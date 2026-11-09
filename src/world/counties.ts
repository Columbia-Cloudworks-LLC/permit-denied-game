import { campaignLevelById, type CampaignLevelDef } from '../game/campaign';
import { hashSeed } from '../game/rng';
import { COUNTY_ARCHETYPES, REGIONAL_FLAVORS, type CountyArchetype } from './regionalCatalog';
import { regionById, REGIONS, type RegionDef } from './regions';
import { rollWeatherCondition, type SeasonId, type WeatherConditionId } from './season';

export const COUNTIES_PER_REGION = 7;
export const CAPITOL_COUNTY_INDEX = 7;

export interface CountyDef {
  /** Stable key, e.g. `US-IL#3`. */
  id: string;
  regionId: string;
  index: number;
  name: string;
  /** HUD-length name: the capitol drops the Governor's Mansion suffix. */
  shortName: string;
  archetype: CountyArchetype;
  level: CampaignLevelDef;
  /** Layout seed: the same region and index always build the same town. */
  seed: number;
}

export function countyId(regionId: string, index: number): string {
  return `${regionId}#${index}`;
}

export function countySeed(regionId: string, index: number): number {
  return hashSeed(countyId(regionId, index));
}

const COUNTY_NAMES: Readonly<Record<CountyArchetype['id'], string>> = {
  rural: 'Farmstead County',
  roadside: 'Highway County',
  industrial: 'Works County',
  suburban: 'Suburban County',
  'main-street': 'Main Street County',
  downtown: 'Downtown County',
  capitol: 'Capitol District',
};

export function countyName(region: RegionDef, archetype: CountyArchetype): string {
  if (archetype.id === 'capitol') return `${region.capitol} Capitol District — Governor's Mansion`;
  return `${region.name} ${COUNTY_NAMES[archetype.id]}`;
}

/** The seven counties of one region; County 7 is always the capitol. */
export function regionCounties(region: RegionDef): CountyDef[] {
  return COUNTY_ARCHETYPES.map(archetype => ({
    id: countyId(region.id, archetype.index),
    regionId: region.id,
    index: archetype.index,
    name: countyName(region, archetype),
    shortName: archetype.id === 'capitol' ? `${region.capitol} Capitol District` : countyName(region, archetype),
    archetype,
    level: campaignLevelById(archetype.levelId),
    seed: countySeed(region.id, archetype.index),
  }));
}

export function countyAt(regionId: string, index: number): CountyDef | undefined {
  const region = regionById(regionId);
  if (!region || index < 1 || index > COUNTIES_PER_REGION) return undefined;
  return regionCounties(region)[index - 1];
}

export function allCounties(): CountyDef[] {
  return REGIONS.flatMap(regionCounties);
}

/** Map-load weather roll: the map seed changes each time the overworld opens; the season never does. */
export function countyWeather(mapSeed: number, season: SeasonId, regionId: string, index: number): WeatherConditionId {
  return rollWeatherCondition(season, (mapSeed ^ countySeed(regionId, index)) >>> 0);
}

export function regionBiome(region: RegionDef) {
  return REGIONAL_FLAVORS[region.flavor].biome;
}
