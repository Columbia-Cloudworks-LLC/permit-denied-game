import { describe, expect, it } from "vitest";
import { FLOOR_Z, SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { createDozer } from "../vehicle/dozer";
import { createTown } from "../world/town";
import { stepWorld } from "../sim/worldSim";
import { applyCellDamage, createBuilding, createBuildingFromArchetype, stepStructures } from "./building";
import { gableEndCaps, gablePlanesSloped, generateRoofs, liveRoofCount, roofCoversOnlyOccupied, roofHeightAt } from "./roof";
import { fullMask } from "../world/archetypes";
import { depthKey, roofPainterDepth } from "../world/iso";
import { slopeFacingLight } from "../render/drawIso";

describe("structural roofs", () => {
  it("builds two sloped gable planes that share a ridge", () => {
    const b = createBuildingFromArchetype("cottage", "TEST COTTAGE", 0, 0);
    expect(b.roofs.filter((r) => r.style === "gable")).toHaveLength(2);
    expect(gablePlanesSloped(b.roofs)).toBe(true);
    const zs = b.roofs.flatMap((r) => r.verts.map((v) => v.z));
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.5);
    const front = b.roofs.reduce((best, roof) => {
      const score = Math.max(...roof.verts.map((v) => v.x + v.y));
      const bestScore = Math.max(...best.verts.map((v) => v.x + v.y));
      return score > bestScore ? roof : best;
    });
    const ridgeZ = Math.max(...front.verts.map((v) => v.z));
    const eaveDepth = Math.max(
      ...front.verts.filter((v) => v.z < ridgeZ - 0.2).map((v) => depthKey(v.x, v.y, v.z)),
    );
    const ridgeDepth = Math.max(
      ...front.verts.filter((v) => v.z >= ridgeZ - 0.2).map((v) => depthKey(v.x, v.y, v.z)),
    );
    expect(eaveDepth).toBeGreaterThan(ridgeDepth);
    expect(roofPainterDepth(front.verts)).toBeGreaterThanOrEqual(eaveDepth);
    const frontCell = b.cells
      .filter((c) => c.floor === b.floors - 1)
      .reduce((best, c) => (c.gx + c.gy > best.gx + best.gy ? c : best));
    const wallDepth = depthKey(
      b.x + (frontCell.gx + 0.5) * b.cellSize,
      b.y + (frontCell.gy + 0.5) * b.cellSize,
      frontCell.floor * FLOOR_Z,
    );
    expect(roofPainterDepth(front.verts)).toBeGreaterThan(wallDepth);
    const lights = b.roofs.filter((r) => r.style === "gable").map((r) => slopeFacingLight(r.verts));
    expect(Math.max(...lights)).toBeGreaterThan(0);
    expect(Math.min(...lights)).toBeLessThan(0);
  });

  it("places roof sections only over occupied top-floor cells", () => {
    const mask = fullMask(2, 4, 3);
    for (let gy = 0; gy < 3; gy++) mask[1]![0]![gy] = false;
    const b = createBuilding({
      kind: "house",
      name: "NOTCH",
      x: 0,
      y: 0,
      w: 4,
      d: 3,
      floors: 2,
      material: "wood",
      roof: "gable",
      mask,
    });
    expect(roofCoversOnlyOccupied(b)).toBe(true);
    for (const roof of b.roofs) {
      expect(roof.support.some((s) => s.gx === 0)).toBe(false);
    }
  });

  it("collapses a roof section after its local top-floor support is removed", () => {
    const b = createBuildingFromArchetype("walkup", "LOCAL", 0, 0);
    const target = b.roofs[0]!;
    const particles = new ParticlePool();
    for (const s of target.support) {
      const cell = b.grid[b.floors - 1]![s.gx]![s.gy]!;
      applyCellDamage(b, cell, 999, 1, 0, particles, []);
    }
    const steps = Math.ceil(2 / SIM_DT);
    for (let i = 0; i < steps; i++) stepStructures([b], SIM_DT, particles, []);
    expect(target.state).toBe("gone");
    expect(b.roofs.some((r) => r.id !== target.id && r.state !== "gone")).toBe(true);
  });

  it("fails remaining roof sections together when most support is lost", () => {
    const b = createBuildingFromArchetype("ranch", "WIDE", 0, 0);
    const particles = new ParticlePool();
    const top = b.floors - 1;
    let n = 0;
    for (const cell of b.cells) {
      if (cell.floor !== top) continue;
      n++;
      if (n <= Math.ceil(b.cells.filter((c) => c.floor === top).length * 0.75)) {
        applyCellDamage(b, cell, 999, 0, 1, particles, []);
      }
    }
    for (let i = 0; i < Math.ceil(2.2 / SIM_DT); i++) stepStructures([b], SIM_DT, particles, []);
    expect(liveRoofCount(b)).toBe(0);
  });

  it("spawns roof debris and mass without a second building bonus", () => {
    const town = createTown();
    const house = town.buildings[0]!;
    const particles = new ParticlePool();
    for (const cell of house.cells) applyCellDamage(house, cell, 999, 0, 1, particles, []);
    const dozer = createDozer(town.maxX - 2, town.maxY - 2, 0);
    let cashEvents = 0;
    for (let i = 0; i < 360; i++) {
      const out = stepWorld(town, dozer, particles, { blade: 0, engine: 0, push: 0 }, SIM_DT);
      cashEvents += out.events.filter((e) => e.kind === "cash" && e.cash === 140).length;
    }
    expect(house.fullyDown).toBe(true);
    expect(house.roofs.every((r) => r.state === "gone")).toBe(true);
    expect(cashEvents).toBe(1);
    expect(town.rubble.length + town.pile.totalMass()).toBeGreaterThan(1);
  });

  it("samples roof-plane height below the ridge and fills the gable end", () => {
    const b = createBuildingFromArchetype("cottage", "FLUSH", 0, 0);
    const zs = b.roofs.flatMap((r) => r.verts.map((v) => v.z));
    const eaveZ = Math.min(...zs);
    const ridgeZ = Math.max(...zs);
    const cx = b.x + (b.w - 0.4) * b.cellSize;
    const cy = b.y + 0.28;
    const z = roofHeightAt(b, cx, cy);
    expect(z).not.toBeNull();
    expect(z!).toBeGreaterThan(eaveZ - 0.05);
    expect(z!).toBeLessThan(ridgeZ - 0.15);
    const caps = gableEndCaps(b);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.face).toBe("east");
    expect(caps[0]!.peak.z).toBeGreaterThan(caps[0]!.a.z + 0.5);
    expect(caps[0]!.peak.x).toBeCloseTo(b.x + b.w * b.cellSize, 5);
    const walk = createBuildingFromArchetype("walkup", "END", 10, 10);
    expect(gableEndCaps(walk)[0]?.face).toBe("south");
  });

  it("regenerates the same gable geometry for the same footprint", () => {
    const a = createBuildingFromArchetype("cottage", "A", 4, 5);
    const b = createBuildingFromArchetype("cottage", "B", 4, 5);
    expect(generateRoofs(a).map((r) => r.verts.map((v) => `${v.x}:${v.y}:${v.z}`).join("/"))).toEqual(
      generateRoofs(b).map((r) => r.verts.map((v) => `${v.x}:${v.y}:${v.z}`).join("/")),
    );
  });
});
