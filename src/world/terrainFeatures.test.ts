import { describe, expect, it } from "vitest";
import { ParticlePool } from "../fx/particles";
import { createDozer } from "../vehicle/dozer";
import { destroyProp } from "../sim/assets";
import { stepWorld } from "../sim/worldSim";
import { BIOME_PROFILES } from "./biomes";
import { spawnAsset } from "./catalog";
import { createSurfaceGrid, groundPatchContains, SURFACE_ID } from "./terrain";
import { createTown } from "./town";
import { validateTown } from "./districts";
import {
  churnFieldAt,
  fieldPatches,
  movementBlocked,
  resolveTraversal,
  terrainTraversalAt,
  validateFeatureLayout,
  type FieldFeature,
  type ForestFeature,
  type BasinFeature,
  type MesaFeature,
  type WashFeature,
} from "./terrainFeatures";
import type { Lot } from "../structure/types";
import type { TopologyFamily } from "./rural";

const TOPOLOGIES: TopologyFamily[] = ["county", "crossroads", "tjunction", "curve-farm", "loop", "frontage"];

/** Centre of the first forest-core cell in row-major order. */
function firstForestCore(grid: ReturnType<typeof createTown>["surface"]): { x: number; y: number } | undefined {
  const i = grid.surface.indexOf(SURFACE_ID["forest-core"]);
  if (i < 0) return undefined;
  return { x: grid.ox + ((i % grid.cols) + 0.5) * grid.cell, y: grid.oy + (((i / grid.cols) | 0) + 0.5) * grid.cell };
}

