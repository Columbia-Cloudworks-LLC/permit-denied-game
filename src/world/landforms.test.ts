import { describe, expect, it } from "vitest";
import { ParticlePool } from "../fx/particles";
import { CAMPAIGN_LEVELS, campaignLevelById, type CampaignLevelId } from "../game/campaign";
import { planForestGarnish, planForestMasses } from "../render/forestCanopy";
import { applyAssetHit, destroyProp } from "../sim/assets";
import { stepWorld } from "../sim/worldSim";
import { createDozer } from "../vehicle/dozer";
import { BIOME_PROFILES, type BiomeId } from "./biomes";
import { getAsset, spawnAsset } from "./catalog";
import { CLIMATES, type ClimateId } from "./climate";
import { validateTown } from "./districts";
import { mesaTierAt } from "./landforms";
import { rockBetween } from "./routing";
import { countNatural, neighbors4, SURFACE_ID, surfaceAt, traversalAt } from "./terrain";
import { movementBlocked, terrainTraversalAt, type MesaFeature } from "./terrainFeatures";
import { createTown, type Town } from "./town";

const SEEDS = [3, 19, 42];

function townIn(climate: ClimateId, seed: number, level: CampaignLevelId = "county", biome: BiomeId = CLIMATES[climate].biome): Town {
  return createTown({ district: "d30", seed, campaign: campaignLevelById(level), season: "summer", biome: BIOME_PROFILES[biome], climate: CLIMATES[climate] });
}

const mesas = (town: Town): MesaFeature[] => town.features.filter((f): f is MesaFeature => f.kind === "mesa");
const count = (town: Town, ...ids: string[]): number => town.props.filter((p) => ids.includes(p.assetId)).length;
const rockCells = (mesa: MesaFeature): number => mesa.tiers.reduce((n, tier) => n + (tier ? 1 : 0), 0);

