import { MoenvDataStore, defaultMoenvDataStore } from '../registry/MoenvDataStore.js';
import type { AuditAlert } from '../core/verification/types.js';

export type AiProvider = 'gemini' | 'openai_compatible';

export interface ByoAiConfig {
  provider: AiProvider;
  api_key: string;
  model: string;
  /** 若使用 Ollama 或自訂端點可填入，預設依 provider 決定 */
  base_url?: string;
}

export interface AdvisoryAiResponse<T> {
  /** 鐵律標記：AI 結果永遠僅供參考，嚴禁自動核准計算或邊界判定 */
  readonly advisory_only: true;
  readonly requires_human_approval: true;
  readonly provider: AiProvider | 'local_deterministic_fallback';
  readonly data: T;
}

export interface ExtractedActivityDraft {
  suggested_material_keyword: string;
  activity_qty: number | null;
  activity_unit: string | null;
  billing_period: string | null;
  confidence_note: string;
}

export interface CodeRecommendationItem {
  material_code: string;
  material_name: string;
  citation_id: string;
  reason: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * BYO-AI 輔助層
 * 僅限單據抽取、代碼推薦與異常說明；無任何核准計算、鎖版或覆寫參數之權限。
 */
export class ByoAiAssistant {
  constructor(
    private config: ByoAiConfig | null = null,
    private readonly dataStore: MoenvDataStore = defaultMoenvDataStore,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  setConfig(config: ByoAiConfig | null): void {
    this.config = config ? { ...config } : null;
  }

  isConfigured(): boolean {
    return Boolean(this.config && this.config.api_key.trim().length > 0);
  }

  getMaskedStatus(): { configured: boolean; provider?: AiProvider; model?: string } {
    if (!this.config) return { configured: false };
    return {
      configured: this.isConfigured(),
      provider: this.config.provider,
      model: this.config.model,
    };
  }

  private async callLlm(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!this.config || !this.isConfigured()) {
      throw new Error('尚未設定 BYO-AI API Key');
    }

    if (this.config.provider === 'gemini') {
      const baseUrl =
        this.config.base_url ?? 'https://generativelanguage.googleapis.com/v1beta';
      const url = `${baseUrl}/models/${encodeURIComponent(this.config.model)}:generateContent?key=${encodeURIComponent(this.config.api_key)}`;
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
            },
          ],
          generationConfig: { temperature: 0.1 },
        }),
      });
      if (!res.ok) {
        throw new Error(`Gemini API 呼叫失敗: HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }

    // OpenAI-compatible (包含 Ollama)
    const baseUrl = this.config.base_url ?? 'https://api.openai.com/v1';
    const res = await this.fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.api_key}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI-compatible API 呼叫失敗: HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content ?? '';
  }

  /**
   * 1. 單據文字抽取活動數據草稿（純建議，不寫入正式計算）
   */
  async extractDocumentActivity(
    rawReceiptText: string
  ): Promise<AdvisoryAiResponse<ExtractedActivityDraft>> {
    if (!this.isConfigured()) {
      // 未設定金鑰時提供確定性關鍵字擷取作為離線草稿
      const numMatch = rawReceiptText.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(公秉|公升|度|千度|立方公尺|公斤|公噸)/);
      return {
        advisory_only: true,
        requires_human_approval: true,
        provider: 'local_deterministic_fallback',
        data: {
          suggested_material_keyword: rawReceiptText.includes('電')
            ? '外購電力'
            : rawReceiptText.includes('汽油')
              ? '車用汽油'
              : rawReceiptText.includes('天然氣')
                ? '天然氣'
                : '待確認項目',
          activity_qty: numMatch ? Number(numMatch[1]!.replace(/,/g, '')) : null,
          activity_unit: numMatch ? numMatch[2]! : null,
          billing_period: null,
          confidence_note: '離線規則草稿抽取，請人工核對原始單據後再填入系統',
        },
      };
    }

    const reply = await this.callLlm(
      '你是溫室氣體盤查單據抽取助手。僅回傳 JSON，格式為 {"suggested_material_keyword": string, "activity_qty": number|null, "activity_unit": string|null, "billing_period": string|null, "confidence_note": string}。不可進行排放量計算。',
      `請從以下單據文字抽取活動數據草稿：\n${rawReceiptText}`
    );
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch
      ? (JSON.parse(jsonMatch[0]) as ExtractedActivityDraft)
      : {
          suggested_material_keyword: '解析失敗',
          activity_qty: null,
          activity_unit: null,
          billing_period: null,
          confidence_note: reply.slice(0, 200),
        };

    return {
      advisory_only: true,
      requires_human_approval: true,
      provider: this.config!.provider,
      data: parsed,
    };
  }

  /**
   * 2. 代碼檔 V2 原燃物料代碼推薦（從已驗證之代碼表篩選，附帶 citation_id）
   */
  async recommendOfficialCodes(
    ownerPlainLabel: string,
    limit = 5
  ): Promise<AdvisoryAiResponse<CodeRecommendationItem[]>> {
    const candidates = this.dataStore.codebook.table8_material_codes
      .filter((m) =>
        ownerPlainLabel
          .split(/\s+/)
          .some((kw) => kw.length > 0 && m.name.includes(kw))
      )
      .slice(0, limit)
      .map((m) => ({
        material_code: m.code,
        material_name: m.name,
        citation_id: m.citation_id,
        reason: `名稱符合關鍵字「${ownerPlainLabel}」（來自代碼檔 V2 附表八）`,
      }));

    if (!this.isConfigured() || candidates.length === 0) {
      return {
        advisory_only: true,
        requires_human_approval: true,
        provider: 'local_deterministic_fallback',
        data: candidates,
      };
    }

    const explanation = await this.callLlm(
      '你是台灣環境部溫室氣體代碼顧問。僅根據提供的候選代碼說明選擇建議，不可編造不存在的代碼。',
      `業主描述：「${ownerPlainLabel}」，候選代碼：${JSON.stringify(candidates)}`
    );

    return {
      advisory_only: true,
      requires_human_approval: true,
      provider: this.config!.provider,
      data: candidates.map((c, idx) =>
        idx === 0 ? { ...c, reason: explanation.slice(0, 160) } : c
      ),
    };
  }

  /**
   * 3. 異常預警與稽核差異白話說明
   */
  async explainAuditAlerts(
    alerts: readonly AuditAlert[]
  ): Promise<AdvisoryAiResponse<string>> {
    if (alerts.length === 0) {
      return {
        advisory_only: true,
        requires_human_approval: true,
        provider: 'local_deterministic_fallback',
        data: '目前無任何稽核預警或阻擋項目。',
      };
    }

    if (!this.isConfigured()) {
      const summary = alerts
        .map((a, i) => `${i + 1}. [${a.severity.toUpperCase()}] ${a.message}（依據：${a.citation_id}）`)
        .join('\n');
      return {
        advisory_only: true,
        requires_human_approval: true,
        provider: 'local_deterministic_fallback',
        data: summary,
      };
    }

    const explanation = await this.callLlm(
      '你是溫室氣體盤查稽核說明助手。請用繁體中文向業主白話解釋以下系統產生的法規預警，並提醒由審核者人工確認。',
      JSON.stringify(alerts)
    );

    return {
      advisory_only: true,
      requires_human_approval: true,
      provider: this.config!.provider,
      data: explanation,
    };
  }
}
