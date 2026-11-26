import { describe, expect, it } from 'vitest';
import {
  CitationRegistry,
  MissingCitationError,
  UnknownCitationError,
  defaultCitationRegistry,
} from '../src/registry/CitationRegistry.js';
import { MoenvDataStore } from '../src/registry/MoenvDataStore.js';

describe('Phase 0: CitationRegistry 與官方 ODS 解析資料驗證', () => {
  it('應載入規格書第 4 節全部 12 筆權威引用來源', () => {
    const requiredIds = [
      'CIT-LAW-ACT',
      'CIT-LAW-MGT',
      'CIT-CODE-V2',
      'CIT-EF-MOENV-113',
      'CIT-NCV-114',
      'CIT-GUIDE-113',
      'CIT-TPL-MFG',
      'CIT-TPL-SVC3',
      'CIT-RPT-GEN',
      'CIT-QA-MOENV',
      'CIT-GWP-AR6-2021',
      'CIT-GWP-AR6-ERR25',
    ];

    for (const id of requiredIds) {
      expect(defaultCitationRegistry.has(id)).toBe(true);
      const cit = defaultCitationRegistry.get(id);
      expect(cit.issuer.length).toBeGreaterThan(0);
      expect(cit.document_title.length).toBeGreaterThan(0);
      expect(cit.url.length).toBeGreaterThan(0);
    }
  });

  it('任何缺少或未知 citation_id 的條目一律拋錯阻擋', () => {
    const registry = new CitationRegistry();

    expect(() => registry.assertCited({ value: 123 } as { value: number; citation_id?: string })).toThrow(
      MissingCitationError
    );
    expect(() => registry.assertCited({ value: 123, citation_id: '' })).toThrow(MissingCitationError);
    expect(() => registry.assertCited({ value: 123, citation_id: 'CIT-NON-EXISTENT' })).toThrow(
      UnknownCitationError
    );
    expect(() => registry.assertCited({ value: 123, citation_id: 'CIT-EF-MOENV-113' })).not.toThrow();
  });

  it('代碼檔 V2 11 張附表與 113 年係數皆已成功解析且具備合法 citation_id', () => {
    const store = new MoenvDataStore(defaultCitationRegistry);

    expect(store.codebook.table1_regulated_industries.length).toBeGreaterThan(0);
    expect(store.codebook.table2_verification_bodies.length).toBeGreaterThan(0);
    expect(store.codebook.table3_competent_authorities.length).toBeGreaterThan(0);
    expect(store.codebook.table4_industry_codes.length).toBeGreaterThan(0);
    expect(store.codebook.table5_zip3_codes.length).toBeGreaterThan(0);
    expect(store.codebook.table6_process_codes.length).toBeGreaterThan(0);
    expect(store.codebook.table7_equipment_codes.length).toBeGreaterThan(0);
    expect(store.codebook.table8_material_codes.length).toBeGreaterThan(0);
    expect(store.codebook.table9_test_methods.length).toBeGreaterThan(0);
    expect(store.codebook.table10_gwp_values.length).toBeGreaterThan(0);
    expect(store.codebook.table11_station_purposes.length).toBeGreaterThan(0);

    // 驗證核心官方代碼存在
    expect(store.hasMaterialCode('170099')).toBe(true);
    expect(store.hasMaterialCode('050002')).toBe(true);
    expect(store.hasMaterialCode('170001')).toBe(true);
    expect(store.hasMaterialCode('GG1835')).toBe(true);
    expect(store.hasMaterialCode('GG3500')).toBe(true);
    expect(store.hasEquipmentCode('4092')).toBe(true);
    expect(store.hasEquipmentCode('9795')).toBe(true);

    // 驗證 113 年係數與服務業 V3 參考表
    expect(store.ef113.stationary_fuels.length).toBeGreaterThan(20);
    expect(store.ef113.mobile_fuels.length).toBeGreaterThan(5);
    expect(store.ef113.wastewater_mcf.length).toBeGreaterThan(5);
    expect(store.ef113.refrigeration_leak_rates.length).toBeGreaterThan(3);
    expect(store.ef113.gwp_ar5.length).toBeGreaterThan(20);
    expect(store.svc3.unit_conversions.length).toBeGreaterThan(10);
    expect(store.svc3.fossil_fuels.length).toBeGreaterThan(50);
  });
});
