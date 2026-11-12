import { describe, expect, it } from "vitest";
import { BIOME_IDS } from "./biomes";
import {
  aridLandscape, classifyClimate, climateById, climateForBiome, climateHazard, CLIMATE_IDS, CLIMATES, deriveClimate,
  geographyAllowsFreeze, geographyAllowsSnow, legalConditions, lookSeason, snowOnGround, waterFrozen, winterMeanC,
} from "./climate";
import { countyBiome, countyClimate, countyGeography } from "./regionClimate";
import { REGIONS } from "./regions";
import { resolveWeather, rollWeatherCondition, SEASONS, weatherConditionLabel, weatherPresetFor } from "./season";
import { townSeasonState } from "./groundCondition";

const WARM: readonly [string, number][] = [
  ["US-AZ", 2], ["US-AZ", 4], ["US-AZ", 7], ["US-CA", 2], ["US-CA", 3], ["US-CA", 6], ["US-NV", 2], ["US-NV", 6],
  ["US-TX", 1], ["US-TX", 2], ["US-TX", 3], ["US-FL", 1], ["US-FL", 7], ["US-LA", 4], ["US-MS", 2], ["US-AL", 2], ["US-HI", 5], ["US-NM", 2],
];
const COLD: readonly [string, number][] = [
  ["US-IL", 3], ["US-MN", 1], ["US-NY", 5], ["US-MA", 6], ["US-ND", 1], ["US-CO", 2], ["US-WY", 4], ["US-MT", 2], ["US-UT", 4],
  ["US-AZ", 1], ["US-CA", 1], ["US-NM", 7], ["US-NV", 7], ["CA-ON", 3], ["CA-QC", 7], ["CA-AB", 1], ["CA-YT", 2], ["US-AK", 4], ["US-ME", 1],
];