/** Cells the dozer can drive to from its spawn, by the same traversal the sim uses. */
function reachable(town: Town): Uint8Array {
  const grid = town.surface;
  const seen = new Uint8Array(grid.surface.length);
  const start = Math.floor(town.spawnY - grid.oy) * grid.cols + Math.floor(town.spawnX - grid.ox);
  const queue = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    for (const j of neighbors4(grid, queue[head]!)) {
      if (seen[j] || traversalAt(grid, grid.ox + (j % grid.cols) + 0.5, grid.oy + ((j / grid.cols) | 0) + 0.5) !== "open") continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return seen;
}

describe("arid landforms", () => {
  it("raises more and taller rock in canyon country than in the low desert", () => {
    let canyon = 0, desert = 0, canyonTop = 0, desertTop = 0;
    for (const seed of SEEDS) {
      const c = mesas(townIn("canyonlands", seed));
      const d = mesas(townIn("sonoran-desert", seed));
      expect(c.length).toBeGreaterThanOrEqual(2);
      expect(d.length).toBeGreaterThanOrEqual(1);
      canyon += c.length;
      desert += d.length;
      for (const m of c) {
        expect(m.bedrock).toBe("sandstone");
        expect(rockCells(m)).toBeGreaterThanOrEqual(12);
        canyonTop = Math.max(canyonTop, Math.max(...m.tiers) * m.tierHeight);
      }
      for (const m of d) {
        expect(m.form).toBe("butte");
        expect(Math.max(...m.tiers)).toBeLessThanOrEqual(2);
        desertTop = Math.max(desertTop, Math.max(...m.tiers) * m.tierHeight);
      }
    }
    expect(canyon).toBeGreaterThan(desert);
    expect(canyonTop).toBeGreaterThan(desertTop);
  });

  it("scatters boulders and only the zone's own flora, with no forest canopy at all", () => {
    for (const seed of SEEDS) {
      const sonoran = townIn("sonoran-desert", seed);
      const mojave = townIn("mojave-desert", seed);
      const canyon = townIn("canyonlands", seed);
      expect(count(sonoran, "granite-boulder")).toBeGreaterThan(0);
      expect(count(sonoran, "granite-rock")).toBeGreaterThan(0);
      expect(count(canyon, "sandstone-boulder", "sandstone-rock")).toBeGreaterThan(2);
      expect(count(sonoran, "saguaro-cactus")).toBeGreaterThan(0);
      expect(count(sonoran, "joshua-tree", "sagebrush")).toBe(0);
      expect(count(mojave, "joshua-tree")).toBeGreaterThan(0);
      expect(count(mojave, "saguaro-cactus")).toBe(0);
      expect(count(canyon, "sagebrush")).toBeGreaterThan(0);
      expect(count(canyon, "saguaro-cactus", "joshua-tree")).toBe(0);
      for (const town of [sonoran, mojave, canyon]) {
        const natural = countNatural(town.surface);
        expect(natural["forest-core"] + natural["forest-floor"]).toBe(0);
        expect(natural.grass + natural["leaf-litter"] + natural.duff).toBe(0);
        expect(town.features.some((f) => f.kind === "forest")).toBe(false);
        expect(planForestGarnish(town.surface, town.biome, town.seed, town.look)).toEqual([]);
        expect(planForestMasses(town.surface, town.biome, town.seed)).toEqual([]);
        expect(count(town, "oak", "pine", "oak-sapling", "pine-sapling", "oak-shrub", "pine-shrub")).toBe(0);
        // The only trees are sparse pockets hugging a wash or water.
        expect(count(town, "mesquite", "desert-palm")).toBeLessThanOrEqual(14);
      }
    }
  });

  it("cuts drivable dry washes instead of flooding the desert", () => {
    const washed = SEEDS.map((seed) => townIn("canyonlands", seed)).filter((town) => town.features.some((f) => f.kind === "wash"));
    expect(washed.length).toBeGreaterThan(0);
    for (const town of washed) {
      const wash = town.features.find((f) => f.kind === "wash")!;
      if (wash.kind !== "wash") continue;
      const on = wash.path.find((p) => surfaceAt(town.surface, p.x, p.y) === "wash")!;
      expect(on).toBeDefined();
      expect(terrainTraversalAt(town.features, on.x, on.y, town.surface)).toBe("open");
    }
  });

  it("keeps rock solid: the dozer and police lines stop at a cliff, talus stays open", () => {
    const town = townIn("canyonlands", 19);
    const mesa = mesas(town)[0]!;
    const i = mesa.tiers.findIndex((tier) => tier > 0);
    const x = mesa.x + (i % mesa.cols) + 0.5;
    const y = mesa.y + ((i / mesa.cols) | 0) + 0.5;
    expect(mesaTierAt(mesa, x, y)).toBeGreaterThan(0);
    expect(surfaceAt(town.surface, x, y)).toBe("rock");
    expect(terrainTraversalAt(town.features, x, y, town.surface)).toBe("rock");
    expect(terrainTraversalAt(town.features, x, y)).toBe("rock");
    expect(movementBlocked("rock")).toBe(true);
    expect(movementBlocked("rock", true)).toBe(true);
    expect(rockBetween(town.surface, mesa.x - 2, y, mesa.x + mesa.cols + 2, y)).toBe(true);
    expect(rockBetween(town.surface, town.spawnX, town.spawnY, town.spawnX + 3, town.spawnY)).toBe(false);
    const talus = town.surface.surface.findIndex((id) => id === SURFACE_ID.talus);
    expect(talus).toBeGreaterThanOrEqual(0);
    expect(traversalAt(town.surface, town.surface.ox + (talus % town.surface.cols) + 0.5, town.surface.oy + ((talus / town.surface.cols) | 0) + 0.5)).toBe("open");
    // A dozer that ends a step on the rock is put back on open ground.
    const dozer = createDozer(x, y, 0);
    dozer.motionStartX = mesa.x - 1.5;
    dozer.motionStartY = y;
    stepWorld(town, dozer, new ParticlePool(), 1 / 60);
    expect(terrainTraversalAt(town.features, dozer.x, dozer.y, town.surface)).toBe("open");
  });

  it("makes large boulders immovable, small rocks shovable and scrub crushable", () => {
    const town = townIn("sonoran-desert", 3);
    for (const id of ["granite-boulder", "sandstone-boulder"]) {
      const boulder = spawnAsset(id, 0, 0);
      expect(getAsset(id).immovable).toBe(true);
      for (let n = 0; n < 200; n++) applyAssetHit(boulder, 50, 1, 0);
      expect(boulder.hp).toBe(boulder.maxHp);
      expect(boulder.broken).toBe(false);
    }
    for (const id of ["granite-rock", "sandstone-rock"]) {
      const rock = spawnAsset(id, 30, 30);
      expect(getAsset(id).destruction).toBe("roll");
      applyAssetHit(rock, 6, 1, 0);
      expect(rock.hp).toBe(0);
      const before = town.rubble.length;
      town.props.push(rock);
      destroyProp(town, rock, new ParticlePool(), [], 29, 30);
      // It leaves one rolling remnant for the blade to push, not a heap.
      expect(town.rubble.length).toBe(before + 1);
      expect(town.rubble[town.rubble.length - 1]!.layer).toBe("remnant");
    }
    for (const id of ["creosote-bush", "sagebrush", "prickly-pear", "agave", "palmetto-scrub"]) {
      const plant = spawnAsset(id, 0, 0);
      expect(getAsset(id).destruction).toBe("crush");
      applyAssetHit(plant, 2, 1, 0);
      expect(plant.pose.crush).toBeGreaterThan(0);
      applyAssetHit(plant, 10, 1, 0);
      expect(plant.hp).toBe(0);
    }
  });

  it("is deterministic for a seed", () => {
    const a = townIn("canyonlands", 42);
    const b = townIn("canyonlands", 42);
    const shape = (town: Town) => mesas(town).map((m) => [m.id, m.form, m.x, m.y, m.cols, m.rows, m.seed, [...m.tiers].join("")]);
    expect(shape(a)).toEqual(shape(b));
    expect(a.props.map((p) => [p.assetId, p.x, p.y, p.heading])).toEqual(b.props.map((p) => [p.assetId, p.x, p.y, p.heading]));
    expect([...a.surface.surface]).toEqual([...b.surface.surface]);
    expect(shape(townIn("canyonlands", 43))).not.toEqual(shape(a));
  });
});

describe("landform reachability", () => {
  it("keeps every campaign level valid and every lot reachable under mesas, washes and boulders", () => {
    for (const level of CAMPAIGN_LEVELS) {
      for (const climate of ["canyonlands", "sonoran-desert"] as const) {
        for (const seed of [3, 19]) {
          const town = townIn(climate, seed, level.id);
          const label = `${level.id} ${climate} ${seed}`;
          const report = validateTown(town);
          expect(report.issues, label).toEqual([]);
          expect(town.diagnostic.ok, label).toBe(true);
          expect(town.props.length, label).toBeLessThanOrEqual(level.generation.dressingBudget);
          const seen = reachable(town);
          // Ground past the surface grid is always open, so only on-grid points are looked up.
          const reached = (x: number, y: number): boolean => {
            const ix = Math.floor(x - town.surface.ox), iy = Math.floor(y - town.surface.oy);
            return ix < 0 || iy < 0 || ix >= town.surface.cols || iy >= town.surface.rows || seen[iy * town.surface.cols + ix] === 1;
          };
          for (const lot of town.lots) expect(reached(lot.x + lot.w * 0.5, lot.y + lot.d * 0.5), `${label} ${lot.id}`).toBe(true);
          expect(reached(town.roadSpawnX, town.roadSpawnY), label).toBe(true);
          // No rock or talus on anything developed, and a setback around every lot.
          for (const mesa of mesas(town)) {
            for (const lot of town.lots) {
              const gapX = Math.max(lot.x - (mesa.x + mesa.cols), mesa.x - (lot.x + lot.w), 0);
              const gapY = Math.max(lot.y - (mesa.y + mesa.rows), mesa.y - (lot.y + lot.d), 0);
              expect(gapX + gapY, `${label} ${mesa.id} ${lot.id}`).toBeGreaterThanOrEqual(2);
            }
          }
        }
      }
    }
  });
});

describe("arid rural land use", () => {
  it("replaces row crops with rangeland, orchards and solar arrays", () => {
    const seen = { windpump: 0, "stock-tank": 0, "citrus-tree": 0, "solar-panel": 0 };
    for (const climate of ["sonoran-desert", "mojave-desert", "canyonlands"] as const) {
      for (const seed of SEEDS) {
        const town = townIn(climate, seed);
        expect(town.features.some((f) => f.kind === "field")).toBe(false);
        expect(countNatural(town.surface).field).toBe(0);
        for (const id of Object.keys(seen) as (keyof typeof seen)[]) seen[id] += count(town, id);
        // A windpump always waters a stock tank beside it.
        expect(count(town, "stock-tank")).toBe(count(town, "windpump"));
      }
    }
    for (const [id, n] of Object.entries(seen)) expect(n, id).toBeGreaterThan(0);
    expect(getAsset("solar-panel").cash).toBeGreaterThan(getAsset("citrus-tree").cash);
    expect(getAsset("solar-panel").material).toBe("glass");
  });
});

describe("other landscapes", () => {
  it("gives the plains windbreak rows and low limestone outcrops instead of woodlots", () => {
    for (const seed of SEEDS) {
      const town = townIn("great-plains", seed);
      const natural = countNatural(town.surface);
      expect(natural["forest-core"]).toBe(0);
      const rock = mesas(town);
      expect(rock.length).toBeGreaterThan(0);
      for (const m of rock) {
        expect(m.form).toBe("outcrop");
        expect(m.bedrock).toBe("limestone");
        expect(Math.max(...m.tiers) * m.tierHeight).toBeLessThan(1);
      }
      expect(validateTown(town).issues).toEqual([]);
    }
    expect(SEEDS.some((seed) => countNatural(townIn("great-plains", seed).surface)["forest-floor"] > 0)).toBe(true);
  });

  it("mixes granite outcrops and boulder fields into alpine conifers", () => {
    for (const seed of SEEDS) {
      const town = townIn("alpine", seed);
      const rock = mesas(town);
      expect(rock.length).toBeGreaterThanOrEqual(2);
      for (const m of rock) {
        expect(m.form).toBe("outcrop");
        expect(m.bedrock).toBe("granite");
      }
      expect(count(town, "granite-boulder", "granite-rock")).toBeGreaterThan(3);
      const natural = countNatural(town.surface);
      expect(natural["forest-core"] + natural["forest-floor"]).toBeGreaterThan(0);
      expect(count(town, "saguaro-cactus", "sagebrush", "sabal-palm")).toBe(0);
      expect(validateTown(town).issues).toEqual([]);
    }
  });

  it("plants palms and palmetto on a shell-sand coast with no rock", () => {
    for (const seed of SEEDS) {
      const town = townIn("gulf-subtropical", seed);
      expect(mesas(town)).toEqual([]);
      expect(countNatural(town.surface).sand).toBeGreaterThan(0);
      expect(count(town, "sabal-palm", "palmetto-scrub", "desert-palm")).toBeGreaterThan(3);
      expect(count(town, "granite-boulder", "sandstone-boulder")).toBe(0);
      expect(validateTown(town).issues).toEqual([]);
    }
  });

  it("leaves temperate and boreal forests exactly as they were", () => {
    for (const [biome, climate] of [["temperate-broadleaf", "temperate"], ["mixed-woodland", "temperate"], ["northern-conifer", "boreal"]] as const) {
      const explicit = townIn(climate, 19, "county", biome);
      const legacy = createTown({ district: "d30", seed: 19, campaign: campaignLevelById("county"), season: "summer", biome: BIOME_PROFILES[biome] });
      expect([...explicit.surface.surface]).toEqual([...legacy.surface.surface]);
      expect(explicit.props.map((p) => [p.assetId, p.x, p.y])).toEqual(legacy.props.map((p) => [p.assetId, p.x, p.y]));
      const natural = countNatural(explicit.surface);
      expect(natural.rock + natural.talus + natural.wash + natural.sand).toBe(0);
      expect(explicit.features.some((f) => f.kind === "mesa" || f.kind === "wash")).toBe(false);
      expect(natural["forest-core"]).toBeGreaterThan(0);
      expect(planForestMasses(explicit.surface, explicit.biome, explicit.seed).length).toBeGreaterThan(0);
      expect(count(explicit, "granite-boulder", "sandstone-boulder", "granite-rock", "sandstone-rock")).toBe(0);
    }
  });
});
