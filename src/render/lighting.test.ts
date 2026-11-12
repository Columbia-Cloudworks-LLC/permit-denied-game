import { afterEach, describe, expect, it } from "vitest";
import { CLIMATE_IDS, CLIMATES, type ClimateEnvelope } from "../world/climate";
import { townSeasonState } from "../world/groundCondition";
import { SEASONS, WEATHER_CONDITIONS, weatherPresetFor, type SeasonId } from "../world/season";
import { createBuildingFromArchetype } from "../structure/building";
import { cellColors } from "./drawIso";
import { NEUTRAL_SUN, roofSlopeLight, setSunlight, shadowFill, sunlightFor, topFaceColor, wallFaceColor, type Sunlight } from "./lighting";

describe("wall lighting", () => {
  it("uses wall orientation shade for eave/gable fills, not top or raw side ramps", () => {
    const b = createBuildingFromArchetype("cottage", "T", 0, 0);
    const mat = b.cells.find((c) => c.floor === b.floors - 1 && c.state !== "gone")!.material;
    const cols = cellColors(mat, false);
    const eastWall = wallFaceColor(mat, "east");
    const southWall = wallFaceColor(mat, "south");

    expect(eastWall).not.toBe(topFaceColor(mat));
    expect(southWall).not.toBe(topFaceColor(mat));
    expect(eastWall).not.toBe(cols.right);
    expect(southWall).not.toBe(cols.left);
  });
});

describe("climate sunlight", () => {
  const clear = (climate: ClimateEnvelope, season: SeasonId = "summer") => weatherPresetFor(season, "clear", climate);
  const desert = CLIMATES["sonoran-desert"], temperate = CLIMATES.temperate, boreal = CLIMATES.boreal;
  const luminance = (color: number) => ((color >> 16) & 255) * 0.299 + ((color >> 8) & 255) * 0.587 + (color & 255) * 0.114;
  const spread = (sun: Sunlight) => {
    setSunlight(sun);
    // Sunlit top against the shaded south wall.
    const gap = luminance(topFaceColor("brick")) - luminance(wallFaceColor("brick", "south"));
    setSunlight(NEUTRAL_SUN);
    return Math.abs(gap);
  };
  afterEach(() => setSunlight(NEUTRAL_SUN));

  it("leaves a temperate clear day on the neutral sun", () => {
    const sun = sunlightFor(temperate, clear(temperate), "summer");
    expect(sun.contrast).toBe(1);
    expect(sun.shadowStrength).toBe(1);
    expect(sun.shadow).toBe(NEUTRAL_SUN.shadow);
    expect(sun.tint).toBe(clear(temperate).light);
    const neutral = [wallFaceColor("brick", "east"), wallFaceColor("brick", "south"), topFaceColor("brick"), shadowFill(0.28)];
    setSunlight(sun);
    expect([wallFaceColor("brick", "east"), wallFaceColor("brick", "south"), topFaceColor("brick"), shadowFill(0.28)]).toEqual(neutral);
    expect(shadowFill(0.28)).toEqual({ color: NEUTRAL_SUN.shadow, alpha: 0.28 });
  });

  it("burns the arid Southwest stark and warm, with deep indigo shadows", () => {
    const sun = sunlightFor(desert, clear(desert), "summer");
    const neutral = sunlightFor(temperate, clear(temperate), "summer");
    expect(sun.contrast).toBeGreaterThan(1.2);
    expect(spread(sun)).toBeGreaterThan(spread(neutral));
    // Indigo: blue leads red and green in the shadow, and the shadow is stronger.
    const r = (sun.shadow >> 16) & 255, g = (sun.shadow >> 8) & 255, b = sun.shadow & 255;
    expect(b).toBeGreaterThan(r * 1.8);
    expect(b).toBeGreaterThan(g * 1.8);
    expect(sun.shadowStrength).toBeGreaterThan(1.2);
    setSunlight(sun);
    expect(shadowFill(0.2).color).toBe(sun.shadow);
    expect(shadowFill(0.2).alpha).toBeGreaterThan(0.2);
    // Warm: the tint keeps its red and gives up blue.
    expect((sun.tint >> 16) & 255).toBeGreaterThan(sun.tint & 255);
    // A roof slope reads steeper under it.
    const slope = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }];
    const lit = roofSlopeLight(slope);
    setSunlight(NEUTRAL_SUN);
    expect(Math.abs(lit)).toBeGreaterThan(Math.abs(roofSlopeLight(slope)));
  });

  it("cools and flattens northern winters, and flattens again under cloud", () => {
    const summer = sunlightFor(boreal, clear(boreal), "summer");
    const winter = sunlightFor(boreal, clear(boreal, "winter"), "winter");
    const overcast = sunlightFor(boreal, weatherPresetFor("winter", "overcast", boreal), "winter");
    expect(summer.contrast).toBeLessThan(1);
    expect(winter.contrast).toBeLessThan(summer.contrast);
    expect(overcast.contrast).toBeLessThan(winter.contrast);
    expect(overcast.shadowStrength).toBeLessThan(winter.shadowStrength);
    expect(spread(overcast)).toBeLessThan(spread(sunlightFor(desert, clear(desert), "summer")));
    // Cool: blue at least matches red in a northern winter's light.
    expect(winter.tint & 255).toBeGreaterThanOrEqual((winter.tint >> 16) & 255);
  });

  it("dims a haboob's contrast below the desert's clear noon", () => {
    const haboob = sunlightFor(desert, weatherPresetFor("summer", "dust", desert), "summer");
    expect(haboob.contrast).toBeLessThan(sunlightFor(desert, clear(desert), "summer").contrast);
  });

  it("is a pure function with a key that changes exactly when the colours do", () => {
    const a = sunlightFor(desert, clear(desert), "summer");
    expect(sunlightFor(desert, clear(desert), "summer")).toEqual(a);
    const keys = new Set<string>();
    for (const id of CLIMATE_IDS) for (const season of SEASONS) for (const condition of WEATHER_CONDITIONS) {
      const climate = CLIMATES[id];
      const sun = sunlightFor(climate, weatherPresetFor(season, condition, climate), townSeasonState(season, climate).look);
      keys.add(sun.key);
      expect(sun.contrast).toBeGreaterThan(0.4);
      expect(sun.contrast).toBeLessThan(1.5);
    }
    expect(keys.size).toBeGreaterThan(10);
    expect(a.key).not.toBe(sunlightFor(temperate, clear(temperate), "summer").key);
  });
});
