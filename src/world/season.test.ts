import { describe, expect, it } from "vitest";
import { CAMPAIGN_LEVELS, campaignLevelById } from "../game/campaign";
import { advanceCampaignLevel, campaignBriefingText, retryCampaignLevel, startCampaign } from "../game/campaignRun";
import { availableTownValue } from "../game/campaignValue";
import { parseSessionFromSearch } from "../game/session";
import { presentationTint, SeasonWeather } from "../fx/seasonWeather";
import { planForestGarnish } from "../render/forestCanopy";
import { pointOnRoad, RoadBuilder } from "./roads";
import { selectCampaignBiome } from "./biomes";
import { payFieldDamage } from "./fields";
import { CLIMATES, SOILS } from "./climate";
import { trackColor } from "./groundCondition";
import { generateCampaignLayout } from "./campaignLayout";
import { movementBlocked, resolveTraversal, terrainTraversalAt, validateFeatureLayout, type FieldFeature } from "./terrainFeatures";
import { cellIndex, emptyGrassGrid, SURFACE_ID } from "./terrain";
import { createTown } from "./town";
import { leaveSeasonalTrack } from "./seasonTracks";
import {
  ICE_COLOR,
  resolveSeason,
  resolveWeather,
  SEASON_COMPATIBILITY,
  SEASONS,
  standingCrop,
  type SeasonId,
} from "./season";

function geography(town: ReturnType<typeof createTown>): string {
  const water = town.features
    .filter((feature) => feature.kind === "pond" || feature.kind === "lake" || feature.kind === "river")
    .map((feature) => JSON.stringify(feature));
  const fields = town.features
    .filter((feature): feature is FieldFeature => feature.kind === "field")
    .map((field) => `${field.crop}:${field.x}:${field.y}:${field.w}:${field.d}:${field.heading}:${field.lotId ?? ""}`);
  const buildings = town.buildings.map((building) => `${building.archetypeId}:${building.x}:${building.y}:${building.w}:${building.d}`);
  const lots = town.lots.map((lot) => `${lot.id}:${lot.x}:${lot.y}:${lot.w}:${lot.d}`);
  const roads = town.network.segments.map((seg) => seg.points.map((p) => `${p.x},${p.y}`).join(">"));
  const wet = [...town.surface.surface].filter((id) => id === SURFACE_ID.water).length;
  return JSON.stringify({
    spawn: [town.spawnX, town.spawnY, town.roadSpawnX, town.roadSpawnY],
    buildings,
    lots,
    roads,
    water,
    fields,
    wet,
  });
}

function fieldStates(season: SeasonId): FieldFeature[] {
  const town = createTown({
    district: "d30",
    seed: 19,
    campaign: campaignLevelById("county"),
    season,
    biome: selectCampaignBiome(19),
  });
  return town.features.filter((feature): feature is FieldFeature => feature.kind === "field");
}

