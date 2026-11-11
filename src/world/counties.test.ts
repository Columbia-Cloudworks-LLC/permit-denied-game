import { describe, expect, it } from 'vitest';
import { CAMPAIGN_LEVELS } from '../game/campaign';
import { allCounties, countyAt, countySeed, countyWeather, regionCounties } from './counties';
import { COUNTY_ARCHETYPES } from './regionalCatalog';
import { REGIONS, regionById } from './regions';
import {
  SEASONS,
  WEATHER_CONDITIONS,
  rollWeatherCondition,
  weatherConditionLabel,
  weatherPresetFor,
} from './season';

describe('seven counties per region', () => {
  it('builds 441 counties: Counties 1–6 on the six core archetypes, County 7 the capitol', () => {
    expect(allCounties()).toHaveLength(441);
    expect(COUNTY_ARCHETYPES.map(archetype => archetype.label)).toEqual([
      'Rural / Agricultural', 'Roadside / Highway', 'Industrial / Works', 'Suburban', 'Main Street / Town',
      'Downtown / Commercial', "Capitol / Governor's Mansion",
    ]);
    for (const region of REGIONS) {
      const counties = regionCounties(region);
      expect(counties.map(county => county.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(counties.map(county => county.level.id)).toEqual(CAMPAIGN_LEVELS.map(level => level.id));
      expect(counties[6]!.level.id).toBe('governors-mansion');
      // The capitol is named for its landmark: the mansion, or the region's statehouse.
      expect(counties[6]!.name).toBe(`${region.capitol} Capitol District — ${counties[6]!.level.landmark.label}`);
    }
    expect(countyAt('US-MA', 7)!.name).toBe('Boston Capitol District — Granite Statehouse');
    expect(countyAt('CA-QC', 7)!.name).toBe('Quebec City Capitol District — Granite Legislature');
    expect(countyAt('US-IL', 7)!.name).toBe("Springfield Capitol District — Governor's Mansion");
    expect(countyAt('US-TX', 7)!.name).toBe("Austin Capitol District — Governor's Mansion");
    expect(countyAt('US-IL', 0)).toBeUndefined();
    expect(countyAt('US-IL', 8)).toBeUndefined();
  });

  it('seeds each county from its region and index, the same every time and distinct across the map', () => {
    expect(countySeed('US-IL', 3)).toBe(countySeed('US-IL', 3));
    expect(countyAt('US-IL', 3)!.seed).toBe(countySeed('US-IL', 3));
    expect(new Set(allCounties().map(county => county.seed)).size).toBe(441);
  });
});

describe('season-locked, county-level weather', () => {
  it('rolls only conditions that exist, and the roll for a map load is stable', () => {
    for (const season of SEASONS) {
      const seen = new Set<string>();
      for (let seed = 0; seed < 400; seed++) seen.add(rollWeatherCondition(season, seed));
      for (const id of seen) expect(WEATHER_CONDITIONS).toContain(id);
      expect(seen.size).toBeGreaterThanOrEqual(4);
    }
    expect(countyWeather(99, 'winter', 'CA-QC', 2)).toBe(countyWeather(99, 'winter', 'CA-QC', 2));
  });

  it('varies weather between counties on one map load, and rerolls on the next load', () => {
    const region = regionById('US-OH')!;
    const one = regionCounties(region).map(county => countyWeather(1, 'spring', region.id, county.index));
    expect(new Set(one).size).toBeGreaterThan(1);
    const loads = new Set<string>();
    for (let mapSeed = 0; mapSeed < 20; mapSeed++) loads.add(regionCounties(region).map(c => countyWeather(mapSeed, 'spring', region.id, c.index)).join());
    expect(loads.size).toBeGreaterThan(1);
  });

  it('resolves every condition against the locked season: snow in winter, rain otherwise', () => {
    for (const season of SEASONS) {
      for (const condition of WEATHER_CONDITIONS) {
        const preset = weatherPresetFor(season, condition);
        expect(preset).toMatchObject({ season, condition, gameplay: 'none' });
        if (condition === 'precip' || condition === 'storm') expect(preset.kind).toBe(season === 'winter' ? 'flurries' : 'rain');
        if (condition === 'fog' || condition === 'overcast') expect(preset.kind).toBe('clear');
      }
    }
    expect(weatherPresetFor('summer', 'storm').intensity).toBeGreaterThan(weatherPresetFor('summer', 'precip').intensity);
    expect(weatherPresetFor('autumn', 'clear').kind).toBe('leaves');
    expect(weatherConditionLabel('winter', 'precip')).toBe('Snow');
    expect(weatherConditionLabel('summer', 'precip')).toBe('Rain');
    expect(weatherConditionLabel('winter', 'storm')).toBe('Blizzard');
  });
});
