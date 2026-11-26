import type { SourceCitation } from '../../registry/types.js';
import type { BoundaryExclusion, BoundaryVersion, Site, UtilityAccount } from '../boundary/types.js';
import type { CalculationOutput } from '../calculators/types.js';
import type { GwpProfile } from '../gwpProjector.js';
import type { ActivityRecord, EmissionScope, EmissionSource, EmissionType } from '../source/types.js';
import type {
  AuditAlert,
  DataQualityResult,
  LabTestRecord,
  UncertaintySummary,
} from '../verification/types.js';

export interface InventoryItemCalculation {
  activity: ActivityRecord;
  source: EmissionSource;
  calculation: CalculationOutput;
}

export interface TrackSummary {
  gwp_profile: GwpProfile;
  /** 七大氣體總排放當量（已依規定四捨五入至小數點後第 3 位，不含生質 CO2） */
  total_co2e_tonnes: number;
  scope_1_co2e_tonnes: number;
  scope_2_co2e_tonnes: number;
  by_gas_co2e: Record<string, number>;
  by_emission_type_co2e: Partial<Record<EmissionType, number>>;
}

export interface ManufacturingTableMapping {
  table1_basic_info: BoundaryVersion;
  table2_boundary_and_exclusions: {
    sites: Site[];
    exclusions: BoundaryExclusion[];
  };
  table3_emission_sources: EmissionSource[];
  table4_activity_records: ActivityRecord[];
  table5_calculation_details: InventoryItemCalculation[];
  table6_data_quality: DataQualityResult[];
  table7_uncertainty: UncertaintySummary | null;
  table8_summary_by_track: Record<GwpProfile, TrackSummary>;
  table10_gwp_comparison: Array<{
    gas_code: string;
    raw_gas_tonnes: number;
    MOENV_AR5: number;
    IPCC_AR6_2021: number;
    IPCC_AR6_ERRATA_2025: number;
  }>;
  table11_lab_tests: LabTestRecord[];
}

export interface ServiceV3TableMapping {
  table1_basic_info: BoundaryVersion;
  table2_sites: Site[];
  table3_utility_accounts: UtilityAccount[];
  table4_sources_and_activities: Array<{
    source: EmissionSource;
    activity: ActivityRecord;
  }>;
  table5_calculation_details: InventoryItemCalculation[];
  table6_summary_by_track: Record<GwpProfile, TrackSummary>;
  table7_lab_tests: LabTestRecord[];
}

export interface InventoryReportPackage {
  boundary_version_id: string;
  report_mode: BoundaryVersion['report_mode'];
  /** 七大氣體原始公噸數合計（明細層 4 位小數加總） */
  raw_gas_totals: Record<string, number>;
  /** 生質能源 CO2 獨立合計（公噸），不計入七大溫室氣體總量 */
  biogenic_co2_tonnes: number;
  /** 三軌 GWP 彙總對照（總量四捨五入至小數點後第 3 位） */
  tracks: Record<GwpProfile, TrackSummary>;
  /** 單廠查驗模式 (製造業表一～表十一) 或 多據點模式 (服務業 V3 表 1～表 7) */
  manufacturing_tables?: ManufacturingTableMapping;
  service_v3_tables?: ServiceV3TableMapping;
  audit_alerts: AuditAlert[];
  notices: string[];
  source_citations: SourceCitation[];
}

export interface BuildReportInput {
  boundary_version: BoundaryVersion;
  sites: Site[];
  exclusions: BoundaryExclusion[];
  utility_accounts: UtilityAccount[];
  items: InventoryItemCalculation[];
  lab_tests?: LabTestRecord[];
  data_quality?: DataQualityResult[];
  uncertainty?: UncertaintySummary | null;
  previous_year_ar5_tonnes?: number;
  additional_alerts?: AuditAlert[];
  /** 若某筆活動數據使用自廠熱值或碳含量，將活動 ID 列於此清單以觸發強制 LabTestRecord 檢核 */
  custom_lab_activity_ids?: string[];
}
