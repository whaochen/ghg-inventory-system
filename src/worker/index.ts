import './polyfill.js';
import {
  exportReportToOdsBuffer,
  exportReportToXlsxBuffer,
} from '../adapters/WorkbookAdapter.js';
import { ByoAiAssistant, ByoAiConfig } from '../ai/ByoAiAssistant.js';
import {
  AuthManager,
  ForbiddenError,
  PublicUser,
  UnauthorizedError,
} from '../auth/AuthManager.js';
import { BoundaryManager } from '../core/boundary/BoundaryManager.js';
import type { BoundaryVersion, Site } from '../core/boundary/types.js';
import {
  calculateMobileCombustion,
  calculatePurchasedElectricity,
  calculateRefrigerantFugitive,
  calculateSepticTank,
  calculateStationaryCombustion,
} from '../core/calculators/index.js';
import type { CalculationOutput } from '../core/calculators/types.js';
import { buildInventoryReportPackage } from '../core/reporting/ReportBuilder.js';
import type { InventoryItemCalculation, InventoryReportPackage } from '../core/reporting/types.js';
import { SourceManager } from '../core/source/SourceManager.js';
import type { ActivityRecord, EmissionSource } from '../core/source/types.js';
import type { ActivityUnit, NcvUnit } from '../core/unitConverter.js';
import { AuditSnapshot, createAuditSnapshot } from '../core/verification/AuditGuard.js';
import { defaultMoenvDataStore } from '../registry/MoenvDataStore.js';
import {
  decryptPayload,
  encryptPayload,
  EncryptedEnvelope,
} from '../storage/EncryptedStore.js';

export interface Env {
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
  SESSION_SECRET?: string;
}

export interface StatelessWorkspace {
  boundary_version: BoundaryVersion;
  sites: Site[];
  sources: EmissionSource[];
  activities: ActivityRecord[];
  snapshots: Array<AuditSnapshot<InventoryReportPackage>>;
}

function resolveFuelParams(materialCode: string): {
  ncv_kcal_per_unit: number;
  ncv_unit: Exclude<NcvUnit, null>;
  ncv_citation_id: string;
  co2_tj: number;
  ch4_tj: number;
  n2o_tj: number;
} {
  const ncvEntry = defaultMoenvDataStore.ncv114.entries.find(
    (e) => e.material_code === materialCode
  );
  switch (materialCode) {
    case '170001':
      return {
        ncv_kcal_per_unit: ncvEntry?.ncv_kcal_per_unit ?? 7586,
        ncv_unit: '千卡/公升',
        ncv_citation_id: 'CIT-NCV-114',
        co2_tj: 69300,
        ch4_tj: 3,
        n2o_tj: 0.6,
      };
    case '170006':
      return {
        ncv_kcal_per_unit: ncvEntry?.ncv_kcal_per_unit ?? 8636,
        ncv_unit: '千卡/公升',
        ncv_citation_id: 'CIT-NCV-114',
        co2_tj: 74100,
        ch4_tj: 3,
        n2o_tj: 0.6,
      };
    case '170055':
      return {
        ncv_kcal_per_unit: ncvEntry?.ncv_kcal_per_unit ?? 5993,
        ncv_unit: '千卡/公升',
        ncv_citation_id: 'CIT-NCV-114',
        co2_tj: 63100,
        ch4_tj: 1,
        n2o_tj: 0.1,
      };
    case '170056':
      return {
        ncv_kcal_per_unit: ncvEntry?.ncv_kcal_per_unit ?? 10972,
        ncv_unit: '千卡/公斤',
        ncv_citation_id: 'CIT-NCV-114',
        co2_tj: 63100,
        ch4_tj: 1,
        n2o_tj: 0.1,
      };
    case '050002':
      return {
        ncv_kcal_per_unit: ncvEntry?.ncv_kcal_per_unit ?? 8067,
        ncv_unit: '千卡/立方公尺',
        ncv_citation_id: 'CIT-NCV-114',
        co2_tj: 56100,
        ch4_tj: 1,
        n2o_tj: 0.1,
      };
    case '020012':
      return {
        ncv_kcal_per_unit: 7000,
        ncv_unit: '千卡/公斤',
        ncv_citation_id: 'CIT-EF-MOENV-113',
        co2_tj: 112000,
        ch4_tj: 200,
        n2o_tj: 4,
      };
    default:
      return {
        ncv_kcal_per_unit: 7586,
        ncv_unit: '千卡/公升',
        ncv_citation_id: 'CIT-NCV-114',
        co2_tj: 69300,
        ch4_tj: 3,
        n2o_tj: 0.6,
      };
  }
}

