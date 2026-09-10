import { describe, expect, it } from "vitest";
import { FLOOR_Z, SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { createDozer } from "../vehicle/dozer";
import { createTown } from "../world/town";
import { stepWorld } from "../sim/worldSim";
import { applyCellDamage, createBuilding, createBuildingFromArchetype, stepStructures } from "./building";
import {
  applyBrokenRoofEdge,
  displacedRoofVerts,
  gableEndCaps,
  gablePlanesSloped,
  gableWallVerts,
  gableZAlong,
  generateRoofs,
  liveRoofCount,
  ranchRafterBeams,
  roofCoversOnlyOccupied,
  roofHandoffPose,
  roofHeightAt,
  roofTiltAngle,
  sectionOwnsRidge,
  shedWallVerts,
} from "./roof";
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
    const eaveZ = Math.min(...b.roofs.flatMap((r) => r.verts.map((v) => v.z)));
    expect(eaveZ).toBeCloseTo(b.floors * FLOOR_Z, 5);
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

  it("raises shed walls to the sloped roof so the lot does not show through", () => {
    const b = createBuildingFromArchetype("warehouse", "SHED FILL", 0, 0);
    const story = b.floors * FLOOR_Z;
    const z0 = (b.floors - 1) * FLOOR_Z;
    const y1 = b.y + b.d * b.cellSize;
    const x1 = b.x + b.w * b.cellSize;
    const southZ = roofHeightAt(b, b.x + b.w * b.cellSize * 0.5, y1 - 0.04);
    expect(southZ).not.toBeNull();
    expect(southZ!).toBeGreaterThan(story + 0.4);
    const south = shedWallVerts(b, "south", b.x, x1, y1, z0);
    expect(south).not.toBeNull();
    expect(Math.max(...south!.map((v) => v.z))).toBeGreaterThan(story + 0.4);
    const east = shedWallVerts(b, "east", b.y, y1, x1, z0);
    expect(east).toHaveLength(4);
    const eastZs = east!.map((v) => v.z);
    expect(Math.max(...eastZs)).toBeGreaterThan(Math.min(...eastZs) + 0.3);
    expect(shedWallVerts(createBuildingFromArchetype("storefront", "FLAT", 4, 0), "south", 4, 8, 3, 0)).toBeNull();
  });

  it("sits flat roofs on the story top so the lot does not show through", () => {
    const shop = createBuildingFromArchetype("storefront", "FLAT LID", 0, 0);
    const zs = shop.roofs.flatMap((r) => r.verts.map((v) => v.z));
    expect(Math.min(...zs)).toBeCloseTo(shop.floors * FLOOR_Z, 5);
    expect(Math.max(...zs)).toBeCloseTo(shop.floors * FLOOR_Z, 5);
    const xs = shop.roofs.flatMap((r) => r.verts.map((v) => v.x));
    const ys = shop.roofs.flatMap((r) => r.verts.map((v) => v.y));
    expect(Math.min(...xs)).toBeLessThan(shop.x);
    expect(Math.max(...xs)).toBeGreaterThan(shop.x + shop.w * shop.cellSize);
    expect(Math.min(...ys)).toBeLessThan(shop.y);
    expect(Math.max(...ys)).toBeGreaterThan(shop.y + shop.d * shop.cellSize);
    const shed = createBuildingFromArchetype("warehouse", "SHED EAVE", 8, 0);
    const low = Math.min(...shed.roofs.flatMap((r) => r.verts.map((v) => v.z)));
    expect(low).toBeCloseTo(shed.floors * FLOOR_Z, 5);
  });

  it("joins the gable peak into one wall polygon instead of a floating triangle", () => {
    const b = createBuildingFromArchetype("cottage", "GABLE WALL", 0, 0);
    const cap = gableEndCaps(b)[0]!;
    const y0 = cap.a.y;
    const y1 = cap.b.y;
    const mid = (y0 + y1) * 0.5;
    expect(gableZAlong(cap, y0)).toBeCloseTo(cap.a.z, 5);
    expect(gableZAlong(cap, y1)).toBeCloseTo(cap.b.z, 5);
    expect(gableZAlong(cap, mid)).toBeCloseTo(cap.peak.z, 5);
    const z0 = (b.floors - 1) * FLOOR_Z;
    const full = gableWallVerts(cap, y0, y1, cap.a.x, z0);
    expect(full).toHaveLength(5);
    expect(Math.min(...full.map((v) => v.z))).toBe(z0);
    expect(Math.max(...full.map((v) => v.z))).toBeCloseTo(cap.peak.z, 5);
    const half = gableWallVerts(cap, y0, mid - 0.02, cap.a.x, z0);
    expect(half).toHaveLength(4);
    expect(gableZAlong(cap, (y0 + mid) * 0.5)).toBeGreaterThan(cap.a.z + 0.2);
    const walk = createBuildingFromArchetype("walkup", "SOUTH GABLE", 10, 10);
    const south = gableEndCaps(walk)[0]!;
    expect(south.face).toBe("south");
    const span = gableWallVerts(south, south.a.x, south.b.x, south.a.y, (walk.floors - 1) * FLOOR_Z);
    expect(span).toHaveLength(5);
  });

  it("clips each ranch bay ridge to the bay it owns", () => {
    const b = createBuildingFromArchetype("ranch", "RIDGE BAYS", 0, 0);
    const full = Math.max(...b.roofs.map((r) => r.ridge!.bx)) - Math.min(...b.roofs.map((r) => r.ridge!.ax));
    expect(full).toBeGreaterThan(b.w * b.cellSize);
    for (const roof of b.roofs) {
      const xs = roof.verts.map((v) => v.x);
      expect(roof.ridge).toBeDefined();
      expect(roof.ridge!.ax).toBeCloseTo(Math.min(...xs), 5);
      expect(roof.ridge!.bx).toBeCloseTo(Math.max(...xs), 5);
      expect(roof.ridge!.bx - roof.ridge!.ax).toBeLessThan(b.cellSize + 0.32);
    }
    const col2 = b.roofs.filter((r) => r.support.every((s) => s.gx === 2));
    expect(col2.length).toBe(2);
    expect(sectionOwnsRidge(b, col2[0]!)).not.toBe(sectionOwnsRidge(b, col2[1]!));
    expect(col2.some((r) => sectionOwnsRidge(b, r))).toBe(true);
  });

  it("drops only the demolished bay's ridge segment", () => {
    const b = createBuildingFromArchetype("ranch", "RIDGE HOLE", 0, 0);
    const particles = new ParticlePool();
    const mid = 2;
    for (const cell of b.cells) {
      if (cell.gx === mid) applyCellDamage(b, cell, 999, 0, 1, particles, []);
    }
    for (let i = 0; i < Math.ceil(1.4 / SIM_DT); i++) stepStructures([b], SIM_DT, particles, []);
    const holeX0 = b.x + mid * b.cellSize;
    const holeX1 = b.x + (mid + 1) * b.cellSize;
    const live = b.roofs.filter((r) => r.state !== "gone" && r.state !== "falling" && r.ridge);
    expect(live.length).toBeGreaterThan(0);
    for (const roof of live) {
      const spansHole = roof.ridge!.ax < holeX0 + 0.02 && roof.ridge!.bx > holeX1 - 0.02;
      expect(spansHole).toBe(false);
    }
    const end = live.filter((r) => r.support.every((s) => s.gx === b.w - 1));
    expect(end.length).toBeGreaterThan(0);
    expect(end.every((r) => r.ridge!.ax >= holeX1 - 0.02)).toBe(true);
    const east = gableEndCaps(b);
    expect(east[0]?.face).toBe("east");
  });

  it("keeps a roof bay drawn after a local wall breach instead of cutting the column away", () => {
    const b = createBuildingFromArchetype("ranch", "NO CUTAWAY", 0, 0);
    const particles = new ParticlePool();
    const south = b.roofs.find((r) => r.support.some((s) => s.gx === 2 && s.gy === b.d - 1))!;
    const north = b.roofs.find((r) => r.support.some((s) => s.gx === 2 && s.gy === 0))!;
    applyCellDamage(b, b.grid[0]![2]![b.d - 1]!, 999, 0, 1, particles, []);
    for (let i = 0; i < 4; i++) stepStructures([b], SIM_DT, particles, []);
    expect(south.state).not.toBe("gone");
    expect(north.state).toBe("intact");
    expect(north.sag).toBeLessThan(0.05);
    expect(liveRoofCount(b)).toBe(b.roofs.length);
  });

  it("tips a failing ranch bay toward the lost support instead of sliding down flat", () => {
    const b = createBuildingFromArchetype("ranch", "TIP", 0, 0);
    const particles = new ParticlePool();
    const south = b.roofs.find((r) => r.support.some((s) => s.gx === 1 && s.gy === b.d - 1))!;
    const rest = south.verts.map((v) => ({ ...v }));
    applyCellDamage(b, b.grid[0]![1]![b.d - 1]!, 999, 0, 1, particles, []);
    for (let i = 0; i < Math.ceil(0.28 / SIM_DT); i++) stepStructures([b], SIM_DT, particles, []);
    expect(south.state === "sagging" || south.state === "falling").toBe(true);
    expect(roofTiltAngle(south)).toBeGreaterThan(0.08);
    const moved = displacedRoofVerts(south);
    const restMinZ = Math.min(...rest.map((v) => v.z));
    const restMaxZ = Math.max(...rest.map((v) => v.z));
    const eaveIdx = rest.map((v, i) => (v.z <= restMinZ + 0.05 ? i : -1)).filter((i) => i >= 0);
    const ridgeIdx = rest.map((v, i) => (v.z >= restMaxZ - 0.05 ? i : -1)).filter((i) => i >= 0);
    const eaveDrop = eaveIdx.reduce((s, i) => s + (rest[i]!.z - moved[i]!.z), 0) / eaveIdx.length;
    const ridgeDrop = ridgeIdx.reduce((s, i) => s + (rest[i]!.z - moved[i]!.z), 0) / ridgeIdx.length;
    expect(eaveDrop).toBeGreaterThan(ridgeDrop + 0.04);
  });

  it("hands a falling bay to debris at the displaced panel pose", () => {
    const b = createBuildingFromArchetype("ranch", "HANDOFF", 0, 0);
    const particles = new ParticlePool();
    const south = b.roofs.find((r) => r.support.some((s) => s.gx === 0 && s.gy === b.d - 1))!;
    applyCellDamage(b, b.grid[0]![0]![b.d - 1]!, 999, 0, 1, particles, []);
    let spawn: { x: number; y: number; source?: string; elev?: number } | undefined;
    let lastPose = roofHandoffPose(south);
    for (let i = 0; i < Math.ceil(1.4 / SIM_DT); i++) {
      const out = stepStructures([b], SIM_DT, particles, []);
      if (south.state === "falling") lastPose = roofHandoffPose(south);
      const roofSpawn = out.rubbleSpawns.find((s) => s.source === "roof");
      if (roofSpawn) spawn = roofSpawn;
    }
    expect(south.state).toBe("gone");
    expect(spawn).toBeDefined();
    expect(Math.hypot(spawn!.x - lastPose.x, spawn!.y - lastPose.y)).toBeLessThan(0.35);
    expect(spawn!.elev).toBeGreaterThan(0.05);
  });

  it("keeps sloped rafters attached to a ranch bay and jags only exposed edges", () => {
    const b = createBuildingFromArchetype("ranch", "FRAMING", 0, 0);
    const mid = b.roofs.find((r) => r.support.some((s) => s.gx === 2 && s.gy === b.d - 1))!;
    const beams = ranchRafterBeams(mid);
    const rafters = beams.filter((beam) => beam.kind === "rafter");
    expect(rafters.length).toBe(3);
    expect(rafters.every((beam) => Math.abs(beam.b.z - beam.a.z) > 0.35)).toBe(true);
    const particles = new ParticlePool();
    for (const cell of b.cells) {
      if (cell.gx === 1) applyCellDamage(b, cell, 999, 0, 1, particles, []);
    }
    for (let i = 0; i < Math.ceil(1.2 / SIM_DT); i++) stepStructures([b], SIM_DT, particles, []);
    const raw = displacedRoofVerts(mid);
    const broken = applyBrokenRoofEdge(b, mid, raw);
    expect(broken.some((v, i) => Math.hypot(v.x - raw[i]!.x, v.y - raw[i]!.y) > 0.01)).toBe(true);
    expect(applyBrokenRoofEdge(b, mid, raw)).toEqual(broken);
  });

  it("regenerates the same gable geometry for the same footprint", () => {
    const a = createBuildingFromArchetype("cottage", "A", 4, 5);
    const b = createBuildingFromArchetype("cottage", "B", 4, 5);
    expect(generateRoofs(a).map((r) => r.verts.map((v) => `${v.x}:${v.y}:${v.z}`).join("/"))).toEqual(
      generateRoofs(b).map((r) => r.verts.map((v) => `${v.x}:${v.y}:${v.z}`).join("/")),
    );
  });
});