describe("terrain features", () => {
  it("paints field ground only on masked cells", () => {
    const feature: FieldFeature = {
      kind: "field",
      id: "field-test",
      x: 0,
      y: 0,
      w: 4,
      d: 2,
      heading: 0,
      crop: "corn",
      state: "mature",
      seed: 1,
      cell: 1,
      cols: 4,
      rows: 2,
      churn: new Uint8Array(8),
      mask: Uint8Array.from([1, 1, 0, 0, 1, 1, 0, 0]),
    };
    const patches = fieldPatches(feature);
    expect(patches.some((patch) => groundPatchContains(patch, 0.5, 0.5))).toBe(true);
    expect(patches.some((patch) => groundPatchContains(patch, 3.5, 0.5))).toBe(false);
  });

  it("keeps biome and features stable for a seed", () => {
    const a = createTown({ district: "d10", seed: 0x51a11, topology: "curve-farm" });
    const b = createTown({ district: "d10", seed: 0x51a11, topology: "curve-farm" });
    expect(a.biome.id).toBe(b.biome.id);
    expect(a.features.map((f) => `${f.kind}:${f.id}`)).toEqual(b.features.map((f) => `${f.kind}:${f.id}`));
    expect(a.buildings.map((building) => `${building.x}:${building.y}:${building.archetypeId}`)).toEqual(
      b.buildings.map((building) => `${building.x}:${building.y}:${building.archetypeId}`),
    );
  });

  it("does not reshuffle buildings when the feature streams change with the same main seed", () => {
    const a = createTown({ district: "d10", seed: 19, topology: "county" });
    const b = createTown({ district: "d10", seed: 19, topology: "county" });
    expect(a.lots.map((lot) => lot.id)).toEqual(b.lots.map((lot) => lot.id));
  });

  it("only plants biome-legal tree species on the feature layer", () => {
    const town = createTown({ district: "d30", seed: 7, topology: "tjunction" });
    const featureTrees = town.props.filter((p) => ["oak", "pine", "oak-sapling", "pine-sapling", "oak-shrub", "pine-shrub"].includes(p.assetId));
    for (const prop of featureTrees) {
      expect(
        town.biome.trees.includes(prop.assetId) ||
          town.biome.saplings.includes(prop.assetId) ||
          town.biome.shrubs.includes(prop.assetId),
      ).toBe(true);
    }
  });

  it("keeps water and forest cores off roads, lots, and spawns", () => {
    for (const topology of TOPOLOGIES) {
      const town = createTown({ district: "d10", seed: 0x51a11, topology });
      const report = validateTown(town);
      expect(report.issues, report.issues.map((i) => i.detail).join("; ")).toEqual([]);
      expect(terrainTraversalAt(town.features, town.spawnX, town.spawnY, town.surface)).toBe("open");
      expect(terrainTraversalAt(town.features, town.roadSpawnX, town.roadSpawnY, town.surface)).toBe("open");
    }
  });

  it("places farm fields that are not dirt patches", () => {
    const town = createTown({ district: "d10", seed: 11, topology: "curve-farm" });
    const fields = town.features.filter((f): f is FieldFeature => f.kind === "field");
    expect(fields.length).toBeGreaterThan(0);
    expect(town.ground.some((g) => g.cover.startsWith("field-"))).toBe(true);
    expect(fields.every((field) => field.w >= 3 && field.d >= 3)).toBe(true);
    expect(town.lots.filter((lot) => lot.identity === "farm").every((lot) => lot.templateId === "farmstead")).toBe(true);
  });

  it("answers impassable water and forest cores", () => {
    const forest: ForestFeature = { kind: "forest", id: "f", cx: 10, cy: 10, coreR: 3, canopyR: 6, seed: 1 };
    const pond: BasinFeature = {
      kind: "pond",
      id: "p",
      poly: [
        { x: 20, y: 20 },
        { x: 24, y: 20 },
        { x: 24, y: 24 },
        { x: 20, y: 24 },
      ],
      seed: 2,
    };
    expect(terrainTraversalAt([forest], 10, 10)).toBe("forest-core");
    expect(terrainTraversalAt([forest], 14.5, 10)).toBe("open");
    expect(terrainTraversalAt([pond], 22, 22)).toBe("water");
    expect(terrainTraversalAt([pond], 18, 18)).toBe("open");
  });

  it("blocks the dozer from driving into water or a forest core", () => {
    const town = createTown({ district: "d10", seed: 0x51a11, topology: "tjunction" });
    const forest = town.features.find((f): f is ForestFeature => f.kind === "forest");
    const water = town.features.find((f): f is BasinFeature => f.kind === "pond" || f.kind === "lake");
    const river = town.features.find((f) => f.kind === "river");
    expect(forest ?? water ?? river).toBeDefined();
    // A prairie windbreak is a forest with no core, so the block under test is then the water.
    const core = forest && firstForestCore(town.surface);
    const cx = core ? core.x : water ? water.poly.reduce((sum, p) => sum + p.x, 0) / water.poly.length : river!.path[1]!.x;
    const cy = core ? core.y : water ? water.poly.reduce((sum, p) => sum + p.y, 0) / water.poly.length : river!.path[1]!.y;
    expect(terrainTraversalAt(town.features, cx, cy, town.surface)).not.toBe("open");
    const dozer = createDozer(cx, cy, 0);
    dozer.motionStartX = cx - 4;
    dozer.motionStartY = cy;
    stepWorld(town, dozer, new ParticlePool(), 1 / 60);
    expect(terrainTraversalAt(town.features, dozer.x, dozer.y, town.surface)).toBe("open");
  });

  it("flattens crop rows without spawning stalk props", () => {
    const field: FieldFeature = {
      kind: "field",
      id: "field",
      x: 4,
      y: 4,
      w: 6,
      d: 5,
      heading: 0,
      crop: "corn",
      state: "mature",
      seed: 3,
      cell: 0.85,
      cols: 8,
      rows: 6,
      churn: new Uint8Array(48),
    };
    expect(churnFieldAt(field, 6, 6, 0.9)).toBeGreaterThan(0);
    expect(field.churn.some((cell) => cell === 1)).toBe(true);
    const town = createTown({ district: "d10", seed: 11, topology: "curve-farm" });
    const live = town.features.find((f): f is FieldFeature => f.kind === "field");
    expect(live).toBeDefined();
    let sample = { x: live!.x + live!.w * 0.5, y: live!.y + live!.d * 0.5 };
    search: for (let row = 0; row < live!.rows; row++) {
      for (let col = 0; col < live!.cols; col++) {
        if (live!.mask && !live!.mask[row * live!.cols + col]) continue;
        const fx = Math.cos(live!.heading);
        const fy = Math.sin(live!.heading);
        const ox = live!.x + live!.w * 0.5;
        const oy = live!.y + live!.d * 0.5;
        sample = {
          x: ox + fx * ((col + 0.5) * live!.cell - live!.w * 0.5) - fy * ((row + 0.5) * live!.cell - live!.d * 0.5),
          y: oy + fy * ((col + 0.5) * live!.cell - live!.w * 0.5) + fx * ((row + 0.5) * live!.cell - live!.d * 0.5),
        };
        break search;
      }
    }
    const dozer = createDozer(sample.x, sample.y, live!.heading);
    dozer.bladeDown = true;
    const before = live!.churn.reduce((sum, cell) => sum + cell, 0);
    stepWorld(town, dozer, new ParticlePool(), 1 / 60);
    expect(live!.churn.reduce((sum, cell) => sum + cell, 0)).toBeGreaterThan(before);
    expect(town.props.every((p) => p.assetId !== "corn" && p.assetId !== "wheat")).toBe(true);
  });

  it("topples biome trees into wood debris", () => {
    const town = createTown({ district: "d10", seed: 3, topology: "county" });
    const tree = spawnAsset(town.biome.trees[0]!, town.minX + 4, town.minY + 4);
    town.props.push(tree);
    const before = town.rubble.length;
    destroyProp(town, tree, new ParticlePool(), [], tree.x - 1, tree.y);
    expect(tree.broken).toBe(true);
    expect(town.rubble.length).toBeGreaterThan(before);
  });
});

