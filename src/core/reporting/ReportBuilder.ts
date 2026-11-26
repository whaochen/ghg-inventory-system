import { CitationRegistry, defaultCitationRegistry } from '../../registry/CitationRegistry.js';
import { ALL_GWP_PROFILES, GwpProfile } from '../gwpProjector.js';
import { roundDetail, roundSummary } from '../precision.js';
import { EmissionType } from '../source/types.js';
import {
  assertLabTestRecordValid,
  checkMaterialityThreshold,
} from '../verification/AuditGuard.js';
import type { AuditAlert, LabTestRecord } from '../verification/types.js';
import type {
  BuildReportInput,
  InventoryReportPackage,
  TrackSummary,
} from './types.js';

export function buildInventoryReportPackage(
  input: BuildReportInput,
  registry: CitationRegistry = defaultCitationRegistry
): InventoryReportPackage {
  const labTests = input.lab_tests ?? [];
  const labTestMap = new Map<string, LabTestRecord>(labTests.map((t) => [t.lab_test_id, t]));
  const customLabIds = new Set(input.custom_lab_activity_ids ?? []);

  const auditAlerts: AuditAlert[] = [...(input.additional_alerts ?? [])];
  const notices: string[] = [];
  const citationIds = new Set<string>(input.boundary_version.citation_ids);

  const rawGasTotals: Record<string, number> = {};
  let biogenicCo2Tonnes = 0;

  // 各軌累計暫存（未四捨五入至 3 位前先累加）
  const trackAcc: Record<
    GwpProfile,
    {
      total: number;
      scope1: number;
      scope2: number;
      byGas: Record<string, number>;
      byType: Partial<Record<EmissionType, number>>;
    }
  > = {
    MOENV_AR5: { total: 0, scope1: 0, scope2: 0, byGas: {}, byType: {} },
    IPCC_AR6_2021: { total: 0, scope1: 0, scope2: 0, byGas: {}, byType: {} },
    IPCC_AR6_ERRATA_2025: { total: 0, scope1: 0, scope2: 0, byGas: {}, byType: {} },
  };

  for (const item of input.items) {
    const { activity, source, calculation } = item;
    citationIds.add(source.codebook_citation_id);
    calculation.citation_ids.forEach((id) => citationIds.add(id));
    notices.push(...calculation.notices);

    // 檢核自廠檢測強制防呆
    if (customLabIds.has(activity.activity_id) || activity.lab_test_id) {
      const record = activity.lab_test_id ? labTestMap.get(activity.lab_test_id) : undefined;
      assertLabTestRecordValid(activity.activity_id, record);
    }

    // 活動數據佐證缺件警示
    if (activity.in_use_this_year && activity.evidence_files.length === 0) {
      auditAlerts.push({
        code: 'MISSING_EVIDENCE',
        severity: 'warning',
        message: `缺件警示：活動數據 "${activity.activity_id}" 未附帶佐證檔名或雜湊`,
        citation_id: 'CIT-QA-MOENV',
      });
      citationIds.add('CIT-QA-MOENV');
    }

    for (const detail of calculation.gas_details) {
      if (detail.is_biogenic_co2) {
        biogenicCo2Tonnes = roundDetail(biogenicCo2Tonnes + detail.raw_gas_tonnes);
        continue;
      }

      rawGasTotals[detail.gas_code] = roundDetail(
        (rawGasTotals[detail.gas_code] ?? 0) + detail.raw_gas_tonnes
      );

      for (const profile of ALL_GWP_PROFILES) {
        const co2e = detail.projections[profile].co2e_tonnes;
        const acc = trackAcc[profile];
        acc.total += co2e;
        if (source.scope === 'scope_1') {
          acc.scope1 += co2e;
        } else {
          acc.scope2 += co2e;
        }
        acc.byGas[detail.gas_code] = roundDetail((acc.byGas[detail.gas_code] ?? 0) + co2e);
        acc.byType[source.emission_type] = roundDetail(
          (acc.byType[source.emission_type] ?? 0) + co2e
        );
      }
    }
  }

  const tracks = {} as Record<GwpProfile, TrackSummary>;
  for (const profile of ALL_GWP_PROFILES) {
    const acc = trackAcc[profile];
    tracks[profile] = {
      gwp_profile: profile,
      total_co2e_tonnes: roundSummary(acc.total),
      scope_1_co2e_tonnes: roundSummary(acc.scope1),
      scope_2_co2e_tonnes: roundSummary(acc.scope2),
      by_gas_co2e: acc.byGas,
      by_emission_type_co2e: acc.byType,
    };
  }

  // 防呆 2：GWP 版本切換（AR5 ↔ AR6）5% 實質性預警
  const ar5Total = tracks.MOENV_AR5.total_co2e_tonnes;
  const ar6Alert = checkMaterialityThreshold(
    ar5Total,
    tracks.IPCC_AR6_2021.total_co2e_tonnes,
    'MOENV_AR5 ↔ IPCC_AR6_2021'
  );
  if (ar6Alert) {
    auditAlerts.push(ar6Alert);
    citationIds.add(ar6Alert.citation_id);
  }

  const errataAlert = checkMaterialityThreshold(
    ar5Total,
    tracks.IPCC_AR6_ERRATA_2025.total_co2e_tonnes,
    'MOENV_AR5 ↔ IPCC_AR6_ERRATA_2025'
  );
  if (errataAlert) {
    auditAlerts.push(errataAlert);
    citationIds.add(errataAlert.citation_id);
  }

  if (input.previous_year_ar5_tonnes !== undefined) {
    const yoyAlert = checkMaterialityThreshold(
      input.previous_year_ar5_tonnes,
      ar5Total,
      '前後期年度排放量比較'
    );
    if (yoyAlert) {
      auditAlerts.push(yoyAlert);
      citationIds.add(yoyAlert.citation_id);
    }
  }

  const pkg: InventoryReportPackage = {
    boundary_version_id: input.boundary_version.boundary_version_id,
    report_mode: input.boundary_version.report_mode,
    raw_gas_totals: rawGasTotals,
    biogenic_co2_tonnes: biogenicCo2Tonnes,
    tracks,
    audit_alerts: auditAlerts,
    notices,
    source_citations: registry.resolveMany(citationIds),
  };

  if (input.boundary_version.report_mode === 'manufacturing_single_site') {
    pkg.manufacturing_tables = {
      table1_basic_info: input.boundary_version,
      table2_boundary_and_exclusions: {
        sites: input.sites,
        exclusions: input.exclusions,
      },
      table3_emission_sources: input.items.map((i) => i.source),
      table4_activity_records: input.items.map((i) => i.activity),
      table5_calculation_details: input.items,
      table6_data_quality: input.data_quality ?? [],
      table7_uncertainty: input.uncertainty ?? null,
      table8_summary_by_track: tracks,
      table10_gwp_comparison: Object.entries(rawGasTotals).map(([gas, raw]) => ({
        gas_code: gas,
        raw_gas_tonnes: raw,
        MOENV_AR5: tracks.MOENV_AR5.by_gas_co2e[gas] ?? 0,
        IPCC_AR6_2021: tracks.IPCC_AR6_2021.by_gas_co2e[gas] ?? 0,
        IPCC_AR6_ERRATA_2025: tracks.IPCC_AR6_ERRATA_2025.by_gas_co2e[gas] ?? 0,
      })),
      table11_lab_tests: labTests,
    };
  } else {
    pkg.service_v3_tables = {
      table1_basic_info: input.boundary_version,
      table2_sites: input.sites,
      table3_utility_accounts: input.utility_accounts,
      table4_sources_and_activities: input.items.map((i) => ({
        source: i.source,
        activity: i.activity,
      })),
      table5_calculation_details: input.items,
      table6_summary_by_track: tracks,
      table7_lab_tests: labTests,
    };
  }

  return pkg;
}
