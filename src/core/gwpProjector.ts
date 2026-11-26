import { CitationRegistry, defaultCitationRegistry } from '../registry/CitationRegistry.js';
import { roundDetail } from './precision.js';

export type GwpProfile = 'MOENV_AR5' | 'IPCC_AR6_2021' | 'IPCC_AR6_ERRATA_2025';

export type Ch4Origin =
  | 'non_fossil_combustion'
  | 'biogenic_or_wastewater'
  | 'fossil_fugitive_or_process';

export type GasCode =
  | 'CO2'
  | 'CH4'
  | 'N2O'
  | 'HFC-134a'
  | 'HFC-125'
  | 'HFC-143a'
  | 'HFC-32'
  | 'SF6'
  | 'NF3';

export interface GwpEntry {
  gwp_value: number;
  citation_id: string;
}

export interface GwpProjectionResult {
  gwp_profile: GwpProfile;
  gwp_value: number;
  gwp_citation_id: string;
  co2e_tonnes: number;
}

const GWP_TABLE: Record<
  GwpProfile,
  {
    CO2: GwpEntry;
    CH4_COMBUSTION_OR_BIOGENIC: GwpEntry;
    CH4_FOSSIL_FUGITIVE: GwpEntry;
    N2O: GwpEntry;
    'HFC-134a': GwpEntry;
    'HFC-125': GwpEntry;
    'HFC-143a': GwpEntry;
    'HFC-32': GwpEntry;
    SF6: GwpEntry;
    NF3: GwpEntry;
  }
> = {
  MOENV_AR5: {
    CO2: { gwp_value: 1, citation_id: 'CIT-EF-MOENV-113' },
    // 依 2026/06/01 官方修正與服務業 V3 化石燃料表：固定與移動燃燒及生物性一律採 28
    CH4_COMBUSTION_OR_BIOGENIC: { gwp_value: 28, citation_id: 'CIT-TPL-MFG' },
    // 30 僅限非燃燒化石逸散／製程
    CH4_FOSSIL_FUGITIVE: { gwp_value: 30, citation_id: 'CIT-EF-MOENV-113' },
    N2O: { gwp_value: 265, citation_id: 'CIT-EF-MOENV-113' },
    'HFC-134a': { gwp_value: 1300, citation_id: 'CIT-EF-MOENV-113' },
    'HFC-125': { gwp_value: 3170, citation_id: 'CIT-EF-MOENV-113' },
    'HFC-143a': { gwp_value: 4800, citation_id: 'CIT-EF-MOENV-113' },
    'HFC-32': { gwp_value: 677, citation_id: 'CIT-EF-MOENV-113' },
    SF6: { gwp_value: 23500, citation_id: 'CIT-EF-MOENV-113' },
    NF3: { gwp_value: 16100, citation_id: 'CIT-EF-MOENV-113' },
  },
  IPCC_AR6_2021: {
    CO2: { gwp_value: 1, citation_id: 'CIT-GWP-AR6-2021' },
    CH4_COMBUSTION_OR_BIOGENIC: { gwp_value: 27.0, citation_id: 'CIT-GWP-AR6-2021' },
    CH4_FOSSIL_FUGITIVE: { gwp_value: 29.8, citation_id: 'CIT-GWP-AR6-2021' },
    N2O: { gwp_value: 273, citation_id: 'CIT-GWP-AR6-2021' },
    'HFC-134a': { gwp_value: 1530, citation_id: 'CIT-GWP-AR6-2021' },
    'HFC-125': { gwp_value: 3740, citation_id: 'CIT-GWP-AR6-2021' },
    'HFC-143a': { gwp_value: 5810, citation_id: 'CIT-GWP-AR6-2021' },
    'HFC-32': { gwp_value: 771, citation_id: 'CIT-GWP-AR6-2021' },
    SF6: { gwp_value: 24300, citation_id: 'CIT-GWP-AR6-2021' },
    NF3: { gwp_value: 17400, citation_id: 'CIT-GWP-AR6-2021' },
  },
  IPCC_AR6_ERRATA_2025: {
    CO2: { gwp_value: 1, citation_id: 'CIT-GWP-AR6-ERR25' },
    CH4_COMBUSTION_OR_BIOGENIC: { gwp_value: 25.3, citation_id: 'CIT-GWP-AR6-ERR25' },
    CH4_FOSSIL_FUGITIVE: { gwp_value: 28.1, citation_id: 'CIT-GWP-AR6-ERR25' },
    N2O: { gwp_value: 267, citation_id: 'CIT-GWP-AR6-ERR25' },
    'HFC-134a': { gwp_value: 1470, citation_id: 'CIT-GWP-AR6-ERR25' },
    'HFC-125': { gwp_value: 3740, citation_id: 'CIT-GWP-AR6-ERR25' },
    'HFC-143a': { gwp_value: 5810, citation_id: 'CIT-GWP-AR6-ERR25' },
    'HFC-32': { gwp_value: 771, citation_id: 'CIT-GWP-AR6-ERR25' },
    SF6: { gwp_value: 23500, citation_id: 'CIT-GWP-AR6-ERR25' },
    NF3: { gwp_value: 16800, citation_id: 'CIT-GWP-AR6-ERR25' },
  },
};

export const ALL_GWP_PROFILES: readonly GwpProfile[] = [
  'MOENV_AR5',
  'IPCC_AR6_2021',
  'IPCC_AR6_ERRATA_2025',
];

export function getGwpEntry(
  gas: GasCode,
  profile: GwpProfile,
  ch4Origin?: Ch4Origin,
  registry: CitationRegistry = defaultCitationRegistry
): GwpEntry {
  const table = GWP_TABLE[profile];
  let entry: GwpEntry;

  if (gas === 'CH4') {
    if (!ch4Origin) {
      throw new Error('計算 CH4 的 GWP 時必須明確指定 ch4_origin (不可預設猜測)');
    }
    entry =
      ch4Origin === 'fossil_fugitive_or_process'
        ? table.CH4_FOSSIL_FUGITIVE
        : table.CH4_COMBUSTION_OR_BIOGENIC;
  } else {
    entry = table[gas];
  }

  registry.assertCited(entry, `GWP(${profile}, ${gas})`);
  return entry;
}

export function projectSingleTrack(
  rawGasTonnes: number,
  gas: GasCode,
  profile: GwpProfile,
  ch4Origin?: Ch4Origin,
  registry: CitationRegistry = defaultCitationRegistry
): GwpProjectionResult {
  const entry = getGwpEntry(gas, profile, ch4Origin, registry);
  return {
    gwp_profile: profile,
    gwp_value: entry.gwp_value,
    gwp_citation_id: entry.citation_id,
    co2e_tonnes: roundDetail(rawGasTonnes * entry.gwp_value),
  };
}

export function projectAllTracks(
  rawGasTonnes: number,
  gas: GasCode,
  ch4Origin?: Ch4Origin,
  registry: CitationRegistry = defaultCitationRegistry
): Record<GwpProfile, GwpProjectionResult> {
  return {
    MOENV_AR5: projectSingleTrack(rawGasTonnes, gas, 'MOENV_AR5', ch4Origin, registry),
    IPCC_AR6_2021: projectSingleTrack(rawGasTonnes, gas, 'IPCC_AR6_2021', ch4Origin, registry),
    IPCC_AR6_ERRATA_2025: projectSingleTrack(
      rawGasTonnes,
      gas,
      'IPCC_AR6_ERRATA_2025',
      ch4Origin,
      registry
    ),
  };
}
