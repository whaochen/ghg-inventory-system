import { CitationRegistry, defaultCitationRegistry } from '../../registry/CitationRegistry.js';
import { projectAllTracks } from '../gwpProjector.js';
import { KCAL_TO_TJ, roundDetail, roundIntermediate } from '../precision.js';
import { ActivityUnit, NcvUnit, lookupUnitConversion } from '../unitConverter.js';
import type { FuelGasFactorInput } from './stationaryCombustion.js';
import type { CalculationOutput, GasEmissionDetail } from './types.js';

export interface MobileCombustionInput {
  material_code: string;
  vehicle_or_equipment_code?: string;
  activity_qty: number;
  activity_unit: Extract<ActivityUnit, '公升' | '公秉' | '立方公尺' | '千立方公尺'>;
  alloc_ratio: number;
  is_biomass: boolean;
  ncv_kcal_per_unit?: number;
  ncv_unit: Exclude<NcvUnit, null>;
  ncv_citation_id: string;
  co2: FuelGasFactorInput;
  /** 選填：若已取得經驗證之車型 CH4/N2O 係數與 citation_id，可傳入計算；未傳入則標註未驗證 */
  ch4?: FuelGasFactorInput;
  n2o?: FuelGasFactorInput;
}

function calcMobileGas(
  gas: 'CO2' | 'CH4' | 'N2O',
  factor: FuelGasFactorInput,
  activityQty: number,
  allocRatio: number,
  unitFactor: number,
  ncvKcalPerUnit: number | undefined,
  isBiomass: boolean,
  registry: CitationRegistry
): GasEmissionDetail {
  registry.assertCited(factor, `移動燃燒 ${gas} 係數`);

  let efPerUnit: number;
  if (factor.ef_per_unit !== undefined) {
    efPerUnit = roundIntermediate(factor.ef_per_unit);
  } else if (factor.ef_kg_per_tj !== undefined) {
    if (ncvKcalPerUnit === undefined) {
      throw new Error(`移動燃燒 ${gas} 使用 kg/TJ 係數時必須提供 ncv_kcal_per_unit`);
    }
    efPerUnit = roundIntermediate(factor.ef_kg_per_tj * ncvKcalPerUnit * KCAL_TO_TJ);
  } else {
    throw new Error(`移動燃燒 ${gas} 必須提供 ef_per_unit 或 ef_kg_per_tj`);
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

export function calculateMobileCombustion(
  input: MobileCombustionInput,
  registry: CitationRegistry = defaultCitationRegistry
): CalculationOutput {
  registry.assertCited({ citation_id: input.ncv_citation_id }, '移動燃燒低位熱值');

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
  const notices: string[] = [];

  const co2Detail = calcMobileGas(
    'CO2',
    input.co2,
    input.activity_qty,
    input.alloc_ratio,
    unitRule.unit_factor,
    input.ncv_kcal_per_unit,
    input.is_biomass,
    registry
  );
  gasDetails.push(co2Detail);
  citationIds.add(input.co2.citation_id);
  Object.values(co2Detail.projections).forEach((p) => citationIds.add(p.gwp_citation_id));

  if (input.ch4) {
    const ch4Detail = calcMobileGas(
      'CH4',
      input.ch4,
      input.activity_qty,
      input.alloc_ratio,
      unitRule.unit_factor,
      input.ncv_kcal_per_unit,
      input.is_biomass,
      registry
    );
    gasDetails.push(ch4Detail);
    citationIds.add(input.ch4.citation_id);
    Object.values(ch4Detail.projections).forEach((p) => citationIds.add(p.gwp_citation_id));
  } else {
    notices.push('未驗證：移動燃燒 CH4 車型細項係數未傳入（113 年公告附表一移動燃燒僅列 CO2 係數）');
  }

  if (input.n2o) {
    const n2oDetail = calcMobileGas(
      'N2O',
      input.n2o,
      input.activity_qty,
      input.alloc_ratio,
      unitRule.unit_factor,
      input.ncv_kcal_per_unit,
      input.is_biomass,
      registry
    );
    gasDetails.push(n2oDetail);
    citationIds.add(input.n2o.citation_id);
    Object.values(n2oDetail.projections).forEach((p) => citationIds.add(p.gwp_citation_id));
  } else {
    notices.push('未驗證：移動燃燒 N2O 車型細項係數未傳入（113 年公告附表一移動燃燒僅列 CO2 係數）');
  }

  return {
    source_category: 'GV',
    material_code: input.material_code,
    gas_details: gasDetails,
    citation_ids: Array.from(citationIds),
    notices,
  };
}
