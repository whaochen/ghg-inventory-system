import { CitationRegistry, defaultCitationRegistry } from '../../registry/CitationRegistry.js';
import { GasCode, projectAllTracks } from '../gwpProjector.js';
import { roundDetail } from '../precision.js';
import { lookupUnitConversion } from '../unitConverter.js';
import type { CalculationOutput, GasEmissionDetail } from './types.js';

export interface RefrigerantComponent {
  /** 成分氣體代碼（如 HFC-134a, HFC-125）或受管制名稱（如 HCFC-22） */
  component_name: string;
  /** 若屬六大/七大溫室氣體則填對應 GasCode */
  gas_code?: GasCode;
  /** 佔比 (0..1]，例如 60% = 0.60 */
  mass_fraction: number;
  /** 是否受《蒙特婁議定書》管制之 HCFC/CFC 成分（若是則強制排除不計入） */
  is_montreal_controlled: boolean;
  /** 是否屬於京都議定書/氣候法納管溫室氣體（例如丙烷/異丁烷非屬七大溫室氣體亦排除） */
  is_kyoto_ghg: boolean;
}

export interface RefrigerantBlendProfile {
  material_code: string;
  blend_name: string;
  components: RefrigerantComponent[];
  citation_id: string;
}

const KNOWN_REFRIGERANT_BLENDS: Record<string, RefrigerantBlendProfile> = {
  GG1835: {
    material_code: 'GG1835',
    blend_name: 'HFC-134a',
    citation_id: 'CIT-EF-MOENV-113',
    components: [
      {
        component_name: 'HFC-134a',
        gas_code: 'HFC-134a',
        mass_fraction: 1.0,
        is_montreal_controlled: false,
        is_kyoto_ghg: true,
      },
    ],
  },
  GG1843: {
    material_code: 'GG1843',
    blend_name: 'R-402A',
    citation_id: 'CIT-EF-MOENV-113',
    components: [
      {
        component_name: 'HFC-125',
        gas_code: 'HFC-125',
        mass_fraction: 0.6,
        is_montreal_controlled: false,
        is_kyoto_ghg: true,
      },
      {
        component_name: 'HCFC-22',
        mass_fraction: 0.38,
        is_montreal_controlled: true,
        is_kyoto_ghg: false,
      },
      {
        component_name: 'Propane (R-290)',
        mass_fraction: 0.02,
        is_montreal_controlled: false,
        is_kyoto_ghg: false,
      },
    ],
  },
  GG1844: {
    material_code: 'GG1844',
    blend_name: 'R-402B',
    citation_id: 'CIT-EF-MOENV-113',
    components: [
      {
        component_name: 'HFC-125',
        gas_code: 'HFC-125',
        mass_fraction: 0.38,
        is_montreal_controlled: false,
        is_kyoto_ghg: true,
      },
      {
        component_name: 'HCFC-22',
        mass_fraction: 0.6,
        is_montreal_controlled: true,
        is_kyoto_ghg: false,
      },
      {
        component_name: 'Propane (R-290)',
        mass_fraction: 0.02,
        is_montreal_controlled: false,
        is_kyoto_ghg: false,
      },
    ],
  },
  GG1814: {
    material_code: 'GG1814',
    blend_name: 'R-410A',
    citation_id: 'CIT-EF-MOENV-113',
    components: [
      {
        component_name: 'HFC-32',
        gas_code: 'HFC-32',
        mass_fraction: 0.5,
        is_montreal_controlled: false,
        is_kyoto_ghg: true,
      },
      {
        component_name: 'HFC-125',
        gas_code: 'HFC-125',
        mass_fraction: 0.5,
        is_montreal_controlled: false,
        is_kyoto_ghg: true,
      },
    ],
  },
};

export interface RefrigerantFugitiveInput {
  material_code: string;
  equipment_code?: string;
  charge_kg: number;
  alloc_ratio: number;
  /** 年逸散率百分比數值，例如 8.5 表示 8.5%/年 */
  leak_rate_pct: number;
  leak_rate_citation_id: string;
  /** 若未指定自訂成分，則依 material_code 查 KNOWN_REFRIGERANT_BLENDS */
  custom_blend?: RefrigerantBlendProfile;
}

export function calculateRefrigerantFugitive(
  input: RefrigerantFugitiveInput,
  registry: CitationRegistry = defaultCitationRegistry
): CalculationOutput {
  registry.assertCited({ citation_id: input.leak_rate_citation_id }, '冷媒年逸散率');

  const unitRule = lookupUnitConversion(
    {
      activity_unit: '公斤/年',
      ncv_unit: null,
      heat_conversion_unit: null,
      ef_unit: '%/年',
    },
    registry
  );

  const blend = input.custom_blend ?? KNOWN_REFRIGERANT_BLENDS[input.material_code];
  if (!blend) {
    throw new Error(`未驗證：冷媒代碼 "${input.material_code}" 尚未登錄成分展開表`);
  }
  registry.assertCited(blend, `冷媒成分表(${input.material_code})`);

  const gasDetails: GasEmissionDetail[] = [];
  const citationIds = new Set<string>([
    input.leak_rate_citation_id,
    unitRule.citation_id,
    blend.citation_id,
  ]);
  const notices: string[] = [];

  for (const comp of blend.components) {
    if (comp.is_montreal_controlled) {
      notices.push(
        `已依《蒙特婁議定書》管制規則排除 ${blend.blend_name} 成分 ${comp.component_name} (${comp.mass_fraction * 100}%)`
      );
      continue;
    }
    if (!comp.is_kyoto_ghg || !comp.gas_code) {
      notices.push(
        `已排除非納管溫室氣體成分 ${comp.component_name} (${comp.mass_fraction * 100}%)`
      );
      continue;
    }

    const rawTonnes = roundDetail(
      input.charge_kg *
        input.alloc_ratio *
        input.leak_rate_pct *
        unitRule.unit_factor *
        comp.mass_fraction
    );
    const projections = projectAllTracks(rawTonnes, comp.gas_code, undefined, registry);
    Object.values(projections).forEach((p) => citationIds.add(p.gwp_citation_id));

    gasDetails.push({
      gas_code: comp.gas_code,
      raw_gas_tonnes: rawTonnes,
      is_biogenic_co2: false,
      projections,
    });
  }

  return {
    source_category: 'GF_REFRIGERANT',
    material_code: input.material_code,
    gas_details: gasDetails,
    citation_ids: Array.from(citationIds),
    notices,
  };
}
