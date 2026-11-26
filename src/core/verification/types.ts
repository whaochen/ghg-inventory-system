export type AccreditationType = 'CNS 17025' | 'ISO 17025' | '環境部認可';

export interface LabTestRecord {
  lab_test_id: string;
  source_id: string;
  parameter_type: 'ncv' | 'carbon_content';
  lab_name: string;
  accreditation: AccreditationType;
  /** 引用《代碼檔 V2》附表九檢測方法或 NIEA/CNS/ASTM 方法編號 */
  test_method: string;
  test_start_date: string;
  test_end_date: string;
  measured_value: number;
  unit: string;
}

export interface DataQualityInput {
  source_id: string;
  /** 1=優, 2=良, 3=普通 (製造業表六) */
  activity_error_grade: 1 | 2 | 3;
  calibration_grade: 1 | 2 | 3;
  factor_grade: 1 | 2 | 3;
}

export interface DataQualityResult extends DataQualityInput {
  composite_score: number;
  quality_level: 'A (優良)' | 'B (尚可)' | 'C (待改善)';
  citation_id: string;
}

export interface UncertaintyItemInput {
  source_id: string;
  co2e_tonnes: number;
  /** 活動數據 95% 信賴區間半寬或下限/上限百分比 (例如 2 表示 ±2%) */
  activity_ci_lower_pct: number;
  activity_ci_upper_pct: number;
  /** 係數 95% 信賴區間百分比（可由官方表代入） */
  factor_ci_lower_pct: number;
  factor_ci_upper_pct: number;
}

export interface UncertaintySummary {
  total_co2e_tonnes: number;
  combined_lower_pct: number;
  combined_upper_pct: number;
  lower_bound_tonnes: number;
  upper_bound_tonnes: number;
  item_count: number;
  citation_id: string;
}

export interface VerifierAssignment {
  verification_body_code: string;
  lead_verifier_id: string;
  lead_verifier_name: string;
  consecutive_years: number;
}

export type AuditAlertCode =
  | 'MATERIALITY_THRESHOLD_EXCEEDED'
  | 'LEAD_VERIFIER_ROTATION_REQUIRED'
  | 'INVALID_VERIFICATION_BODY'
  | 'MISSING_EVIDENCE';

export interface AuditAlert {
  code: AuditAlertCode;
  severity: 'warning' | 'blocking';
  message: string;
  citation_id: string;
}
