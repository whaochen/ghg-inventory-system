import { describe, expect, it } from 'vitest';
import {
  calculateMobileCombustion,
  calculatePurchasedElectricity,
  calculateRefrigerantFugitive,
  calculateSepticTank,
  calculateStationaryCombustion,
} from '../src/core/calculators/index.js';
import { UnitMismatchError, lookupUnitConversion } from '../src/core/unitConverter.js';

describe('Phase 1: 五大核心排放源與官方黃金測試案例', () => {
  it('黃金案例 1 (固定燃燒其他汽油 170099): CO2/CH4/N2O 誤差為 0', () => {
    const result = calculateStationaryCombustion({
      material_code: '170099',
      activity_qty: 365.23,
      activity_unit: '公秉',
      alloc_ratio: 1.0,
      is_biomass: false,
      ncv_unit: '千卡/公升',
      ncv_citation_id: 'CIT-TPL-MFG',
      co2: { ef_per_unit: 2.2010417906, citation_id: 'CIT-EF-MOENV-113' },
      ch4: { ef_per_unit: 0.0000952832, citation_id: 'CIT-EF-MOENV-113' },
      n2o: { ef_per_unit: 0.0000190566, citation_id: 'CIT-EF-MOENV-113' },
    });

    const co2 = result.gas_details.find((g) => g.gas_code === 'CO2')!;
    const ch4 = result.gas_details.find((g) => g.gas_code === 'CH4')!;
    const n2o = result.gas_details.find((g) => g.gas_code === 'N2O')!;

    expect(co2.raw_gas_tonnes).toBe(803.8865);
    expect(co2.projections.MOENV_AR5.co2e_tonnes).toBe(803.8865);

    expect(ch4.raw_gas_tonnes).toBe(0.0348);
    expect(ch4.projections.MOENV_AR5.gwp_value).toBe(28);
    expect(ch4.projections.MOENV_AR5.co2e_tonnes).toBe(0.9744);

    expect(n2o.raw_gas_tonnes).toBe(0.007);
    expect(n2o.projections.MOENV_AR5.co2e_tonnes).toBe(1.855);
  });

  it('黃金案例 2 (固定燃燒天然氣 050002): 立方公尺單位換算與精度誤差為 0', () => {
    const result = calculateStationaryCombustion({
      material_code: '050002',
      activity_qty: 500.0,
      activity_unit: '立方公尺',
      alloc_ratio: 1.0,
      is_biomass: false,
      ncv_unit: '千卡/立方公尺',
      ncv_citation_id: 'CIT-TPL-SVC3',
      co2: { ef_per_unit: 1.8947727652, citation_id: 'CIT-EF-MOENV-113' },
      ch4: { ef_per_unit: 3.37749e-5, citation_id: 'CIT-EF-MOENV-113' },
      n2o: { ef_per_unit: 3.37749e-6, citation_id: 'CIT-EF-MOENV-113' },
    });

    const co2 = result.gas_details.find((g) => g.gas_code === 'CO2')!;
    const ch4 = result.gas_details.find((g) => g.gas_code === 'CH4')!;
    const n2o = result.gas_details.find((g) => g.gas_code === 'N2O')!;

    expect(co2.raw_gas_tonnes).toBe(0.9474);
    expect(co2.projections.MOENV_AR5.co2e_tonnes).toBe(0.9474);
    expect(ch4.raw_gas_tonnes).toBe(0);
    expect(n2o.raw_gas_tonnes).toBe(0);
  });

  it('黃金案例 3 (移動燃燒車用汽油 170001): CO2 誤差為 0 且標註 CH4/N2O 未驗證', () => {
    const result = calculateMobileCombustion({
      material_code: '170001',
      activity_qty: 523.0,
      activity_unit: '公秉',
      alloc_ratio: 1.0,
      is_biomass: false,
      ncv_unit: '千卡/公升',
      ncv_citation_id: 'CIT-TPL-MFG',
      co2: { ef_per_unit: 2.2010417906, citation_id: 'CIT-EF-MOENV-113' },
    });

    const co2 = result.gas_details.find((g) => g.gas_code === 'CO2')!;
    expect(co2.raw_gas_tonnes).toBe(1151.1449);
    expect(co2.projections.MOENV_AR5.co2e_tonnes).toBe(1151.1449);
    expect(result.notices.some((n) => n.includes('未驗證') && n.includes('CH4'))).toBe(true);
    expect(result.notices.some((n) => n.includes('未驗證') && n.includes('N2O'))).toBe(true);
  });

  it('黃金案例 4 (冷媒 HFC-134a GG1835): 0.0009 t 與三軌 GWP 當量誤差為 0', () => {
    const result = calculateRefrigerantFugitive({
      material_code: 'GG1835',
      equipment_code: '4092',
      charge_kg: 10.0,
      alloc_ratio: 1.0,
      leak_rate_pct: 8.5,
      leak_rate_citation_id: 'CIT-EF-MOENV-113',
    });

    const hfc = result.gas_details[0]!;
    expect(hfc.gas_code).toBe('HFC-134a');
    expect(hfc.raw_gas_tonnes).toBe(0.0009);
    expect(hfc.projections.MOENV_AR5.co2e_tonnes).toBe(1.17);
    expect(hfc.projections.IPCC_AR6_2021.co2e_tonnes).toBe(1.377);
    expect(hfc.projections.IPCC_AR6_ERRATA_2025.co2e_tonnes).toBe(1.323);
  });

  it('黃金案例 5 (化糞池人天法與 BOD 總量法): CH4 與三軌 GWP 當量誤差為 0', () => {
    const personDayRes = calculateSepticTank({
      mode: 'person_day',
      material_code: '360006',
      person_days: 12683.0,
      alloc_ratio: 1.0,
      factor_citation_id: 'CIT-EF-MOENV-113',
    });

    const ch4A = personDayRes.gas_details[0]!;
    expect(ch4A.raw_gas_tonnes).toBe(0.1541);
    expect(ch4A.projections.MOENV_AR5.co2e_tonnes).toBe(4.3148);
    expect(ch4A.projections.IPCC_AR6_2021.co2e_tonnes).toBe(4.1607);
    expect(ch4A.projections.IPCC_AR6_ERRATA_2025.co2e_tonnes).toBe(3.8987);

    const bodRes = calculateSepticTank({
      mode: 'bod_tonnes',
      material_code: 'GG3805',
      bod_tonnes: 0.146,
      alloc_ratio: 1.0,
      factor_citation_id: 'CIT-EF-MOENV-113',
    });

    const ch4B = bodRes.gas_details[0]!;
    expect(ch4B.raw_gas_tonnes).toBe(0.0438);
    expect(ch4B.projections.MOENV_AR5.co2e_tonnes).toBe(1.2264);
    expect(ch4B.projections.IPCC_AR6_2021.co2e_tonnes).toBe(1.1826);
    expect(ch4B.projections.IPCC_AR6_ERRATA_2025.co2e_tonnes).toBe(1.1081);
  });

  it('黃金案例 6 (外購電力 GG3500): 千度與度計算誤差為 0', () => {
    const result = calculatePurchasedElectricity({
      material_code: 'GG3500',
      activity_qty: 71175.266,
      activity_unit: '千度',
      alloc_ratio: 1.0,
      grid_ef_kg_per_kwh: 0.474,
      ef_citation_id: 'CIT-EF-MOENV-113',
    });

    const co2 = result.gas_details[0]!;
    expect(co2.raw_gas_tonnes).toBe(33737.0761);
    expect(co2.projections.MOENV_AR5.co2e_tonnes).toBe(33737.0761);

    // 同等電量以「度」輸入
    const kwhResult = calculatePurchasedElectricity({
      material_code: 'GG3500',
      activity_qty: 71175266,
      activity_unit: '度',
      alloc_ratio: 1.0,
      grid_ef_kg_per_kwh: 0.474,
      ef_citation_id: 'CIT-EF-MOENV-113',
    });
    expect(kwhResult.gas_details[0]!.raw_gas_tonnes).toBe(33737.0761);
  });

  it('單位不相容拋出 UnitMismatchError、混合冷媒排除蒙特婁管制物、生質燃料獨立標記 CO2', () => {
    expect(() =>
      lookupUnitConversion({
        activity_unit: '公秉',
        ncv_unit: '千卡/立方公尺',
        heat_conversion_unit: '兆焦耳/千卡',
        ef_unit: '公斤/兆焦耳',
      })
    ).toThrow(UnitMismatchError);

    // 混合冷媒 R-402A (GG1843): 僅計入 60% HFC-125，排除 38% HCFC-22 與 2% Propane
    const r402a = calculateRefrigerantFugitive({
      material_code: 'GG1843',
      charge_kg: 100,
      alloc_ratio: 1.0,
      leak_rate_pct: 10,
      leak_rate_citation_id: 'CIT-EF-MOENV-113',
    });
    expect(r402a.gas_details).toHaveLength(1);
    expect(r402a.gas_details[0]!.gas_code).toBe('HFC-125');
    expect(r402a.gas_details[0]!.raw_gas_tonnes).toBe(0.006);
    expect(r402a.notices.some((n) => n.includes('蒙特婁議定書') && n.includes('HCFC-22'))).toBe(true);

    // 生質燃料 CO2 標記 is_biogenic_co2 = true
    const bio = calculateStationaryCombustion({
      material_code: '020012',
      activity_qty: 10,
      activity_unit: '公噸',
      alloc_ratio: 1.0,
      is_biomass: true,
      ncv_unit: '千卡/公斤',
      ncv_citation_id: 'CIT-EF-MOENV-113',
      ncv_kcal_per_unit: 7000,
      co2: { ef_kg_per_tj: 112000, citation_id: 'CIT-EF-MOENV-113' },
      ch4: { ef_kg_per_tj: 200, citation_id: 'CIT-EF-MOENV-113' },
    });
    expect(bio.gas_details.find((g) => g.gas_code === 'CO2')!.is_biogenic_co2).toBe(true);
    expect(bio.gas_details.find((g) => g.gas_code === 'CH4')!.is_biogenic_co2).toBe(false);
  });
});
