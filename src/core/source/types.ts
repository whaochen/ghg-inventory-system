import type { Ch4Origin } from '../gwpProjector.js';
import type { ActivityUnit } from '../unitConverter.js';

export type EmissionScope = 'scope_1' | 'scope_2';
export type EmissionType =
  | 'stationary'
  | 'mobile'
  | 'process'
  | 'fugitive'
  | 'purchased_electricity'
  | 'purchased_steam';

export type DataSourceTier = 'cems' | 'periodic_measure' | 'estimate';

export interface EvidenceFileRef {
  filename: string;
  sha256?: string;
}

export interface EmissionSource {
  source_id: string;
  site_id: string;
  /** 業主白話標籤（例如：一號鍋爐柴油、公務車汽油） */
  owner_label: string;
  /** 內部製程/設備編號，前綴 G/GS/GM/GV/GF/GP */
  process_no: string;
  equipment_no: string;
  /** 官方代碼（代碼檔 V2 附表六/七/八） */
  process_code: string;
  equipment_code: string;
  material_code: string;
  scope: EmissionScope;
  emission_type: EmissionType;
  sub_category?: string;
  is_biomass: boolean;
  is_chp: boolean;
  /** CH4 來源分類（強制標記，決定 GWP） */
  ch4_origin?: Ch4Origin;
  codebook_citation_id: string;
}

export interface ActivityRecord {
  activity_id: string;
  source_id: string;
  in_use_this_year: boolean;
  activity_qty: number;
  activity_unit: ActivityUnit;
  alloc_ratio: number;
  data_source_desc: string;
  data_source_tier: DataSourceTier;
  evidence_files: EvidenceFileRef[];
  /** 若使用自廠熱值或碳含量，須關聯 LabTestRecord ID */
  lab_test_id?: string;
}

export interface ActivityValidationWarning {
  activity_id: string;
  source_id: string;
  code: 'MISSING_EVIDENCE';
  message: string;
}
