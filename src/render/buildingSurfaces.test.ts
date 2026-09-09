import { describe, expect, it } from "vitest";
import { ParticlePool } from "../fx/particles";
import { applyCellDamage, createBuilding, createBuildingFromArchetype } from "../structure/building";
import {
  buildingSurfaceSignature,
  extractBuildingSurfaces,
  getBuildingSurfaces,
  southFacadeCells,
} from "./buildingSurfaces";

function intactWarehouse() {
  return createBuilding({
    kind: "industrial",
    name: "TEST",
    x: 0,
    y: 0,
    w: 4,
    d: 3,
    floors: 2,
    material: "concrete",
    roof: "shed",
  });
}

describe("building surface extraction", () => {
  it("culls internal faces between neighboring live cells", () => {
    const b = intactWarehouse();
    const s = extractBuildingSurfaces(b);
    const innerSouth = s.walls.filter((w) => w.dir === "south" && w.gy0 === 1 && w.gx0 === 1);
    expect(innerSouth.length).toBe(0);
  });

  it("does not emit a top under a live upper cell", () => {
    const b = intactWarehouse();
    const s = extractBuildingSurfaces(b);
    const groundTops = s.tops.filter((t) => t.floor === 0);
    expect(groundTops.length).toBe(0);
  });

  it("emits a top for an uncovered one-story extension", () => {
    const b = createBuildingFromArchetype("porch-house", "PORCH", 0, 0);
    const s = extractBuildingSurfaces(b);
    expect(s.tops.some((t) => t.floor === 0)).toBe(true);
  });

  it("skips top caps where a live roof covers the cell", () => {
    const b = createBuildingFromArchetype("cottage", "COTTAGE", 0, 0);
    const s = extractBuildingSurfaces(b);
    expect(s.tops.filter((t) => t.floor === b.floors - 1).length).toBe(0);
  });

  it("merges adjacent compatible south faces into one span", () => {
    const b = intactWarehouse();
    const s = extractBuildingSurfaces(b);
    const southRow = s.walls.filter((w) => w.dir === "south" && w.gy0 === b.d - 1 && w.floor === 0);
    expect(southRow.some((w) => w.gx1 - w.gx0 + 1 >= 3)).toBe(true);
  });

  it("splits intact spans when a breach interrupts the row", () => {
    const b = intactWarehouse();
    const mid = Math.floor(b.w / 2);
    applyCellDamage(b, b.grid[0]![mid]![b.d - 1]!, 999, 0, 1, new ParticlePool(), []);
    const s = extractBuildingSurfaces(b);
    const southRow = s.walls.filter((w) => w.dir === "south" && w.gy0 === b.d - 1 && w.floor === 0);
    expect(southRow.length).toBeGreaterThanOrEqual(2);
    expect(s.breaches.length).toBeGreaterThan(0);
  });

  it("is deterministic for the same building state", () => {
    const b = intactWarehouse();
    const a = extractBuildingSurfaces(b);
    const c = extractBuildingSurfaces(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
    expect(buildingSurfaceSignature(b)).toBe(buildingSurfaceSignature(b));
  });

  it("caches surfaces until the signature changes", () => {
    const b = intactWarehouse();
    const first = getBuildingSurfaces(b);
    const second = getBuildingSurfaces(b);
    expect(first).toBe(second);
    applyCellDamage(b, b.grid[0]![0]![0]!, 40, 1, 0, new ParticlePool(), []);
    const third = getBuildingSurfaces(b);
    expect(third).not.toBe(first);
  });

  it("only decorates exposed south facade cells", () => {
    const b = createBuildingFromArchetype("storefront", "SHOP", 0, 0);
    const s = extractBuildingSurfaces(b);
    const south = s.walls.find((w) => w.dir === "south" && w.floor === 0);
    expect(south).toBeDefined();
    const cells = southFacadeCells(b, south!);
    expect(cells.every((c) => c.gy === b.d - 1)).toBe(true);
    expect(cells.some((c) => c.doorS || c.windowS)).toBe(true);
  });
});
