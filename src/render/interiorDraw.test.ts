import { describe, expect, it } from "vitest";
import { SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { applyCellDamage, createBuildingFromArchetype, stepStructures } from "../structure/building";
import { fixtureCatalog } from "../structure/interior";
import { neighborRoofBayOpen, roofFrameBeams } from "../structure/roof";
import { depthKey, roofPainterDepth } from "../world/iso";
import { getBuildingSurfaces, maxTopFloorWallFaceDepth } from "./buildingSurfaces";
import { interiorCmds, roofCommandDepth, roofShowsFrame } from "./interiorDraw";
import { wallSpanFadeRuns } from "./occlusion";
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
    const cmds = interiorCmds(b, 1);
    const kitchenFloors = cmds.filter((c) => c.kind === "floor");
    const fixtures = cmds.filter((c) => c.kind === "fixture");
    expect(kitchenFloors.length).toBeGreaterThan(0);
    expect(fixtures.length).toBeGreaterThan(0);
    expect(Math.min(...kitchenFloors.map((c) => c.depth))).toBeLessThan(Math.min(...fixtures.map((c) => c.depth)));
  });

  it("keeps a vehicle-sized marker in the back half of a slab above the floor", () => {
    const b = createBuildingFromArchetype("ranch", "CROSS", 0, 0);
    for (const gx of [1, 2, 3]) smash(b, gx, b.d - 1);
    const living = interiorCmds(b, 1).filter((c) => c.kind === "floor");
    expect(living.length).toBeGreaterThan(0);
    const floor = living[0]!;
    const cs = b.cellSize;
    const backX = b.x + 2.2 * cs;
    const backY = b.y + 0.35 * cs;
    expect(floor.depth).toBeLessThan(depthKey(backX, backY, 0.4));
  });

  it("draws exposed furniture and the surviving perimeter after a south breach", () => {
    const b = createBuildingFromArchetype("ranch", "STUB", 0, 0);
    smash(b, 2, b.d - 1);
    const cmds = interiorCmds(b, 1);
    const fixture = cmds.find((c) => c.kind === "fixture");
    const southStubs = cmds.filter((c) => c.kind === "stub");
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
    const cmds = interiorCmds(b, 1);
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
    expect(roofShowsFrame(b, south)).toBe(false);
    expect(roofShowsFrame(b, north)).toBe(false);
  });

  it("exposes framing on an intact bay only after the neighbor opening appears", () => {
    const b = createBuildingFromArchetype("ranch", "OPENING", 0, 0);
    const left = b.roofs.find((r) => r.support.some((s) => s.gx === 1 && s.gy === b.d - 1))!;
    const mid = b.roofs.find((r) => r.support.some((s) => s.gx === 2 && s.gy === b.d - 1))!;
    expect(roofShowsFrame(b, mid)).toBe(false);
    expect(neighborRoofBayOpen(b, mid, -1)).toBe(false);
    for (const cell of b.cells) {
      if (cell.gx === 1) smash(b, cell.gx, cell.gy);
    }
    for (let i = 0; i < Math.ceil(1.2 / SIM_DT); i++) stepStructures([b], SIM_DT, new ParticlePool(), []);
    expect(left.state === "gone" || left.state === "falling").toBe(true);
    expect(mid.state).toBe("intact");
    expect(neighborRoofBayOpen(b, mid, -1)).toBe(true);
    expect(roofShowsFrame(b, mid)).toBe(true);
  });

  it("draws rafters along the roof slope instead of a flat ladder", () => {
    const b = createBuildingFromArchetype("ranch", "RAFTERS", 0, 0);
    const south = b.roofs.find((r) => r.support.some((s) => s.gy === b.d - 1))!;
    const rise = roofFrameBeams(south)
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
    const floor = interiorCmds(b, 1).find((c) => c.kind === "floor");
    expect(floor).toBeDefined();
    const wallD = depthKey(b.x + 2.5 * b.cellSize, b.y + 2.9 * b.cellSize, 1.1);
    expect(floor!.depth).toBeLessThan(wallD);
  });
});

describe("gable roof sort vs eave walls", () => {
  const far = { x: -100, y: -100, heading: 0 };

  it.each(["cottage", "dairy-building", "gable-barn"] as const)(
    "paints every %s sloped panel after the long south/east wall faces",
    (id) => {
      const b = createBuildingFromArchetype(id, id.toUpperCase(), 0, 0);
      const wallDepth = maxTopFloorWallFaceDepth(b);
      expect(wallDepth).toBeGreaterThan(0);
      const live = b.roofs.filter((r) => r.style === "gable" && r.state !== "gone");
      expect(live.length).toBeGreaterThan(1);
      for (const roof of live) {
        const raw = roofPainterDepth(roof.verts);
        const command = roofCommandDepth(b, roof, roof.verts);
        expect(command).toBeGreaterThan(wallDepth);
        expect(command).toBeGreaterThanOrEqual(raw);
      }
      for (const span of getBuildingSurfaces(b).walls.filter((s) => s.floor === b.floors - 1)) {
        for (const run of wallSpanFadeRuns(b, span, far)) {
          for (const roof of live) {
            expect(roofCommandDepth(b, roof, roof.verts)).toBeGreaterThan(run.span.depth);
          }
        }
      }
    },
  );

  it("boosts far dairy bays that raw eave depth would leave behind the south wall", () => {
    const b = createBuildingFromArchetype("dairy-building", "DAIRY", 0, 0);
    const wallDepth = maxTopFloorWallFaceDepth(b);
    const behind = b.roofs.filter((r) => r.style === "gable" && roofPainterDepth(r.verts) <= wallDepth);
    expect(behind.length).toBeGreaterThan(0);
    for (const roof of behind) {
      expect(roofCommandDepth(b, roof, roof.verts)).toBeGreaterThan(wallDepth);
    }
  });
});
