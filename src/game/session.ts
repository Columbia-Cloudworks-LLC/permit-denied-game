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
export const LEGACY_SANDBOX_LEVEL: Record<DistrictId, CampaignLevelId> = {
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
  if (params.get("sandbox") === "1" || params.get("mode") === "sandbox") rules.kind = "sandbox";
  if (params.get('mode') === 'challenge' || params.get('sandbox') === '0') rules.kind = 'challenge';
  const district = params.get("district");
  if (district === "classic" || district === "d10" || district === "d30" || district === "d100") {
    rules.district = playableDistrict(rules.kind, district);
    rules.seed = DEFAULT_DISTRICT_SEEDS[rules.district];
    rules.level = LEGACY_SANDBOX_LEVEL[rules.district];
  }
  const level = params.get("level");
  if (
    level === "county" ||
    level === "village" ||
    level === "township" ||
    level === "suburb" ||
    level === "city-borough" ||
    level === "city-downtown" ||
    level === "governors-mansion"
  ) {
    rules.level = level;
  } else if ((params.get("mode") === "sandbox" || params.get("sandbox") === "1") && !rules.level && !params.get("yard") && !params.get("job")) {
    rules.level = "county";
  }
  // Asset diagnostics are explicit and are not offered as a playable map size.
  const rawSeed = params.get("seed");
  const demo = params.get("demo");
  if (params.get('ranch') === '1') rules.testMap = { kind: 'asset', assetId: 'building:ranch', variant: 0 };
  if (params.get('yard') === '1') rules.testMap = { kind: 'yard' };
  if (demo === 'ranch' || demo === 'rivertown' || demo === 'steel-warehouse') rules.testMap = { kind: 'asset', assetId: 'building:' + demo, variant: 0 };
  if (params.get('tower') === '1') rules.testMap = { kind: 'asset', assetId: 'building:union-tower', variant: 0 };
  if (params.has('testAsset')) rules.testMap = { kind: 'asset', assetId: params.get('testAsset')!, variant: Number(params.get('variant') ?? 0) };
  if (rules.testMap) {
    rules.kind = 'sandbox';
    rules.district = 'classic';
    rules.seed = DEFAULT_DISTRICT_SEEDS.classic;
    rules.level = undefined;
  }
  if (rawSeed !== null && rawSeed !== "") {
    const seed = Number(rawSeed);
    if (Number.isFinite(seed) && seed >= 0) rules.seed = seed >>> 0;
  }
  const topology = params.get("topology");
  if (
    topology === "county" ||
    topology === "crossroads" ||
    topology === "tjunction" ||
    topology === "curve-farm" ||
    topology === "loop" ||
    topology === "frontage"
  ) {
    rules.topology = topology;
  }
  const seasonParam = params.get("season");
  if (seasonParam == null || seasonParam === "") {
    rules.season = "summer";
    rules.seasonExplicit = false;
  } else if (seasonParam === "random") {
    rules.seasonSelection = "random";
    rules.season = resolveSeason(rules.seed);
    rules.seasonExplicit = true;
  } else if (isSeasonId(seasonParam)) {
    rules.seasonSelection = seasonParam;
    rules.season = seasonParam;
    rules.seasonExplicit = true;
  } else {
    rules.season = "summer";
    rules.seasonSelection = "summer";
    rules.seasonExplicit = true;
  }
  const biome = biomeById(params.get("biome"));
  if (biome) rules.biomeId = biome.id;
  const effects = params.get("effects");
  if (effects && isWeatherDetail(effects)) rules.weatherDetail = effects;
  if (params.get("job") === "brick") {
    rules.testMap = undefined;
    rules.towerTest = false;
    rules.job = true;
    rules.demo = "rivertown";
    rules.kind = "challenge";
    rules.district = "classic";
    rules.level = undefined;
  }
  return rules;
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
