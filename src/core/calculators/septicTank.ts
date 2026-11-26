import { CitationRegistry, defaultCitationRegistry } from '../../registry/CitationRegistry.js';
import { projectAllTracks } from '../gwpProjector.js';
import { roundDetail, roundIntermediate } from '../precision.js';
import { lookupUnitConversion } from '../unitConverter.js';
import type { CalculationOutput } from './types.js';

export type SepticTankInput =
  | {
      mode: 'person_day';
      material_code: string;
      person_days: number;
      alloc_ratio: number;
      /** 預設 0.6 (CIT-EF-MOENV-113 附表三表1) */
      bo_kg_ch4_per_kg_bod?: number;
      /** 預設 0.5 (CIT-EF-MOENV-113 附表三表2 化糞池系統) */
      mcf?: number;
      /** 預設 180 L/人日 (建築物污水處理設施設計技術規範) */
      wastewater_l_per_person_day?: number;
      /** 預設 225 mg/L BOD 濃度 */
      bod_mg_per_l?: number;
      factor_citation_id: string;
    }
  | {
      mode: 'bod_tonnes';
      material_code: string;
      bod_tonnes: number;
      alloc_ratio: number;
      bo_kg_ch4_per_kg_bod?: number;
      mcf?: number;
      factor_citation_id: string;
    };

export function calculateSepticTank(
  input: SepticTankInput,
  registry: CitationRegistry = defaultCitationRegistry
): CalculationOutput {
  registry.assertCited({ citation_id: input.factor_citation_id }, '化糞池排放係數');

  const bo = input.bo_kg_ch4_per_kg_bod ?? 0.6;
  const mcf = input.mcf ?? 0.5;
  const ch4Origin = 'biogenic_or_wastewater' as const;

  let rawTonnes: number;
  let unitCitationId: string;

  if (input.mode === 'person_day') {
    const unitRule = lookupUnitConversion(
      {
        activity_unit: '人天',
        ncv_unit: null,
        heat_conversion_unit: null,
        ef_unit: '公噸/人天',
      },
      registry
    );
    unitCitationId = unitRule.citation_id;

    const wastewaterL = input.wastewater_l_per_person_day ?? 180;
    const bodMgL = input.bod_mg_per_l ?? 225;
    // 0.6 * 0.5 * 180 * 225 / 1e9 = 0.0000121500 公噸 CH4/人天
    const efPerPersonDay = roundIntermediate((bo * mcf * wastewaterL * bodMgL) / 1e9);
    rawTonnes = roundDetail(input.person_days * input.alloc_ratio * efPerPersonDay * unitRule.unit_factor);
  } else {
    const unitRule = lookupUnitConversion(
      {
        activity_unit: '公噸(BOD)',
        ncv_unit: null,
        heat_conversion_unit: null,
        ef_unit: '公噸/公噸(BOD)',
      },
      registry
    );
    unitCitationId = unitRule.citation_id;

    // 0.6 * 0.5 = 0.3000 公噸 CH4/公噸 BOD
    const efPerBodTonne = roundIntermediate(bo * mcf);
    rawTonnes = roundDetail(input.bod_tonnes * input.alloc_ratio * efPerBodTonne * unitRule.unit_factor);
  }

  const projections = projectAllTracks(rawTonnes, 'CH4', ch4Origin, registry);
  const citationIds = new Set<string>([input.factor_citation_id, unitCitationId]);
  Object.values(projections).forEach((p) => citationIds.add(p.gwp_citation_id));

  return {
    source_category: 'GF_SEPTIC',
    material_code: input.material_code,
    gas_details: [
      {
        gas_code: 'CH4',
        ch4_origin: ch4Origin,
        raw_gas_tonnes: rawTonnes,
        is_biogenic_co2: false,
        projections,
      },
    ],
    citation_ids: Array.from(citationIds),
    notices: [],
  };
}