function calculateActivityItem(
  source: EmissionSource,
  activity: ActivityRecord
): CalculationOutput {
  if (source.emission_type === 'purchased_electricity') {
    return calculatePurchasedElectricity({
      material_code: source.material_code,
      activity_qty: activity.activity_qty,
      activity_unit: activity.activity_unit === '度' ? '度' : '千度',
      alloc_ratio: activity.alloc_ratio,
      grid_ef_kg_per_kwh: 0.474,
      ef_citation_id: 'CIT-EF-MOENV-113',
    });
  }
  if (source.emission_type === 'fugitive' && source.equipment_code === '9795') {
    return calculateSepticTank(
      activity.activity_unit === '公噸(BOD)'
        ? {
            mode: 'bod_tonnes',
            material_code: source.material_code,
            bod_tonnes: activity.activity_qty,
            alloc_ratio: activity.alloc_ratio,
            factor_citation_id: 'CIT-EF-MOENV-113',
          }
        : {
            mode: 'person_day',
            material_code: source.material_code,
            person_days: activity.activity_qty,
            alloc_ratio: activity.alloc_ratio,
            factor_citation_id: 'CIT-EF-MOENV-113',
          }
    );
  }
  if (source.emission_type === 'fugitive') {
    return calculateRefrigerantFugitive({
      material_code: source.material_code,
      equipment_code: source.equipment_code,
      charge_kg: activity.activity_qty,
      alloc_ratio: activity.alloc_ratio,
      leak_rate_pct: 8.5,
      leak_rate_citation_id: 'CIT-EF-MOENV-113',
    });
  }

  const fuel = resolveFuelParams(source.material_code);

  if (source.emission_type === 'mobile') {
    const mobileUnit = (
      ['公升', '公秉', '立方公尺', '千立方公尺'].includes(activity.activity_unit)
        ? activity.activity_unit
        : '公秉'
    ) as Extract<ActivityUnit, '公升' | '公秉' | '立方公尺' | '千立方公尺'>;
    return calculateMobileCombustion({
      material_code: source.material_code,
      activity_qty: activity.activity_qty,
      activity_unit: mobileUnit,
      alloc_ratio: activity.alloc_ratio,
      is_biomass: source.is_biomass,
      ncv_kcal_per_unit: fuel.ncv_kcal_per_unit,
      ncv_unit: fuel.ncv_unit,
      ncv_citation_id: fuel.ncv_citation_id,
      co2: { ef_kg_per_tj: fuel.co2_tj, citation_id: 'CIT-EF-MOENV-113' },
    });
  }

  const statUnit = (
    ['公斤', '公噸', '公升', '公秉', '立方公尺', '千立方公尺'].includes(activity.activity_unit)
      ? activity.activity_unit
      : '立方公尺'
  ) as Extract<ActivityUnit, '公斤' | '公噸' | '公升' | '公秉' | '立方公尺' | '千立方公尺'>;
  return calculateStationaryCombustion({
    material_code: source.material_code,
    activity_qty: activity.activity_qty,
    activity_unit: statUnit,
    alloc_ratio: activity.alloc_ratio,
    is_biomass: source.is_biomass,
    ncv_kcal_per_unit: fuel.ncv_kcal_per_unit,
    ncv_unit: fuel.ncv_unit,
    ncv_citation_id: fuel.ncv_citation_id,
    co2: { ef_kg_per_tj: fuel.co2_tj, citation_id: 'CIT-EF-MOENV-113' },
    ch4: { ef_kg_per_tj: fuel.ch4_tj, citation_id: 'CIT-EF-MOENV-113' },
    n2o: { ef_kg_per_tj: fuel.n2o_tj, citation_id: 'CIT-EF-MOENV-113' },
  });
}

function buildReportFromStatelessWorkspace(ws: StatelessWorkspace): InventoryReportPackage {
  const bm = new BoundaryManager(ws.boundary_version);
  for (const s of ws.sites) bm.addSite(s);
  const sm = new SourceManager(bm);
  for (const src of ws.sources) sm.addSource(src);
  for (const act of ws.activities) sm.addActivity(act);

  const items: InventoryItemCalculation[] = ws.activities.map((act) => {
    const src = sm.getSource(act.source_id)!;
    return {
      activity: act,
      source: src,
      calculation: calculateActivityItem(src, act),
    };
  });

  return buildInventoryReportPackage({
    boundary_version: bm.getVersion(),
    sites: bm.getAllSites(),
    exclusions: bm.getExclusions(),
    utility_accounts: bm.getUtilityAccounts(),
    items,
  });
}

