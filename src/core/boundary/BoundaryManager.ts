import { CitationRegistry, defaultCitationRegistry } from '../../registry/CitationRegistry.js';
import { MoenvDataStore, defaultMoenvDataStore } from '../../registry/MoenvDataStore.js';
import type {
  BoundaryExclusion,
  BoundaryVersion,
  Site,
  UtilityAccount,
} from './types.js';

export class BoundaryLockedError extends Error {
  constructor(versionId: string) {
    super(`邊界版本 "${versionId}" 已鎖定 (locked=true)，禁止直接覆寫，請建立新版本`);
    this.name = 'BoundaryLockedError';
  }
}

export class BoundaryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoundaryValidationError';
  }
}

export class DuplicateMeterAllocationError extends Error {
  constructor(meterNo: string, totalRatio: number) {
    super(
      `電號 "${meterNo}" 於重疊期間共用比例合計達 ${(totalRatio * 100).toFixed(2)}%，超過 100% 上限`
    );
    this.name = 'DuplicateMeterAllocationError';
  }
}

function periodsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * 邊界管理器（BoundaryManager）
 */
export class BoundaryManager {
  private version: BoundaryVersion;
  private readonly sites = new Map<string, Site>();
  private readonly exclusions: BoundaryExclusion[] = [];
  private readonly utilityAccounts = new Map<string, UtilityAccount>();

  constructor(
    version: BoundaryVersion,
    private readonly dataStore: MoenvDataStore = defaultMoenvDataStore,
    private readonly registry: CitationRegistry = defaultCitationRegistry
  ) {
    this.validateVersion(version);
    this.version = { ...version, citation_ids: [...version.citation_ids] };
  }

  private assertUnlocked(): void {
    if (this.version.locked) {
      throw new BoundaryLockedError(this.version.boundary_version_id);
    }
  }

  private validateVersion(v: BoundaryVersion): void {
    if (!v.citation_ids || v.citation_ids.length === 0) {
      throw new BoundaryValidationError('BoundaryVersion 必須綁定至少一筆權威 citation_id');
    }
    for (const cid of v.citation_ids) {
      this.registry.assertCited({ citation_id: cid }, 'BoundaryVersion');
    }
    if (!this.dataStore.hasIndustryCode(v.industry_code)) {
      throw new BoundaryValidationError(
        `行業代碼 "${v.industry_code}" 不存在於《代碼檔 V2》附表四`
      );
    }
  }

  getVersion(): BoundaryVersion {
    return { ...this.version };
  }

  lockVersion(lockedAtIso = new Date().toISOString()): BoundaryVersion {
    this.assertUnlocked();
    this.version = {
      ...this.version,
      locked: true,
      locked_at: lockedAtIso,
    };
    return this.getVersion();
  }

  addSite(site: Site): void {
    this.assertUnlocked();
    if (!/^D\d{5}$/.test(site.site_id)) {
      throw new BoundaryValidationError(
        `據點主鍵 site_id "${site.site_id}" 不符合穩定主鍵格式 (例: D00001)`
      );
    }
    if (!this.dataStore.hasZip3(site.zip3)) {
      throw new BoundaryValidationError(
        `郵遞區號 "${site.zip3}" 不存在於《代碼檔 V2》附表五`
      );
    }
    if (!site.operating_periods || site.operating_periods.length === 0) {
      throw new BoundaryValidationError(`據點 "${site.site_id}" 必須至少包含一段營運起訖日`);
    }
    for (const p of site.operating_periods) {
      if (p.start_date > p.end_date) {
        throw new BoundaryValidationError(
          `據點 "${site.site_id}" 營運起訖日無效: ${p.start_date} > ${p.end_date}`
        );
      }
    }
    this.sites.set(site.site_id, {
      ...site,
      operating_periods: site.operating_periods.map((p) => ({ ...p })),
    });
  }

  getSite(siteId: string): Site | undefined {
    return this.sites.get(siteId);
  }

  getAllSites(): Site[] {
    return Array.from(this.sites.values());
  }

  getIncludedSites(): Site[] {
    return this.getAllSites().filter((s) => s.inclusion_status === 'included');
  }

  addExclusion(exclusion: BoundaryExclusion): void {
    this.assertUnlocked();
    this.registry.assertCited(exclusion, 'BoundaryExclusion');
    const site = this.sites.get(exclusion.site_id);
    if (!site) {
      throw new BoundaryValidationError(`排除對象所屬據點 "${exclusion.site_id}" 不存在`);
    }
    if (!exclusion.evidence_ref || exclusion.evidence_ref.trim() === '') {
      throw new BoundaryValidationError(
        `同址排除對象 "${exclusion.excluded_entity_name}" 缺少獨立登記及列管證明佐證 (evidence_ref)`
      );
    }
    this.exclusions.push({ ...exclusion });
  }

  getExclusions(): BoundaryExclusion[] {
    return [...this.exclusions];
  }

  addUtilityAccount(account: UtilityAccount): void {
    this.assertUnlocked();
    if (!this.sites.has(account.site_id)) {
      throw new BoundaryValidationError(`電號所屬據點 "${account.site_id}" 不存在`);
    }
    if (account.share_ratio <= 0 || account.share_ratio > 1) {
      throw new BoundaryValidationError(
        `電號 "${account.utility_id}" 分攤比例 share_ratio 必須介於 (0, 1]，目前為 ${account.share_ratio}`
      );
    }
    if (account.meter_available && (!account.meter_no || account.meter_no.trim() === '')) {
      throw new BoundaryValidationError(`電號 "${account.utility_id}" 標記有電表但未填 meter_no`);
    }
    if (
      !account.meter_available &&
      (!account.unavailable_reason || account.unavailable_reason.trim() === '')
    ) {
      throw new BoundaryValidationError(
        `電號 "${account.utility_id}" 標記無電表但未填 unavailable_reason`
      );
    }
    if (account.period_start > account.period_end) {
      throw new BoundaryValidationError(
        `電號 "${account.utility_id}" 期間無效: ${account.period_start} > ${account.period_end}`
      );
    }

    // 檢核同一電號於重疊期間共用比例合計不得大於 100% (1.0)
    if (account.meter_available && account.meter_no) {
      let overlappingRatio = account.share_ratio;
      for (const existing of this.utilityAccounts.values()) {
        if (
          existing.utility_id !== account.utility_id &&
          existing.meter_available &&
          existing.meter_no === account.meter_no &&
          periodsOverlap(
            existing.period_start,
            existing.period_end,
            account.period_start,
            account.period_end
          )
        ) {
          overlappingRatio += existing.share_ratio;
        }
      }
      // 允許極小浮點誤差 1e-9
      if (overlappingRatio > 1 + 1e-9) {
        throw new DuplicateMeterAllocationError(account.meter_no, overlappingRatio);
      }
    }

    this.utilityAccounts.set(account.utility_id, { ...account });
  }

  getUtilityAccounts(): UtilityAccount[] {
    return Array.from(this.utilityAccounts.values());
  }
}
