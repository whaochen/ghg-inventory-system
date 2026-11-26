import codebookV2 from './data/codebook_v2.json' with { type: 'json' };
import efMoenv113 from './data/ef_moenv_113.json' with { type: 'json' };
import ncv114 from './data/ncv_114.json' with { type: 'json' };
import svc3Refs from './data/svc3_reference_tables.json' with { type: 'json' };
import { CitationRegistry, defaultCitationRegistry } from './CitationRegistry.js';
import type { CitedEntry } from './types.js';

export interface CodebookEntry extends CitedEntry {
  code: string;
  name: string;
}

export interface MaterialEntry extends CitedEntry {
  seq: string;
  code: string;
  name: string;
}

export interface ProcessEntry extends CitedEntry {
  seq: string;
  code: string;
  name: string;
}

export interface EquipmentEntry extends CitedEntry {
  seq: string;
  code: string;
  name: string;
}

export interface Zip3Entry extends CitedEntry {
  city: string;
  district: string;
  zip3: string;
}

export interface StationaryFuelEf extends CitedEntry {
  fuel_name: string;
  fuel_name_en: string;
  co2_kg_per_tj: number;
  ch4_kg_per_tj: number | null;
  n2o_kg_per_tj: number | null;
  unit: string;
}

export interface EfWithCiEntry extends CitedEntry {
  scope_type: string;
  emission_type: string;
  gas: string;
  material_code: string;
  material_name: string;
  fuel_name: string;
  ef_value: number;
  unit: string;
  ci_95_lower_pct: number | null;
  ci_95_upper_pct: number | null;
}

/**
 * 唯讀官方參數與代碼查表器（Provenance-First 驗證）
 */
export class MoenvDataStore {
  readonly codebook = codebookV2;
  readonly ef113 = efMoenv113;
  readonly ncv114 = ncv114;
  readonly svc3 = svc3Refs;

  private readonly processMap = new Map<string, ProcessEntry>();
  private readonly equipmentMap = new Map<string, EquipmentEntry>();
  private readonly materialMap = new Map<string, MaterialEntry>();
  private readonly industryMap = new Map<string, CodebookEntry>();
  private readonly verificationBodyMap = new Map<string, CodebookEntry>();
  private readonly zip3Set = new Set<string>();

  constructor(private readonly registry: CitationRegistry = defaultCitationRegistry) {
    this.validateAllAndIndex();
  }

  private validateAllAndIndex(): void {
    this.registry.assertAllCited(this.codebook.table1_regulated_industries, 'codebook.table1');
    this.registry.assertAllCited(this.codebook.table2_verification_bodies, 'codebook.table2');
    this.registry.assertAllCited(this.codebook.table3_competent_authorities, 'codebook.table3');
    this.registry.assertAllCited(this.codebook.table4_industry_codes, 'codebook.table4');
    this.registry.assertAllCited(this.codebook.table5_zip3_codes, 'codebook.table5');
    this.registry.assertAllCited(this.codebook.table6_process_codes, 'codebook.table6');
    this.registry.assertAllCited(this.codebook.table7_equipment_codes, 'codebook.table7');
    this.registry.assertAllCited(this.codebook.table8_material_codes, 'codebook.table8');
    this.registry.assertAllCited(this.codebook.table9_test_methods, 'codebook.table9');
    this.registry.assertAllCited(this.codebook.table10_gwp_values, 'codebook.table10');
    this.registry.assertAllCited(this.codebook.table11_station_purposes, 'codebook.table11');

    this.registry.assertAllCited(this.ef113.stationary_fuels, 'ef113.stationary_fuels');
    this.registry.assertAllCited(this.ef113.mobile_fuels, 'ef113.mobile_fuels');
    this.registry.assertAllCited(this.ef113.wastewater_mcf, 'ef113.wastewater_mcf');
    this.registry.assertAllCited(this.ef113.refrigeration_leak_rates, 'ef113.refrigeration_leak_rates');
    this.registry.assertAllCited(this.ef113.gwp_ar5, 'ef113.gwp_ar5');
    this.registry.assertAllCited(this.ef113.ef_with_ci_svc3, 'ef113.ef_with_ci_svc3');

    this.registry.assertAllCited(this.ncv114.entries, 'ncv114.entries');

    this.registry.assertAllCited(this.svc3.unit_conversions, 'svc3.unit_conversions');
    this.registry.assertAllCited(this.svc3.fossil_fuels, 'svc3.fossil_fuels');

    for (const item of this.codebook.table2_verification_bodies) {
      this.verificationBodyMap.set(item.code, item);
    }
    for (const item of this.codebook.table4_industry_codes) {
      this.industryMap.set(item.code, item);
    }
    for (const item of this.codebook.table5_zip3_codes) {
      this.zip3Set.add(item.zip3);
    }
    for (const item of this.codebook.table6_process_codes) {
      this.processMap.set(item.code, item);
    }
    for (const item of this.codebook.table7_equipment_codes) {
      this.equipmentMap.set(item.code, item);
    }
    for (const item of this.codebook.table8_material_codes) {
      this.materialMap.set(item.code, item);
    }
  }

  hasProcessCode(code: string): boolean {
    return this.processMap.has(code);
  }

  hasEquipmentCode(code: string): boolean {
    return this.equipmentMap.has(code);
  }

  hasMaterialCode(code: string): boolean {
    return this.materialMap.has(code);
  }

  hasIndustryCode(code: string): boolean {
    return this.industryMap.has(code);
  }

  hasVerificationBodyCode(code: string): boolean {
    return this.verificationBodyMap.has(code);
  }

  hasZip3(zip3: string): boolean {
    return this.zip3Set.has(zip3);
  }

  getMaterial(code: string): MaterialEntry | undefined {
    return this.materialMap.get(code);
  }

  getEquipment(code: string): EquipmentEntry | undefined {
    return this.equipmentMap.get(code);
  }

  getProcess(code: string): ProcessEntry | undefined {
    return this.processMap.get(code);
  }

  findEfWithCi(materialCode: string, emissionType: string, gas: string): EfWithCiEntry | undefined {
    return this.ef113.ef_with_ci_svc3.find(
      (item) =>
        item.material_code === materialCode &&
        item.emission_type === emissionType &&
        item.gas.toUpperCase() === gas.toUpperCase()
    );
  }
}

export const defaultMoenvDataStore = new MoenvDataStore();