function createAuth(env: Env): AuthManager {
  // 無狀態 Worker 使用固定密鑰驗證簽章；正式環境請以 wrangler secret 設定 SESSION_SECRET
  const secretHex =
    env.SESSION_SECRET ??
    '4f8c9a12e5d34b7a8c19f02b77e4a6d9c20f8b13e5a7c9d1b3f5e7a9c1d3e5f7';
  const auth = new AuthManager(secretHex);
  auth.createUser({
    username: 'admin',
    display_name: '系統管理者',
    role: 'admin',
    password: 'admin-password-123',
  });
  auth.createUser({
    username: 'reviewer',
    display_name: '查驗顧問 / 審核者',
    role: 'reviewer',
    password: 'reviewer-password-123',
  });
  auth.createUser({
    username: 'user',
    display_name: '業主填報人員',
    role: 'user',
    password: 'user-password-123',
  });
  return auth;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 非 /api/* 交給 Workers Static Assets (public/index.html)
    if (!path.startsWith('/api/')) {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return jsonResponse({ status: 'ok', mode: 'cloudflare-worker-stateless' });
    }

    const auth = createAuth(env);

    try {
      if (method === 'POST' && path === '/api/auth/login') {
        const body = (await request.json()) as { username: string; password: string };
        return jsonResponse(auth.authenticate(body.username, body.password));
      }

      const authHeader = request.headers.get('Authorization') ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
      const currentUser: PublicUser = auth.verifyToken(token);

      if (method === 'GET' && path === '/api/auth/me') {
        return jsonResponse({ user: currentUser });
      }

      if (method === 'GET' && path === '/api/ncv-114') {
        return jsonResponse({ ncv_114: defaultMoenvDataStore.ncv114.entries });
      }

      // 無狀態計算報表（前端傳入本機 localStorage 保存的 workspace）
      if (method === 'POST' && path === '/api/report/calculate') {
        auth.assertPermission(currentUser, 'review_inventory');
        const body = (await request.json()) as { workspace: StatelessWorkspace };
        const report = buildReportFromStatelessWorkspace(body.workspace);
        return jsonResponse({ report });
      }

      if (method === 'POST' && path === '/api/report/lock-snapshot') {
        auth.assertPermission(currentUser, 'lock_boundary_and_snapshot');
        const body = (await request.json()) as { workspace: StatelessWorkspace };
        const report = buildReportFromStatelessWorkspace(body.workspace);
        const snapshot = createAuditSnapshot(
          `SNAP-${(body.workspace.snapshots?.length ?? 0) + 1}`,
          body.workspace.boundary_version.boundary_version_id,
          report
        );
        return jsonResponse({ snapshot });
      }

      if (method === 'POST' && path === '/api/export/xlsx') {
        auth.assertPermission(currentUser, 'export_official_reports');
        const body = (await request.json()) as { workspace: StatelessWorkspace };
        const report = buildReportFromStatelessWorkspace(body.workspace);
        const buf = await exportReportToXlsxBuffer(report);
        return new Response(new Uint8Array(buf), {
          status: 200,
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="ghg_inventory.xlsx"',
          },
        });
      }

      if (method === 'POST' && path === '/api/export/ods') {
        auth.assertPermission(currentUser, 'export_official_reports');
        const body = (await request.json()) as { workspace: StatelessWorkspace };
        const report = buildReportFromStatelessWorkspace(body.workspace);
        const buf = await exportReportToOdsBuffer(report);
        return new Response(new Uint8Array(buf), {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.oasis.opendocument.spreadsheet',
            'Content-Disposition': 'attachment; filename="ghg_inventory.ods"',
          },
        });
      }

      // 無狀態加密備份與解密還原（支援跨裝置攜帶 .backup.enc）
      if (method === 'POST' && path === '/api/backup/export') {
        auth.assertPermission(currentUser, 'manage_backup');
        const body = (await request.json()) as {
          passphrase: string;
          workspace: StatelessWorkspace;
        };
        const envelope = encryptPayload({ workspace: body.workspace }, body.passphrase);
        return jsonResponse({ envelope });
      }

      if (method === 'POST' && path === '/api/backup/restore') {
        auth.assertPermission(currentUser, 'manage_backup');
        const body = (await request.json()) as {
          passphrase: string;
          envelope: EncryptedEnvelope;
        };
        const restored = decryptPayload<{ workspace: StatelessWorkspace }>(
          body.envelope,
          body.passphrase
        );
        return jsonResponse({ restored: true, workspace: restored.workspace });
      }

      // BYO-AI 輔助（金鑰由請求端提供，不落地雲端）
      if (method === 'POST' && path === '/api/ai/extract') {
        auth.assertPermission(currentUser, 'use_ai_assistant');
        const body = (await request.json()) as { text: string; ai_config?: ByoAiConfig | null };
        const ai = new ByoAiAssistant(body.ai_config ?? null);
        return jsonResponse(await ai.extractDocumentActivity(body.text ?? ''));
      }

      if (method === 'POST' && path === '/api/ai/recommend-code') {
        auth.assertPermission(currentUser, 'use_ai_assistant');
        const body = (await request.json()) as { label: string; ai_config?: ByoAiConfig | null };
        const ai = new ByoAiAssistant(body.ai_config ?? null);
        return jsonResponse(await ai.recommendOfficialCodes(body.label ?? ''));
      }

      return jsonResponse({ error: 'Not Found' }, 404);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return jsonResponse({ error: err.message }, 401);
      }
      if (err instanceof ForbiddenError) {
        return jsonResponse({ error: err.message }, 403);
      }
      const message = err instanceof Error ? err.message : 'Internal Server Error';
      return jsonResponse({ error: message }, 400);
    }
  },
};
