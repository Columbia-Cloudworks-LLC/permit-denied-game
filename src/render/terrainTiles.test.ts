import { describe, expect, it } from "vitest";
import { emptyGrassGrid, SURFACE_ID } from "../world/terrain";
import { BLOB_CARDINAL_INDEX, BLOB_FULL_INDEX, blob47Masks, blobIndex47, describeCell, terrainSolidFrame } from "./terrainTiles";

describe("autotile blob mask", () => {
  it("compacts the 8-neighbor bitmask to 47 unique indices", () => {
    expect(blob47Masks()).toHaveLength(47);
    expect(new Set(blob47Masks()).size).toBe(47);
  });

  it("maps a documented 3×3 cardinal fixture to a stable 47-index", () => {
    // . M .
    // M C M
    // . M .
    expect(blobIndex47(true, false, true, false, true, false, true, false)).toBe(BLOB_CARDINAL_INDEX);
    expect(BLOB_CARDINAL_INDEX).toBeGreaterThanOrEqual(0);
    expect(BLOB_CARDINAL_INDEX).toBeLessThan(47);
  });

  it("maps a fully surrounded 3×3 fixture to the last blob index", () => {
    expect(blobIndex47(true, true, true, true, true, true, true, true)).toBe(BLOB_FULL_INDEX);
    expect(BLOB_FULL_INDEX).toBe(46);
  });
});

describe("snow terrain frames", () => {
  it("prefixes soft solids with snow- and leaves water on the clear atlas", () => {
    expect(terrainSolidFrame("grass", 1, "clear")).toBe("grass-1");
    expect(terrainSolidFrame("grass", 1, "snow")).toBe("snow-grass-1");
    expect(terrainSolidFrame("duff", 0, "snow")).toBe("snow-duff-0");
    expect(terrainSolidFrame("gravel", 2, "snow")).toBe("snow-gravel-2");
    expect(terrainSolidFrame("water", 1, "snow")).toBe("water-1");
  });

  it("skips green overlays on snow maps so lot pads can blend into winter ground", () => {
    const grid = emptyGrassGrid(0, 0, 2, 2);
    grid.surface[0] = SURFACE_ID.grass;
    grid.variant[0] = 1;
    expect(describeCell(grid, 0, 0, "clear")?.base).toBe("grass-1");
    expect(describeCell(grid, 0, 0, "snow")).toEqual({ base: "snow-grass-1" });

    grid.surface[0] = SURFACE_ID.developed;
    expect(describeCell(grid, 0, 0, "snow")).toEqual({ base: "snow-gravel-1" });
    expect(describeCell(grid, 0, 0, "clear")).toEqual({ base: "gravel-1" });

    grid.surface[0] = SURFACE_ID["forest-core"];
    expect(describeCell(grid, 0, 0, "clear")).toEqual({ base: "duff-1" });
    expect(describeCell(grid, 0, 0, "snow")).toEqual({ base: "snow-duff-1" });
    grid.surface[0] = SURFACE_ID["forest-floor"];
    expect(describeCell(grid, 0, 0, "snow")).toEqual({ base: "snow-duff-1" });

    grid.surface[0] = SURFACE_ID.water;
    const waterSnow = describeCell(grid, 0, 0, "snow");
    expect(waterSnow?.base).toBe("water-1");
    expect(waterSnow?.overlay).toBeDefined();

    grid.surface.fill(SURFACE_ID.field);
    expect(describeCell(grid, 0, 0, "snow")).toEqual({ base: "snow-prairie-1" });
    expect(describeCell(grid, 0, 0, "clear")?.overlay).toMatch(/^field__/);
  });
});

describe("arid terrain tiles", () => {
  const grid = (surface: keyof typeof SURFACE_ID) => {
    const cell = emptyGrassGrid(0, 0, 1, 1);
    cell.surface[0] = SURFACE_ID[surface];
    return cell;
  };

  it("bares turf to dirt in a snowless desert and leaves water, fields and scrub alone", () => {
    for (const turf of ["grass", "prairie", "leaf-litter"] as const) {
      expect(describeCell(grid(turf), 0, 0, "clear", "summer", true)).toEqual({ base: "dirt-0" });
      // Autumn leaf litter never falls on desert floor.
      expect(describeCell(grid(turf), 0, 0, "clear", "autumn", true)).toEqual({ base: "dirt-0" });
    }
    expect(describeCell(grid("scrub"), 0, 0, "clear", "summer", true)?.base).toBe("scrub-0");
    expect(describeCell(grid("water"), 0, 0, "clear", "summer", true)?.base).toBe("water-0");
    expect(describeCell(grid("field"), 0, 0, "clear", "summer", true)).toEqual(describeCell(grid("field"), 0, 0, "clear", "summer"));
  });

  it("buries a high desert under snow like anywhere else", () => {
    expect(describeCell(grid("grass"), 0, 0, "snow", "winter", true)).toEqual({ base: "snow-grass-0" });
    expect(describeCell(grid("grass"), 0, 0, "clear", "summer")).toEqual(describeCell(grid("grass"), 0, 0, "clear", "summer", false));
  });
});
