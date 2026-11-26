import { CitationRegistry, defaultCitationRegistry } from '../../registry/CitationRegistry.js';
import { MoenvDataStore, defaultMoenvDataStore } from '../../registry/MoenvDataStore.js';
import type { BoundaryManager } from '../boundary/BoundaryManager.js';
import type {
  ActivityRecord,
  ActivityValidationWarning,
  DataSourceTier,
  EmissionSource,
} from './types.js';

export class ExcludedSiteSourceError extends Error {
  constructor(siteId: string, status: string) {
    super(
      `據點 "${siteId}" 納入狀態為 "${status}"（非 included），禁止掛載正式排放源進入總量`
    );
    this.name = 'ExcludedSiteSourceError';
  }
}

export class InvalidOfficialCodeError extends Error {
  constructor(field: string, code: string, tableName: string) {
    super(`官方代碼無效: ${field}="${code}" 不存在於《代碼檔 V2》${tableName}`);
    this.name = 'InvalidOfficialCodeError';
  }
}

const DATA_SOURCE_TIER_RANK: Record<DataSourceTier, number> = {
  cems: 1,
  periodic_measure: 2,
  estimate: 3,
};

export function compareDataSourceTier(a: DataSourceTier, b: DataSourceTier): number {
  return DATA_SOURCE_TIER_RANK[a] - DATA_SOURCE_TIER_RANK[b];
}

export class SourceManager {
  private readonly sources = new Map<string, EmissionSource>();
  private readonly activities = new Map<string, ActivityRecord>();

  constructor(
    private readonly boundary: BoundaryManager,
    private readonly dataStore: MoenvDataStore = defaultMoenvDataStore,
    private readonly registry: CitationRegistry = defaultCitationRegistry
  ) {}

  addSource(source: EmissionSource): void {
    this.registry.assertCited({ citation_id: source.codebook_citation_id }, 'EmissionSource');

    const site = this.boundary.getSite(source.site_id);
    if (!site) {
      throw new Error(`排放源 "${source.source_id}" 所屬據點 "${source.site_id}" 不存在`);
    }
    if (site.inclusion_status !== 'included') {
      throw new ExcludedSiteSourceError(site.site_id, site.inclusion_status);
    }

    if (!this.dataStore.hasProcessCode(source.process_code)) {
      throw new InvalidOfficialCodeError('process_code', source.process_code, '附表六');
    }
    if (!this.dataStore.hasEquipmentCode(source.equipment_code)) {
      throw new InvalidOfficialCodeError('equipment_code', source.equipment_code, '附表七');
    }
    if (!this.dataStore.hasMaterialCode(source.material_code)) {
      throw new InvalidOfficialCodeError('material_code', source.material_code, '附表八');
    }

    if (
      (source.emission_type === 'stationary' ||
        source.emission_type === 'mobile' ||
        (source.emission_type === 'fugitive' && source.equipment_code === '9795')) &&
      !source.ch4_origin
    ) {
      throw new Error(`排放源 "${source.source_id}" (${source.emission_type}) 必須明確指定 ch4_origin`);
    }

    this.sources.set(source.source_id, { ...source });
  }

  addActivity(activity: ActivityRecord): ActivityValidationWarning[] {
    const source = this.sources.get(activity.source_id);
    if (!source) {
      throw new Error(`活動數據 "${activity.activity_id}" 所屬排放源 "${activity.source_id}" 不存在`);
    }
    if (activity.alloc_ratio <= 0 || activity.alloc_ratio > 1) {
      throw new Error(`活動數據 "${activity.activity_id}" alloc_ratio 必須介於 (0, 1]`);
    }
    if (activity.activity_qty < 0) {
      throw new Error(`活動數據 "${activity.activity_id}" activity_qty 不可為負數`);
    }

    this.activities.set(activity.activity_id, {
      ...activity,
      evidence_files: activity.evidence_files.map((e) => ({ ...e })),
    });

    const warnings: ActivityValidationWarning[] = [];
    if (activity.in_use_this_year && activity.evidence_files.length === 0) {
      warnings.push({
        activity_id: activity.activity_id,
        source_id: activity.source_id,
        code: 'MISSING_EVIDENCE',
        message: `缺件警示：活動數據 "${activity.activity_id}" 未附帶佐證檔名或雜湊 (evidence_files)`,
      });
    }
    return warnings;
  }

  getSource(sourceId: string): EmissionSource | undefined {
    return this.sources.get(sourceId);
  }

  getAllSources(): EmissionSource[] {
    return Array.from(this.sources.values());
  }

  getAllActivities(): ActivityRecord[] {
    return Array.from(this.activities.values());
  }

  collectWarnings(): ActivityValidationWarning[] {
    const warnings: ActivityValidationWarning[] = [];
    for (const act of this.activities.values()) {
      if (act.in_use_this_year && act.evidence_files.length === 0) {
        warnings.push({
          activity_id: act.activity_id,
          source_id: act.source_id,
          code: 'MISSING_EVIDENCE',
          message: `缺件警示：活動數據 "${act.activity_id}" 未附帶佐證檔名或雜湊 (evidence_files)`,
        });
      }
    }
    return warnings;
  }
}
