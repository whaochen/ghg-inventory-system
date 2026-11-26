export type RegimeMode = 'mandatory_verify' | 'mandatory_register' | 'voluntary';
export type ReportMode = 'manufacturing_single_site' | 'service_multi_site';
export type BoundaryMethod = 'statutory' | 'operational_control';

/**
 * 據點納入狀態（四態嚴格分離）
 * 僅 'included' 據點可掛載正式排放源進入總量計算
 */
export type SiteInclusionStatus =
  | 'included'
  | 'inactive_period'
  | 'excluded_statutory'
  | 'data_gap';

export interface OperatingPeriod {
  /** YYYY-MM-DD */
  start_date: string;
  /** YYYY-MM-DD */
  end_date: string;
}

export interface Site {
  /** 跨年度穩定主鍵，格式 D00001 */
  site_id: string;
  site_name: string;
  site_type: string;
  /** 附表五 3 碼郵遞區號 */
  zip3: string;
  address: string;
  inclusion_status: SiteInclusionStatus;
  operating_periods: OperatingPeriod[];
  /** 站所用途代碼（服務業/運輸業適用，附表十一） */
  station_purpose_code?: string;
}

export interface BoundaryExclusion {
  site_id: string;
  excluded_entity_name: string;
  address_desc: string;
  statutory_basis: string;
  /** 獨立登記及列管證明佐證索引 */
  evidence_ref: string;
  citation_id: string;
}

export interface UtilityAccount {
  utility_id: string;
  site_id: string;
  meter_available: boolean;
  meter_no?: string;
  unavailable_reason?: string;
  is_shared: boolean;
  /** 0 < share_ratio <= 1 */
  share_ratio: number;
  /** 共用期間（用於檢核重疊期間合計是否 > 100%） */
  period_start: string;
  period_end: string;
  evidence_ref?: string;
}

export interface BoundaryVersion {
  boundary_version_id: string;
  inventory_year_roc: number;
  regime_mode: RegimeMode;
  report_mode: ReportMode;
  boundary_method: BoundaryMethod;
  tax_id: string;
  control_no?: string;
  /** 附表四 4 碼行業代碼 */
  industry_code: string;
  /** 擴大列管適用（附表一） */
  regulated_industry_code?: string;
  regulated_condition_code?: string;
  locked: boolean;
  locked_at?: string;
  citation_ids: string[];
}
