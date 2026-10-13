import type { CampaignLevelId } from './campaign';
import type { TestMapRequest } from '../world/testMapRequest';
import type { BiomeId } from '../world/biomes';
import { biomeById } from '../world/biomes';
import {
  isSeasonId,
  isWeatherDetail,
  resolveSeason,
  type SeasonId,
  type SeasonSelection,
  type WeatherDetail,
} from '../world/season';
export type SessionKind = "challenge" | "sandbox";

/**
 * Old size links open a named campaign level instead of a parallel map catalog.
 * d10 and classic → County, d30 → Suburb, d100 → City Downtown.
 */
const LEGACY_SANDBOX_LEVEL: Record<DistrictId, CampaignLevelId> = {
  classic: "county",
  d10: "county",
  d30: "suburb",
  d100: "city-downtown",
};

export function playableDistrict(_kind: SessionKind, district: DistrictId): DistrictId {
  return district === 'classic' ? 'd10' : district;
}

export function gameSetupRules(
  kind: SessionKind,
  district: DistrictId,
  currentSeed: number,
  level?: CampaignLevelId,
): SessionRules {
  district = playableDistrict(kind, district);
  return {
    kind,
    district,
    seed: nextSeed(currentSeed),
    ranchFocus: false,
    level: level ?? LEGACY_SANDBOX_LEVEL[district],
    season: "summer",
    seasonExplicit: false,
    weatherDetail: "on",
  };
}
export type DemoAsset = "ranch" | "rivertown" | "steel-warehouse";
export type DistrictId = "classic" | "d10" | "d30" | "d100";
export type SessionTopology = "county" | "crossroads" | "tjunction" | "curve-farm" | "loop" | "frontage";
export type PlayMode = "title" | "play" | "pause" | "upgrade" | "results" | "briefing";

export const DISTRICT_COUNTS: Record<DistrictId, number> = {
  classic: 7,
  d10: 10,
  d30: 30,
  d100: 100,
};

export const DEFAULT_DISTRICT_SEEDS: Record<DistrictId, number> = {
  classic: 0x0ddba11,
  d10: 0x10d15c7,
  d30: 0x30d15c7,
  d100: 0x100d15c,
};

export interface SessionRules {
  testMap?: TestMapRequest;
  towerTest?: boolean;
  job?: boolean;
  demo?: DemoAsset;
  kind: SessionKind;
  district: DistrictId;
  seed: number;
  ranchFocus: boolean;
  topology?: SessionTopology;
  /** Campaign district used by both Sandbox and Time Challenge. Absent on diagnostic maps. */
  level?: CampaignLevelId;
  /** Menu selection. Random rerolls on New Layout. Explicit values stay. */
  seasonSelection?: SeasonSelection;
  /** Resolved season for this run. Missing or invalid links are summer. */
  season: SeasonId;
  /** True when the link named a season, including an invalid value resolved to summer. */
  seasonExplicit: boolean;
  biomeId?: BiomeId;
  weatherDetail: WeatherDetail;
}

function defaultSessionRules(): SessionRules {
  return {
    kind: "sandbox",
    district: "d10",
    seed: DEFAULT_DISTRICT_SEEDS.d10,
    ranchFocus: false,
    season: "summer",
    seasonExplicit: false,
    weatherDetail: "on",
  };
}

export function parseSessionFromSearch(search: string): SessionRules {
  const rules = defaultSessionRules();
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const sandboxLink = params.get("sandbox") === "1" || params.get("mode") === "sandbox";
  if (sandboxLink) rules.kind = "sandbox";
  if (params.get('mode') === 'challenge' || params.get('sandbox') === '0') rules.kind = 'challenge';
  applyDistrictLink(rules, params.get("district"));
  applyLevelLink(rules, params, sandboxLink);
  applyTestMapLink(rules, params);
  applySeedLink(rules, params.get("seed"));
  const topology = params.get("topology");
  if (TOPOLOGIES.has(topology as SessionTopology)) rules.topology = topology as SessionTopology;
  applySeasonLink(rules, params.get("season"));
  applyLookLinks(rules, params);
  if (params.get("job") === "brick") applyBrickJob(rules);
  return rules;
}

/** A named level wins; a plain sandbox link opens County unless it is a yard or job link. */
function applyLevelLink(rules: SessionRules, params: URLSearchParams, sandboxLink: boolean): void {
  const level = params.get("level");
  if (CAMPAIGN_LEVEL_IDS.has(level as CampaignLevelId)) rules.level = level as CampaignLevelId;
  else if (sandboxLink && !rules.level && !params.get("yard") && !params.get("job")) rules.level = "county";
}

