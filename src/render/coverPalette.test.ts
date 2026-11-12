import { describe, expect, it } from "vitest";
import { CLIMATE_IDS, CLIMATES, SOILS, type ClimateId } from "../world/climate";
import { townSeasonState } from "../world/groundCondition";
import { ICE_COLOR, SEASONS, type SeasonId } from "../world/season";
import { PAL } from "./palette";
import {
  COVER_KINDS,
  HARD_LOT_COVERS,
  SOFT_LOT_COVERS,
  coverColor,
  coverDark,
  groundTone,
} from "./coverPalette";

function luminance(color: number): number {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function channels(color: number): { r: number; g: number; b: number } {
  return { r: (color >> 16) & 255, g: (color >> 8) & 255, b: color & 255 };
}

describe("cover palettes", () => {
  it("covers every CoverKind for both map conditions", () => {
    expect(COVER_KINDS).toHaveLength(18);
    for (const cover of COVER_KINDS) {
      expect(coverColor(cover, "clear")).toEqual(expect.any(Number));
      expect(coverColor(cover, "snow")).toEqual(expect.any(Number));
      expect(coverDark(cover, "clear")).toEqual(expect.any(Number));
      expect(coverDark(cover, "snow")).toEqual(expect.any(Number));
    }
  });

  it("keeps the clear palette on non-snow maps", () => {
    expect(coverColor("grass", "clear")).toBe(PAL.grass);
    expect(coverColor("dirt", "clear")).toBe(PAL.dirt);
    expect(coverColor("planted", "clear")).toBe(PAL.planted);
    expect(coverColor("lot", "clear")).toBe(PAL.lot);
    expect(coverColor("driveway", "clear")).toBe(0x5a5248);
    expect(coverColor("water", "clear")).toBe(PAL.water);
    expect(coverColor("water", "snow")).not.toBe(PAL.water);
    expect(coverColor("water", "snow")).toBe(0x6e8ea4);
  });

  it("snows soft lot covers without summer-green or warm-earth rectangles", () => {
    for (const cover of SOFT_LOT_COVERS) {
      const snow = coverColor(cover, "snow");
      const clear = coverColor(cover, "clear");
      expect(snow).not.toBe(clear);
      expect(luminance(snow)).toBeGreaterThan(luminance(clear));
      const { r, g, b } = channels(snow);
      expect(g - r, `${cover} must not stay summer-green`).toBeLessThan(24);
      expect(r).toBeGreaterThan(140);
      expect(b).toBeGreaterThan(140);
    }
  });

  it("winterizes hard covers while keeping them darker than snow lawns", () => {
    const snowGrass = coverColor("grass", "snow");
    for (const cover of HARD_LOT_COVERS) {
      const snow = coverColor(cover, "snow");
      expect(snow).not.toBe(coverColor(cover, "clear"));
      expect(snow).not.toBe(snowGrass);
      expect(luminance(snow)).toBeLessThan(luminance(snowGrass) - 12);
    }
    expect(coverColor("driveway", "snow")).not.toBe(coverColor("parking", "snow"));
    expect(coverColor("tracks", "snow")).not.toBe(snowGrass);
  });

  it("greens growing covers in spring and browns them in autumn, leaving paving alone", () => {
    for (const cover of ["grass", "scrub", "planted", "lot"] as const) {
      const summer = coverColor(cover, "clear", "summer");
      const spring = channels(coverColor(cover, "clear", "spring"));
      const autumn = channels(coverColor(cover, "clear", "autumn"));
      expect(coverColor(cover, "clear", "spring")).not.toBe(summer);
      expect(spring.g - spring.r, `${cover} spring`).toBeGreaterThan(autumn.g - autumn.r);
      expect(autumn.r, `${cover} autumn`).toBeGreaterThan(autumn.b);
      expect(luminance(coverDark(cover, "clear", "autumn"))).toBeLessThan(luminance(coverColor(cover, "clear", "autumn")));
    }
    expect(coverColor("forest-floor", "clear", "autumn")).not.toBe(coverColor("forest-floor", "clear", "summer"));
    expect(coverColor("dirt", "clear", "spring")).not.toBe(coverColor("dirt", "clear", "autumn"));
    for (const cover of HARD_LOT_COVERS) {
      expect(coverColor(cover, "clear", "spring")).toBe(coverColor(cover, "clear", "summer"));
      expect(coverColor(cover, "clear", "autumn")).toBe(coverColor(cover, "clear", "summer"));
      expect(coverDark(cover, "clear", "autumn")).toBe(coverDark(cover, "clear", "summer"));
    }
  });
});

describe("climate-aware cover palettes", () => {
  const WINTER_ONLY = new Set(COVER_KINDS.flatMap((cover) => [coverColor(cover, "snow"), coverDark(cover, "snow")])
    .filter((color) => !COVER_KINDS.some((cover) => SEASONS.some((season) => season !== "winter"
      && (coverColor(cover, "clear", season) === color || coverDark(cover, "clear", season) === color)))));
  const toneOf = (id: ClimateId, season: SeasonId) => {
    const climate = CLIMATES[id];
    const state = townSeasonState(season, climate);
    return { state, tone: groundTone({ frozen: state.frozen, climate }) };
  };

  it("has winter colours to keep out of snowless zones", () => {
    expect(WINTER_ONLY.size).toBeGreaterThan(10);
    expect(WINTER_ONLY.has(ICE_COLOR)).toBe(true);
    expect(WINTER_ONLY.has(coverColor("grass", "snow"))).toBe(true);
  });

  it("reaches the winter palette only through snow cover", () => {
    for (const cover of COVER_KINDS) {
      // A calendar winter with clear ground paints dormant autumn, never snow.
      expect(coverColor(cover, "clear", "winter")).toBe(coverColor(cover, "clear", "autumn"));
      expect(coverDark(cover, "clear", "winter")).toBe(coverDark(cover, "clear", "autumn"));
      expect(WINTER_ONLY.has(coverColor(cover, "clear", "winter"))).toBe(false);
      // Snow cover wins whatever paint season comes with it.
      expect(coverColor(cover, "snow", "summer")).toBe(coverColor(cover, "snow", "winter"));
    }
  });

  it("never paints a winter colour, or ice, in any snowless zone's winter", () => {
    for (const id of CLIMATE_IDS) {
      if (CLIMATES[id].allowsSnow || CLIMATES[id].allowsFreeze) continue;
      const { state, tone } = toneOf(id, "winter");
      expect(state.groundCondition).toBe("clear");
      for (const cover of COVER_KINDS) {
        const color = coverColor(cover, state.groundCondition, state.look, tone);
        const dark = coverDark(cover, state.groundCondition, state.look, tone);
        expect(WINTER_ONLY.has(color), `${id} ${cover}`).toBe(false);
        expect(WINTER_ONLY.has(dark), `${id} ${cover} dark`).toBe(false);
      }
      expect(coverColor("water", state.groundCondition, state.look, tone)).toBe(PAL.water);
    }
  });

  it("keeps snow and ice in cold zones' winters", () => {
    for (const id of ["temperate", "great-plains", "alpine", "boreal", "subarctic", "canyonlands"] as const) {
      const { state, tone } = toneOf(id, "winter");
      expect(state.groundCondition).toBe("snow");
      expect(coverColor("grass", state.groundCondition, state.look, tone)).toBe(coverColor("grass", "snow"));
      expect(coverColor("water", state.groundCondition, state.look, tone)).toBe(ICE_COLOR);
      expect(coverColor("water", "clear", "summer", toneOf(id, "summer").tone)).toBe(PAL.water);
    }
  });

  it("freezes ponds without snow where a zone freezes but does not snow", () => {
    const { state, tone } = toneOf("upland-south", "winter");
    expect(state).toMatchObject({ groundCondition: "clear", frozen: true });
    expect(coverColor("water", state.groundCondition, state.look, tone)).toBe(ICE_COLOR);
    expect(coverColor("grass", state.groundCondition, state.look, tone)).toBe(coverColor("grass", "clear", "autumn"));
  });

  it("paints desert winters as dry ochre soil with dormant tan scrub", () => {
    for (const id of ["sonoran-desert", "mojave-desert", "chihuahuan-desert"] as const) {
      const { state, tone } = toneOf(id, "winter");
      const soil = SOILS[CLIMATES[id].soil];
      expect(tone.arid).toBe(true);
      const ground = channels(coverColor("grass", state.groundCondition, state.look, tone));
      expect(coverColor("grass", state.groundCondition, state.look, tone)).toBe(soil.verge);
      // Ochre and sand: red over green over blue, nothing like turf.
      expect(ground.r).toBeGreaterThan(ground.g);
      expect(ground.g).toBeGreaterThan(ground.b);
      const scrub = channels(coverColor("scrub", state.groundCondition, state.look, tone));
      expect(scrub.r).toBeGreaterThan(scrub.g);
      expect(scrub.b).toBeLessThan(scrub.g);
      expect(coverColor("scrub", state.groundCondition, state.look, tone)).not.toBe(coverColor("scrub", "clear", "summer"));
      // Pavement and water are not soil.
      expect(coverColor("parking", state.groundCondition, state.look, tone)).toBe(coverColor("parking", "clear"));
      expect(coverColor("water", state.groundCondition, state.look, tone)).toBe(PAL.water);
      expect(luminance(coverDark("grass", state.groundCondition, state.look, tone))).toBeLessThan(luminance(soil.verge));
    }
    // Red sandstone and pale caliche are different deserts.
    expect(coverColor("lot", "clear", "summer", toneOf("chihuahuan-desert", "winter").tone))
      .not.toBe(coverColor("lot", "clear", "summer", toneOf("sonoran-desert", "winter").tone));
  });

  it("paints subtropical winters in mild greens", () => {
    for (const id of ["gulf-subtropical", "mediterranean-coast", "tropical"] as const) {
      const { state, tone } = toneOf(id, "winter");
      expect(tone.arid).toBe(false);
      const grass = channels(coverColor("grass", state.groundCondition, state.look, tone));
      expect(grass.g).toBeGreaterThan(grass.r);
      expect(grass.g).toBeGreaterThan(grass.b);
    }
  });

  it("buries a snowy canyon winter and bares its red soil the rest of the year", () => {
    const winter = toneOf("canyonlands", "winter"), summer = toneOf("canyonlands", "summer");
    expect(coverColor("grass", winter.state.groundCondition, winter.state.look, winter.tone)).toBe(coverColor("grass", "snow"));
    expect(coverColor("grass", summer.state.groundCondition, summer.state.look, summer.tone)).toBe(SOILS["red-sandstone"].verge);
  });

  it("keys the ground caches on ice, aridity and soil", () => {
    const keys = new Set(CLIMATE_IDS.flatMap((id) => SEASONS.map((season) => toneOf(id, season).tone.key)));
    expect(toneOf("sonoran-desert", "winter").tone.key).not.toBe(toneOf("temperate", "winter").tone.key);
    expect(toneOf("temperate", "winter").tone.key).not.toBe(toneOf("temperate", "summer").tone.key);
    expect(toneOf("sonoran-desert", "winter").tone.key).toBe(toneOf("sonoran-desert", "summer").tone.key);
    expect(keys.size).toBeGreaterThan(8);
  });
});