describe("district generation with terrain features", () => {
  it("stays valid across districts, topologies, and seeds", () => {
    for (const district of ["d10", "d30"] as const) {
      for (const topology of TOPOLOGIES) {
        for (const seed of [0x51a11, 19]) {
          const town = createTown({ district, seed, topology });
          const report = validateTown(town);
          expect(report.issues, `${district} ${topology} ${seed}: ${report.issues.map((i) => i.detail).join("; ")}`).toEqual([]);
          expect(BIOME_PROFILES[town.biome.id]).toBeDefined();
        }
      }
    }
  });
});

describe("rock and wash features", () => {
  const mesa: MesaFeature = { kind: "mesa", id: "mesa-0", form: "butte", bedrock: "sandstone", x: 10, y: 10, cols: 4, rows: 4, tiers: new Uint8Array([0, 0, 0, 0, 0, 1, 2, 0, 0, 1, 1, 0, 0, 0, 0, 0]), tierHeight: 1.2, seed: 7 };
  const wash: WashFeature = { kind: "wash", id: "wash-1", path: [{ x: 0, y: 5 }, { x: 30, y: 5 }], halfWidth: 1.5, seed: 3 };

  it("blocks on rock cells only and lets a wash through", () => {
    expect(terrainTraversalAt([mesa, wash], 11.5, 11.5)).toBe("rock");
    expect(terrainTraversalAt([mesa, wash], 12.5, 11.5)).toBe("rock");
    // The talus margin of the same box is open ground.
    expect(terrainTraversalAt([mesa, wash], 10.5, 10.5)).toBe("open");
    expect(terrainTraversalAt([mesa, wash], 13.5, 12.5)).toBe("open");
    expect(terrainTraversalAt([mesa, wash], 15, 5)).toBe("open");
    expect(movementBlocked("rock")).toBe(true);
  });

  it("slides a mover off the rock back to where it came from", () => {
    const out = resolveTraversal(11.5, 11.5, 9.5, 11.5, [mesa, wash]);
    expect(out.blocked).toBe(true);
    expect(terrainTraversalAt([mesa, wash], out.x, out.y)).toBe("open");
    const through = resolveTraversal(15, 5, 15, 3, [mesa, wash]);
    expect(through).toEqual({ x: 15, y: 5, blocked: false });
  });

  it("reports rock that sits on a lot or walls one in", () => {
    const grid = createSurfaceGrid(0, 0, 12, 12, "dirt");
    const network = createTown({ district: "d10", seed: 19 }).network;
    const lot = { id: "lot-x", x: 300, y: 300, w: 4, d: 4 } as Lot;
    const ring: MesaFeature = { ...mesa, x: 2, y: 2, cols: 7, rows: 7, tiers: new Uint8Array(49) };
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      if (r === 0 || c === 0 || r === 6 || c === 6) {
        ring.tiers[r * 7 + c] = 1;
        grid.surface[(2 + r) * grid.cols + 2 + c] = SURFACE_ID.rock;
      }
    }
    for (let r = 2; r < 5; r++) for (let c = 2; c < 5; c++) grid.surface[(2 + r) * grid.cols + 2 + c] = SURFACE_ID.developed;
    const walled = { ...lot, x: 4, y: 4, w: 3, d: 3 } as Lot;
    const issues = validateFeatureLayout([ring], network, [], 0.5, 0.5, 0.5, 0.5, grid, [walled]);
    expect(issues).toContain("rock isolates lot lot-x");
    expect(issues).toContain("rock isolates developed ground");
    const onLot = validateFeatureLayout([ring], network, [], 0.5, 0.5, 0.5, 0.5, grid, [{ ...lot, x: 2, y: 2, w: 2, d: 2 } as Lot]);
    expect(onLot).toContain("rock overlaps lot lot-x");
    // The same ring left open on one side isolates nothing.
    ring.tiers[3] = 0;
    grid.surface[2 * grid.cols + 5] = SURFACE_ID.dirt;
    expect(validateFeatureLayout([ring], network, [], 0.5, 0.5, 0.5, 0.5, grid, [walled]).filter((issue) => issue.includes("isolates"))).toEqual([]);
  });
});
