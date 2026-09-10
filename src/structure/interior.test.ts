import { describe, expect, it } from "vitest";
import { SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { extractBuildingSurfaces } from "../render/buildingSurfaces";
import { ranchRoofShowsRafters } from "../render/interiorDraw";
import { applyCellDamage, createBuildingFromArchetype, stepStructures } from "./building";
import {
  cellDrawsRanchFloor,
  cellHasFloor,
  cellInteriorExposed,
  fixtureCatalog,
  fixtureSolid,
  fixtureSupported,
  generateInteriors,
  hasFurnishedInterior,
  ranchFloorCoverage,
  ranchFloorSpans,
  ranchRoomAt,
  stepInteriors,
} from "./interior";

function smashCell(b: ReturnType<typeof createBuildingFromArchetype>, gx: number, gy: number, floor = 0): void {
  applyCellDamage(b, b.grid[floor]![gx]![gy]!, 999, 0, 1, new ParticlePool(), []);
}

describe("ranch interiors", () => {
  it("furnishes only the ranch with kitchen, living, and bathroom sets", () => {
    const ranch = createBuildingFromArchetype("ranch", "RANCH", 0, 0);
    const cottage = createBuildingFromArchetype("cottage", "COTTAGE", 8, 0);
    expect(hasFurnishedInterior(ranch)).toBe(true);
    expect(hasFurnishedInterior(cottage)).toBe(false);
    expect(cottage.fixtures).toEqual([]);
    const rooms = new Set(ranch.fixtures.map((f) => f.room));
    expect(rooms.has("kitchen")).toBe(true);
    expect(rooms.has("living")).toBe(true);
    expect(rooms.has("bathroom")).toBe(true);
    const kinds = new Set(ranch.fixtures.map((f) => f.kind));
    expect(kinds.has("cabinet")).toBe(true);
    expect(kinds.has("counter")).toBe(true);
    expect(kinds.has("toilet")).toBe(true);
    expect(kinds.has("sofa")).toBe(true);
    expect(kinds.has("table")).toBe(true);
    expect(kinds.has("radiator")).toBe(true);
    expect(ranchRoomAt(ranch, 0, 0)).toBe("kitchen");
    expect(ranchRoomAt(ranch, 2, 1)).toBe("living");
    expect(ranchRoomAt(ranch, 4, 2)).toBe("bathroom");
  });

  it("places the same fixtures for the same ranch footprint", () => {
    const a = createBuildingFromArchetype("ranch", "A", 4, 5);
    const b = createBuildingFromArchetype("ranch", "B", 4, 5);
    expect(generateInteriors(a).map((f) => `${f.kind}:${f.x}:${f.y}:${f.w}:${f.d}`)).toEqual(
      generateInteriors(b).map((f) => `${f.kind}:${f.x}:${f.y}:${f.w}:${f.d}`),
    );
  });

  it("exposes a breached cell and keeps furniture on a living floor", () => {
    const b = createBuildingFromArchetype("ranch", "BREACH", 0, 0);
    smashCell(b, 2, 2);
    expect(cellInteriorExposed(b, 2, 2, 0)).toBe(true);
    const sofa = b.fixtures.find((f) => f.kind === "sofa")!;
    expect(fixtureSupported(b, sofa)).toBe(true);
    expect(sofa.broken).toBe(false);
  });

  it("breaks fixtures when their supporting floor is gone and does not leave them floating", () => {
    const b = createBuildingFromArchetype("ranch", "DROP", 0, 0);
    const particles = new ParticlePool();
    for (const cell of b.cells) applyCellDamage(b, cell, 999, 0, 1, particles, []);
    for (let i = 0; i < Math.ceil(2.4 / SIM_DT); i++) stepStructures([b], SIM_DT, particles, []);
    expect(b.cells.every((c) => c.state === "gone" || c.state === "falling")).toBe(true);
    expect(b.fixtures.every((f) => f.broken)).toBe(true);
    expect(b.fixtures.every((f) => !fixtureSupported(b, f))).toBe(true);
  });

  it("uses one catalog entry for health, material, cash, and remnant finish", () => {
    const b = createBuildingFromArchetype("ranch", "CATALOG", 0, 0);
    const toilet = b.fixtures.find((f) => f.kind === "toilet")!;
    const radiator = b.fixtures.find((f) => f.kind === "radiator")!;
    const cabinet = b.fixtures.find((f) => f.kind === "cabinet")!;
    expect(toilet.material).toBe(fixtureCatalog("toilet").material);
    expect(toilet.maxHp).toBe(fixtureCatalog("toilet").hp);
    expect(fixtureCatalog("toilet").finish).toBe("ceramic");
    expect(fixtureCatalog("radiator").finish).toBe("metal");
    expect(fixtureCatalog("cabinet").finish).toBe("wood");
    expect(radiator.material).toBe("metal");
    expect(cabinet.material).toBe("wood");
    expect(fixtureCatalog("radiator").cash).toBeGreaterThan(fixtureCatalog("toilet").cash);
  });

  it("stops treating broken furnishings as solid blockers", () => {
    const b = createBuildingFromArchetype("ranch", "SOLID", 0, 0);
    smashCell(b, 4, 0);
    const toilet = b.fixtures.find((f) => f.kind === "toilet")!;
    expect(fixtureSolid(b, toilet)).toBe(true);
    toilet.broken = true;
    toilet.hp = 0;
    expect(fixtureSolid(b, toilet)).toBe(false);
    expect(fixtureSupported(b, toilet)).toBe(true);
  });

  it("breaks a fixture immediately after its last floor cell disappears", () => {
    const b = createBuildingFromArchetype("ranch", "TOILET", 0, 0);
    const toilet = b.fixtures.find((f) => f.kind === "toilet")!;
    const particles = new ParticlePool();
    for (const s of toilet.support) {
      const cell = b.grid[0]![s.gx]![s.gy]!;
      applyCellDamage(b, cell, 999, 1, 0, particles, []);
      cell.state = "gone";
    }
    const out = stepInteriors(b, particles, []);
    expect(toilet.broken).toBe(true);
    expect(out.frags.length).toBeGreaterThan(0);
  });
});

describe("ranch floor spans", () => {
  it("joins adjacent exposed cells of the same finish into one slab", () => {
    const b = createBuildingFromArchetype("ranch", "SLAB", 0, 0);
    smashCell(b, 2, 2);
    smashCell(b, 3, 2);
    const living = ranchFloorSpans(b).find((s) => s.finish === "plank");
    expect(living).toBeDefined();
    expect(living!.gx0).toBe(2);
    expect(living!.gx1).toBe(3);
    expect(living!.gy0).toBeLessThanOrEqual(2);
    expect(living!.gy1).toBe(2);
    expect((living!.gx1 - living!.gx0 + 1) * b.cellSize).toBeCloseTo(2 * b.cellSize, 5);
  });

  it("grows a same-finish block into one rectangle across rows", () => {
    const b = createBuildingFromArchetype("ranch", "BLOCK", 0, 0);
    for (const [gx, gy] of [
      [2, 1],
      [3, 1],
      [2, 2],
      [3, 2],
    ] as const) {
      const cell = b.grid[0]![gx]![gy]!;
      cell.state = "breached";
      cell.hp = 0;
    }
    const living = ranchFloorSpans(b).filter((s) => s.finish === "plank");
    expect(living).toHaveLength(1);
    const slab = living[0]!;
    expect(slab.gx0).toBe(2);
    expect(slab.gx1).toBe(3);
    expect(slab.gy1).toBe(2);
    expect(slab.gy1 - slab.gy0).toBeGreaterThanOrEqual(1);
    for (const [gx, gy] of [
      [2, 1],
      [3, 1],
      [2, 2],
      [3, 2],
    ] as const) {
      expect(gx).toBeGreaterThanOrEqual(slab.gx0);
      expect(gx).toBeLessThanOrEqual(slab.gx1);
      expect(gy).toBeGreaterThanOrEqual(slab.gy0);
      expect(gy).toBeLessThanOrEqual(slab.gy1);
    }
  });

  it("keeps room materials distinct but flush at the shared cell edge", () => {
    const b = createBuildingFromArchetype("ranch", "ROOMS", 0, 0);
    smashCell(b, 1, 2);
    smashCell(b, 2, 2);
    const kitchen = ranchFloorSpans(b).find((s) => s.finish === "linoleum");
    const living = ranchFloorSpans(b).find((s) => s.finish === "plank");
    expect(kitchen?.gx1).toBe(1);
    expect(living?.gx0).toBe(2);
    expect(kitchen?.gy1).toBe(2);
    expect(living?.gy1).toBe(2);
    expect(b.x + (kitchen!.gx1 + 1) * b.cellSize).toBeCloseTo(b.x + living!.gx0 * b.cellSize, 5);
  });

  it("reuses one coverage pass for spans and neighbor floor queries", () => {
    const b = createBuildingFromArchetype("ranch", "CACHE", 0, 0);
    smashCell(b, 2, 2);
    const first = ranchFloorCoverage(b);
    const second = ranchFloorCoverage(b);
    expect(second.spans).toBe(first.spans);
    expect(cellDrawsRanchFloor(b, 2, 2, 0)).toBe(true);
    expect(first.hasFloor(2, 2, 0)).toBe(true);
    smashCell(b, 3, 2);
    const after = ranchFloorCoverage(b);
    expect(after.spans).not.toBe(first.spans);
    expect(after.hasFloor(3, 2, 0)).toBe(true);
    expect(cellDrawsRanchFloor(b, 3, 2, 0)).toBe(true);
  });

  it("does not treat a surviving neighbor as a broken floor edge", () => {
    const b = createBuildingFromArchetype("ranch", "SEAM", 0, 0);
    smashCell(b, 2, 1);
    expect(cellInteriorExposed(b, 2, 1, 0)).toBe(true);
    expect(cellHasFloor(b.grid[0]![2]![0])).toBe(true);
    expect(cellHasFloor(b.grid[0]![2]![2])).toBe(true);
    expect(cellHasFloor(b.grid[0]![1]![1])).toBe(true);
    expect(cellHasFloor(b.grid[0]![3]![1])).toBe(true);
  });
});

describe("ranch roof bays", () => {
  it("splits the ranch gable into per-column bays", () => {
    const b = createBuildingFromArchetype("ranch", "BAYS", 0, 0);
    expect(b.roofs.length).toBeGreaterThan(2);
    expect(b.roofs.every((r) => r.style === "gable")).toBe(true);
    expect(extractBuildingSurfaces(b).tops.filter((t) => t.floor === 0)).toHaveLength(0);
  });

  it("opens a colored floor through a demolished south wall instead of a hollow shell", () => {
    const b = createBuildingFromArchetype("ranch", "HOLLOW", 0, 0);
    for (const gx of [1, 2, 3]) {
      const cell = b.grid[0]![gx]![b.d - 1]!;
      cell.state = "gone";
      cell.hp = 0;
    }
    expect(cellInteriorExposed(b, 2, 1, 0)).toBe(true);
    const living = ranchFloorSpans(b).find((s) => s.finish === "plank");
    expect(living).toBeDefined();
    expect(living!.gx0).toBeLessThanOrEqual(2);
    expect(living!.gx1).toBeGreaterThanOrEqual(2);
    expect(living!.gy1).toBe(2);
    const southWalls = extractBuildingSurfaces(b).walls.filter((w) => w.dir === "south" && w.gy0 === 1);
    expect(southWalls.some((w) => w.gx0 <= 2 && w.gx1 >= 2)).toBe(false);
    const southBay = b.roofs.find((r) => r.support.some((s) => s.gx === 2 && s.gy === b.d - 1))!;
    const northBay = b.roofs.find((r) => r.support.some((s) => s.gx === 2 && s.gy === 0))!;
    expect(southBay.state).toBe("intact");
    expect(northBay.state).toBe("intact");
    expect(ranchRoofShowsRafters(b, southBay)).toBe(false);
    expect(ranchRoofShowsRafters(b, northBay)).toBe(false);
    expect(living!.gx0).toBeLessThanOrEqual(2);
    expect(living!.gx1).toBeGreaterThanOrEqual(2);
  });

  it("drops the damaged south bay and leaves a far roof section standing", () => {
    const b = createBuildingFromArchetype("ranch", "LOCAL ROOF", 0, 0);
    const particles = new ParticlePool();
    smashCell(b, 0, b.d - 1);
    const hit = b.roofs.find((r) => r.support.some((s) => s.gx === 0 && s.gy === b.d - 1))!;
    const far = b.roofs.find((r) => r.support.every((s) => s.gx === b.w - 1))!;
    for (let i = 0; i < Math.ceil(1.2 / SIM_DT); i++) stepStructures([b], SIM_DT, particles, []);
    expect(hit.state === "gone" || hit.state === "falling").toBe(true);
    expect(far.state).toBe("intact");
  });
});
