import { createHash } from 'node:crypto';
import { MoenvDataStore, defaultMoenvDataStore } from '../../registry/MoenvDataStore.js';
import { roundDetail, roundSummary } from '../precision.js';
import type {
  AuditAlert,
  DataQualityInput,
  DataQualityResult,
  LabTestRecord,
  UncertaintyItemInput,
  UncertaintySummary,
  VerifierAssignment,
} from './types.js';

export class MissingLabTestError extends Error {
  constructor(activityId: string, reason: string) {
    super(`阻擋定案：活動數據 "${activityId}" 使用自廠檢測參數但檢核失敗 — ${reason}`);
    this.name = 'MissingLabTestError';
  }
}

/**
 * 製造業表六：數據品質誤差等級評分
 */
export function evaluateDataQuality(input: DataQualityInput): DataQualityResult {
  const composite = input.activity_error_grade * input.calibration_grade * input.factor_grade;
  let qualityLevel: DataQualityResult['quality_level'];
  if (composite <= 4) {
    qualityLevel = 'A (優良)';
  } else if (composite <= 12) {
    qualityLevel = 'B (尚可)';
  } else {
    qualityLevel = 'C (待改善)';
  }
  return {
    ...input,
    composite_score: composite,
    quality_level: qualityLevel,
    citation_id: 'CIT-TPL-MFG',
  };
}

/**
 * 製造業表七：95% 信賴區間合成（誤差傳遞法）
 */
export function evaluateUncertainty(items: readonly UncertaintyItemInput[]): UncertaintySummary {
  let totalEmissions = 0;
  let sumSquaredLower = 0;
  let sumSquaredUpper = 0;

  for (const item of items) {
    totalEmissions += item.co2e_tonnes;
    const itemLowerPct = Math.sqrt(
      item.activity_ci_lower_pct ** 2 + item.factor_ci_lower_pct ** 2
    );
    const itemUpperPct = Math.sqrt(
      item.activity_ci_upper_pct ** 2 + item.factor_ci_upper_pct ** 2
    );
    sumSquaredLower += (item.co2e_tonnes * itemLowerPct) ** 2;
    sumSquaredUpper += (item.co2e_tonnes * itemUpperPct) ** 2;
  }

  const combinedLowerPct =
    totalEmissions > 0 ? roundDetail(Math.sqrt(sumSquaredLower) / totalEmissions) : 0;
  const combinedUpperPct =
    totalEmissions > 0 ? roundDetail(Math.sqrt(sumSquaredUpper) / totalEmissions) : 0;

  return {
    total_co2e_tonnes: roundSummary(totalEmissions),
    combined_lower_pct: -Math.abs(combinedLowerPct),
    combined_upper_pct: Math.abs(combinedUpperPct),
    lower_bound_tonnes: roundSummary(totalEmissions * (1 - Math.abs(combinedLowerPct) / 100)),
    upper_bound_tonnes: roundSummary(totalEmissions * (1 + Math.abs(combinedUpperPct) / 100)),
    item_count: items.length,
    citation_id: 'CIT-TPL-MFG',
  };
}

/**
 * 防呆 1：自廠檢測強制驗證（表十一 / 表 7）
 * 缺實驗室名稱、認可資格、檢測方法或起訖日者阻擋定案
 */
export function assertLabTestRecordValid(
  activityId: string,
  record: LabTestRecord | undefined
): void {
  if (!record) {
    throw new MissingLabTestError(activityId, '缺少 LabTestRecord 檢測紀錄');
  }
  if (!record.lab_name || record.lab_name.trim() === '') {
    throw new MissingLabTestError(activityId, '缺少實驗室或檢測機構名稱 (lab_name)');
  }
  const validAccreditations = ['CNS 17025', 'ISO 17025', '環境部認可'];
  if (!validAccreditations.includes(record.accreditation)) {
    throw new MissingLabTestError(
      activityId,
      `認證資格 "${record.accreditation}" 必須為 CNS 17025 / ISO 17025 / 環境部認可`
    );
  }
  if (!record.test_method || record.test_method.trim() === '') {
    throw new MissingLabTestError(activityId, '缺少檢測方法編號 (test_method)');
  }
  if (!record.test_start_date || !record.test_end_date || record.test_start_date > record.test_end_date) {
    throw new MissingLabTestError(activityId, '檢測起訖日期無效或缺漏');
  }
}

/**
 * 防呆 2：5% 實質性差異預警（《管理辦法》第 15 條第 5 款）
 */
export function checkMaterialityThreshold(
  baselineTonnes: number,
  currentTonnes: number,
  contextLabel: string
): AuditAlert | null {
  if (baselineTonnes <= 0) return null;
  const diffRatio = Math.abs(currentTonnes - baselineTonnes) / baselineTonnes;
  if (diffRatio >= 0.05) {
    const pct = (diffRatio * 100).toFixed(2);
    return {
      code: 'MATERIALITY_THRESHOLD_EXCEEDED',
      severity: 'warning',
      message: `實質性預警 (${contextLabel}): 差異達 ${pct}% (>= 5%)，應評估基準年重算或實質性差異原因`,
      citation_id: 'CIT-LAW-MGT',
    };
  }
  return null;
}

/**
 * 防呆 3：查驗機構代碼檢核與主導查驗員 6 年輪調控管（《管理辦法》第 8 條）
 */
export function checkVerifierCompliance(
  assignment: VerifierAssignment,
  dataStore: MoenvDataStore = defaultMoenvDataStore
): AuditAlert[] {
  const alerts: AuditAlert[] = [];

  if (!dataStore.hasVerificationBodyCode(assignment.verification_body_code)) {
    alerts.push({
      code: 'INVALID_VERIFICATION_BODY',
      severity: 'blocking',
      message: `查驗機構代碼 "${assignment.verification_body_code}" 不存在於《代碼檔 V2》附表二`,
      citation_id: 'CIT-CODE-V2',
    });
  }

  if (assignment.consecutive_years >= 6) {
    alerts.push({
      code: 'LEAD_VERIFIER_ROTATION_REQUIRED',
      severity: 'warning',
      message: `主導查驗員 "${assignment.lead_verifier_name}" (${assignment.lead_verifier_id}) 連續執行查驗已滿 ${assignment.consecutive_years} 年（>= 6 年），依《管理辦法》第 8 條須強制輪調不得連任`,
      citation_id: 'CIT-LAW-MGT',
    });
  }

  return alerts;
}

export interface AuditSnapshot<T> {
  readonly snapshot_id: string;
  readonly boundary_version_id: string;
  readonly created_at: string;
  readonly payload_sha256: string;
  readonly payload: Readonly<T>;
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const value of Object.values(obj as Record<string, unknown>)) {
      deepFreeze(value);
    }
  }
  return obj;
}

/**
 * 建立不可變 AuditSnapshot 鎖存
 */
export function createAuditSnapshot<T>(
  snapshotId: string,
  boundaryVersionId: string,
  payload: T,
  createdAtIso = new Date().toISOString()
): AuditSnapshot<T> {
  const cloned = structuredClone(payload);
  const canonicalJson = JSON.stringify(cloned);
  const hash = createHash('sha256').update(canonicalJson).digest('hex');

  const snapshot: AuditSnapshot<T> = {
    snapshot_id: snapshotId,
    boundary_version_id: boundaryVersionId,
    created_at: createdAtIso,
    payload_sha256: hash,
    payload: cloned,
  };

  return deepFreeze(snapshot);
}
