import { describe, expect, it } from "vitest";
import { BIOME_PROFILES, selectBiome } from "./biomes";
import { createTown } from "./town";
import {
  TERRAIN_GEN_VERSION,
  SURFACE_CHUNK,
  hashSurfaceBytes,
  isolatedBaseCellCount,
  lotCostAt,
  naturalCellTotal,
  countNatural,
  roadCostAt,
  traversalAt,
  type TerrainSurface,
} from "./terrain";

describe("terrain surface grid", () => {
  it("builds a d100 surface and stays within the cell cap", () => {
    const t0 = performance.now();
    const town = createTown({ district: "d100", seed: 9 });
    const ms = performance.now() - t0;
    expect(town.surface).toBeDefined();
    expect(town.surface.cols * town.surface.rows).toBeLessThanOrEqual(512 * 512);
    expect(town.surface.cols).toBeGreaterThan(8);
    expect(town.ground.some((g) => g.w === 6.2 || g.z === -0.02)).toBe(false);
    const budget = 8000;
    expect(ms).toBeLessThan(budget);
  });

  it("removes isolated 1-cell base regions after smoothing", () => {
    const town = createTown({ district: "d10", seed: 19 });
    expect(isolatedBaseCellCount(town.surface)).toBe(0);
  });

  it("is deterministic for seed, district, biome, and version", () => {
    const a = createTown({ district: "d10", seed: 19, topology: "county" });
    const b = createTown({ district: "d10", seed: 19, topology: "county" });
    expect(a.biome.id).toBe(b.biome.id);
    expect(TERRAIN_GEN_VERSION).toBe(1);
    expect(hashSurfaceBytes(a.surface.surface)).toBe(hashSurfaceBytes(b.surface.surface));
    expect(hashSurfaceBytes(a.surface.variant)).toBe(hashSurfaceBytes(b.surface.variant));
    const other = createTown({ district: "d10", seed: 20, topology: "county" });
    expect(hashSurfaceBytes(other.surface.surface)).not.toBe(hashSurfaceBytes(a.surface.surface));
  });

  it("matches the locked cost and traversal table", () => {
    const town = createTown({ district: "d10", seed: 19 });
    const grid = town.surface;
    const samples: Record<TerrainSurface, { x: number; y: number } | undefined> = {
      grass: undefined,
      scrub: undefined,
      dirt: undefined,
      prairie: undefined,
      duff: undefined,
      "leaf-litter": undefined,
      gravel: undefined,
      "forest-floor": undefined,
      "forest-core": undefined,
      field: undefined,
      "wet-edge": undefined,
      water: undefined,
      developed: undefined,
    };
    for (let iy = 0; iy < grid.rows; iy++) {
      for (let ix = 0; ix < grid.cols; ix++) {
        const x = grid.ox + ix + 0.5;
        const y = grid.oy + iy + 0.5;
        const name = town.surface.surface[iy * grid.cols + ix]!;
        const surface = (
          [
            "grass",
            "scrub",
            "dirt",
            "prairie",
            "duff",
            "leaf-litter",
            "gravel",
            "forest-floor",
            "forest-core",
            "field",
            "wet-edge",
            "water",
            "developed",
          ] as const
        )[name]!;
        samples[surface] ??= { x, y };
      }
    }
    const table: Array<[TerrainSurface, number, number | "farm", ReturnType<typeof traversalAt>]> = [
      ["grass", 1, 1, "open"],
      ["scrub", 1.15, 1, "open"],
      ["dirt", 1, 1, "open"],
      ["prairie", 1.3, 1, "open"],
      ["duff", 1.4, 1, "open"],
      ["leaf-litter", 1.2, 1, "open"],
      ["gravel", 0.85, 1, "open"],
      ["forest-floor", 2.8, 4, "open"],
      ["forest-core", Infinity, Infinity, "forest-core"],
      ["field", 2.2, Infinity, "open"],
      ["wet-edge", 3.5, Infinity, "open"],
      ["water", Infinity, Infinity, "water"],
      ["developed", 0.5, 1, "open"],
    ];
    for (const [surface, road, lot, trav] of table) {
      const p = samples[surface];
      if (!p) continue;
      expect(roadCostAt(grid, p.x, p.y)).toBe(road);
      expect(lotCostAt(grid, p.x, p.y, "residence")).toBe(lot === "farm" ? 0.9 : lot);
      if (surface === "field") expect(lotCostAt(grid, p.x, p.y, "farm")).toBe(0.8);
      expect(traversalAt(grid, p.x, p.y)).toBe(trav);
    }
  });

  it("shows each biome's three bases on a d10 fixture", () => {
    const fixtures: Array<{ topology: "curve-farm" | "tjunction" | "county" | "loop"; seed: number }> = [
      { topology: "curve-farm", seed: 334353 },
      { topology: "tjunction", seed: 1 },
      { topology: "county", seed: 19 },
      { topology: "loop", seed: 77 },
    ];
    const seen = new Set<string>();
    for (const fixture of fixtures) {
      const biome = selectBiome("d10", fixture.seed, fixture.topology);
      const town = createTown({ district: "d10", seed: fixture.seed, topology: fixture.topology });
      expect(town.biome.id).toBe(biome.id);
      const counts = countNatural(town.surface);
      const natural = naturalCellTotal(town.surface);
      for (const base of biome.groundCover) {
        expect(counts[base] / Math.max(1, natural)).toBeGreaterThanOrEqual(0.05);
      }
      seen.add(biome.id);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(BIOME_PROFILES["northern-conifer"].groundCover).toEqual(["duff", "scrub", "grass"]);
  });

  it("stamps lot pads as developed without covering water", () => {
    const town = createTown({ district: "d10", seed: 19 });
    for (const lot of town.lots) {
      const x = lot.x + lot.w * 0.5;
      const y = lot.y + lot.d * 0.5;
      const t = traversalAt(town.surface, x, y);
      expect(t).not.toBe("water");
      expect(t).not.toBe("forest-core");
    }
  });

  it("keeps chunk math aligned with the locked size", () => {
    const town = createTown({ district: "d30", seed: 19 });
    const chunks = Math.ceil(town.surface.cols / SURFACE_CHUNK) * Math.ceil(town.surface.rows / SURFACE_CHUNK);
    expect(chunks).toBeLessThanOrEqual(512);
  });
});