describe("seasons", () => {
  it("documents missing seasons as summer and resolves random once", () => {
    expect(SEASON_COMPATIBILITY).toBe("missing-or-invalid-season-is-summer");
    const absent = parseSessionFromSearch("");
    expect(absent.season).toBe("summer");
    expect(absent.seasonExplicit).toBe(false);
    const invalid = parseSessionFromSearch("?season=monsoon&seed=4");
    expect(invalid.season).toBe("summer");
    expect(invalid.seasonExplicit).toBe(true);
    expect(parseSessionFromSearch("?biome=not-a-biome").biomeId).toBeUndefined();
    const named = parseSessionFromSearch("?season=winter&biome=northern-conifer&seed=4");
    expect(named.season).toBe("winter");
    expect(named.biomeId).toBe("northern-conifer");
    const rolled = parseSessionFromSearch("?season=random&seed=4");
    expect(rolled.season).toBe(resolveSeason(4));
    expect(rolled.seasonSelection).toBe("random");
    expect(rolled.seasonExplicit).toBe(true);
    expect(parseSessionFromSearch("?season=random&seed=4").season).toBe(rolled.season);
  });

  it("keeps one campaign season and biome across levels, retry, and advance", () => {
    const run = startCampaign(19);
    expect(SEASONS).toContain(run.season);
    const biomes = CAMPAIGN_LEVELS.map((level) => generateCampaignLayout(level, 19).biome.id);
    expect(new Set(biomes)).toEqual(new Set([run.biomeId]));
    const retried = retryCampaignLevel(run);
    expect(retried.season).toBe(run.season);
    expect(retried.biomeId).toBe(run.biomeId);
    const advanced = advanceCampaignLevel(run, 99);
    expect(advanced.season).toBe(run.season);
    expect(advanced.biomeId).toBe(run.biomeId);
    expect(advanced.levelSeed).toBe(99);
    const briefing = campaignBriefingText(CAMPAIGN_LEVELS[0]!, "winter");
    expect(briefing).toContain("Locked for this run");
    expect(briefing).toContain("The dozer can cross it.");
    const county = campaignBriefingText(CAMPAIGN_LEVELS[6]!, "winter", { name: "Juneau Capitol District — Governor's Mansion", weather: "storm" });
    expect(county).toContain("County 7 · Juneau Capitol District");
    expect(county).toContain("Weather: Blizzard.");
    expect(county).toContain("Blizzard: heavy snow");
    // A desert or Gulf winter briefs no ice crossing and no snow; its own hazards brief by name.
    for (const id of ["sonoran-desert", "mojave-desert", "gulf-subtropical", "tropical"] as const) {
      for (const weather of ["clear", "precip", "storm", "dust"] as const) {
        const warm = campaignBriefingText(CAMPAIGN_LEVELS[1]!, "winter", { name: "Low Desert County", weather }, CLIMATES[id]);
        expect(warm, `${id} ${weather}`).not.toMatch(/ice|snow|blizzard|frozen|frost/i);
        expect(warm).toContain("Season: Winter.");
      }
    }
    expect(campaignBriefingText(CAMPAIGN_LEVELS[1]!, "winter", { name: "A", weather: "precip" }, CLIMATES["sonoran-desert"])).toContain("Weather: Rain.");
    const haboob = campaignBriefingText(CAMPAIGN_LEVELS[1]!, "summer", { name: "A", weather: "dust" }, CLIMATES["sonoran-desert"]);
    expect(haboob).toContain("Weather: Haboob.");
    expect(haboob).toContain("short visibility");
    expect(campaignBriefingText(CAMPAIGN_LEVELS[1]!, "summer", { name: "A", weather: "storm" }, CLIMATES["sonoran-desert"])).toContain("Monsoon downpour");
    expect(campaignBriefingText(CAMPAIGN_LEVELS[1]!, "summer", { name: "A", weather: "heat" }, CLIMATES["sonoran-desert"])).toContain("Extreme heat");
    expect(campaignBriefingText(CAMPAIGN_LEVELS[1]!, "summer", { name: "A", weather: "storm" }, CLIMATES["gulf-subtropical"])).toContain("Coastal squall");
    // Ponds freeze in the Upland South without snow, so the ice line stays.
    expect(campaignBriefingText(CAMPAIGN_LEVELS[1]!, "winter", undefined, CLIMATES["upland-south"])).toContain("The dozer can cross it.");
    expect(campaignBriefingText(CAMPAIGN_LEVELS[1]!, "summer")).not.toContain("ice");
  });

  it("keeps the season locked across counties while each county carries its own weather", () => {
    const run = startCampaign(5);
    run.season = "autumn";
    run.county = { regionId: "US-VT", index: 2, weather: "fog", mapSeed: 3 };
    const next = advanceCampaignLevel(run, 77, { levelIndex: 4, county: { ...run.county, index: 5, weather: "precip" } });
    expect(next).toMatchObject({ season: "autumn", levelIndex: 4, levelSeed: 77, county: { index: 5, weather: "precip", mapSeed: 3 } });
    expect(retryCampaignLevel(next).county).toEqual(next.county);
  });

  it("keeps roads, parcels, buildings, and water identical across seasons", () => {
    const biome = selectCampaignBiome(19);
    const maps = SEASONS.map((season) => createTown({
      district: "d30",
      seed: 19,
      campaign: campaignLevelById("county"),
      season,
      biome,
    }));
    const fingerprint = geography(maps[0]!);
    for (const town of maps) expect(geography(town)).toBe(fingerprint);
    expect(maps.find((town) => town.season === "winter")!.groundCondition).toBe("snow");
    expect(maps.find((town) => town.season === "summer")!.groundCondition).toBe("clear");
    const off = createTown({
      district: "d30",
      seed: 19,
      campaign: campaignLevelById("county"),
      season: "summer",
      biome,
      weatherDetail: "off",
    });
    expect(geography(off)).toBe(fingerprint);
    expect(off.weather.gameplay).toBe("none");
    expect(resolveWeather("winter", 19).gameplay).toBe("none");
  }, 120_000);

  it("stages fields by season and pays only standing crops", () => {
    const winter = fieldStates("winter");
    const spring = fieldStates("spring");
    const summer = fieldStates("summer");
    const autumn = fieldStates("autumn");
    for (const field of winter) expect(["stubble", "tilled"]).toContain(field.state);
    for (const field of spring) expect(["tilled", "short"]).toContain(field.state);
    for (const field of summer) expect(["short", "mature"]).toContain(field.state);
    for (const field of autumn) expect(["mature", "stubble"]).toContain(field.state);
    for (const field of [...winter, ...spring, ...summer, ...autumn]) {
      if (!standingCrop(field.state)) expect(field.value ?? 0).toBe(0);
    }
    const fallow = winter[0] ?? { ...summer[0]!, state: "stubble" as const, paid: 0, value: 40, valid: 4 };
    expect(payFieldDamage({ ...fallow, state: "stubble" }, 2)).toBe(0);
    expect(payFieldDamage({ ...fallow, state: "tilled" }, 2)).toBe(0);
    const level = campaignLevelById("county");
    const town = createTown({ district: "d30", seed: 19, campaign: level, season: "winter", biome: selectCampaignBiome(19) });
    expect(availableTownValue(town)).toBeGreaterThan(level.dollarTarget);
  }, 120_000);

  it("lets the dozer cross winter ice and keeps traffic on the roads", () => {
    const grid = emptyGrassGrid(0, 0, 8, 8);
    const water = cellIndex(grid, 3, 3);
    const forest = cellIndex(grid, 4, 3);
    grid.surface[water] = SURFACE_ID.water;
    grid.surface[forest] = SURFACE_ID["forest-core"];
    const wx = grid.ox + 3.5;
    const wy = grid.oy + 3.5;
    const fx = grid.ox + 4.5;
    const fy = grid.oy + 3.5;
    expect(movementBlocked(terrainTraversalAt([], wx, wy, grid), true)).toBe(false);
    expect(movementBlocked(terrainTraversalAt([], wx, wy, grid), false)).toBe(true);
    expect(movementBlocked(terrainTraversalAt([], wx, wy, grid))).toBe(true);
    expect(movementBlocked(terrainTraversalAt([], fx, fy, grid), true)).toBe(true);
    const winterMove = resolveTraversal(wx, wy, wx - 1, wy, [], grid, true);
    expect(winterMove.blocked).toBe(false);
    expect(winterMove.x).toBeCloseTo(wx);
    const traffic = resolveTraversal(wx, wy, wx - 1, wy, [], grid);
    expect(traffic.blocked).toBe(true);
    expect(traffic.x).toBeCloseTo(wx - 1);
    const lake = {
      kind: "lake" as const,
      id: "ice",
      seed: 1,
      poly: [
        { x: 2, y: 2 },
        { x: 6, y: 2 },
        { x: 6, y: 6 },
        { x: 2, y: 6 },
      ],
    };
    expect(terrainTraversalAt([lake], 4, 4)).toBe("water");
    expect(resolveTraversal(4, 4, 1, 4, [lake], null, true).blocked).toBe(false);
    expect(resolveTraversal(4, 4, 1, 4, [lake]).blocked).toBe(true);
    const network = new RoadBuilder().finish();
    const winterIssues = validateFeatureLayout([], network, [], wx, wy, fx, fy, grid, [], true);
    expect(winterIssues).not.toContain("spawn blocked by terrain");
    expect(winterIssues).toContain("road spawn blocked by terrain");
    expect(validateFeatureLayout([], network, [], wx, wy, fx, fy, grid, [], false)).toContain("spawn blocked by terrain");
    expect(ICE_COLOR).not.toBe(0xffffff);
  });

  it("keeps forest collision identity while phenology changes", () => {
    const town = createTown({
      district: "d30",
      seed: 19,
      campaign: campaignLevelById("county"),
      season: "summer",
      biome: selectCampaignBiome(19),
    });
    const summer = planForestGarnish(town.surface, town.biome, town.seed, "summer");
    const winter = planForestGarnish(town.surface, town.biome, town.seed, "winter");
    const place = (trees: typeof summer) => trees.map((tree) => `${tree.x}:${tree.y}:${tree.species}:${tree.form}:${tree.scale}:${tree.seed}`);
    expect(place(winter)).toEqual(place(summer));
    if (summer.length > 0) expect(winter.every((tree) => tree.phenology === "winter")).toBe(true);
  }, 60_000);

  it("draws tracks only on open ground when weather is showing", () => {
    const town = createTown({ district: "classic", seed: 1, season: "winter", weatherDetail: "off" });
    leaveSeasonalTrack(town, 2, 2, 0);
    expect(town.marks.some((mark) => mark.kind === "season-track")).toBe(false);
    town.weatherDetail = "on";
    leaveSeasonalTrack(town, town.spawnX, town.spawnY, 0);
    expect(town.marks.some((mark) => mark.kind === "season-track")).toBe(false);
    let open: { x: number; y: number } | undefined;
    for (let y = town.minY + 1; y < town.maxY && !open; y += 1) {
      for (let x = town.minX + 1; x < town.maxX; x += 1) {
        if (pointOnRoad(town.network, x + 0.5, y + 0.5)) continue;
        if (terrainTraversalAt(town.features, x + 0.5, y + 0.5, town.surface) !== "open") continue;
        open = { x: x + 0.5, y: y + 0.5 };
        break;
      }
    }
    expect(open).toBeTruthy();
    leaveSeasonalTrack(town, open!.x, open!.y, 0.4);
    expect(town.marks.filter((mark) => mark.kind === "season-track")).toHaveLength(2);
    const weather = new SeasonWeather();
    weather.step({ dt: 1, kind: "flurries", detail: "off", camX: 0, camY: 0, seed: 1 });
    expect(weather.flakes).toHaveLength(0);
    expect(presentationTint(0xd7e3ef, "off")).toBe(0xffffff);
    expect(presentationTint(0xd7e3ef, "on")).toBe(0xd7e3ef);
  });
});

