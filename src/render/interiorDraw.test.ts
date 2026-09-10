import { describe, expect, it } from "vitest";
import { applyCellDamage, createBuildingFromArchetype } from "../structure/building";
import { fixtureCatalog } from "../structure/interior";
import { depthKey } from "../world/iso";
import { ParticlePool } from "../fx/particles";
import { ranchInteriorCmds, ranchRoofShowsRafters } from "./interiorDraw";
import { ranchRafterBeams } from "../structure/roof";
import { PAL } from "./palette";

function smash(b: ReturnType<typeof createBuildingFromArchetype>, gx: number, gy: number): void {
  applyCellDamage(b, b.grid[0]![gx]![gy]!, 999, 0, 1, new ParticlePool(), []);
}

describe("ranch interior draw order", () => {
  it("paints the kitchen slab behind the back-wall counter", () => {
    const b = createBuildingFromArchetype("ranch", "ORDER", 0, 0);
    for (const gy of [1, 2]) {
      smash(b, 0, gy);
      smash(b, 1, gy);
    }
    const cmds = ranchInteriorCmds(b, 1);
    const kitchenFloors = cmds.filter((c) => c.kind === "floor");
    const fixtures = cmds.filter((c) => c.kind === "fixture");
    expect(kitchenFloors.length).toBeGreaterThan(0);
    expect(fixtures.length).toBeGreaterThan(0);
    expect(Math.min(...kitchenFloors.map((c) => c.depth))).toBeLessThan(Math.min(...fixtures.map((c) => c.depth)));
  });

  it("keeps a vehicle-sized marker in the back half of a slab above the floor", () => {
    const b = createBuildingFromArchetype("ranch", "CROSS", 0, 0);
    for (const gx of [1, 2, 3]) smash(b, gx, b.d - 1);
    const living = ranchInteriorCmds(b, 1).filter((c) => c.kind === "floor");
    expect(living.length).toBeGreaterThan(0);
    const floor = living[0]!;
    const cs = b.cellSize;
    const backX = b.x + 2.2 * cs;
    const backY = b.y + 0.35 * cs;
    expect(floor.depth).toBeLessThan(depthKey(backX, backY, 0.4));
  });

  it("gives a south wall stub a later depth than furniture behind it", () => {
    const b = createBuildingFromArchetype("ranch", "STUB", 0, 0);
    smash(b, 2, 1);
    const cmds = ranchInteriorCmds(b, 1);
    const fixture = cmds.find((c) => c.kind === "fixture");
    const southStubs = cmds.filter((c) => c.kind === "stub" && c.depth > (fixture?.depth ?? 0));
    expect(fixture).toBeDefined();
    expect(southStubs.length).toBeGreaterThan(0);
  });
});

describe("broken fixture remnants", () => {
  it("keeps ceramic, metal, and wood remnants on their catalog finishes", () => {
    expect(fixtureCatalog("toilet").finish).toBe("ceramic");
    expect(fixtureCatalog("radiator").finish).toBe("metal");
    expect(fixtureCatalog("cabinet").finish).toBe("wood");
    expect(PAL.ceramic).not.toBe(PAL.wood);
    expect(PAL.metal).not.toBe(PAL.wood);
    const b = createBuildingFromArchetype("ranch", "REMNANT", 0, 0);
    smash(b, 4, 0);
    const toilet = b.fixtures.find((f) => f.kind === "toilet")!;
    toilet.broken = true;
    const cmds = ranchInteriorCmds(b, 1);
    expect(cmds.some((c) => c.kind === "fixture")).toBe(true);
  });
});

describe("ranch roof framing", () => {
  it("does not hide an intact roof bay when a south wall opens", () => {
    const b = createBuildingFromArchetype("ranch", "ROOF STAYS", 0, 0);
    smash(b, 2, b.d - 1);
    const south = b.roofs.find((r) => r.support.some((s) => s.gx === 2 && s.gy === b.d - 1))!;
    const north = b.roofs.find((r) => r.support.some((s) => s.gx === 2 && s.gy === 0))!;
    expect(south.state).toBe("intact");
    expect(north.state).toBe("intact");
    expect(ranchRoofShowsRafters(b, south)).toBe(false);
    expect(ranchRoofShowsRafters(b, north)).toBe(false);
  });

  it("draws rafters along the roof slope instead of a flat ladder", () => {
    const b = createBuildingFromArchetype("ranch", "RAFTERS", 0, 0);
    const south = b.roofs.find((r) => r.support.some((s) => s.gy === b.d - 1))!;
    const rise = ranchRafterBeams(south)
      .filter((beam) => beam.kind === "rafter")
      .map((beam) => Math.abs(beam.b.z - beam.a.z));
    expect(rise.length).toBe(3);
    expect(Math.min(...rise)).toBeGreaterThan(0.35);
  });
});

describe("ranch interior depth vs facades", () => {
  it("keeps floor painter depth behind a south-edge wall at the same cells", () => {
    const b = createBuildingFromArchetype("ranch", "FACADE", 0, 0);
    smash(b, 2, 2);
    const floor = ranchInteriorCmds(b, 1).find((c) => c.kind === "floor");
    expect(floor).toBeDefined();
    const wallD = depthKey(b.x + 2.5 * b.cellSize, b.y + 2.9 * b.cellSize, 1.1);
    expect(floor!.depth).toBeLessThan(wallD);
  });
});