/** A non-negative seed, kept to 32 bits; anything else keeps the default. */
function applySeedLink(rules: SessionRules, rawSeed: string | null): void {
  if (rawSeed === null || rawSeed === "") return;
  const seed = Number(rawSeed);
  if (Number.isFinite(seed) && seed >= 0) rules.seed = seed >>> 0;
}

function applyLookLinks(rules: SessionRules, params: URLSearchParams): void {
  const biome = biomeById(params.get("biome"));
  if (biome) rules.biomeId = biome.id;
  const effects = params.get("effects");
  if (effects && isWeatherDetail(effects)) rules.weatherDetail = effects;
}

const DISTRICT_IDS = new Set<DistrictId>(["classic", "d10", "d30", "d100"]);
const CAMPAIGN_LEVEL_IDS = new Set<CampaignLevelId>(["county", "village", "township", "suburb", "city-borough", "city-downtown", "governors-mansion"]);
const TOPOLOGIES = new Set<SessionTopology>(["county", "crossroads", "tjunction", "curve-farm", "loop", "frontage"]);
const DEMO_ASSETS = new Set<DemoAsset>(["ranch", "rivertown", "steel-warehouse"]);

/** An old map-size link opens its matching campaign level on that district's seed. */
function applyDistrictLink(rules: SessionRules, district: string | null): void {
  if (!DISTRICT_IDS.has(district as DistrictId)) return;
  rules.district = playableDistrict(rules.kind, district as DistrictId);
  rules.seed = DEFAULT_DISTRICT_SEEDS[rules.district];
  rules.level = LEGACY_SANDBOX_LEVEL[rules.district];
}

/** Asset diagnostics are explicit and are not offered as a playable map size; the last link given wins. */
function applyTestMapLink(rules: SessionRules, params: URLSearchParams): void {
  const demo = params.get("demo");
  if (params.get('ranch') === '1') rules.testMap = { kind: 'asset', assetId: 'building:ranch', variant: 0 };
  if (params.get('yard') === '1') rules.testMap = { kind: 'yard' };
  if (DEMO_ASSETS.has(demo as DemoAsset)) rules.testMap = { kind: 'asset', assetId: 'building:' + demo, variant: 0 };
  if (params.get('tower') === '1') rules.testMap = { kind: 'asset', assetId: 'building:union-tower', variant: 0 };
  if (params.has('testAsset')) rules.testMap = { kind: 'asset', assetId: params.get('testAsset')!, variant: Number(params.get('variant') ?? 0) };
  if (!rules.testMap) return;
  rules.kind = 'sandbox';
  rules.district = 'classic';
  rules.seed = DEFAULT_DISTRICT_SEEDS.classic;
  rules.level = undefined;
}

/** No season means summer; `random` resolves from the seed; an unknown name is an explicit summer. */
function applySeasonLink(rules: SessionRules, seasonParam: string | null): void {
  if (seasonParam == null || seasonParam === "") {
    rules.season = "summer";
    rules.seasonExplicit = false;
    return;
  }
  rules.seasonExplicit = true;
  if (seasonParam === "random") {
    rules.seasonSelection = "random";
    rules.season = resolveSeason(rules.seed);
  } else if (isSeasonId(seasonParam)) {
    rules.seasonSelection = seasonParam;
    rules.season = seasonParam;
  } else {
    rules.season = "summer";
    rules.seasonSelection = "summer";
  }
}

/** The brick demolition job is its own challenge on the classic rivertown map. */
function applyBrickJob(rules: SessionRules): void {
  rules.testMap = undefined;
  rules.towerTest = false;
  rules.job = true;
  rules.demo = "rivertown";
  rules.kind = "challenge";
  rules.district = "classic";
  rules.level = undefined;
}

export function nextSeed(seed: number): number {
  return (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
}

export function sessionFailsOn(rules: SessionRules): { heat: boolean; track: boolean; clock: boolean } {
  if (rules.kind === "sandbox" || rules.job) return { heat: false, track: false, clock: false };
  return { heat: true, track: true, clock: true };
}

export function sessionForcesUpgrade(rules: SessionRules): boolean {
  return rules.kind === "challenge" && !rules.job;
}

export function canPickUpgrade(rules: SessionRules, mode: PlayMode, earned: boolean): boolean {
  return rules.kind === "sandbox" || (mode === "upgrade" && earned);
}


/** Explicit scenario links retain their immediate-play behavior. */
export function startsAtTitle(search: string): boolean {
  const params = new URLSearchParams(search);
  return !['testAsset', 'yard', 'sandbox', 'mode', 'district', 'level', 'seed', 'ranch', 'demo', 'tower', 'job', 'perf', 'nhood'].some(key => params.has(key));
}
