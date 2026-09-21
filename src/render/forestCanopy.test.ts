import { describe, expect, it } from "vitest";
import { BIOME_PROFILES } from "../world/biomes";
import { createSurfaceGrid, SURFACE_CHUNK, SURFACE_ID, surfaceAt } from "../world/terrain";
import { createTown } from "../world/town";
import { FOREST_GARNISH_CHUNK_CAP, planForestGarnish } from "./forestCanopy";

describe("forest canopy garnish", () => {
  it("puts detailed trees on core edges and understory on the floor ring, not grass", () => {
    const grid = createSurfaceGrid(0, 0, 8, 8, "grass");
    for (const [ix, iy] of [[1, 1], [1, 2], [1, 3], [4, 1], [4, 2], [4, 3], [2, 1], [3, 1]] as const) {
      grid.surface[ix + iy * 8] = SURFACE_ID["forest-floor"];
    }
    grid.surface[2 + 2 * 8] = SURFACE_ID["forest-core"];
    grid.surface[3 + 2 * 8] = SURFACE_ID["forest-core"];
    const trees = planForestGarnish(grid, BIOME_PROFILES["temperate-broadleaf"], 11);
    expect(trees.length).toBeGreaterThanOrEqual(2);
    expect(trees.some((tree) => tree.form === "edge")).toBe(true);
    expect(trees.some((tree) => tree.form === "understory")).toBe(true);
    expect(trees.every((tree) => tree.x > 0.5 && tree.x < 5.5 && tree.y > 0.5 && tree.y < 4.5)).toBe(true);
    expect(trees.every((tree) => tree.species.startsWith("oak"))).toBe(true);
  });

  it("caps garnish per surface chunk", () => {
    const grid = createSurfaceGrid(0, 0, SURFACE_CHUNK, SURFACE_CHUNK, "forest-core");
    const trees = planForestGarnish(grid, BIOME_PROFILES["northern-conifer"], 3);
    expect(trees.length).toBeLessThanOrEqual(FOREST_GARNISH_CHUNK_CAP);
    expect(trees.length).toBeGreaterThan(40);
    expect(trees.every((tree) => tree.species.startsWith("pine"))).toBe(true);
    expect(trees.some((tree) => tree.form === "interior")).toBe(true);
    expect(trees.some((tree) => tree.form === "edge")).toBe(true);
  });

  it("mixes oak and pine on mixed-woodland and varies scale and tint", () => {
    const grid = createSurfaceGrid(0, 0, 8, 8, "forest-core");
    const trees = planForestGarnish(grid, BIOME_PROFILES["mixed-woodland"], 19);
    expect(trees.some((tree) => tree.species.startsWith("oak"))).toBe(true);
    expect(trees.some((tree) => tree.species.startsWith("pine"))).toBe(true);
    const scales = new Set(trees.map((tree) => tree.scale.toFixed(2)));
    const tints = new Set(trees.map((tree) => tree.tint));
    expect(scales.size).toBeGreaterThan(3);
    expect(tints.size).toBeGreaterThan(1);
  });

  it("is deterministic and does not spawn props", () => {
    const town = createTown({ district: "d10", seed: 1, topology: "tjunction" });
    const before = town.props.length;
    const a = planForestGarnish(town.surface, town.biome, town.seed);
    const b = planForestGarnish(town.surface, town.biome, town.seed);
    expect(a.length).toBeGreaterThan(8);
    expect(a).toEqual(b);
    expect(town.props.length).toBe(before);
    expect(town.biome.id).toBe("northern-conifer");
    expect(a.every((tree) => tree.species.startsWith("pine"))).toBe(true);
    expect(new Set(a.map((tree) => tree.form)).size).toBeGreaterThan(1);
  });

  it("keeps garnish on wooded cells and off lots", () => {
    const town = createTown({ district: "d10", seed: 1, topology: "tjunction" });
    const trees = planForestGarnish(town.surface, town.biome, town.seed);
    expect(trees.some((tree) => tree.form === "edge")).toBe(true);
    expect(trees.some((tree) => tree.form === "interior" || tree.form === "understory")).toBe(true);
    for (const tree of trees) {
      const cover = surfaceAt(town.surface, tree.x, tree.y);
      expect(cover === "forest-core" || cover === "forest-floor").toBe(true);
      if (tree.form === "understory") expect(cover).toBe("forest-floor");
      else expect(cover).toBe("forest-core");
      for (const lot of town.lots) {
        expect(tree.x < lot.x || tree.y < lot.y || tree.x > lot.x + lot.w || tree.y > lot.y + lot.d).toBe(true);
      }
    }
  });

  it("leaves gaps in large forest edges instead of filling every core-edge cell", () => {
    const grid = createSurfaceGrid(0, 0, SURFACE_CHUNK, SURFACE_CHUNK, "forest-core");
    const trees = planForestGarnish(grid, BIOME_PROFILES["northern-conifer"], 3);
    const edge = trees.filter((tree) => tree.form === "edge");
    expect(edge.length).toBeGreaterThan(8);
    expect(edge.length).toBeLessThan(SURFACE_CHUNK * 4);
  });
});
