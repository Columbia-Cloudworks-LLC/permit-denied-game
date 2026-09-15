import { CAMPAIGN_LEVEL_IDS, isCampaignLevelId, type CampaignLevelId } from '../game/campaign';
import type { LotZone } from '../structure/types';
import type { Archetype } from './archetypes';
import type { BuildingSite } from './buildingSites';
import type { AssetDef, LotCompat } from './catalog';
import { isStreetRole, isUrbanBand, type StreetRole, type UrbanBand } from './urbanBands';

export interface CampaignPlacement {
  levels: Partial<Record<CampaignLevelId, number>>;
  maxRepeats?: number;
  landmarkOnly?: boolean;
  zones?: readonly LotCompat[];
  family?: string;
  exception?: boolean;
  urbanBands?: readonly UrbanBand[];
  streetRole?: StreetRole;
}

export interface CampaignPlacementIssue {
  code: string;
  detail: string;
}

const placementShapeKeys = new Set([
  'levels', 'maxRepeats', 'landmarkOnly', 'zones', 'family', 'exception', 'urbanBands', 'streetRole',
]);

export function parseCampaignPlacement(input: unknown, context: string): CampaignPlacement {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${context}: campaign placement must be an object`);
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!placementShapeKeys.has(key)) throw new Error(`${context}: unknown field campaign.${key}`);
  }
  if (!record.levels || typeof record.levels !== 'object' || Array.isArray(record.levels)) {
    throw new Error(`${context}: campaign.levels must list allowed level IDs`);
  }
  const levels: Partial<Record<CampaignLevelId, number>> = {};
  for (const [id, weight] of Object.entries(record.levels as Record<string, unknown>)) {
    if (!isCampaignLevelId(id)) throw new Error(`${context}: invalid campaign level id ${id}`);
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      throw new Error(`${context}: campaign weight for ${id} must be a finite number >= 0`);
    }
    levels[id] = weight;
  }
  if (!Object.keys(levels).length) throw new Error(`${context}: campaign.levels must include at least one level`);
  const placement: CampaignPlacement = { levels };
  if (record.maxRepeats !== undefined) {
    if (!Number.isInteger(record.maxRepeats) || (record.maxRepeats as number) < 1) {
      throw new Error(`${context}: campaign.maxRepeats must be an integer >= 1`);
    }
    placement.maxRepeats = record.maxRepeats as number;
  }
  if (record.landmarkOnly !== undefined) {
    if (typeof record.landmarkOnly !== 'boolean') throw new Error(`${context}: campaign.landmarkOnly must be boolean`);
    placement.landmarkOnly = record.landmarkOnly;
  }
  if (record.zones !== undefined) {
    if (!Array.isArray(record.zones) || record.zones.some(zone => typeof zone !== 'string')) {
      throw new Error(`${context}: campaign.zones must be an array of zone names`);
    }
    placement.zones = record.zones as LotCompat[];
  }
  if (record.family !== undefined) {
    if (typeof record.family !== 'string' || !record.family.trim()) {
      throw new Error(`${context}: campaign.family must be a non-empty string`);
    }
    placement.family = record.family;
  }
  if (record.exception !== undefined) {
    if (typeof record.exception !== 'boolean') throw new Error(`${context}: campaign.exception must be boolean`);
    placement.exception = record.exception;
  }
  if (record.urbanBands !== undefined) {
    if (!Array.isArray(record.urbanBands) || record.urbanBands.length < 1 || record.urbanBands.some(band => typeof band !== 'string' || !isUrbanBand(band))) {
      throw new Error(`${context}: campaign.urbanBands must list known urban bands`);
    }
    placement.urbanBands = record.urbanBands as UrbanBand[];
  }
  if (record.streetRole !== undefined) {
    if (typeof record.streetRole !== 'string' || !isStreetRole(record.streetRole)) {
      throw new Error(`${context}: campaign.streetRole must be standard, corner, or run`);
    }
    placement.streetRole = record.streetRole;
  }
  return placement;
}

export function campaignWeight(placement: CampaignPlacement | undefined, level: CampaignLevelId): number {
  if (!placement) return 0;
  return placement.levels[level] ?? 0;
}

export function campaignEligible(
  placement: CampaignPlacement | undefined,
  level: CampaignLevelId,
  options: { zone?: LotZone; used?: number; landmark?: boolean; urbanBand?: UrbanBand } = {},
): boolean {
  if (!placement) return false;
  const weight = campaignWeight(placement, level);
  if (!(weight > 0)) return false;
  if (placement.landmarkOnly && !options.landmark) return false;
  if (!placement.landmarkOnly && options.landmark) return false;
  if (options.used !== undefined && placement.maxRepeats !== undefined && options.used >= placement.maxRepeats) return false;
  if (options.zone && placement.zones && !placement.zones.includes(options.zone)) return false;
  if (options.urbanBand && placement.urbanBands && !placement.urbanBands.includes(options.urbanBand)) return false;
  return true;
}

export function validateSiteCampaignRules(
  site: BuildingSite & { campaign?: CampaignPlacement },
  buildings: readonly (Archetype & { campaign?: CampaignPlacement })[],
  assets: readonly (AssetDef & { campaign?: CampaignPlacement })[],
  context = `site ${site.id}`,
): CampaignPlacementIssue[] {
  const issues: CampaignPlacementIssue[] = [];
  if (!site.campaign) return issues;
  for (const id of CAMPAIGN_LEVEL_IDS) {
    if (!(campaignWeight(site.campaign, id) > 0)) continue;
    for (const member of site.buildings) {
      const def = buildings.find(building => building.id === member.building);
      if (!def) {
        issues.push({ code: 'missing-building', detail: `${context}: unknown building ${member.building}` });
        continue;
      }
      if (site.campaign.landmarkOnly) continue;
      if (!campaignEligible(def.campaign, id, { landmark: !!def.campaign?.landmarkOnly })) {
        issues.push({
          code: 'site-member',
          detail: `${context}: ${member.building} is not eligible for ${id}`,
        });
      }
    }
    for (const member of site.equipment) {
      const def = assets.find(asset => asset.id === member.asset);
      if (!def) {
        issues.push({ code: 'missing-asset', detail: `${context}: unknown equipment ${member.asset}` });
        continue;
      }
      if (!campaignEligible(def.campaign, id)) {
        issues.push({
          code: 'site-member',
          detail: `${context}: ${member.asset} is not eligible for ${id}`,
        });
      }
    }
  }
  return issues;
}

export function pickWeighted<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  range: (min: number, max: number) => number,
): T | undefined {
  const pool = items.filter(item => weightOf(item) > 0);
  if (!pool.length) return undefined;
  let pick = range(0, pool.reduce((sum, item) => sum + weightOf(item), 0));
  for (const item of pool) {
    pick -= weightOf(item);
    if (pick <= 0) return item;
  }
  return pool[pool.length - 1];
}
