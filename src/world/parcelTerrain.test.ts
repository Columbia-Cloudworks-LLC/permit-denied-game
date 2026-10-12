import { describe, expect, it } from "vitest";
import { campaignLevelById } from "../game/campaign";
import { selectBiome } from "./biomes";
import { validateTown } from "./districts";
import { pointOnRoad, publicStreetsReachable } from "./roads";
import { createTown } from "./town";
import {
  estimateRuralSurfaceBounds,
  generateSurfaceGrid,
  SURFACE_ID,
  lotEnvelopeRejected,
  surfaceAt,
} from "./terrain";

const FRONTAGE_SEEDS = [19, 1, 77, 1001] as const;

function originalFrontageGrid(seed: number) {
  const originX = 4;
  const originY = 4;
  const biome = selectBiome("d10", seed, "frontage");
  const bounds = estimateRuralSurfaceBounds(10, originX, originY, 40, 36);
  return generateSurfaceGrid({
    seed,
    biome,
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    spawnBand: { x: originX + 2, y: originY + 8, w: 18, d: 18 },
  });
}

function inExpandedBox(
  x: number,
  y: number,
  bx: number,
  by: number,
  bw: number,
  bd: number,
  pad: number,
): boolean {
  return x >= bx - pad && y >= by - pad && x <= bx + bw + pad && y <= by + bd + pad;
}

function waterComponents(grid: ReturnType<typeof generateSurfaceGrid>): { cellId: Int32Array; sizeOf: number[] } {
  const cellId = new Int32Array(grid.surface.length);
  cellId.fill(-1);
  const sizeOf = [0];
  let nextId = 0;
  const seen = new Uint8Array(grid.surface.length);
  for (let start = 0; start < grid.surface.length; start++) {
    if (seen[start] || grid.surface[start] !== SURFACE_ID.water) continue;
    const id = nextId++;
    const cells = floodWater(grid, start, seen);
    sizeOf[id] = cells.length;
    for (const i of cells) cellId[i] = id;
  }
  return { cellId, sizeOf };
}

function floodWater(grid: ReturnType<typeof generateSurfaceGrid>, start: number, seen: Uint8Array): number[] {
  const cells: number[] = [];
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const i = q.pop()!;
    cells.push(i);
    const ix = i % grid.cols;
    const iy = (i / grid.cols) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const j = waterNeighbour(grid, ix + dx, iy + dy, seen);
      if (j < 0) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return cells;
}

function waterNeighbour(grid: ReturnType<typeof generateSurfaceGrid>, jx: number, jy: number, seen: Uint8Array): number {
  if (jx < 0 || jy < 0 || jx >= grid.cols || jy >= grid.rows) return -1;
  const j = jy * grid.cols + jx;
  return seen[j] || grid.surface[j] !== SURFACE_ID.water ? -1 : j;
}

type FrontageTown = ReturnType<typeof createTown>;
type OriginalGrid = ReturnType<typeof originalFrontageGrid>;

/** On a road or within 0.35 of a building: places where development may legitimately clear water. */
function onAccess(town: FrontageTown, x: number, y: number): boolean {
  return pointOnRoad(town.network, x, y) ||
    town.buildings.some((b) => inExpandedBox(x, y, b.x, b.y, b.w * b.cellSize, b.d * b.cellSize, 0.35));
}

/** Original water cells per component that development had no reason to clear. */
function waterKeepCounts(original: OriginalGrid, town: FrontageTown, cellId: Int32Array, cols: number, rows: number): Map<number, number> {
  const keepCount = new Map<number, number>();
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      if (original.surface[iy * original.cols + ix] !== SURFACE_ID.water) continue;
      const id = cellId[iy * original.cols + ix]!;
      if (onAccess(town, original.ox + (ix + 0.5) * original.cell, original.oy + (iy + 0.5) * original.cell)) continue;
      keepCount.set(id, (keepCount.get(id) ?? 0) + 1);
    }
  }
  return keepCount;
}

/** Whether an original water cell of a sizeable kept pond, inside a lot but off any access, lost its water. */
function yardWaterErased(original: OriginalGrid, town: FrontageTown, ix: number, iy: number, sizeOf: readonly number[], cellId: Int32Array, keepCount: ReadonlyMap<number, number>): boolean {
  if (original.surface[iy * original.cols + ix] !== SURFACE_ID.water) return false;
  const id = cellId[iy * original.cols + ix]!;
  if ((sizeOf[id] ?? 0) < 8 || (keepCount.get(id) ?? 0) < 8) return false;
  const x = original.ox + (ix + 0.5) * original.cell;
  const y = original.oy + (iy + 0.5) * original.cell;
  if (!town.lots.some((lot) => inExpandedBox(x, y, lot.x, lot.y, lot.w, lot.d, 0))) return false;
  if (onAccess(town, x, y)) return false;
  const final = town.surface.surface[iy * town.surface.cols + ix];
  return final !== SURFACE_ID.water && final !== SURFACE_ID["wet-edge"];
}

describe("parcel placement vs original water", () => {
  it("consults the original surface and keeps buildable envelopes off water", () => {
    for (const seed of FRONTAGE_SEEDS) {
      const original = originalFrontageGrid(seed);
      const town = createTown({ district: "d10", seed, topology: "frontage" });
      const report = validateTown(town);
      expect(report.ok, `seed ${seed} ${report.issues.map((i) => i.detail).join("; ")}`).toBe(true);
      expect(town.buildings.length).toBe(10);
      expect(publicStreetsReachable(town.network, town.roadSpawnX, town.roadSpawnY)).toBe(true);

      for (const lot of town.lots) {
        expect(lotEnvelopeRejected(original, lot), `${lot.id} seed ${seed}`).toBe(false);
        expect(surfaceAt(town.surface, lot.buildable.x + lot.buildable.w * 0.5, lot.buildable.y + lot.buildable.d * 0.5)).not.toBe("water");
      }
    }
  });

  it("keeps original water cells that are only covered by a lot AABB", () => {
    for (const seed of FRONTAGE_SEEDS) {
      const original = originalFrontageGrid(seed);
      const town = createTown({ district: "d10", seed, topology: "frontage" });
      const { cellId, sizeOf } = waterComponents(original);
      const cols = Math.min(original.cols, town.surface.cols);
      const rows = Math.min(original.rows, town.surface.rows);
      const keepCount = waterKeepCounts(original, town, cellId, cols, rows);
      let erasedYardWater = 0;
      for (let iy = 0; iy < rows; iy++) {
        for (let ix = 0; ix < cols; ix++) {
          if (yardWaterErased(original, town, ix, iy, sizeOf, cellId, keepCount)) erasedYardWater++;
        }
      }
      expect(erasedYardWater, `seed ${seed} erased ${erasedYardWater} yard water cells`).toBeLessThan(8);
    }
  });

  it("still places a reachable County landmark after water-aware allocation", () => {
    const level = campaignLevelById("county");
    const town = createTown({ district: "d30", seed: 19, campaign: level });
    const again = createTown({ district: "d30", seed: 19, campaign: level });
    expect(validateTown(town).ok).toBe(true);
    expect(town.buildings.some((b) => b.campaignLandmark)).toBe(true);
    expect(town.buildings.length).toBe(level.generation.buildingCount);
    expect(town.surface.surface.length).toBe(again.surface.surface.length);
    expect(Array.from(town.surface.surface)).toEqual(Array.from(again.surface.surface));
  });
});
