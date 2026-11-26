import seedCitations from './citations.json' with { type: 'json' };
import type { CitedEntry, SourceCitation } from './types.js';

export class MissingCitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingCitationError';
  }
}

export class UnknownCitationError extends Error {
  constructor(citationId: string) {
    super(`未知或未登錄的權威引用來源 citation_id: "${citationId}"`);
    this.name = 'UnknownCitationError';
  }
}

/**
 * 權威引用登錄表（CitationRegistry）
 * Provenance-First Invariant：任何進入系統之代碼、係數、熱值、GWP 皆須具備有效 citation_id
 */
export class CitationRegistry {
  private readonly citations: Map<string, SourceCitation> = new Map();

  constructor(initialCitations: SourceCitation[] = seedCitations as SourceCitation[]) {
    for (const citation of initialCitations) {
      this.register(citation);
    }
  }

  /**
   * 登錄新的權威引用來源
   */
  register(citation: SourceCitation): void {
    if (!citation.citation_id || citation.citation_id.trim() === '') {
      throw new MissingCitationError('登錄 SourceCitation 時 citation_id 不可為空');
    }
    if (!citation.issuer || !citation.document_title || !citation.url) {
      throw new MissingCitationError(
        `SourceCitation "${citation.citation_id}" 缺少必要欄位 (issuer, document_title, url)`
      );
    }
    this.citations.set(citation.citation_id, { ...citation });
  }

  /**
   * 檢查 citation_id 是否存在於登錄表
   */
  has(citationId: string): boolean {
    return this.citations.has(citationId);
  }

  /**
   * 取得特定引用來源；若不存在則拋出錯誤
   */
  get(citationId: string): SourceCitation {
    if (!citationId || citationId.trim() === '') {
      throw new MissingCitationError('查詢權威引用來源時 citation_id 不可為空');
    }
    const found = this.citations.get(citationId);
    if (!found) {
      throw new UnknownCitationError(citationId);
    }
    return found;
  }

  /**
   * 取得所有已登錄之引用來源
   */
  getAll(): SourceCitation[] {
    return Array.from(this.citations.values());
  }

  /**
   * 根據 citation_id 清單取得對應的唯一 SourceCitation[]
   */
  resolveMany(citationIds: Iterable<string>): SourceCitation[] {
    const seen = new Set<string>();
    const result: SourceCitation[] = [];
    for (const id of citationIds) {
      if (!seen.has(id)) {
        seen.add(id);
        result.push(this.get(id));
      }
    }
    return result;
  }

  /**
   * 檢核單筆參數條目是否附帶合法且已登錄之 citation_id
   * 任何缺少或未登錄之條目一律拋錯阻擋
   */
  assertCited<T extends Partial<CitedEntry>>(entry: T, contextLabel = '參數條目'): asserts entry is T & CitedEntry {
    if (!entry || typeof entry !== 'object') {
      throw new MissingCitationError(`${contextLabel} 必須為物件且附帶有效 citation_id`);
    }
    if (!entry.citation_id || typeof entry.citation_id !== 'string' || entry.citation_id.trim() === '') {
      throw new MissingCitationError(`${contextLabel} 缺少 citation_id，依 Provenance-First 鐵律禁止入庫或計算`);
    }
    if (!this.has(entry.citation_id)) {
      throw new UnknownCitationError(entry.citation_id);
    }
  }

  /**
   * 批次檢核多筆參數條目
   */
  assertAllCited<T extends Partial<CitedEntry>>(entries: readonly T[], contextLabel = '參數清單'): void {
    entries.forEach((entry, index) => {
      this.assertCited(entry, `${contextLabel}[${index}]`);
    });
  }
}

export const defaultCitationRegistry = new CitationRegistry();
