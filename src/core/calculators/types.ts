import type { Ch4Origin, GasCode, GwpProfile, GwpProjectionResult } from '../gwpProjector.js';

export interface GasEmissionDetail {
  gas_code: GasCode;
  ch4_origin?: Ch4Origin;
  /** 明細層四捨五入至小數點後第 4 位 */
  raw_gas_tonnes: number;
  /** 是否為生質能源 CO2（獨立列於生質排放當量，不計入七大溫室氣體總量） */
  is_biogenic_co2: boolean;
  /** 三軌 GWP 投影結果 */
  projections: Record<GwpProfile, GwpProjectionResult>;
}

export interface CalculationOutput {
  source_category: 'GS' | 'GV' | 'GF_REFRIGERANT' | 'GF_SEPTIC' | 'GF_MASS_BALANCE' | 'GP';
  material_code: string;
  gas_details: GasEmissionDetail[];
  /** 使用之權威引用 ID（完整追溯） */
  citation_ids: string[];
  /** 若有未驗證參數或排除項（例如移動燃燒 CH4/N2O 或蒙特婁管制冷媒），列於此處 */
  notices: string[];
}
