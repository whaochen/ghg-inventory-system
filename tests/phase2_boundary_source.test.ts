import { describe, expect, it } from 'vitest';
import {
  BoundaryLockedError,
  BoundaryManager,
  BoundaryValidationError,
  DuplicateMeterAllocationError,
} from '../src/core/boundary/BoundaryManager.js';
import {
  ExcludedSiteSourceError,
  InvalidOfficialCodeError,
  SourceManager,
  compareDataSourceTier,
} from '../src/core/source/SourceManager.js';

describe('Phase 2: 邊界與排放源領域模型及合規檢核', () => {
  function createSampleBoundary(): BoundaryManager {
    const bm = new BoundaryManager({
      boundary_version_id: 'BV-113-01',
      inventory_year_roc: 113,
      regime_mode: 'mandatory_register',
      report_mode: 'service_multi_site',
      boundary_method: 'operational_control',
      tax_id: '12345678',
      industry_code: '4711',
      regulated_industry_code: 'RIC0003',
      regulated_condition_code: 'RIT0001',
      locked: false,
      citation_ids: ['CIT-LAW-MGT', 'CIT-CODE-V2'],
    });

    bm.addSite({
      site_id: 'D00001',
      site_name: '台北總公司',
      site_type: '辦公室',
      zip3: '100',
      address: '臺北市中正區忠孝西路一段1號',
      inclusion_status: 'included',
      operating_periods: [{ start_date: '2024-01-01', end_date: '2024-12-31' }],
      station_purpose_code: '0',
    });

    bm.addSite({
      site_id: 'D00002',
      site_name: '台中停業門市',
      site_type: '門市',
      zip3: '400',
      address: '臺中市中區台灣大道一段1號',
      inclusion_status: 'inactive_period',
      operating_periods: [{ start_date: '2024-01-01', end_date: '2024-03-31' }],
    });

    return bm;
  }

  it('非 included 據點禁止掛載正式排放源進入總量', () => {
    const bm = createSampleBoundary();
    const sm = new SourceManager(bm);

    expect(() =>
      sm.addSource({
        source_id: 'SRC-02',
        site_id: 'D00002',
        owner_label: '停業門市冷氣',
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
      })
    ).toThrow(ExcludedSiteSourceError);
  });

  it('同一電號於重疊期間共用比例合計不得大於 100%', () => {
    const bm = createSampleBoundary();
    bm.addSite({
      site_id: 'D00003',
      site_name: '台北門市',
      site_type: '門市',
      zip3: '100',
      address: '臺北市中正區館前路10號',
      inclusion_status: 'included',
      operating_periods: [{ start_date: '2024-01-01', end_date: '2024-12-31' }],
    });

    bm.addUtilityAccount({
      utility_id: 'U-01',
      site_id: 'D00001',
      meter_available: true,
      meter_no: '00-12345678-9',
      is_shared: true,
      share_ratio: 0.7,
      period_start: '2024-01-01',
      period_end: '2024-12-31',
    });

    expect(() =>
      bm.addUtilityAccount({
        utility_id: 'U-02',
        site_id: 'D00003',
        meter_available: true,
        meter_no: '00-12345678-9',
        is_shared: true,
        share_ratio: 0.35,
        period_start: '2024-06-01',
        period_end: '2024-12-31',
      })
    ).toThrow(DuplicateMeterAllocationError);

    // 合計 1.00 應允許
    expect(() =>
      bm.addUtilityAccount({
        utility_id: 'U-02',
        site_id: 'D00003',
        meter_available: true,
        meter_no: '00-12345678-9',
        is_shared: true,
        share_ratio: 0.3,
        period_start: '2024-06-01',
        period_end: '2024-12-31',
      })
    ).not.toThrow();
  });

  it('版本鎖定後禁止直接覆寫', () => {
    const bm = createSampleBoundary();
    bm.lockVersion('2026-11-25T00:00:00Z');

    expect(() =>
      bm.addSite({
        site_id: 'D00004',
        site_name: '高雄新據點',
        site_type: '門市',
        zip3: '800',
        address: '高雄市新興區中正三路1號',
        inclusion_status: 'included',
        operating_periods: [{ start_date: '2024-01-01', end_date: '2024-12-31' }],
      })
    ).toThrow(BoundaryLockedError);
  });

  it('官方代碼必須存在於代碼檔 V2 且未附佐證之活動數據標記缺件警示', () => {
    const bm = createSampleBoundary();
    const sm = new SourceManager(bm);

    expect(() =>
      sm.addSource({
        source_id: 'SRC-BAD',
        site_id: 'D00001',
        owner_label: '無效代碼',
        process_no: 'G01',
        equipment_no: 'GS01',
        process_code: '000000',
        equipment_code: '4092',
        material_code: 'INVALID_CODE',
        scope: 'scope_1',
        emission_type: 'stationary',
        is_biomass: false,
        is_chp: false,
        ch4_origin: 'non_fossil_combustion',
        codebook_citation_id: 'CIT-CODE-V2',
      })
    ).toThrow(InvalidOfficialCodeError);

    sm.addSource({
      source_id: 'SRC-ELEC',
      site_id: 'D00001',
      owner_label: '總公司外購電力',
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

    const warnings = sm.addActivity({
      activity_id: 'ACT-01',
      source_id: 'SRC-ELEC',
      in_use_this_year: true,
      activity_qty: 1000,
      activity_unit: '千度',
      alloc_ratio: 1.0,
      data_source_desc: '台電電費單',
      data_source_tier: 'periodic_measure',
      evidence_files: [],
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe('MISSING_EVIDENCE');
    expect(compareDataSourceTier('cems', 'periodic_measure')).toBeLessThan(0);
    expect(compareDataSourceTier('periodic_measure', 'estimate')).toBeLessThan(0);

    // 驗證無效郵遞區號會被阻擋
    expect(() =>
      bm.addSite({
        site_id: 'D00009',
        site_name: '錯誤郵遞區號',
        site_type: '辦公室',
        zip3: '999',
        address: '未知地址',
        inclusion_status: 'included',
        operating_periods: [{ start_date: '2024-01-01', end_date: '2024-12-31' }],
      })
    ).toThrow(BoundaryValidationError);
  });
});