describe("track colors", () => {
  it("presses snow, mud and each soil's own compacted colour", () => {
    const soils = Object.values(SOILS);
    for (const soil of soils) {
      expect(trackColor("dry", soil)).toBe(soil.track);
      expect(trackColor("wet", soil)).toBe(soil.mud);
      expect(trackColor("mud-wash", soil)).toBe(soil.mud);
    }
    expect(new Set(soils.map((soil) => trackColor("dry", soil))).size).toBe(soils.length);
    expect(new Set(soils.map((soil) => trackColor("snow", soil))).size).toBe(1);
  });

  it("stamps each town's tracks in its own soil, and in snow only where snow lies", () => {
    const stamp = (climate: (typeof CLIMATES)[keyof typeof CLIMATES], season: SeasonId, weather: "clear" | "storm" = "clear") => {
      const town = createTown({ district: "d30", seed: 19, campaign: campaignLevelById("village"), season, climate, weather });
      for (let y = town.minY + 1; y < town.maxY; y += 1) for (let x = town.minX + 1; x < town.maxX; x += 1) {
        if (town.marks.length || pointOnRoad(town.network, x + 0.5, y + 0.5)) continue;
        if (terrainTraversalAt(town.features, x + 0.5, y + 0.5, town.surface) === "open") leaveSeasonalTrack(town, x + 0.5, y + 0.5, 0);
      }
      expect(town.marks).toHaveLength(2);
      return town.marks[0]!.tint;
    };
    const snow = stamp(CLIMATES.temperate, "winter");
    expect(snow).toBe(trackColor("snow", SOILS["dark-loam"]));
    expect(stamp(CLIMATES["sonoran-desert"], "winter")).toBe(SOILS["pale-caliche"].track);
    expect(stamp(CLIMATES.canyonlands, "summer")).toBe(SOILS["red-sandstone"].track);
    expect(stamp(CLIMATES["gulf-subtropical"], "winter")).toBe(SOILS["coastal-sand"].track);
    expect(stamp(CLIMATES.temperate, "summer")).toBe(SOILS["dark-loam"].track);
    // A monsoon churns caliche to mud.
    expect(stamp(CLIMATES["sonoran-desert"], "summer", "storm")).toBe(SOILS["pale-caliche"].mud);
  }, 60_000);
});
