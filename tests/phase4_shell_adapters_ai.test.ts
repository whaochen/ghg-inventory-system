import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  exportReportToOdsBuffer,
  exportReportToXlsxBuffer,
  importActivitiesFromOdsBuffer,
  importActivitiesFromXlsxBuffer,
} from '../src/adapters/WorkbookAdapter.js';
import { ByoAiAssistant } from '../src/ai/ByoAiAssistant.js';
import { BoundaryManager } from '../src/core/boundary/BoundaryManager.js';
import {
  calculateMassBalance,
  calculatePurchasedElectricity,
  calculateRefrigerantFugitive,
} from '../src/core/calculators/index.js';
import { buildInventoryReportPackage } from '../src/core/reporting/ReportBuilder.js';
import { SourceManager } from '../src/core/source/SourceManager.js';
import { createAppServer, RequestHandler } from '../src/server/app.js';
import workerEntry from '../src/worker/index.js';
import {
  DecryptionError,
  decryptPayload,
  encryptPayload,
} from '../src/storage/EncryptedStore.js';

async function invokeApp(
  handler: RequestHandler,
  opts: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
  }
): Promise<{ status: number; bodyBuffer: Buffer; json: <T>() => T }> {
  const req = new EventEmitter() as IncomingMessage;
  req.method = opts.method;
  req.url = opts.url;
  req.headers = Object.fromEntries(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
  );

  let status = 200;
  const chunks: Buffer[] = [];

  const res = {
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(data?: string | Buffer) {
      if (data !== undefined) {
        chunks.push(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
      }
      return this;
    },
  } as unknown as ServerResponse;

  const execPromise = handler(req, res);
  if (opts.body !== undefined) {
    req.emit('data', Buffer.from(JSON.stringify(opts.body), 'utf8'));
  }
  req.emit('end');
  await execPromise;

  const bodyBuffer = Buffer.concat(chunks);
  return {
    status,
    bodyBuffer,
    json: <T>() => JSON.parse(bodyBuffer.toString('utf8')) as T,
  };
}

describe('Phase 4: Web 應用、RBAC 帳密、加密備份、XLSX/ODS 配接器與 BYO-AI', () => {
  it('AES-256-GCM 加密備份往返正確且錯誤密碼拋出 DecryptionError', () => {
    const secretData = { tax_id: '12345678', total: 34548.107 };
    const envelope = encryptPayload(secretData, 'strong-pass-123');
    expect(envelope.algorithm).toBe('aes-256-gcm');

    const restored = decryptPayload<typeof secretData>(envelope, 'strong-pass-123');
    expect(restored).toEqual(secretData);

    expect(() => decryptPayload(envelope, 'wrong-pass')).toThrow(DecryptionError);
  });

  it('XLSX 與 ODS 官方清冊匯出及活動數據匯入往返一致', async () => {
    const bm = new BoundaryManager({
      boundary_version_id: 'BV-ADAPTER-01',
      inventory_year_roc: 113,
      regime_mode: 'mandatory_register',
      report_mode: 'service_multi_site',
      boundary_method: 'operational_control',
      tax_id: '88776655',
      industry_code: '4711',
      locked: false,
      citation_ids: ['CIT-LAW-MGT', 'CIT-TPL-SVC3'],
    });
    bm.addSite({
      site_id: 'D00001',
      site_name: '台北總公司',
      site_type: '辦公室',
      zip3: '100',
      address: '臺北市中正區1號',
      inclusion_status: 'included',
      operating_periods: [{ start_date: '2024-01-01', end_date: '2024-12-31' }],
    });

    const sm = new SourceManager(bm);
    const src = {
      source_id: 'SRC-GP01',
      site_id: 'D00001',
      owner_label: '總公司外購電力',
      process_no: 'G01',
      equipment_no: 'GP01',
      process_code: '000000',
      equipment_code: '9999',
      material_code: 'GG3500',
      scope: 'scope_2' as const,
      emission_type: 'purchased_electricity' as const,
      is_biomass: false,
      is_chp: false,
      codebook_citation_id: 'CIT-CODE-V2',
    };
    sm.addSource(src);

    const act = {
      activity_id: 'ACT-GP01',
      source_id: 'SRC-GP01',
      in_use_this_year: true,
      activity_qty: 250,
      activity_unit: '千度' as const,
      alloc_ratio: 1.0,
      data_source_desc: '電費單',
      data_source_tier: 'periodic_measure' as const,
      evidence_files: [{ filename: 'bill_2024.pdf' }],
    };
    sm.addActivity(act);

    const calc = calculatePurchasedElectricity({
      material_code: 'GG3500',
      activity_qty: 250,
      activity_unit: '千度',
      alloc_ratio: 1.0,
      grid_ef_kg_per_kwh: 0.474,
      ef_citation_id: 'CIT-EF-MOENV-113',
    });

    const pkg = buildInventoryReportPackage({
      boundary_version: bm.lockVersion(),
      sites: bm.getAllSites(),
      exclusions: [],
      utility_accounts: [],
      items: [{ activity: act, source: src, calculation: calc }],
    });

    const xlsxBuf = await exportReportToXlsxBuffer(pkg);
    const odsBuf = await exportReportToOdsBuffer(pkg);

    expect(xlsxBuf.length).toBeGreaterThan(1000);
    expect(odsBuf.length).toBeGreaterThan(500);

    const fromXlsx = await importActivitiesFromXlsxBuffer(xlsxBuf);
    const fromOds = await importActivitiesFromOdsBuffer(odsBuf);

    expect(fromXlsx).toHaveLength(1);
    expect(fromXlsx[0]!.activity_id).toBe('ACT-GP01');
    expect(fromXlsx[0]!.activity_qty).toBe(250);
    expect(fromXlsx[0]!.activity_unit).toBe('千度');

    expect(fromOds).toHaveLength(1);
    expect(fromOds[0]!.activity_id).toBe('ACT-GP01');
    expect(fromOds[0]!.activity_qty).toBe(250);
    expect(fromOds[0]!.evidence_filename).toBe('bill_2024.pdf');
  });

  it('BYO-AI 輔助層強制 advisory_only 且支援 Gemini 模擬呼叫與代碼推薦', async () => {
    const ai = new ByoAiAssistant();

    // 1. 未設定金鑰時走離線確定性抽取，仍強制 advisory_only
    const offlineDraft = await ai.extractDocumentActivity('本期台電用電 150.5 千度');
    expect(offlineDraft.advisory_only).toBe(true);
    expect(offlineDraft.requires_human_approval).toBe(true);
    expect(offlineDraft.data.activity_qty).toBe(150.5);
    expect(offlineDraft.data.activity_unit).toBe('千度');

    // 2. 代碼推薦附帶 citation_id
    const recs = await ai.recommendOfficialCodes('天然氣');
    expect(recs.advisory_only).toBe(true);
    expect(recs.data.length).toBeGreaterThan(0);
    expect(recs.data[0]!.citation_id).toBe('CIT-CODE-V2');

    // 3. 模擬 Gemini API 回應
    const geminiAi = new ByoAiAssistant(
      { provider: 'gemini', api_key: 'fake-key', model: 'gemini-2.5-flash' },
      undefined,
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: '{"suggested_material_keyword":"車用汽油","activity_qty":300,"activity_unit":"公升","billing_period":"2024-05","confidence_note":"來自加油單據"}',
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 }
        )
    );
    const geminiDraft = await geminiAi.extractDocumentActivity('中油車用汽油 300 公升');
    expect(geminiDraft.provider).toBe('gemini');
    expect(geminiDraft.advisory_only).toBe(true);
    expect(geminiDraft.data.activity_qty).toBe(300);
  });

  it('Web 伺服器與三角色 RBAC 權限控管端到端測試 (admin / reviewer / user)', async () => {
    const { requestHandler } = createAppServer();

    async function login(username: string, password: string): Promise<string> {
      const res = await invokeApp(requestHandler, {
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'Content-Type': 'application/json' },
        body: { username, password },
      });
      expect(res.status).toBe(200);
      return res.json<{ token: string }>().token;
    }

    const userToken = await login('user', 'user-password-123');
    const reviewerToken = await login('reviewer', 'reviewer-password-123');
    const adminToken = await login('admin', 'admin-password-123');

    // 1. user 無權鎖版或匯出備份 (403)
    const forbiddenLock = await invokeApp(requestHandler, {
      method: 'POST',
      url: '/api/report/lock-snapshot',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(forbiddenLock.status).toBe(403);

    // 2. user 可更新活動數據
    const saveAct = await invokeApp(requestHandler, {
      method: 'POST',
      url: '/api/activities',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: {
        activity_id: 'ACT-ELEC-01',
        source_id: 'SRC-ELEC-01',
        in_use_this_year: true,
        activity_qty: 200,
        activity_unit: '千度',
        alloc_ratio: 1.0,
        data_source_desc: '台電帳單',
        data_source_tier: 'periodic_measure',
        evidence_files: [{ filename: 'taipower_2024_updated.pdf' }],
      },
    });
    expect(saveAct.status).toBe(200);

    // 3. reviewer 可計算報表並匯出 .xlsx / .ods，但無權匯出加密備份 (403)
    const calcRes = await invokeApp(requestHandler, {
      method: 'POST',
      url: '/api/report/calculate',
      headers: { Authorization: `Bearer ${reviewerToken}` },
    });
    expect(calcRes.status).toBe(200);
    const calcJson = calcRes.json<{
      report: { tracks: { MOENV_AR5: { total_co2e_tonnes: number } } };
    }>();
    // 200 * 0.474 + 10 * 8.5 * 0.00001 * 1300 = 94.8 + 1.17 = 95.970
    expect(calcJson.report.tracks.MOENV_AR5.total_co2e_tonnes).toBe(95.97);

    const xlsxRes = await invokeApp(requestHandler, {
      method: 'GET',
      url: '/api/export/xlsx',
      headers: { Authorization: `Bearer ${reviewerToken}` },
    });
    expect(xlsxRes.status).toBe(200);
    expect(xlsxRes.bodyBuffer.length).toBeGreaterThan(1000);

    const reviewerBackup = await invokeApp(requestHandler, {
      method: 'POST',
      url: '/api/backup/export',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${reviewerToken}`,
      },
      body: { passphrase: 'secret' },
    });
    expect(reviewerBackup.status).toBe(403);

    // 4. reviewer 鎖版產出不可變 AuditSnapshot
    const lockRes = await invokeApp(requestHandler, {
      method: 'POST',
      url: '/api/report/lock-snapshot',
      headers: { Authorization: `Bearer ${reviewerToken}` },
    });
    expect(lockRes.status).toBe(200);

    // 5. admin 可匯出加密備份並還原
    const backupRes = await invokeApp(requestHandler, {
      method: 'POST',
      url: '/api/backup/export',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: { passphrase: 'admin-backup-key' },
    });
    expect(backupRes.status).toBe(200);
    const { envelope } = backupRes.json<{ envelope: unknown }>();

    const restoreRes = await invokeApp(requestHandler, {
      method: 'POST',
      url: '/api/backup/restore',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: { passphrase: 'admin-backup-key', envelope },
    });
    expect(restoreRes.status).toBe(200);
  });

  it('一鍵載入五大排放源範本（含 114 年度熱值與生質能源）並完成計算', async () => {
    const { requestHandler } = createAppServer();
    const loginRes = await invokeApp(requestHandler, {
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'admin', password: 'admin-password-123' },
    });
    const token = loginRes.json<{ token: string }>().token;

    const seedRes = await invokeApp(requestHandler, {
      method: 'POST',
      url: '/api/workspace/seed-all-sources',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(seedRes.status).toBe(200);
    expect(seedRes.json<{ count: number }>().count).toBe(6);

    const calcRes = await invokeApp(requestHandler, {
      method: 'POST',
      url: '/api/report/calculate',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(calcRes.status).toBe(200);
    const { report } = calcRes.json<{
      report: {
        biogenic_co2_tonnes: number;
        notices: string[];
        source_citations: Array<{ citation_id: string }>;
      };
    }>();
    expect(report.biogenic_co2_tonnes).toBeGreaterThan(0);
    expect(report.notices.some((n) => n.includes('未驗證'))).toBe(true);
    expect(report.source_citations.some((c) => c.citation_id === 'CIT-NCV-114')).toBe(true);
  });

  it('Cloudflare Worker 無狀態入口 (fetch Request -> Response) 完整運作', async () => {
    const loginRes = await workerEntry.fetch(
      new Request('https://example.workers.dev/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'reviewer', password: 'reviewer-password-123' }),
      }),
      {}
    );
    expect(loginRes.status).toBe(200);
    const { token } = (await loginRes.json()) as { token: string };

    const ws = {
      boundary_version: {
        boundary_version_id: 'BV-CF-01',
        inventory_year_roc: 113,
        regime_mode: 'mandatory_register' as const,
        report_mode: 'service_multi_site' as const,
        boundary_method: 'operational_control' as const,
        tax_id: '12345678',
        industry_code: '4711',
        locked: false,
        citation_ids: ['CIT-LAW-MGT', 'CIT-CODE-V2'],
      },
      sites: [
        {
          site_id: 'D00001',
          site_name: '台北總公司',
          site_type: '辦公室',
          zip3: '100',
          address: '臺北市中正區1號',
          inclusion_status: 'included' as const,
          operating_periods: [{ start_date: '2024-01-01', end_date: '2024-12-31' }],
        },
      ],
      sources: [
        {
          source_id: 'SRC-ELEC',
          site_id: 'D00001',
          owner_label: '外購電力',
          process_no: 'G01',
          equipment_no: 'GP01',
          process_code: '000000',
          equipment_code: '9999',
          material_code: 'GG3500',
          scope: 'scope_2' as const,
          emission_type: 'purchased_electricity' as const,
          is_biomass: false,
          is_chp: false,
          codebook_citation_id: 'CIT-CODE-V2',
        },
      ],
      activities: [
        {
          activity_id: 'ACT-ELEC',
          source_id: 'SRC-ELEC',
          in_use_this_year: true,
          activity_qty: 100,
          activity_unit: '千度' as const,
          alloc_ratio: 1.0,
          data_source_desc: '電費單',
          data_source_tier: 'periodic_measure' as const,
          evidence_files: [{ filename: 'bill.pdf' }],
        },
      ],
      snapshots: [],
    };

    const calcRes = await workerEntry.fetch(
      new Request('https://example.workers.dev/api/report/calculate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ workspace: ws }),
      }),
      {}
    );
    expect(calcRes.status).toBe(200);
    const calcJson = (await calcRes.json()) as {
      report: { tracks: { MOENV_AR5: { total_co2e_tonnes: number } } };
    };
    expect(calcJson.report.tracks.MOENV_AR5.total_co2e_tonnes).toBe(47.4);

    const xlsxRes = await workerEntry.fetch(
      new Request('https://example.workers.dev/api/export/xlsx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ workspace: ws }),
      }),
      {}
    );
    expect(xlsxRes.status).toBe(200);
    expect((await xlsxRes.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it('大專校院 V3 實測：質量平衡法 (CO2/乙炔/N2O/乙醇)、R-410a 與代碼搜尋 API', async () => {
    // 1. 消防二氧化碳 20 公斤 -> 0.0200 t CO2
    const co2Fire = calculateMassBalance({
      material_code: '180014',
      activity_qty: 20,
      activity_unit: '公斤',
      alloc_ratio: 1.0,
    });
    expect(co2Fire.gas_details[0]!.raw_gas_tonnes).toBe(0.02);

    // 2. 點焊乙炔 0.0040 公噸 -> 0.0135 t CO2
    const acetylene = calculateMassBalance({
      material_code: '180191',
      activity_qty: 0.004,
      activity_unit: '公噸',
      alloc_ratio: 1.0,
    });
    expect(acetylene.gas_details[0]!.raw_gas_tonnes).toBe(0.0135);

    // 3. 氧化亞氮鋼瓶 0.0100 公噸 -> 0.0100 t N2O -> AR5 2.6500 t CO2e
    const n2o = calculateMassBalance({
      material_code: 'GG1802',
      activity_qty: 0.01,
      activity_unit: '公噸',
      alloc_ratio: 1.0,
    });
    expect(n2o.gas_details[0]!.raw_gas_tonnes).toBe(0.01);
    expect(n2o.gas_details[0]!.projections.MOENV_AR5.co2e_tonnes).toBe(2.65);

    // 4. 乙醇 0.1000 公升 -> 0.0002 t CO2
    const ethanol = calculateMassBalance({
      material_code: '180267',
      activity_qty: 0.1,
      activity_unit: '公升',
      alloc_ratio: 1.0,
    });
    expect(ethanol.gas_details[0]!.raw_gas_tonnes).toBe(0.0002);

    // 5. R-410A (GG1814): 50% HFC-32 + 50% HFC-125
    const r410a = calculateRefrigerantFugitive({
      material_code: 'GG1814',
      equipment_code: '4091',
      charge_kg: 6,
      alloc_ratio: 1.0,
      leak_rate_pct: 8.5,
      leak_rate_citation_id: 'CIT-EF-MOENV-113',
    });
    expect(r410a.gas_details).toHaveLength(2);

    // 6. Worker /api/codebook/search 搜尋 0298 發電機與 GG1802
    const loginRes = await workerEntry.fetch(
      new Request('https://example.workers.dev/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'user', password: 'user-password-123' }),
      }),
      {}
    );
    const { token } = (await loginRes.json()) as { token: string };
    const searchRes = await workerEntry.fetch(
      new Request('https://example.workers.dev/api/codebook/search?q=發電機', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      {}
    );
    expect(searchRes.status).toBe(200);
    const searchJson = (await searchRes.json()) as {
      equipment_codes: Array<{ code: string }>;
    };
    expect(searchJson.equipment_codes.some((e) => e.code === '0298')).toBe(true);
  });
});
