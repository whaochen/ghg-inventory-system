import { CitationRegistry, defaultCitationRegistry } from '../../registry/CitationRegistry.js';
import { projectAllTracks } from '../gwpProjector.js';
import { KCAL_TO_TJ, roundDetail, roundIntermediate } from '../precision.js';
import { ActivityUnit, NcvUnit, lookupUnitConversion } from '../unitConverter.js';
import type { CalculationOutput, GasEmissionDetail } from './types.js';

export interface FuelGasFactorInput {
  /** 燃料單位熱值排放係數 (kg/TJ)，例如 CO2=69300 */
  ef_kg_per_tj?: number;
  /** 若直接傳入已換算之單位係數（如官方表五 10 位小數，單位：公噸/活動單位或公斤/單位），優先使用 */
  ef_per_unit?: number;
  /** 本項係數之權威引用 ID */
  citation_id: string;
}

export interface StationaryCombustionInput {
  material_code: string;
  activity_qty: number;
  activity_unit: Extract<ActivityUnit, '公斤' | '公噸' | '公升' | '公秉' | '立方公尺' | '千立方公尺'>;
  alloc_ratio: number;
  is_biomass: boolean;
  /** 低位熱值 (kcal/單位)，若提供 ef_kg_per_tj 時必填 */
  ncv_kcal_per_unit?: number;
  ncv_unit: Exclude<NcvUnit, null>;
  ncv_citation_id: string;
  co2?: FuelGasFactorInput;
  ch4?: FuelGasFactorInput;
  n2o?: FuelGasFactorInput;
}

function resolveGasDetail(
  gas: 'CO2' | 'CH4' | 'N2O',
  factorInput: FuelGasFactorInput,
  activityQty: number,
  allocRatio: number,
  unitFactor: number,
  ncvKcalPerUnit: number | undefined,
  isBiomass: boolean,
  registry: CitationRegistry
): GasEmissionDetail {
  registry.assertCited(factorInput, `固定燃燒 ${gas} 係數`);

  let efPerUnit: number;
  if (factorInput.ef_per_unit !== undefined) {
    efPerUnit = roundIntermediate(factorInput.ef_per_unit);
  } else if (factorInput.ef_kg_per_tj !== undefined) {
    if (ncvKcalPerUnit === undefined) {
      throw new Error(`固定燃燒 ${gas} 使用 kg/TJ 係數時必須提供 ncv_kcal_per_unit`);
    }
    efPerUnit = roundIntermediate(factorInput.ef_kg_per_tj * ncvKcalPerUnit * KCAL_TO_TJ);
  } else {
    throw new Error(`固定燃燒 ${gas} 必須提供 ef_per_unit 或 ef_kg_per_tj`);
  }

  const rawTonnes = roundDetail(activityQty * allocRatio * efPerUnit * unitFactor);
  const ch4Origin = gas === 'CH4' ? 'non_fossil_combustion' : undefined;

  return {
    gas_code: gas,
    ch4_origin: ch4Origin,
    raw_gas_tonnes: rawTonnes,
    is_biogenic_co2: gas === 'CO2' && isBiomass,
    projections: projectAllTracks(rawTonnes, gas, ch4Origin, registry),
  };
}

export function calculateStationaryCombustion(
  input: StationaryCombustionInput,
  registry: CitationRegistry = defaultCitationRegistry
): CalculationOutput {
  registry.assertCited({ citation_id: input.ncv_citation_id }, '固定燃燒低位熱值');

  const unitRule = lookupUnitConversion(
    {
      activity_unit: input.activity_unit,
      ncv_unit: input.ncv_unit,
      heat_conversion_unit: '兆焦耳/千卡',
      ef_unit: '公斤/兆焦耳',
    },
    registry
  );

  const gasDetails: GasEmissionDetail[] = [];
  const citationIds = new Set<string>([input.ncv_citation_id, unitRule.citation_id]);

  if (input.co2) {
    const detail = resolveGasDetail(
      'CO2',
      input.co2,
      input.activity_qty,
      input.alloc_ratio,
      unitRule.unit_factor,
      input.ncv_kcal_per_unit,
      input.is_biomass,
      registry
    );
    gasDetails.push(detail);
    citationIds.add(input.co2.citation_id);
    Object.values(detail.projections).forEach((p) => citationIds.add(p.gwp_citation_id));
  }

  if (input.ch4) {
    const detail = resolveGasDetail(
      'CH4',
      input.ch4,
      input.activity_qty,
      input.alloc_ratio,
      unitRule.unit_factor,
      input.ncv_kcal_per_unit,
      input.is_biomass,
      registry
    );
    gasDetails.push(detail);
    citationIds.add(input.ch4.citation_id);
    Object.values(detail.projections).forEach((p) => citationIds.add(p.gwp_citation_id));
  }

  if (input.n2o) {
    const detail = resolveGasDetail(
      'N2O',
      input.n2o,
      input.activity_qty,
      input.alloc_ratio,
      unitRule.unit_factor,
      input.ncv_kcal_per_unit,
      input.is_biomass,
      registry
    );
    gasDetails.push(detail);
    citationIds.add(input.n2o.citation_id);
    Object.values(detail.projections).forEach((p) => citationIds.add(p.gwp_citation_id));
  }

  return {
    source_category: 'GS',
    material_code: input.material_code,
    gas_details: gasDetails,
    citation_ids: Array.from(citationIds),
    notices: [],
  };
}
