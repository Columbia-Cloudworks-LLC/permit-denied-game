import { describe, expect, it } from "vitest";
import { campaignLevelById } from "../game/campaign";
import { BIOME_PROFILES } from "./biomes";
import { CLIMATE_IDS, CLIMATES, legalConditions, SOILS, type ClimateEnvelope } from "./climate";
import { groundState, townSeasonState, trackColor } from "./groundCondition";
import { SEASONS, WEATHER_CONDITIONS, weatherPresetFor } from "./season";
import { movementBlocked, resolveTraversal, terrainTraversalAt } from "./terrainFeatures";
import { createTown } from "./town";

const WARM: readonly ClimateEnvelope[] = CLIMATE_IDS.map((id) => CLIMATES[id]).filter((climate) => !climate.allowsSnow && !climate.allowsFreeze);
const COLD: readonly ClimateEnvelope[] = CLIMATE_IDS.map((id) => CLIMATES[id]).filter((climate) => climate.allowsSnow);

describe("town season state", () => {
  it("keeps the four season fields in agreement for every zone and season", () => {
    for (const id of CLIMATE_IDS) for (const season of SEASONS) {
      const climate = CLIMATES[id];
      const state = townSeasonState(season, climate);
      expect(state.season).toBe(season);
      expect(state.groundCondition === "snow").toBe(season === "winter" && climate.allowsSnow);
      expect(state.frozen).toBe(season === "winter" && climate.allowsFreeze);
      // The winter palette is reachable only through snow cover.
      expect(state.look === "winter").toBe(state.groundCondition === "snow");
      if (season !== "winter") expect(state.look).toBe(season);
      // Snow never lies on liquid water.
      if (state.groundCondition === "snow") expect(state.frozen).toBe(true);
    }
  });

  it("gives a map without a climate the legacy snowy, frozen winter", () => {
    expect(townSeasonState("winter")).toEqual({ season: "winter", look: "winter", frozen: true, groundCondition: "snow" });
    expect(townSeasonState("summer")).toEqual({ season: "summer", look: "summer", frozen: false, groundCondition: "clear" });
  });

  it("borrows each snowless zone's winter look", () => {
    expect(townSeasonState("winter", CLIMATES["sonoran-desert"]).look).toBe("summer");
    expect(townSeasonState("winter", CLIMATES["gulf-subtropical"]).look).toBe("spring");
    expect(townSeasonState("winter", CLIMATES["humid-south"]).look).toBe("autumn");
  });
});

describe("ground state and traction", () => {
  it("covers both kinds of zone", () => {
    expect(WARM.map((climate) => climate.id)).toEqual(expect.arrayContaining(["sonoran-desert", "mojave-desert", "gulf-subtropical", "tropical", "mediterranean-coast"]));
    expect(COLD.map((climate) => climate.id)).toEqual(expect.arrayContaining(["temperate", "great-plains", "alpine", "boreal", "subarctic", "canyonlands"]));
  });

  it("never reports snow cover, snow footing or snow slip where snow is impossible", () => {
    for (const climate of WARM) for (const season of SEASONS) for (const condition of [undefined, ...WEATHER_CONDITIONS]) {
      const state = groundState(season, condition, climate);
      expect(state.cover, `${climate.id} ${season} ${condition}`).toBe("clear");
      expect(state.footing).not.toBe("snow");
      // Dry skies leave dry ground: nothing slips but rain.
      if (condition !== "precip" && condition !== "storm") expect(state.slip).toBe(0);
    }
  });

  it("keeps full winter snow footing, and the legacy slip numbers, in cold zones", () => {
    for (const climate of COLD) {
      expect(groundState("winter", "clear", climate)).toEqual({ cover: "snow", footing: "snow", slip: 0 });
      expect(groundState("winter", "precip", climate)).toEqual({ cover: "snow", footing: "snow", slip: 0.09 });
      expect(groundState("winter", "storm", climate)).toEqual({ cover: "snow", footing: "snow", slip: 0.15 });
      expect(groundState("summer", "clear", climate).cover).toBe("clear");
    }
    expect(groundState("spring", "precip")).toEqual({ cover: "clear", footing: "wet", slip: 0.09 });
    expect(groundState("autumn", "storm")).toEqual({ cover: "clear", footing: "wet", slip: 0.15 });
    expect(groundState("summer", undefined)).toEqual({ cover: "clear", footing: "dry", slip: 0 });
  });

  it("turns a desert monsoon into slick mud wash and a coastal storm into a squall", () => {
    const monsoon = groundState("summer", "storm", CLIMATES["sonoran-desert"]);
    expect(monsoon.footing).toBe("mud-wash");
    expect(monsoon.slip).toBeGreaterThan(groundState("summer", "storm").slip);
    const squall = groundState("summer", "storm", CLIMATES["gulf-subtropical"]);
    expect(squall.footing).toBe("wet");
    expect(squall.slip).toBeGreaterThan(groundState("summer", "storm").slip);
    expect(squall.slip).toBeLessThan(monsoon.slip);
    // Dust and heat are dry: no traction loss at all.
    expect(groundState("summer", "dust", CLIMATES["sonoran-desert"])).toEqual({ cover: "clear", footing: "dry", slip: 0 });
    expect(groundState("summer", "heat", CLIMATES["sonoran-desert"])).toEqual({ cover: "clear", footing: "dry", slip: 0 });
  });

  it("presses tracks in snow, mud or the soil itself", () => {
    const caliche = SOILS["pale-caliche"];
    expect(trackColor("dry", caliche)).toBe(caliche.track);
    expect(trackColor("mud-wash", caliche)).toBe(caliche.mud);
    expect(trackColor("snow", caliche)).toBe(trackColor("snow", SOILS["dark-loam"]));
  });
});

