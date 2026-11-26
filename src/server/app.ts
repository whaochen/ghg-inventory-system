import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
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
  UserAccount,
  UserRole,
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

export interface AppWorkspaceState {
  boundary_version: BoundaryVersion;
  sites: Site[];
  sources: EmissionSource[];
  activities: ActivityRecord[];
  snapshots: Array<AuditSnapshot<InventoryReportPackage>>;
}

interface BackupBundle {
  users: UserAccount[];
  workspace: AppWorkspaceState;
}

function createDefaultWorkspace(): AppWorkspaceState {
  return {
    boundary_version: {
      boundary_version_id: 'BV-113-DEFAULT',
      inventory_year_roc: 113,
      regime_mode: 'mandatory_register',
      report_mode: 'service_multi_site',
      boundary_method: 'operational_control',
      tax_id: '12345678',
      industry_code: '4711',
      regulated_industry_code: 'RIC0003',
      regulated_condition_code: 'RIT0001',
      locked: false,
      citation_ids: ['CIT-LAW-MGT', 'CIT-CODE-V2', 'CIT-TPL-SVC3'],
    },
    sites: [
      {
        site_id: 'D00001',
        site_name: '台北總公司',
        site_type: '辦公室',
        zip3: '100',
        address: '臺北市中正區忠孝西路一段1號',
        inclusion_status: 'included',
        operating_periods: [{ start_date: '2024-01-01', end_date: '2024-12-31' }],
        station_purpose_code: '0',
      },
    ],
    sources: [
      {
        source_id: 'SRC-ELEC-01',
        site_id: 'D00001',
        owner_label: '總公司用電',
        process_no: 'G01',
        equipment_no: 'GP01',
        process_code: '000000',
        equipment_code: '9999',
        material_code: 'GG3500',
        scope: 'scope_2',
        emission_type: 'purchased_electricity',
        is_biomass: false,
        is_chp: false,
        codebook_citation_id: 'CIT-CODE-V2',
      },
      {
        source_id: 'SRC-REF-01',
        site_id: 'D00001',
        owner_label: '總公司冰水機冷媒',
        process_no: 'G01',
        equipment_no: 'GF01',
        process_code: '000000',
        equipment_code: '4092',
        material_code: 'GG1835',
        scope: 'scope_1',
        emission_type: 'fugitive',
        is_biomass: false,
        is_chp: false,
        codebook_citation_id: 'CIT-CODE-V2',
      },
    ],
    activities: [
      {
        activity_id: 'ACT-ELEC-01',
        source_id: 'SRC-ELEC-01',
        in_use_this_year: true,
        activity_qty: 120,
        activity_unit: '千度',
        alloc_ratio: 1.0,
        data_source_desc: '台電電費單',
        data_source_tier: 'periodic_measure',
        evidence_files: [{ filename: 'taipower_2024.pdf' }],
      },
      {
        activity_id: 'ACT-REF-01',
        source_id: 'SRC-REF-01',
        in_use_this_year: true,
        activity_qty: 10,
        activity_unit: '公斤/年',
        alloc_ratio: 1.0,
        data_source_desc: '設備銘牌',
        data_source_tier: 'estimate',
        evidence_files: [{ filename: 'chiller_plate.jpg' }],
      },
    ],
    snapshots: [],
  };
}

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolvePromise((raw ? JSON.parse(raw) : {}) as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function extractBearerToken(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return undefined;
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

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export interface AppContext {
  auth: AuthManager;
  ai: ByoAiAssistant;
  getWorkspace: () => AppWorkspaceState;
  requestHandler: RequestHandler;
  server: Server;
}

export function createAppServer(options?: {
  seedDefaultUsers?: boolean;
  publicDir?: string;
}): AppContext {
  const auth = new AuthManager();
  const ai = new ByoAiAssistant();
  let workspace = createDefaultWorkspace();

  if (options?.seedDefaultUsers !== false) {
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
  }

  const publicDir = options?.publicDir ?? resolve(process.cwd(), 'public');

  function buildReportFromWorkspace(ws: AppWorkspaceState = workspace): InventoryReportPackage {
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

  const requestHandler: RequestHandler = async (req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0] ?? '/';
    const method = req.method ?? 'GET';

    try {
      // 1. 靜態首頁
      if (method === 'GET' && urlPath === '/') {
        const indexPath = resolve(publicDir, 'index.html');
        if (existsSync(indexPath)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(readFileSync(indexPath, 'utf8'));
          return;
        }
        sendJson(res, 200, { status: 'ok', service: 'AI GHG Inventory System' });
        return;
      }

      // 2. 登入與身分驗證
      if (method === 'POST' && urlPath === '/api/auth/login') {
        const body = await readJsonBody<{ username: string; password: string }>(req);
        const session = auth.authenticate(body.username, body.password);
        sendJson(res, 200, session);
        return;
      }

      const currentUser: PublicUser = auth.verifyToken(extractBearerToken(req));

      if (method === 'GET' && urlPath === '/api/auth/me') {
        sendJson(res, 200, { user: currentUser });
        return;
      }

      // 3. 管理者：帳號管理
      if (method === 'GET' && urlPath === '/api/users') {
        auth.assertPermission(currentUser, 'manage_users');
        sendJson(res, 200, { users: auth.listUsers() });
        return;
      }

      if (method === 'POST' && urlPath === '/api/users') {
        auth.assertPermission(currentUser, 'manage_users');
        const body = await readJsonBody<{
          username: string;
          display_name: string;
          role: UserRole;
          password: string;
        }>(req);
        const created = auth.createUser(body);
        sendJson(res, 201, { user: created });
        return;
      }

      // 4. 管理者：加密備份匯出與還原
      if (method === 'POST' && urlPath === '/api/backup/export') {
        auth.assertPermission(currentUser, 'manage_backup');
        const body = await readJsonBody<{
          passphrase: string;
          workspace?: AppWorkspaceState;
        }>(req);
        const bundle: BackupBundle = {
          users: auth.exportUsers(),
          workspace: body.workspace ?? workspace,
        };
        const envelope = encryptPayload(bundle, body.passphrase);
        sendJson(res, 200, { envelope });
        return;
      }

      if (method === 'POST' && urlPath === '/api/backup/restore') {
        auth.assertPermission(currentUser, 'manage_backup');
        const body = await readJsonBody<{
          passphrase: string;
          envelope: EncryptedEnvelope;
        }>(req);
        const restored = decryptPayload<BackupBundle>(body.envelope, body.passphrase);
        if (restored.users) {
          auth.importUsers(restored.users);
        }
        workspace = restored.workspace;
        sendJson(res, 200, {
          restored: true,
          sites_count: workspace.sites.length,
          workspace,
        });
        return;
      }

      // 5. 管理者：設定 BYO-AI
      if (method === 'POST' && urlPath === '/api/ai/config') {
        auth.assertPermission(currentUser, 'configure_ai');
        const body = await readJsonBody<ByoAiConfig | null>(req);
        ai.setConfig(body);
        sendJson(res, 200, ai.getMaskedStatus());
        return;
      }

      // 6. 讀取盤查資料（所有已登入角色）
      if (method === 'GET' && urlPath === '/api/inventory') {
        sendJson(res, 200, {
          workspace,
          ai_status: ai.getMaskedStatus(),
          ncv_114: defaultMoenvDataStore.ncv114.entries,
        });
        return;
      }

      // 7. 業主 / 管理者：新增排放源與活動數據、一鍵載入五大排放源範本
      if (method === 'POST' && urlPath === '/api/sources') {
        auth.assertPermission(currentUser, 'edit_activity_data');
        if (workspace.boundary_version.locked) {
          sendJson(res, 409, { error: '邊界版本已鎖定，禁止修改排放源' });
          return;
        }
        const body = await readJsonBody<{
          source: EmissionSource;
          activity: ActivityRecord;
        }>(req);
        const bm = new BoundaryManager(workspace.boundary_version);
        for (const s of workspace.sites) bm.addSite(s);
        const sm = new SourceManager(bm);
        sm.addSource(body.source);
        const warnings = sm.addActivity(body.activity);

        const sIdx = workspace.sources.findIndex((s) => s.source_id === body.source.source_id);
        if (sIdx >= 0) workspace.sources[sIdx] = body.source;
        else workspace.sources.push(body.source);

        const aIdx = workspace.activities.findIndex(
          (a) => a.activity_id === body.activity.activity_id
        );
        if (aIdx >= 0) workspace.activities[aIdx] = body.activity;
        else workspace.activities.push(body.activity);

        sendJson(res, 200, { source: body.source, activity: body.activity, warnings });
        return;
      }

      if (method === 'POST' && urlPath === '/api/workspace/seed-all-sources') {
        auth.assertPermission(currentUser, 'edit_activity_data');
        if (workspace.boundary_version.locked) {
          sendJson(res, 409, { error: '邊界版本已鎖定，禁止重置範本' });
          return;
        }
        const extraSources: EmissionSource[] = [
          {
            source_id: 'SRC-GS-01',
            site_id: 'D00001',
            owner_label: '員工餐廳天然氣鍋爐',
            process_no: 'G01',
            equipment_no: 'GS01',
            process_code: '000000',
            equipment_code: '0000',
            material_code: '050002',
            scope: 'scope_1',
            emission_type: 'stationary',
            is_biomass: false,
            is_chp: false,
            ch4_origin: 'non_fossil_combustion',
            codebook_citation_id: 'CIT-CODE-V2',
          },
          {
            source_id: 'SRC-GV-01',
            site_id: 'D00001',
            owner_label: '公務車隊車用汽油',
            process_no: 'G01',
            equipment_no: 'GV01',
            process_code: '000000',
            equipment_code: '0000',
            material_code: '170001',
            scope: 'scope_1',
            emission_type: 'mobile',
            is_biomass: false,
            is_chp: false,
            ch4_origin: 'non_fossil_combustion',
            codebook_citation_id: 'CIT-CODE-V2',
          },
          {
            source_id: 'SRC-SEPTIC-01',
            site_id: 'D00001',
            owner_label: '總公司化糞池 (人天法)',
            process_no: 'G01',
            equipment_no: 'GF02',
            process_code: '000000',
            equipment_code: '9795',
            material_code: '360006',
            scope: 'scope_1',
            emission_type: 'fugitive',
            is_biomass: false,
            is_chp: false,
            ch4_origin: 'biogenic_or_wastewater',
            codebook_citation_id: 'CIT-CODE-V2',
          },
          {
            source_id: 'SRC-BIO-01',
            site_id: 'D00001',
            owner_label: '生質木炭測試爐 (獨立列示CO2)',
            process_no: 'G01',
            equipment_no: 'GS02',
            process_code: '000000',
            equipment_code: '0000',
            material_code: '020012',
            scope: 'scope_1',
            emission_type: 'stationary',
            is_biomass: true,
            is_chp: false,
            ch4_origin: 'non_fossil_combustion',
            codebook_citation_id: 'CIT-CODE-V2',
          },
        ];
        const extraActivities: ActivityRecord[] = [
          {
            activity_id: 'ACT-GS-01',
            source_id: 'SRC-GS-01',
            in_use_this_year: true,
            activity_qty: 500,
            activity_unit: '立方公尺',
            alloc_ratio: 1.0,
            data_source_desc: '天然氣費帳單',
            data_source_tier: 'periodic_measure',
            evidence_files: [{ filename: 'ng_2024.pdf' }],
          },
          {
            activity_id: 'ACT-GV-01',
            source_id: 'SRC-GV-01',
            in_use_this_year: true,
            activity_qty: 12.5,
            activity_unit: '公秉',
            alloc_ratio: 1.0,
            data_source_desc: '車隊加油卡月結表',
            data_source_tier: 'periodic_measure',
            evidence_files: [{ filename: 'fleet_fuel_2024.xlsx' }],
          },
          {
            activity_id: 'ACT-SEPTIC-01',
            source_id: 'SRC-SEPTIC-01',
            in_use_this_year: true,
            activity_qty: 12683,
            activity_unit: '人天',
            alloc_ratio: 1.0,
            data_source_desc: '人資出勤人天統計',
            data_source_tier: 'estimate',
            evidence_files: [{ filename: 'attendance_2024.xlsx' }],
          },
          {
            activity_id: 'ACT-BIO-01',
            source_id: 'SRC-BIO-01',
            in_use_this_year: true,
            activity_qty: 2,
            activity_unit: '公噸',
            alloc_ratio: 1.0,
            data_source_desc: '磅秤入庫紀錄',
            data_source_tier: 'periodic_measure',
            evidence_files: [{ filename: 'charcoal_2024.pdf' }],
          },
        ];

        for (const s of extraSources) {
          if (!workspace.sources.some((x) => x.source_id === s.source_id)) {
            workspace.sources.push(s);
          }
        }
        for (const a of extraActivities) {
          if (!workspace.activities.some((x) => x.activity_id === a.activity_id)) {
            workspace.activities.push(a);
          }
        }
        sendJson(res, 200, { seeded: true, count: workspace.activities.length });
        return;
      }

      // 7. 業主 / 管理者：新增或更新活動數據
      if (method === 'POST' && urlPath === '/api/activities') {
        auth.assertPermission(currentUser, 'edit_activity_data');
        if (workspace.boundary_version.locked) {
          sendJson(res, 409, { error: '邊界版本已鎖定，禁止修改活動數據' });
          return;
        }
        const body = await readJsonBody<ActivityRecord>(req);
        const idx = workspace.activities.findIndex((a) => a.activity_id === body.activity_id);
        if (idx >= 0) {
          workspace.activities[idx] = body;
        } else {
          workspace.activities.push(body);
        }
        sendJson(res, 200, { activity: body });
        return;
      }

      // 8. BYO-AI 輔助層（僅供參考）
      if (method === 'POST' && urlPath === '/api/ai/extract') {
        auth.assertPermission(currentUser, 'use_ai_assistant');
        const body = await readJsonBody<{ text: string }>(req);
        const draft = await ai.extractDocumentActivity(body.text ?? '');
        sendJson(res, 200, draft);
        return;
      }

      if (method === 'POST' && urlPath === '/api/ai/recommend-code') {
        auth.assertPermission(currentUser, 'use_ai_assistant');
        const body = await readJsonBody<{ label: string }>(req);
        const recs = await ai.recommendOfficialCodes(body.label ?? '');
        sendJson(res, 200, recs);
        return;
      }

      // 9. 審核者 / 管理者：計算報表、鎖版快照、匯出 XLSX / ODS
      if (method === 'POST' && urlPath === '/api/report/calculate') {
        auth.assertPermission(currentUser, 'review_inventory');
        const body = await readJsonBody<{ workspace?: AppWorkspaceState }>(req);
        const pkg = buildReportFromWorkspace(body.workspace ?? workspace);
        sendJson(res, 200, { report: pkg });
        return;
      }

      if (method === 'POST' && urlPath === '/api/report/lock-snapshot') {
        auth.assertPermission(currentUser, 'lock_boundary_and_snapshot');
        const body = await readJsonBody<{ workspace?: AppWorkspaceState }>(req);
        const targetWs = body.workspace ?? workspace;
        const pkg = buildReportFromWorkspace(targetWs);
        if (!body.workspace) {
          workspace.boundary_version = {
            ...workspace.boundary_version,
            locked: true,
            locked_at: new Date().toISOString(),
          };
        }
        const snapshot = createAuditSnapshot(
          `SNAP-${targetWs.snapshots.length + 1}`,
          targetWs.boundary_version.boundary_version_id,
          pkg
        );
        if (!body.workspace) {
          workspace.snapshots.push(snapshot);
        }
        sendJson(res, 200, { snapshot });
        return;
      }

      if ((method === 'GET' || method === 'POST') && urlPath === '/api/export/xlsx') {
        auth.assertPermission(currentUser, 'export_official_reports');
        const body =
          method === 'POST' ? await readJsonBody<{ workspace?: AppWorkspaceState }>(req) : {};
        const pkg = buildReportFromWorkspace(body.workspace ?? workspace);
        const buf = await exportReportToXlsxBuffer(pkg);
        res.writeHead(200, {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="ghg_inventory.xlsx"',
        });
        res.end(buf);
        return;
      }

      if ((method === 'GET' || method === 'POST') && urlPath === '/api/export/ods') {
        auth.assertPermission(currentUser, 'export_official_reports');
        const body =
          method === 'POST' ? await readJsonBody<{ workspace?: AppWorkspaceState }>(req) : {};
        const pkg = buildReportFromWorkspace(body.workspace ?? workspace);
        const buf = await exportReportToOdsBuffer(pkg);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.oasis.opendocument.spreadsheet',
          'Content-Disposition': 'attachment; filename="ghg_inventory.ods"',
        });
        res.end(buf);
        return;
      }

      sendJson(res, 404, { error: 'Not Found' });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        sendJson(res, 401, { error: err.message });
        return;
      }
      if (err instanceof ForbiddenError) {
        sendJson(res, 403, { error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Internal Server Error';
      sendJson(res, 400, { error: message });
    }
  };

  const server = createServer((req, res) => {
    void requestHandler(req, res);
  });

  return {
    auth,
    ai,
    getWorkspace: () => workspace,
    requestHandler,
    server,
  };
}
