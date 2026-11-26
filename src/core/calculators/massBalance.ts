import { CitationRegistry, defaultCitationRegistry } from '../../registry/CitationRegistry.js';
import { GasCode, projectAllTracks } from '../gwpProjector.js';
import { roundDetail } from '../precision.js';
import { ActivityUnit, EfUnit, lookupUnitConversion } from '../unitConverter.js';
import type { CalculationOutput } from './types.js';

export interface MassBalancePreset {
  material_code: string;
  material_name: string;
  gas_code: GasCode;
  ef_value: number;
  ef_unit: Extract<EfUnit, '公斤/公斤' | '公噸/公噸' | '公斤/公升'>;
  citation_id: string;
}

/**
 * 依據《大專校院 V3 表5》驗證之質量平衡標準係數
 */
export const MASS_BALANCE_PRESETS: Record<string, MassBalancePreset> = {
  '180014': {
    material_code: '180014',
    material_name: '二氧化碳 (消防設施 / 氣體鋼瓶)',
    gas_code: 'CO2',
    ef_value: 1.0,
    ef_unit: '公斤/公斤',
    citation_id: 'CIT-TPL-SVC3',
  },
  '180191': {
    material_code: '180191',
    material_name: '乙炔 (點焊設施)',
    gas_code: 'CO2',
    ef_value: 3.3846153846,
    ef_unit: '公噸/公噸',
    citation_id: 'CIT-TPL-SVC3',
  },
  GG1802: {
    material_code: 'GG1802',
    material_name: '氧化亞氮 (醫療/實驗室氣體鋼瓶)',
    gas_code: 'N2O',
    ef_value: 1.0,
    ef_unit: '公噸/公噸',
    citation_id: 'CIT-TPL-SVC3',
  },
  '180267': {
    material_code: '180267',
    material_name: '乙醇 (其他實驗或儀器使用)',
    gas_code: 'CO2',
    ef_value: 1.5093913043,
    ef_unit: '公斤/公升',
    citation_id: 'CIT-TPL-SVC3',
  },
};

export interface MassBalanceInput {
  material_code: string;
  activity_qty: number;
  activity_unit: Extract<ActivityUnit, '公斤' | '公噸' | '公升'>;
  alloc_ratio: number;
  gas_code?: GasCode;
  ef_value?: number;
  ef_unit?: Extract<EfUnit, '公斤/公斤' | '公噸/公噸' | '公斤/公升'>;
  citation_id?: string;
}

export function calculateMassBalance(
  input: MassBalanceInput,
  registry: CitationRegistry = defaultCitationRegistry
): CalculationOutput {
  const preset = MASS_BALANCE_PRESETS[input.material_code];
  const gasCode = input.gas_code ?? preset?.gas_code;
  const efValue = input.ef_value ?? preset?.ef_value;
  const citationId = input.citation_id ?? preset?.citation_id;

  if (!gasCode || efValue === undefined || !citationId) {
    throw new Error(`未驗證：質量平衡材料代碼 "${input.material_code}" 缺少氣體或係數定義`);
  }

  registry.assertCited({ citation_id: citationId }, `質量平衡(${input.material_code})`);

  // 依據輸入活動單位推導對應的質量平衡係數單位
  const inferredEfUnit: Extract<EfUnit, '公斤/公斤' | '公噸/公噸' | '公斤/公升'> =
    input.ef_unit ??
    (input.activity_unit === '公噸'
      ? '公噸/公噸'
      : input.activity_unit === '公升'
        ? '公斤/公升'
        : '公斤/公斤');

  // 若系統 preset 原單位為公噸/公噸，而使用者輸入公斤（例如 200 公斤乙炔），係數數值同為 kg CO2/kg C2H2 (3.3846153846)，乘 unit_factor 0.001 即為公噸！
  const unitRule = lookupUnitConversion(
    {
      activity_unit: input.activity_unit,
      ncv_unit: null,
      heat_conversion_unit: null,
      ef_unit: inferredEfUnit,
    },
    registry
  );

  const rawTonnes = roundDetail(
    input.activity_qty * input.alloc_ratio * efValue * unitRule.unit_factor
  );
  const projections = projectAllTracks(rawTonnes, gasCode, undefined, registry);
  const citationIds = new Set<string>([citationId, unitRule.citation_id]);
  Object.values(projections).forEach((p) => citationIds.add(p.gwp_citation_id));

  return {
    source_category: 'GF_MASS_BALANCE',
    material_code: input.material_code,
    gas_details: [
      {
        gas_code: gasCode,
        raw_gas_tonnes: rawTonnes,
        is_biogenic_co2: false,
        projections,
      },
    ],
    citation_ids: Array.from(citationIds),
    notices: [],
  };
}
