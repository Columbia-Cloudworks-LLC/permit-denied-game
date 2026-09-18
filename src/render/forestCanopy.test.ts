import { describe, expect, it } from "vitest";
import { BIOME_PROFILES } from "../world/biomes";
import { createSurfaceGrid, SURFACE_CHUNK, SURFACE_ID } from "../world/terrain";
import { createTown } from "../world/town";
import { FOREST_GARNISH_CHUNK_CAP, planForestGarnish } from "./forestCanopy";

describe("forest canopy garnish", () => {
  it("places one mass on forest-core cells only, not the circle or floor ring", () => {
    const grid = createSurfaceGrid(0, 0, 8, 8, "grass");
    grid.surface[1 + 1 * 8] = SURFACE_ID["forest-floor"];
    grid.surface[2 + 2 * 8] = SURFACE_ID["forest-core"];
    grid.surface[3 + 2 * 8] = SURFACE_ID["forest-core"];
    const trees = planForestGarnish(grid, BIOME_PROFILES["temperate-broadleaf"], 11);
    expect(trees).toHaveLength(2);
    expect(trees.every((tree) => tree.x > 1.5 && tree.x < 4.5 && tree.y > 1.5 && tree.y < 3.5)).toBe(true);
    expect(trees.every((tree) => tree.species === "oak")).toBe(true);
  });

  it("caps garnish per surface chunk", () => {
    const grid = createSurfaceGrid(0, 0, SURFACE_CHUNK, SURFACE_CHUNK, "forest-core");
    const trees = planForestGarnish(grid, BIOME_PROFILES["northern-conifer"], 3);
    expect(trees).toHaveLength(FOREST_GARNISH_CHUNK_CAP);
    expect(trees.every((tree) => tree.species === "pine")).toBe(true);
  });

  it("mixes oak and pine on mixed-woodland", () => {
    const grid = createSurfaceGrid(0, 0, 6, 6, "forest-core");
    const trees = planForestGarnish(grid, BIOME_PROFILES["mixed-woodland"], 19);
    expect(trees.some((tree) => tree.species === "oak")).toBe(true);
    expect(trees.some((tree) => tree.species === "pine")).toBe(true);
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
    expect(a.every((tree) => tree.species === "pine")).toBe(true);
  });
});
