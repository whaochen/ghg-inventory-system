import { CitationRegistry, defaultCitationRegistry } from '../registry/CitationRegistry.js';

export type ActivityUnit =
  | '公斤'
  | '公噸'
  | '公升'
  | '公秉'
  | '立方公尺'
  | '千立方公尺'
  | '公斤/年'
  | '公噸(BOD)'
  | '人天'
  | '千度'
  | '度';

export type NcvUnit = '千卡/公斤' | '千卡/公升' | '千卡/立方公尺' | null;
export type HeatConversionUnit = '兆焦耳/千卡' | null;
export type EfUnit =
  | '公斤/兆焦耳'
  | '公斤/公斤'
  | '%/年'
  | '公噸/公噸(BOD)'
  | '公噸/人天'
  | '公斤CO2/度';

export interface UnitConversionRule {
  activity_unit: ActivityUnit;
  ncv_unit: NcvUnit;
  heat_conversion_unit: HeatConversionUnit;
  ef_unit: EfUnit;
  unit_factor: number;
  citation_id: string;
  scenario: string;
}

export class UnitMismatchError extends Error {
  constructor(
    activityUnit: string,
    ncvUnit: string | null,
    heatConversionUnit: string | null,
    efUnit: string
  ) {
    super(
      `單位不相容錯誤 (UnitMismatchError): activity_unit="${activityUnit}", ncv_unit="${ncvUnit ?? '—'}", heat_conversion_unit="${heatConversionUnit ?? '—'}", ef_unit="${efUnit}"。禁止靜默換算。`
    );
    this.name = 'UnitMismatchError';
  }
}

const OFFICIAL_CONVERSION_RULES: readonly UnitConversionRule[] = [
  {
    activity_unit: '公斤',
    ncv_unit: '千卡/公斤',
    heat_conversion_unit: '兆焦耳/千卡',
    ef_unit: '公斤/兆焦耳',
    unit_factor: 0.001,
    citation_id: 'CIT-TPL-SVC3',
    scenario: '固體／重量燃料',
  },
  {
    activity_unit: '公噸',
    ncv_unit: '千卡/公斤',
    heat_conversion_unit: '兆焦耳/千卡',
    ef_unit: '公斤/兆焦耳',
    unit_factor: 1,
    citation_id: 'CIT-TPL-SVC3',
    scenario: '固體／重量燃料',
  },
  {
    activity_unit: '公升',
    ncv_unit: '千卡/公升',
    heat_conversion_unit: '兆焦耳/千卡',
    ef_unit: '公斤/兆焦耳',
    unit_factor: 0.001,
    citation_id: 'CIT-TPL-SVC3',
    scenario: '液體燃料（柴油、汽油）',
  },
  {
    activity_unit: '公秉',
    ncv_unit: '千卡/公升',
    heat_conversion_unit: '兆焦耳/千卡',
    ef_unit: '公斤/兆焦耳',
    unit_factor: 1,
    citation_id: 'CIT-TPL-SVC3',
    scenario: '液體燃料（公秉 = 1,000 公升）',
  },
  {
    activity_unit: '立方公尺',
    ncv_unit: '千卡/立方公尺',
    heat_conversion_unit: '兆焦耳/千卡',
    ef_unit: '公斤/兆焦耳',
    unit_factor: 0.001,
    citation_id: 'CIT-TPL-SVC3',
    scenario: '氣體燃料（天然氣）',
  },
  {
    activity_unit: '千立方公尺',
    ncv_unit: '千卡/立方公尺',
    heat_conversion_unit: '兆焦耳/千卡',
    ef_unit: '公斤/兆焦耳',
    unit_factor: 1,
    citation_id: 'CIT-TPL-SVC3',
    scenario: '氣體燃料（千立方公尺 = 1,000 m³）',
  },
  {
    activity_unit: '公斤',
    ncv_unit: null,
    heat_conversion_unit: null,
    ef_unit: '公斤/公斤',
    unit_factor: 0.001,
    citation_id: 'CIT-TPL-SVC3',
    scenario: '質量平衡（CO₂ 滅火器／乙炔）',
  },
  {
    activity_unit: '公斤/年',
    ncv_unit: null,
    heat_conversion_unit: null,
    ef_unit: '%/年',
    unit_factor: 0.00001,
    citation_id: 'CIT-TPL-SVC3',
    scenario: '冷凍空調冷媒逸散（1% × 10^-3 t/kg）',
  },
  {
    activity_unit: '公噸(BOD)',
    ncv_unit: null,
    heat_conversion_unit: null,
    ef_unit: '公噸/公噸(BOD)',
    unit_factor: 1,
    citation_id: 'CIT-TPL-SVC3',
    scenario: '化糞池 BOD 總量法',
  },
  {
    activity_unit: '人天',
    ncv_unit: null,
    heat_conversion_unit: null,
    ef_unit: '公噸/人天',
    unit_factor: 1,
    citation_id: 'CIT-TPL-SVC3',
    scenario: '化糞池人天法',
  },
  {
    activity_unit: '千度',
    ncv_unit: null,
    heat_conversion_unit: null,
    ef_unit: '公斤CO2/度',
    unit_factor: 1,
    citation_id: 'CIT-TPL-SVC3',
    scenario: '外購電力（千度 × kg/度 = 公噸）',
  },
  {
    activity_unit: '度',
    ncv_unit: null,
    heat_conversion_unit: null,
    ef_unit: '公斤CO2/度',
    unit_factor: 0.001,
    citation_id: 'CIT-TPL-SVC3',
    scenario: '外購電力（度數直接輸入）',
  },
];

export function lookupUnitConversion(
  params: {
    activity_unit: string;
    ncv_unit?: string | null;
    heat_conversion_unit?: string | null;
    ef_unit: string;
  },
  registry: CitationRegistry = defaultCitationRegistry
): UnitConversionRule {
  const ncv = params.ncv_unit ?? null;
  const heatConv = params.heat_conversion_unit ?? null;

  const matched = OFFICIAL_CONVERSION_RULES.find(
    (rule) =>
      rule.activity_unit === params.activity_unit &&
      rule.ncv_unit === ncv &&
      rule.heat_conversion_unit === heatConv &&
      rule.ef_unit === params.ef_unit
  );

  if (!matched) {
    throw new UnitMismatchError(params.activity_unit, ncv, heatConv, params.ef_unit);
  }

  registry.assertCited(matched, '單位轉換係數');
  return matched;
}

export function getAllUnitConversionRules(): readonly UnitConversionRule[] {
  return OFFICIAL_CONVERSION_RULES;
}
