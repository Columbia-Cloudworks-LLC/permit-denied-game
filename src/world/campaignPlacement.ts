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

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isBoolean = (value: unknown): boolean => typeof value === 'boolean';
/** Optional placement fields in authoring order, each with its validity rule and complaint. */
const OPTIONAL_PLACEMENT_FIELDS: readonly { key: Exclude<keyof CampaignPlacement, 'levels'>; valid: (value: unknown) => boolean; message: string }[] = [
  { key: 'maxRepeats', valid: value => Number.isInteger(value) && (value as number) >= 1, message: 'campaign.maxRepeats must be an integer >= 1' },
  { key: 'landmarkOnly', valid: isBoolean, message: 'campaign.landmarkOnly must be boolean' },
  { key: 'zones', valid: value => Array.isArray(value) && value.every(zone => typeof zone === 'string'), message: 'campaign.zones must be an array of zone names' },
  { key: 'family', valid: value => typeof value === 'string' && !!value.trim(), message: 'campaign.family must be a non-empty string' },
  { key: 'exception', valid: isBoolean, message: 'campaign.exception must be boolean' },
  { key: 'urbanBands', valid: value => Array.isArray(value) && value.length >= 1 && value.every(band => typeof band === 'string' && isUrbanBand(band)), message: 'campaign.urbanBands must list known urban bands' },
  { key: 'streetRole', valid: value => typeof value === 'string' && isStreetRole(value), message: 'campaign.streetRole must be standard, corner, or run' },
];

export function parseCampaignPlacement(input: unknown, context: string): CampaignPlacement {
  if (!isRecord(input)) throw new Error(`${context}: campaign placement must be an object`);
  for (const key of Object.keys(input)) {
    if (!placementShapeKeys.has(key)) throw new Error(`${context}: unknown field campaign.${key}`);
  }
  const placement: CampaignPlacement = { levels: parseCampaignLevels(input.levels, context) };
  for (const { key, valid, message } of OPTIONAL_PLACEMENT_FIELDS) {
    if (input[key] === undefined) continue;
    if (!valid(input[key])) throw new Error(`${context}: ${message}`);
    (placement as unknown as Record<string, unknown>)[key] = input[key];
  }
  return placement;
}

function parseCampaignLevels(input: unknown, context: string): Partial<Record<CampaignLevelId, number>> {
  if (!input || !isRecord(input)) throw new Error(`${context}: campaign.levels must list allowed level IDs`);
  const levels: Partial<Record<CampaignLevelId, number>> = {};
  for (const [id, weight] of Object.entries(input)) {
    if (!isCampaignLevelId(id)) throw new Error(`${context}: invalid campaign level id ${id}`);
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      throw new Error(`${context}: campaign weight for ${id} must be a finite number >= 0`);
    }
    levels[id] = weight;
  }
  if (!Object.keys(levels).length) throw new Error(`${context}: campaign.levels must include at least one level`);
  return levels;
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
    siteBuildingIssues(site, buildings, id, context, issues);
    siteEquipmentIssues(site, assets, id, context, issues);
  }
  return issues;
}

function siteBuildingIssues(
  site: BuildingSite & { campaign?: CampaignPlacement },
  buildings: readonly (Archetype & { campaign?: CampaignPlacement })[],
  id: CampaignLevelId,
  context: string,
  issues: CampaignPlacementIssue[],
): void {
  for (const member of site.buildings) {
    const def = buildings.find(building => building.id === member.building);
    if (!def) {
      issues.push({ code: 'missing-building', detail: `${context}: unknown building ${member.building}` });
      continue;
    }
    if (site.campaign?.landmarkOnly) continue;
    if (!campaignEligible(def.campaign, id, { landmark: !!def.campaign?.landmarkOnly })) {
      issues.push({
        code: 'site-member',
        detail: `${context}: ${member.building} is not eligible for ${id}`,
      });
    }
  }
}

function siteEquipmentIssues(
  site: BuildingSite,
  assets: readonly (AssetDef & { campaign?: CampaignPlacement })[],
  id: CampaignLevelId,
  context: string,
  issues: CampaignPlacementIssue[],
): void {
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
