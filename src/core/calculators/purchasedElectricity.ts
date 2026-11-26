import { CitationRegistry, defaultCitationRegistry } from '../../registry/CitationRegistry.js';
import { projectAllTracks } from '../gwpProjector.js';
import { roundDetail } from '../precision.js';
import { lookupUnitConversion } from '../unitConverter.js';
import type { CalculationOutput } from './types.js';

export interface PurchasedElectricityInput {
  material_code: string;
  activity_qty: number;
  activity_unit: '千度' | '度';
  alloc_ratio: number;
  /** 電力排碳係數 (kg CO2/度) */
  grid_ef_kg_per_kwh: number;
  ef_citation_id: string;
}

export function calculatePurchasedElectricity(
  input: PurchasedElectricityInput,
  registry: CitationRegistry = defaultCitationRegistry
): CalculationOutput {
  registry.assertCited({ citation_id: input.ef_citation_id }, '外購電力排碳係數');

  const unitRule = lookupUnitConversion(
    {
      activity_unit: input.activity_unit,
      ncv_unit: null,
      heat_conversion_unit: null,
      ef_unit: '公斤CO2/度',
    },
    registry
  );

  const rawTonnes = roundDetail(
    input.activity_qty * input.alloc_ratio * input.grid_ef_kg_per_kwh * unitRule.unit_factor
  );
  const projections = projectAllTracks(rawTonnes, 'CO2', undefined, registry);
  const citationIds = new Set<string>([input.ef_citation_id, unitRule.citation_id]);
  Object.values(projections).forEach((p) => citationIds.add(p.gwp_citation_id));

  return {
    source_category: 'GP',
    material_code: input.material_code,
    gas_details: [
      {
        gas_code: 'CO2',
        raw_gas_tonnes: rawTonnes,
        is_biogenic_co2: false,
        projections,
      },
    ],
    citation_ids: Array.from(citationIds),
    notices: [],
  };
}
