import { describe, expect, it } from "vitest";
import { ParticlePool } from "../fx/particles";
import { createDozer } from "../vehicle/dozer";
import { destroyProp } from "../sim/assets";
import { stepWorld } from "../sim/worldSim";
import { BIOME_PROFILES } from "./biomes";
import { spawnAsset } from "./catalog";
import { createTown } from "./town";
import { validateTown } from "./districts";
import {
  churnFieldAt,
  terrainTraversalAt,
  type FieldFeature,
  type ForestFeature,
  type BasinFeature,
} from "./terrainFeatures";
import type { TopologyFamily } from "./rural";

const TOPOLOGIES: TopologyFamily[] = ["county", "crossroads", "tjunction", "curve-farm", "loop", "frontage"];

describe("terrain features", () => {
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
    const cx = forest ? forest.cx : water ? water.poly.reduce((sum, p) => sum + p.x, 0) / water.poly.length : river!.path[1]!.x;
    const cy = forest ? forest.cy : water ? water.poly.reduce((sum, p) => sum + p.y, 0) / water.poly.length : river!.path[1]!.y;
    const dozer = createDozer(cx, cy, 0);
    dozer.motionStartX = cx - 4;
    dozer.motionStartY = cy;
    stepWorld(town, dozer, new ParticlePool(), { blade: 0, engine: 0, push: 0 }, 1 / 60);
    expect(terrainTraversalAt(town.features, dozer.x, dozer.y)).toBe("open");
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
    stepWorld(town, dozer, new ParticlePool(), { blade: 0, engine: 0, push: 0 }, 1 / 60);
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
