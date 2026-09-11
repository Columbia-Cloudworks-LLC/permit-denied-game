import { describe, expect, it } from "vitest";
import { ParticlePool } from "../fx/particles";
import { SIM_DT } from "../game/constants";
import { applyCellDamage, createBuilding, createBuildingFromArchetype, stepStructures } from "./building";
import { archetypeById, ARCHETYPES } from "../world/archetypes";
const brick = archetypeById("rivertown");
import { fixtureExposed, fixtureSolid, fixtureSupported, interiorFloorCoverage } from "./interior";
import { displacedRoofVerts, roofCoverage, neighborRoofBayOpen } from "./roof";
import { cellWorldBox, type Building } from "./types";
import { getAsset } from "../world/catalog";

const particles = () => new ParticlePool();
function settle(b: Building, seconds = 2): void {
  const pool = particles();
  for (let i = 0; i < seconds / SIM_DT; i++) stepStructures([b], SIM_DT, pool, []);
}
function smash(b: Building, floor: number, gx: number, gy: number): void {
  applyCellDamage(b, b.grid[floor]![gx]![gy]!, 999, 0, 1, particles(), []);
}

describe("shared building construction", () => {
  it("rejects invalid content recipes before generation", () => {
    const invalid = { ...brick.layout, rooms: [{ ...brick.layout.rooms[0]!, x: .95 }] };
    expect(() => createBuilding({ kind: "shop", name: "BAD", x: 0, y: 0, w: 5, d: 4, floors: 2,
      roof: "flat", construction: brick.construction, openings: brick.openings, layout: invalid })).toThrow("Invalid layout");
  });
  it("selects the complete interior and roof system through a definition, without an asset-id branch", () => {
    const b = createBuilding({ kind: "shop", name: "CUSTOM", x: 0, y: 0, w: 5, d: 4, floors: 2,
      roof: "flat", construction: { ...brick.construction, id: "another-town" }, layout: brick.layout, openings: brick.openings });
    expect(b.roofs.length).toBeGreaterThan(1);
    expect(b.fixtures.some(f => f.floor === 0 && f.room === "retail")).toBe(true);
    expect(b.fixtures.some(f => f.floor === 1 && f.room === "bedroom")).toBe(true);
    expect(b.fixtures.some(f => f.kind === "partition")).toBe(true);
  });

  it.each(["ranch", "rivertown", "steel-warehouse"])("keeps %s contents deterministic and within their scaled footprint", id => {
    for (const scale of [1, 1.5]) {
      const b = createBuildingFromArchetype(id, "A", 7, 11, { w: Math.round(6 * scale), d: Math.round(5 * scale) });
      const again = createBuildingFromArchetype(id, "A", 7, 11, { w: b.w, d: b.d });
      expect(b.fixtures).toEqual(again.fixtures);
      for (const f of b.fixtures) {
        expect(f.x).toBeGreaterThanOrEqual(b.x);
        expect(f.y).toBeGreaterThanOrEqual(b.y);
        expect(f.x + f.w).toBeLessThanOrEqual(b.x + b.w * b.cellSize + 1e-6);
        expect(f.y + f.d).toBeLessThanOrEqual(b.y + b.d * b.cellSize + 1e-6);
        expect(getAsset(`interior-${f.kind}`).hp).toBe(f.maxHp);
        expect(f.support.length).toBeGreaterThan(0);
      }
    }
  });

  it("has an open warehouse hall, independent floor, and roof coverage distinct from columns", () => {
    const b = createBuildingFromArchetype("steel-warehouse", "HALL", 0, 0);
    expect(b.grid[0]![2]![2]!.state).toBe("gone");
    expect(b.floorTiles).toHaveLength(b.w * b.d);
    expect(b.roofs.every(r => roofCoverage(r).length > r.support.length)).toBe(true);
    expect(b.roofs.every(r => r.support.every(s => b.grid[0]![s.gx]![s.gy]!.role === "column"))).toBe(true);
  });

  it("sheds cladding once without taking its column or roof down", () => {
    const b = createBuildingFromArchetype("steel-warehouse", "SKIN", 0, 0);
    const c = b.cells.find(c => c.role === "column" && c.gy === b.d - 1)!;
    const before = c.hp;
    applyCellDamage(b, c, c.cladding!.hp, 0, 1, particles(), []);
    expect(c.hp).toBe(before);
    expect(c.state).toBe("intact");
    expect(cellWorldBox(b, c).w).toBeLessThan(b.cellSize / 2);
    const first = stepStructures([b], SIM_DT, particles(), []);
    expect(first.rubbleSpawns).toHaveLength(1);
    const second = stepStructures([b], SIM_DT, particles(), []);
    expect(second.rubbleSpawns).toHaveLength(0);
    settle(b);
    expect(b.roofs.every(r => r.state === "intact")).toBe(true);
  });

  it("drops a locally unsupported roof bay and crushes its contents while leaving the far bay intact", () => {
    const b = createBuildingFromArchetype("steel-warehouse", "LOCAL", 0, 0);
    const roof = b.roofs[0]!, far = b.roofs.at(-1)!;
    for (const s of roof.support) smash(b, 0, s.gx, s.gy);
    settle(b);
    expect(roof.state).toBe("gone");
    expect(far.state).toBe("intact");
    expect(b.fixtures.some(f => f.broken)).toBe(true);
    expect(b.fixtures.some(f => !f.broken)).toBe(true);
    expect(b.floorTiles!.every(t => t.state === "intact")).toBe(true);
  });

  it("collapses upper slabs from their bearing walls and releases attached furniture", () => {
    const b = createBuildingFromArchetype("rivertown", "SLAB", 0, 0);
    const tile = b.floorTiles!.find(t => t.floor === 1 && t.gx === 0 && t.gy === 1)!;
    for (const s of tile.support) smash(b, 0, s.gx, s.gy);
    settle(b);
    expect(tile.state).toBe("gone");
    expect(b.floorTiles!.some(t => t.floor === 1 && t.state === "intact")).toBe(true);
    expect(b.fixtures.filter(f => f.floor === 1 && !fixtureSupported(b, f)).every(f => f.broken)).toBe(true);
    expect(interiorFloorCoverage(b).hasFloor(tile.gx, tile.gy, tile.floor)).toBe(false);
  });

  it("stops stepping a settled partial demolition despite old damage timers", () => {
    const b = createBuildingFromArchetype("ranch", "SETTLED", 0, 0);
    for (const c of b.cells.filter(c => c.gy === b.d - 1)) smash(b, c.floor, c.gx, c.gy);
    settle(b, 8);
    expect(b.fullyDown).toBe(false);
    expect(b.cells.some(c => c.state === "gone" && c.unsupportedTime > 0)).toBe(true);
    const stats = { stepped: 0, skipped: 0 };
    stepStructures([b], SIM_DT, particles(), [], stats);
    expect(stats).toEqual({ stepped: 0, skipped: 1 });
  });

  it("never adds upstairs furniture to ground-level vehicle collision", () => {
    const b = createBuildingFromArchetype("rivertown", "UPSTAIRS", 0, 0);
    for (const c of b.cells.filter(c => c.floor === 1 && c.gy === b.d - 1)) smash(b, 1, c.gx, c.gy);
    const exposed = b.fixtures.filter(f => f.floor === 1 && fixtureExposed(b, f));
    expect(exposed.length).toBeGreaterThan(0);
    expect(exposed.every(f => !fixtureSolid(b, f))).toBe(true);
  });

  it("opens hall floors and contents through a demolished wall, not only in reveal mode", () => {
    const b = createBuildingFromArchetype("steel-warehouse", "HALL-OPEN", 0, 0);
    expect(interiorFloorCoverage(b).hasFloor(2, 2, 0)).toBe(false);
    expect(b.fixtures.filter(f => f.floor === 0 && fixtureExposed(b, f))).toHaveLength(0);
    for (const c of b.cells.filter(c => c.floor === 0 && c.gy === b.d - 1)) smash(b, 0, c.gx, c.gy);
    expect(interiorFloorCoverage(b).hasFloor(2, 2, 0)).toBe(true);
    const exposed = b.fixtures.filter(f => f.floor === 0 && fixtureExposed(b, f));
    expect(exposed.length).toBeGreaterThan(0);
    expect(exposed.some(f => fixtureSolid(b, f))).toBe(true);
  });

  it("starts the fall continuously from the sagged pose", () => {
    const b = createBuildingFromArchetype("ranch", "SAG", 0, 0);
    const roof = b.roofs[0]!;
    roof.sag = 1;
    const before = displacedRoofVerts(roof);
    roof.fallT = 1e-7;
    const after = displacedRoofVerts(roof);
    for (let i = 0; i < before.length; i++) expect(Math.abs(before[i]!.z - after[i]!.z)).toBeLessThan(1e-5);
  });

  it("segments gables along either ridge axis and recognizes adjacent bays", () => {
    const b = createBuildingFromArchetype("ranch", "ROTATED", 0, 0, { roofAxis: "y" });
    expect(b.roofs).toHaveLength(b.d * 2);
    const first = b.roofs[0]!, next = b.roofs[2]!;
    first.state = "gone";
    expect(neighborRoofBayOpen(b, next, -1)).toBe(true);
  });

  it.each(ARCHETYPES.map(a => a.id))("settles complete %s demolition without floating contents or repeating spawns", id => {
    const b = createBuildingFromArchetype(id, "DOWN", 0, 0);
    for (const c of b.cells) smash(b, c.floor, c.gx, c.gy);
    settle(b, 4);
    expect(b.fullyDown).toBe(true);
    expect(b.fixtures.every(f => f.broken)).toBe(true);
    const after = stepStructures([b], SIM_DT, particles(), []);
    expect(after.rubbleSpawns).toHaveLength(0);
    expect(after.fixtureFrags).toHaveLength(0);
    expect(after.cash).toBe(0);
  });
});
