import { describe, expect, it } from 'vitest';
import { BoundaryManager } from '../src/core/boundary/BoundaryManager.js';
import {
  calculatePurchasedElectricity,
  calculateRefrigerantFugitive,
  calculateSepticTank,
  calculateStationaryCombustion,
} from '../src/core/calculators/index.js';
import { buildInventoryReportPackage } from '../src/core/reporting/ReportBuilder.js';
import { SourceManager } from '../src/core/source/SourceManager.js';
import {
  MissingLabTestError,
  checkVerifierCompliance,
  createAuditSnapshot,
  evaluateDataQuality,
  evaluateUncertainty,
} from '../src/core/verification/AuditGuard.js';
import type { LabTestRecord } from '../src/core/verification/types.js';

describe('Phase 3: 報＋查輸出資料包、三大防呆與端到端整合測試', () => {
  it('端到端案例 1：單廠製造業查驗模式 (表一～表十一、表六/七與 AuditSnapshot)', () => {
    const bm = new BoundaryManager({
      boundary_version_id: 'BV-MFG-113-01',
      inventory_year_roc: 113,
      regime_mode: 'mandatory_verify',
      report_mode: 'manufacturing_single_site',
      boundary_method: 'statutory',
      tax_id: '22334455',
      control_no: 'A1234567',
      industry_code: '2399',
      locked: false,
      citation_ids: ['CIT-LAW-MGT', 'CIT-CODE-V2', 'CIT-TPL-MFG'],
    });

    bm.addSite({
      site_id: 'D00001',
      site_name: '桃園一廠',
      site_type: '製造工廠',
      zip3: '330',
      address: '桃園市桃園區工業路100號',
      inclusion_status: 'included',
      operating_periods: [{ start_date: '2024-01-01', end_date: '2024-12-31' }],
    });

    bm.addExclusion({
      site_id: 'D00001',
      excluded_entity_name: '同址獨立關係企業物流中心',
      address_desc: '桃園市桃園區工業路100號B棟',
      statutory_basis: '具獨立統編與工廠登記，依問答集排除',
      evidence_ref: '工廠登記證字號 99-123456-00',
      citation_id: 'CIT-QA-MOENV',
    });

    const sm = new SourceManager(bm);
    sm.addSource({
      source_id: 'SRC-GS01',
      site_id: 'D00001',
      owner_label: '緊急發電機汽油',
      process_no: 'G01',
      equipment_no: 'GS01',
      process_code: '000000',
      equipment_code: '0000',
      material_code: '170099',
      scope: 'scope_1',
      emission_type: 'stationary',
      is_biomass: false,
      is_chp: false,
      ch4_origin: 'non_fossil_combustion',
      codebook_citation_id: 'CIT-CODE-V2',
    });
    sm.addSource({
      source_id: 'SRC-GF01',
      site_id: 'D00001',
      owner_label: '廠區化糞池',
      process_no: 'G01',
      equipment_no: 'GF01',
      process_code: '000000',
      equipment_code: '9795',
      material_code: '360006',
      scope: 'scope_1',
      emission_type: 'fugitive',
      is_biomass: false,
      is_chp: false,
      ch4_origin: 'biogenic_or_wastewater',
      codebook_citation_id: 'CIT-CODE-V2',
    });
    sm.addSource({
      source_id: 'SRC-GP01',
      site_id: 'D00001',
      owner_label: '全廠外購電力',
      process_no: 'G01',
      equipment_no: 'GP01',
      process_code: '000000',
      equipment_code: '9999',
      material_code: 'GG3500',
      scope: 'scope_2',
      emission_type: 'purchased_electricity',
      is_biomass: false,
      is_chp: false,
      codebook_citation_id: 'CIT-CODE-V2',
    });

    const labTest: LabTestRecord = {
      lab_test_id: 'LAB-001',
      source_id: 'SRC-GS01',
      parameter_type: 'ncv',
      lab_name: '台灣檢驗科技股份有限公司',
      accreditation: 'CNS 17025',
      test_method: 'ASTM D240',
      test_start_date: '2024-06-01',
      test_end_date: '2024-06-05',
      measured_value: 7580,
      unit: '千卡/公升',
    };

    const actGs = {
      activity_id: 'ACT-GS01',
      source_id: 'SRC-GS01',
      in_use_this_year: true,
      activity_qty: 365.23,
      activity_unit: '公秉' as const,
      alloc_ratio: 1.0,
      data_source_desc: '發票與入庫紀錄',
      data_source_tier: 'periodic_measure' as const,
      evidence_files: [{ filename: 'gasoline_2024.pdf', sha256: 'abc123' }],
      lab_test_id: 'LAB-001',
    };
    const actGf = {
      activity_id: 'ACT-GF01',
      source_id: 'SRC-GF01',
      in_use_this_year: true,
      activity_qty: 12683,
      activity_unit: '人天' as const,
      alloc_ratio: 1.0,
      data_source_desc: '人資出勤統計表',
      data_source_tier: 'estimate' as const,
      evidence_files: [{ filename: 'attendance_2024.xlsx', sha256: 'def456' }],
    };
    const actGp = {
      activity_id: 'ACT-GP01',
      source_id: 'SRC-GP01',
      in_use_this_year: true,
      activity_qty: 71175.266,
      activity_unit: '千度' as const,
      alloc_ratio: 1.0,
      data_source_desc: '台電電費單',
      data_source_tier: 'periodic_measure' as const,
      evidence_files: [{ filename: 'taipower_2024.pdf', sha256: 'ghi789' }],
    };

    expect(sm.addActivity(actGs)).toHaveLength(0);
    expect(sm.addActivity(actGf)).toHaveLength(0);
    expect(sm.addActivity(actGp)).toHaveLength(0);

    const calcGs = calculateStationaryCombustion({
      material_code: '170099',
      activity_qty: actGs.activity_qty,
      activity_unit: '公秉',
      alloc_ratio: 1.0,
      is_biomass: false,
      ncv_unit: '千卡/公升',
      ncv_citation_id: 'CIT-TPL-MFG',
      co2: { ef_per_unit: 2.2010417906, citation_id: 'CIT-EF-MOENV-113' },
      ch4: { ef_per_unit: 0.0000952832, citation_id: 'CIT-EF-MOENV-113' },
      n2o: { ef_per_unit: 0.0000190566, citation_id: 'CIT-EF-MOENV-113' },
    });
    const calcGf = calculateSepticTank({
      mode: 'person_day',
      material_code: '360006',
      person_days: 12683,
      alloc_ratio: 1.0,
      factor_citation_id: 'CIT-EF-MOENV-113',
    });
    const calcGp = calculatePurchasedElectricity({
      material_code: 'GG3500',
      activity_qty: 71175.266,
      activity_unit: '千度',
      alloc_ratio: 1.0,
      grid_ef_kg_per_kwh: 0.474,
      ef_citation_id: 'CIT-EF-MOENV-113',
    });

    const dq = [
      evaluateDataQuality({
        source_id: 'SRC-GS01',
        activity_error_grade: 1,
        calibration_grade: 1,
        factor_grade: 2,
      }),
    ];
    expect(dq[0]!.quality_level).toBe('A (優良)');

    const uncertainty = evaluateUncertainty([
      {
        source_id: 'SRC-GS01',
        co2e_tonnes: 806.7159,
        activity_ci_lower_pct: 2,
        activity_ci_upper_pct: 2,
        factor_ci_lower_pct: 3,
        factor_ci_upper_pct: 3,
      },
      {
        source_id: 'SRC-GP01',
        co2e_tonnes: 33737.0761,
        activity_ci_lower_pct: 1,
        activity_ci_upper_pct: 1,
        factor_ci_lower_pct: 2,
        factor_ci_upper_pct: 2,
      },
    ]);
    expect(uncertainty.lower_bound_tonnes).toBeLessThan(uncertainty.total_co2e_tonnes);
    expect(uncertainty.upper_bound_tonnes).toBeGreaterThan(uncertainty.total_co2e_tonnes);

    const lockedVersion = bm.lockVersion('2026-11-25T00:00:00Z');
    const verifierAlerts = checkVerifierCompliance({
      verification_body_code: 'BSI',
      lead_verifier_id: 'V-001',
      lead_verifier_name: '王查驗',
      consecutive_years: 3,
    });
    expect(verifierAlerts).toHaveLength(0);

    const pkg = buildInventoryReportPackage({
      boundary_version: lockedVersion,
      sites: bm.getAllSites(),
      exclusions: bm.getExclusions(),
      utility_accounts: bm.getUtilityAccounts(),
      items: [
        { activity: actGs, source: sm.getSource('SRC-GS01')!, calculation: calcGs },
        { activity: actGf, source: sm.getSource('SRC-GF01')!, calculation: calcGf },
        { activity: actGp, source: sm.getSource('SRC-GP01')!, calculation: calcGp },
      ],
      lab_tests: [labTest],
      data_quality: dq,
      uncertainty,
      additional_alerts: verifierAlerts,
    });

    // AR5 總和 = (803.8865 + 0.9744 + 1.8550) + 4.3148 + 33737.0761 = 34548.1068 -> 34548.107
    expect(pkg.tracks.MOENV_AR5.total_co2e_tonnes).toBe(34548.107);
    expect(pkg.manufacturing_tables).toBeDefined();
    expect(pkg.manufacturing_tables!.table11_lab_tests).toHaveLength(1);
    expect(pkg.audit_alerts).toHaveLength(0);
    expect(pkg.source_citations.length).toBeGreaterThanOrEqual(4);

    // 不可變 AuditSnapshot 鎖存驗證
    const snapshot = createAuditSnapshot('SNAP-113-01', lockedVersion.boundary_version_id, pkg);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.payload)).toBe(true);
    expect(snapshot.payload_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('端到端案例 2：多據點服務業擴大盤查模式 (服務業 V3 表 1～表 7)', () => {
    const bm = new BoundaryManager({
      boundary_version_id: 'BV-SVC-113-01',
      inventory_year_roc: 113,
      regime_mode: 'mandatory_register',
      report_mode: 'service_multi_site',
      boundary_method: 'operational_control',
      tax_id: '88776655',
      industry_code: '4711',
      regulated_industry_code: 'RIC0003',
      regulated_condition_code: 'RIT0001',
      locked: false,
      citation_ids: ['CIT-LAW-MGT', 'CIT-CODE-V2', 'CIT-TPL-SVC3'],
    });

    bm.addSite({
      site_id: 'D00001',
      site_name: '台北總公司',
      site_type: '辦公室',
      zip3: '100',
      address: '臺北市中正區1號',
      inclusion_status: 'included',
      operating_periods: [{ start_date: '2024-01-01', end_date: '2024-12-31' }],
      station_purpose_code: '0',
    });
    bm.addSite({
      site_id: 'D00002',
      site_name: '停業門市',
      site_type: '門市',
      zip3: '100',
      address: '臺北市中正區2號',
      inclusion_status: 'inactive_period',
      operating_periods: [{ start_date: '2024-01-01', end_date: '2024-02-01' }],
    });

    bm.addUtilityAccount({
      utility_id: 'U-01',
      site_id: 'D00001',
      meter_available: true,
      meter_no: '11-22334455-0',
      is_shared: false,
      share_ratio: 1.0,
      period_start: '2024-01-01',
      period_end: '2024-12-31',
    });

    const sm = new SourceManager(bm);
    sm.addSource({
      source_id: 'SRC-NG',
      site_id: 'D00001',
      owner_label: '員工餐廳天然氣',
      process_no: 'G01',
      equipment_no: 'GS01',
      process_code: '000000',
      equipment_code: '0000',
      material_code: '050002',
      scope: 'scope_1',
      emission_type: 'stationary',
      is_biomass: false,
      is_chp: false,
      ch4_origin: 'non_fossil_combustion',
      codebook_citation_id: 'CIT-CODE-V2',
    });
    sm.addSource({
      source_id: 'SRC-REF',
      site_id: 'D00001',
      owner_label: '冰水機冷媒',
      process_no: 'G01',
      equipment_no: 'GF01',
      process_code: '000000',
      equipment_code: '4092',
      material_code: 'GG1835',
      scope: 'scope_1',
      emission_type: 'fugitive',
      is_biomass: false,
      is_chp: false,
      codebook_citation_id: 'CIT-CODE-V2',
    });
    sm.addSource({
      source_id: 'SRC-BOD',
      site_id: 'D00001',
      owner_label: '總公司化糞池',
      process_no: 'G01',
      equipment_no: 'GF02',
      process_code: '000000',
      equipment_code: '9795',
      material_code: 'GG3805',
      scope: 'scope_1',
      emission_type: 'fugitive',
      is_biomass: false,
      is_chp: false,
      ch4_origin: 'biogenic_or_wastewater',
      codebook_citation_id: 'CIT-CODE-V2',
    });

    const actNg = {
      activity_id: 'ACT-NG',
      source_id: 'SRC-NG',
      in_use_this_year: true,
      activity_qty: 500,
      activity_unit: '立方公尺' as const,
      alloc_ratio: 1.0,
      data_source_desc: '天然氣帳單',
      data_source_tier: 'periodic_measure' as const,
      evidence_files: [{ filename: 'ng_bill.pdf' }],
    };
    const actRef = {
      activity_id: 'ACT-REF',
      source_id: 'SRC-REF',
      in_use_this_year: true,
      activity_qty: 10,
      activity_unit: '公斤/年' as const,
      alloc_ratio: 1.0,
      data_source_desc: '設備銘牌',
      data_source_tier: 'estimate' as const,
      evidence_files: [{ filename: 'chiller_plate.jpg' }],
    };
    const actBod = {
      activity_id: 'ACT-BOD',
      source_id: 'SRC-BOD',
      in_use_this_year: true,
      activity_qty: 0.146,
      activity_unit: '公噸(BOD)' as const,
      alloc_ratio: 1.0,
      data_source_desc: '人員出勤推估',
      data_source_tier: 'estimate' as const,
      evidence_files: [{ filename: 'staff_count.xlsx' }],
    };

    const calcNg = calculateStationaryCombustion({
      material_code: '050002',
      activity_qty: 500,
      activity_unit: '立方公尺',
      alloc_ratio: 1.0,
      is_biomass: false,
      ncv_unit: '千卡/立方公尺',
      ncv_citation_id: 'CIT-TPL-SVC3',
      co2: { ef_per_unit: 1.8947727652, citation_id: 'CIT-EF-MOENV-113' },
    });
    const calcRef = calculateRefrigerantFugitive({
      material_code: 'GG1835',
      equipment_code: '4092',
      charge_kg: 10,
      alloc_ratio: 1.0,
      leak_rate_pct: 8.5,
      leak_rate_citation_id: 'CIT-EF-MOENV-113',
    });
    const calcBod = calculateSepticTank({
      mode: 'bod_tonnes',
      material_code: 'GG3805',
      bod_tonnes: 0.146,
      alloc_ratio: 1.0,
      factor_citation_id: 'CIT-EF-MOENV-113',
    });

    const pkg = buildInventoryReportPackage({
      boundary_version: bm.lockVersion(),
      sites: bm.getAllSites(),
      exclusions: bm.getExclusions(),
      utility_accounts: bm.getUtilityAccounts(),
      items: [
        { activity: actNg, source: sm.getSource('SRC-NG')!, calculation: calcNg },
        { activity: actRef, source: sm.getSource('SRC-REF')!, calculation: calcRef },
        { activity: actBod, source: sm.getSource('SRC-BOD')!, calculation: calcBod },
      ],
    });

    expect(pkg.service_v3_tables).toBeDefined();
    expect(pkg.service_v3_tables!.table2_sites).toHaveLength(2);
    expect(pkg.service_v3_tables!.table3_utility_accounts).toHaveLength(1);
    // AR5 總和 = 0.9474 + 1.1700 + 1.2264 = 3.3438 -> 3.344
    expect(pkg.tracks.MOENV_AR5.total_co2e_tonnes).toBe(3.344);
    // AR6 2021 總和 = 0.9474 + 1.3770 + 1.1826 = 3.5070 -> 3.507 (與 AR5 差異 4.87% < 5%)
    expect(pkg.tracks.IPCC_AR6_2021.total_co2e_tonnes).toBe(3.507);
    expect(pkg.audit_alerts).toHaveLength(0);
  });

  it('三大強制防呆：缺 LabTestRecord 阻擋定案、5% 實質性預警、6 年主導查驗員輪調警示', () => {
    const bm = new BoundaryManager({
      boundary_version_id: 'BV-GUARD-01',
      inventory_year_roc: 113,
      regime_mode: 'mandatory_verify',
      report_mode: 'manufacturing_single_site',
      boundary_method: 'statutory',
      tax_id: '11223344',
      industry_code: '2399',
      locked: false,
      citation_ids: ['CIT-LAW-MGT'],
    });
    bm.addSite({
      site_id: 'D00001',
      site_name: '總廠',
      site_type: '工廠',
      zip3: '100',
      address: '臺北市中正區1號',
      inclusion_status: 'included',
      operating_periods: [{ start_date: '2024-01-01', end_date: '2024-12-31' }],
    });
    const sm = new SourceManager(bm);
    sm.addSource({
      source_id: 'SRC-01',
      site_id: 'D00001',
      owner_label: '冷媒',
      process_no: 'G01',
      equipment_no: 'GF01',
      process_code: '000000',
      equipment_code: '4092',
      material_code: 'GG1835',
      scope: 'scope_1',
      emission_type: 'fugitive',
      is_biomass: false,
      is_chp: false,
      codebook_citation_id: 'CIT-CODE-V2',
    });

    const act = {
      activity_id: 'ACT-CUSTOM',
      source_id: 'SRC-01',
      in_use_this_year: true,
      activity_qty: 10,
      activity_unit: '公斤/年' as const,
      alloc_ratio: 1.0,
      data_source_desc: '設備銘牌',
      data_source_tier: 'periodic_measure' as const,
      evidence_files: [{ filename: 'plate.pdf' }],
    };
    const calc = calculateRefrigerantFugitive({
      material_code: 'GG1835',
      charge_kg: 10,
      alloc_ratio: 1.0,
      leak_rate_pct: 8.5,
      leak_rate_citation_id: 'CIT-EF-MOENV-113',
    });

    // 1. 缺 LabTestRecord 阻擋定案
    expect(() =>
      buildInventoryReportPackage({
        boundary_version: bm.getVersion(),
        sites: bm.getAllSites(),
        exclusions: [],
        utility_accounts: [],
        items: [{ activity: act, source: sm.getSource('SRC-01')!, calculation: calc }],
        custom_lab_activity_ids: ['ACT-CUSTOM'],
      })
    ).toThrow(MissingLabTestError);

    // 2. AR5 (1.170) vs AR6_2021 (1.377) 差異達 17.69% >= 5% -> 觸發實質性預警
    // 3. 同一主導查驗員連續滿 6 年 -> 強制警示輪調
    const rotationAlerts = checkVerifierCompliance({
      verification_body_code: 'BSI',
      lead_verifier_id: 'V-999',
      lead_verifier_name: '陳資深',
      consecutive_years: 6,
    });
    expect(rotationAlerts.some((a) => a.code === 'LEAD_VERIFIER_ROTATION_REQUIRED')).toBe(true);

    const pkg = buildInventoryReportPackage({
      boundary_version: bm.getVersion(),
      sites: bm.getAllSites(),
      exclusions: [],
      utility_accounts: [],
      items: [{ activity: act, source: sm.getSource('SRC-01')!, calculation: calc }],
      previous_year_ar5_tonnes: 1.0,
      additional_alerts: rotationAlerts,
    });

    expect(pkg.audit_alerts.some((a) => a.code === 'MATERIALITY_THRESHOLD_EXCEEDED')).toBe(true);
    expect(pkg.audit_alerts.some((a) => a.code === 'LEAD_VERIFIER_ROTATION_REQUIRED')).toBe(true);
  });
});
