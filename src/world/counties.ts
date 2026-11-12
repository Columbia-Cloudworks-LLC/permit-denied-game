import { campaignLevelById, type CampaignLevelDef } from '../game/campaign';
import { hashSeed } from '../game/rng';
import { COUNTY_ARCHETYPES, REGIONAL_FLAVORS, regionalLandmark, type CountyArchetype } from './regionalCatalog';
import { regionalLevel } from './regionalPlacement';
import { regionById, REGIONS, type RegionDef } from './regions';
import { countyBiome as climateCountyBiome, countyClimate } from './regionClimate';
import { rollWeatherCondition, type SeasonId, type WeatherConditionId } from './season';

export const COUNTIES_PER_REGION = 7;
export const CAPITOL_COUNTY_INDEX = 7;

export interface CountyDef {
  /** Stable key, e.g. `US-IL#3`. */
  id: string;
  regionId: string;
  index: number;
  name: string;
  /** HUD-length name: the capitol drops its landmark suffix. */
  shortName: string;
  /** Button-length name on the region's own map: `Highway County`, or the capitol city. */
  mapName: string;
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

/** The capitol is named for what stands in it: the Governor's Mansion, or the region's statehouse. */
export function countyName(region: RegionDef, archetype: CountyArchetype): string {
  if (archetype.id === 'capitol') return `${region.capitol} Capitol District — ${countyLevel(region, archetype).landmark.label}`;
  return `${region.name} ${COUNTY_NAMES[archetype.id]}`;
}

/** The county's level as it plays: the base level with the region's landmark, when it overrides the civic one. */
export function countyLevel(region: RegionDef, archetype: CountyArchetype): CampaignLevelDef {
  return regionalLevel(campaignLevelById(archetype.levelId), { landmark: regionalLandmark(region, archetype.index) });
}

/** The seven counties of one region; County 7 is always the capitol. */
export function regionCounties(region: RegionDef): CountyDef[] {
  return COUNTY_ARCHETYPES.map(archetype => ({
    id: countyId(region.id, archetype.index),
    regionId: region.id,
    index: archetype.index,
    name: countyName(region, archetype),
    shortName: archetype.id === 'capitol' ? `${region.capitol} Capitol District` : countyName(region, archetype),
    mapName: archetype.id === 'capitol' ? region.capitol : COUNTY_NAMES[archetype.id],
    archetype,
    level: countyLevel(region, archetype),
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
  return rollWeatherCondition(season, (mapSeed ^ countySeed(regionId, index)) >>> 0, countyClimate(regionId, index));
}

/** The county's biome and climate zone: what its ground, sky and buildings are generated for. */
export function countyEnvironment(region: RegionDef, index: number) {
  return {
    biomeId: climateCountyBiome(region.id, index, REGIONAL_FLAVORS[region.flavor].biome),
    climateId: countyClimate(region.id, index).id,
  };
}