describe("generated towns", () => {
  const village = campaignLevelById("village");

  it("keeps conifer maps clear unless the season is winter", () => {
    const classic = createTown();
    expect(classic.groundCondition).toBe("clear");
    expect(classic.season).toBe("summer");

    const conifer = createTown({ district: "d10", seed: 1, topology: "tjunction" });
    expect(conifer.biome.id).toBe("northern-conifer");
    expect(conifer.groundCondition).toBe("clear");

    const snow = createTown({ district: "d10", seed: 1, topology: "tjunction", season: "winter" });
    expect(snow.biome.id).toBe("northern-conifer");
    expect(snow).toMatchObject({ groundCondition: "snow", season: "winter", look: "winter", frozen: true });
  });

  it("never snows or freezes a Sonoran or Gulf winter, and their water still stops the dozer", () => {
    for (const [climate, biome] of [
      [CLIMATES["sonoran-desert"], BIOME_PROFILES["arid-scrub"]],
      [CLIMATES["gulf-subtropical"], BIOME_PROFILES["subtropical-coast"]],
    ] as const) {
      const town = createTown({ district: "d30", seed: 19, campaign: village, season: "winter", biome, climate });
      expect(town, climate.id).toMatchObject({ season: "winter", groundCondition: "clear", frozen: false });
      expect(town.look).not.toBe("winter");
      expect(town.weather.kind).not.toBe("flurries");
      // Every sky the county can be dealt, and every one a link could force on it.
      for (const condition of [...legalConditions(climate, "winter"), ...WEATHER_CONDITIONS]) {
        const sky = weatherPresetFor(town.season, condition, town.climate);
        expect(sky.kind, `${climate.id} ${condition}`).not.toBe("flurries");
        expect(sky.hazard).not.toBe("blizzard");
        expect(groundState(town.season, condition, town.climate).footing).not.toBe("snow");
      }
      expect(movementBlocked("water", town.frozen)).toBe(true);
      // A pond dropped on this town stops the dozer exactly as it would in July.
      const pond = { kind: "pond" as const, id: "tank", seed: 1, poly: [{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 2, y: 6 }] };
      expect(terrainTraversalAt([pond], 4, 4)).toBe("water");
      expect(resolveTraversal(4, 4, 1, 4, [pond], null, town.frozen)).toMatchObject({ blocked: true, x: 1 });
    }
  }, 120_000);

  it("keeps snow, ice crossings and flurries in temperate, boreal and alpine winters", () => {
    for (const climate of [CLIMATES.temperate, CLIMATES.boreal, CLIMATES.alpine, CLIMATES.subarctic]) {
      const town = createTown({ district: "d30", seed: 19, campaign: village, season: "winter", biome: BIOME_PROFILES[climate.biome], climate, weather: "precip" });
      expect(town, climate.id).toMatchObject({ season: "winter", look: "winter", groundCondition: "snow", frozen: true });
      expect(town.weather.kind).toBe("flurries");
      expect(movementBlocked("water", town.frozen)).toBe(false);
      expect(groundState(town.season, "storm", town.climate)).toEqual({ cover: "snow", footing: "snow", slip: 0.15 });
    }
  }, 120_000);

  it("gives legacy maps their biome's home climate: desert and coast biomes lose their snow", () => {
    const desert = createTown({ district: "d30", seed: 19, campaign: village, season: "winter", biome: BIOME_PROFILES["arid-scrub"] });
    expect(desert.climate.id).toBe("sonoran-desert");
    expect(desert).toMatchObject({ groundCondition: "clear", frozen: false });
    const coast = createTown({ district: "d30", seed: 19, campaign: village, season: "winter", biome: BIOME_PROFILES["subtropical-coast"] });
    expect(coast).toMatchObject({ groundCondition: "clear", frozen: false });
    const woods = createTown({ district: "d30", seed: 19, campaign: village, season: "winter", biome: BIOME_PROFILES["temperate-broadleaf"] });
    expect(woods).toMatchObject({ groundCondition: "snow", frozen: true });
  }, 120_000);
});