describe("climate envelopes", () => {
  it("derives snow and freeze from geography, never from a place name", () => {
    for (const id of CLIMATE_IDS) {
      const zone = CLIMATES[id];
      expect(zone.allowsSnow, id).toBe(geographyAllowsSnow(zone.geography));
      expect(zone.allowsFreeze, id).toBe(geographyAllowsFreeze(zone.geography));
      // A zone's own representative geography classifies back into the zone.
      expect(classifyClimate(zone.geography), id).toBe(id);
      // Anything that snows also freezes.
      if (zone.allowsSnow) expect(zone.allowsFreeze, id).toBe(true);
    }
    // Colder with latitude and height, warmer on the coast.
    const base = { latitude: 36, elevation: 300, aridity: 0.3, maritime: 0.2, bedrock: "limestone" as const };
    expect(winterMeanC({ ...base, latitude: 46 })).toBeLessThan(winterMeanC(base));
    expect(winterMeanC({ ...base, elevation: 2300 })).toBeLessThan(winterMeanC(base));
    expect(winterMeanC({ ...base, maritime: 0.9 })).toBeGreaterThan(winterMeanC(base));
  });

  it("keeps warm-arid and subtropical counties free of snow and ice", () => {
    for (const [regionId, index] of WARM) {
      const climate = countyClimate(regionId, index);
      expect(climate.allowsSnow, `${regionId}#${index} ${climate.id}`).toBe(false);
      expect(climate.allowsFreeze, `${regionId}#${index} ${climate.id}`).toBe(false);
      expect(snowOnGround("winter", climate)).toBe(false);
      expect(waterFrozen("winter", climate)).toBe(false);
      expect(townSeasonState("winter", climate).groundCondition).toBe("clear");
      expect(lookSeason("winter", climate)).not.toBe("winter");
    }
  });

  it("keeps the full winter in cold, temperate and high country", () => {
    for (const [regionId, index] of COLD) {
      const climate = countyClimate(regionId, index);
      expect(climate.allowsSnow, `${regionId}#${index} ${climate.id}`).toBe(true);
      expect(climate.allowsFreeze, `${regionId}#${index} ${climate.id}`).toBe(true);
      expect(townSeasonState("winter", climate).groundCondition).toBe("snow");
      expect(lookSeason("winter", climate)).toBe("winter");
      expect(townSeasonState("summer", climate).groundCondition).toBe("clear");
    }
  });

  it("gives every county of every region a zone and a biome that suits it", () => {
    for (const region of REGIONS) for (let index = 1; index <= 7; index++) {
      const climate = countyClimate(region.id, index);
      expect(climate).toBe(deriveClimate(countyGeography(region.id, index)));
      const biome = countyBiome(region.id, index, "temperate-broadleaf");
      expect(BIOME_IDS).toContain(biome);
      if (aridLandscape(climate)) expect(biome, `${region.id}#${index}`).toBe("arid-scrub");
    }
    // One state, several countries: low desert, plateau, coast, mountain.
    expect(countyClimate("US-AZ", 2).id).toBe("sonoran-desert");
    expect(countyClimate("US-AZ", 1).id).toBe("canyonlands");
    expect(countyClimate("US-CA", 2).id).toBe("mojave-desert");
    expect(countyClimate("US-CA", 3).id).toBe("mediterranean-coast");
    expect(countyClimate("US-CA", 1).id).toBe("alpine");
    expect(countyClimate("US-TX", 2).id).toBe("chihuahuan-desert");
    expect(countyClimate("US-TX", 3).id).toBe("gulf-subtropical");
    expect(countyClimate("US-HI", 1).id).toBe("tropical");
  });

  it("never rolls or paints snow in a snowless winter, and backfills arid and coastal hazards", () => {
    for (const id of CLIMATE_IDS) {
      const climate = CLIMATES[id];
      for (const season of SEASONS) {
        const legal = legalConditions(climate, season);
        expect(legal.length, `${id} ${season}`).toBeGreaterThan(1);
        for (let n = 1; n <= 240; n++) {
          const seed = Math.imul(n, 0x9e3779b1) >>> 0;
          const condition = rollWeatherCondition(season, seed, climate);
          expect(legal, `${id} ${season}`).toContain(condition);
          const preset = weatherPresetFor(season, condition, climate);
          const legacy = resolveWeather(season, seed, climate);
          if (!snowOnGround(season, climate)) {
            expect(preset.kind, `${id} ${season} ${condition}`).not.toBe("flurries");
            expect(legacy.kind, `${id} ${season}`).not.toBe("flurries");
            expect(weatherConditionLabel(season, condition, climate)).not.toMatch(/snow|blizzard|ice|frost/i);
          }
        }
      }
    }
    const sonoran = CLIMATES["sonoran-desert"], gulf = CLIMATES["gulf-subtropical"], temperate = CLIMATES.temperate;
    expect(legalConditions(sonoran, "summer")).toEqual(expect.arrayContaining(["dust", "heat", "storm"]));
    expect(climateHazard(sonoran, "summer", "dust")).toBe("haboob");
    expect(climateHazard(sonoran, "summer", "storm")).toBe("monsoon");
    expect(climateHazard(sonoran, "summer", "heat")).toBe("heat");
    expect(climateHazard(gulf, "summer", "storm")).toBe("squall");
    expect(climateHazard(temperate, "winter", "storm")).toBe("blizzard");
    expect(climateHazard(sonoran, "winter", "storm")).toBeUndefined();
    expect(weatherPresetFor("summer", "dust", sonoran)).toMatchObject({ kind: "dust", hazard: "haboob" });
    expect(weatherPresetFor("summer", "storm", sonoran)).toMatchObject({ kind: "downpour", hazard: "monsoon" });
    expect(weatherPresetFor("summer", "heat", sonoran)).toMatchObject({ kind: "shimmer", hazard: "heat" });
    expect(weatherConditionLabel("winter", "precip", sonoran)).toBe("Rain");
    expect(weatherConditionLabel("winter", "precip", temperate)).toBe("Snow");
    // Temperate and northern zones never roll desert hazards.
    for (const id of ["temperate", "boreal", "alpine", "pacific-maritime"] as const) for (const season of SEASONS) {
      expect(legalConditions(CLIMATES[id], season)).not.toContain("dust");
      expect(legalConditions(CLIMATES[id], season)).not.toContain("heat");
    }
  });

  it("keeps legacy maps on their biome's home climate", () => {
    expect(climateForBiome("northern-conifer").allowsSnow).toBe(true);
    expect(climateForBiome("temperate-broadleaf").id).toBe("temperate");
    expect(climateForBiome("arid-scrub").allowsSnow).toBe(false);
    expect(climateForBiome("subtropical-coast").allowsFreeze).toBe(false);
    expect(climateById("mojave-desert")).toBe(CLIMATES["mojave-desert"]);
    expect(climateById("nowhere")).toBeUndefined();
    // The temperate table is the original odds, so legacy county rolls are unchanged.
    expect(rollWeatherCondition("winter", 12345)).toBe(rollWeatherCondition("winter", 12345, CLIMATES.temperate));
  });
});
