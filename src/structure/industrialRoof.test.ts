import { describe, expect, it } from "vitest";
import { SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { spawnCollapseDebris } from "../sim/debris";
import { PileField } from "../sim/pile";
import { createTown } from "../world/town";
import { roofInteriorPainterDepth, roofShowsFrame } from "../render/interiorDraw";
import { depthKey, roofPainterDepth } from "../world/iso";
import { applyCellDamage, createBuildingFromArchetype, stepStructures } from "./building";
import { displacedRoofVerts, industrialRoofOpen, roofCoverage, roofCoversOnlyOccupied, roofHandoffPose, roofHeightAt, stepRoofs, type RoofDebrisSpawn } from "./roof";
import { cellPresent, type Building, type RoofSection } from "./types";

const make = (id = "logistics-hub") => createBuildingFromArchetype(id, "ROOF TEST", 10, 20);
const panelKey = (r: RoofSection) => `${r.floor}:${r.bay!.id}`;
function removeSupports(b: Building, roof: RoofSection, frontOnly = false): void {
  const maxY = Math.max(...roof.support.map(s => s.gy));
  for (const s of roof.support) {
    if (frontOnly && s.gy !== maxY) continue;
    const cell = b.grid[roof.floor]![s.gx]![s.gy]!;
    cell.hp = 0; cell.state = "gone";
  }
  b.structureDirty = true; b.roofDirty = true;
}

describe("industrial roof panels", () => {
  it.each(["logistics-hub", "data-hall", "steel-warehouse"])("covers %s once with small, supported panels and continuous pitch", id => {
    const b = make(id), keys = new Set<string>();
    expect(b.roofs.every(r => r.bay && r.support.length > 0)).toBe(true);
    expect(roofCoversOnlyOccupied(b)).toBe(true);
    for (const roof of b.roofs) {
      expect(roof.verts).toHaveLength(4);
      const xs = roof.verts.map(v => v.x), ys = roof.verts.map(v => v.y);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(b.cellSize * 2 + .281);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(b.cellSize * 2 + .281);
      for (const c of roofCoverage(roof)) {
        const key = `${roof.floor}:${c.gx}:${c.gy}`;
        expect(keys.has(key)).toBe(false); keys.add(key);
      }
      for (const index of Object.values(roof.neighbors!).flat()) {
        const other = b.roofs[index]!;
        expect(other.floor).toBe(roof.floor);
        expect(Object.values(other.neighbors!).flat()).toContain(b.roofs.indexOf(roof));
        // T junctions may have different overhang lengths, but must meet without a gap or overlap.
        const box = (r: RoofSection) => ({ x0: Math.min(...r.verts.map(v => v.x)), x1: Math.max(...r.verts.map(v => v.x)),
          y0: Math.min(...r.verts.map(v => v.y)), y1: Math.max(...r.verts.map(v => v.y)) });
        const a = box(roof), n = box(other);
        if (roof.neighbors!.minX?.includes(index)) expect(a.x0).toBeCloseTo(n.x1, 8);
        if (roof.neighbors!.maxX?.includes(index)) expect(a.x1).toBeCloseTo(n.x0, 8);
        if (roof.neighbors!.minY?.includes(index)) expect(a.y0).toBeCloseTo(n.y1, 8);
        if (roof.neighbors!.maxY?.includes(index)) expect(a.y1).toBeCloseTo(n.y0, 8);
        for (const a of roof.verts) for (const v of other.verts) {
          if (Math.hypot(a.x - v.x, a.y - v.y) < 1e-6) expect(a.z).toBeCloseTo(v.z, 8);
        }
      }
    }
    const exposed = b.floorTiles.filter(t => !b.floorTiles.some(u => u.floor === t.floor + 1 && u.gx === t.gx && u.gy === t.gy));
    expect(keys.size).toBe(exposed.length);
    const pool = new ParticlePool();
    for (let i = 0; i < 120; i++) stepStructures([b], SIM_DT, pool, []);
    expect(b.roofs.every(r => r.state === "intact")).toBe(true);
    expect(b.roofs.some(r => r.support.every(s => !roofCoverage(r).some(c => c.gx === s.gx && c.gy === s.gy)))).toBe(true);
  });

  it("keeps shed pitch continuous for either authored axis", () => {
    for (const roofAxis of ["x", "y"] as const) {
      const b = createBuildingFromArchetype("steel-warehouse", "ROTATED", 0, 0, { roofAxis });
      for (const r of b.roofs) for (const v of r.verts) expect(roofHeightAt(b, v.x, v.y)).toBeCloseTo(v.z, 6);
    }
  });

  it("does not collapse roof covering when only cladding is stripped", () => {
    const b = make(), pool = new ParticlePool();
    for (const c of b.cells.filter(c => c.cladding)) applyCellDamage(b, c, c.cladding!.hp, 0, 1, pool, []);
    for (let i = 0; i < 180; i++) stepStructures([b], SIM_DT, pool, []);
    expect(b.roofs.every(r => r.state === "intact")).toBe(true);
  });

  it("buckles from the missing bearing side, while other bays stay supported", () => {
    const b = make(), roof = b.roofs[0]!, key = panelKey(roof);
    const panels = b.roofs.filter(r => panelKey(r) === key);
    const front = panels.at(-1)!, back = panels[0]!;
    removeSupports(b, roof, true);
    const pool = new ParticlePool(), spawns: RoofDebrisSpawn[] = [];
    const starts = new Map<number, number>();
    for (let i = 0; i < 180; i++) {
      stepRoofs(b, SIM_DT, pool, [], spawns);
      for (const r of panels) if (r.state === "falling" && !starts.has(r.id)) starts.set(r.id, i);
    }
    expect(starts.get(front.id)).toBeLessThan(starts.get(back.id)!);
    expect(panels.every(r => r.state === "gone")).toBe(true);
    expect(b.roofs.filter(r => panelKey(r) !== key).every(r => r.state === "intact")).toBe(true);
    expect(spawns).toHaveLength(panels.length);
  });

  it("does not globally collapse surviving bays after most bearings are removed", () => {
    const b = make(), survivor = panelKey(b.roofs.at(-1)!);
    for (const r of b.roofs) if (panelKey(r) !== survivor) removeSupports(b, r);
    for (let i = 0; i < 180; i++) stepRoofs(b, SIM_DT, new ParticlePool(), [], []);
    expect(b.roofs.filter(r => panelKey(r) === survivor).every(r => r.state === "intact")).toBe(true);
  });

  it("exposes framing at Y edges and does not confuse different floors", () => {
    const b = make(), r = b.roofs.find(r => r.neighbors!.maxY?.length)!;
    const next = b.roofs[r.neighbors!.maxY![0]!]!;
    expect(industrialRoofOpen(b, r)).toBe(false);
    next.state = "falling";
    expect(industrialRoofOpen(b, r)).toBe(true);
    expect(roofShowsFrame(b, r)).toBe(true);
    expect(b.roofs.filter(r => r.floor > 0).every(r => !industrialRoofOpen(b, r))).toBe(true);
  });

  it("paints small intact panels above the long interior racks they cover", () => {
    const b = make();
    let checked = 0;
    for (const r of b.roofs) for (const f of b.fixtures) {
      if (f.floor !== r.floor) continue;
      const x0 = Math.min(...r.verts.map(v => v.x)), x1 = Math.max(...r.verts.map(v => v.x));
      const y0 = Math.min(...r.verts.map(v => v.y)), y1 = Math.max(...r.verts.map(v => v.y));
      if (f.x >= x1 || f.x + f.w <= x0 || f.y >= y1 || f.y + f.d <= y0) continue;
      const fixtureDepth = depthKey(f.x + f.w / 2, f.y + f.d / 2, f.floor * 2.35 + f.h * .45);
      if (fixtureDepth <= roofPainterDepth(r.verts)) continue;
      checked++;
      expect(roofInteriorPainterDepth(b, r, r.verts)).toBeGreaterThan(fixtureDepth);
      r.state = "falling";
      expect(roofInteriorPainterDepth(b, r, r.verts)).toBe(roofPainterDepth(r.verts));
      r.state = "intact";
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("lands continuously without long swings, below-ground vertices, or oversized debris", () => {
    const b = make(), pool = new ParticlePool(), r = b.roofs[0]!;
    r.sag = 1;
    const sag = displacedRoofVerts(r);
    r.fallT = 1e-7;
    displacedRoofVerts(r).forEach((v, i) => expect(Math.hypot(v.x - sag[i]!.x, v.y - sag[i]!.y, v.z - sag[i]!.z)).toBeLessThan(1e-5));
    r.fallDx = .6; r.fallDy = .8;
    for (let i = 0; i <= 100; i++) {
      r.fallT = i / 100;
      displacedRoofVerts(r).forEach((v, j) => {
        expect(Object.values(v).every(Number.isFinite)).toBe(true);
        expect(v.z).toBeGreaterThanOrEqual(.16);
        expect(Math.hypot(v.x - r.verts[j]!.x, v.y - r.verts[j]!.y)).toBeLessThanOrEqual(.181);
      });
    }
    const pose = roofHandoffPose(r);
    r.state = "falling"; r.fallT = 1 - SIM_DT / .85;
    const spawns: RoofDebrisSpawn[] = [];
    stepRoofs(b, SIM_DT, pool, [], spawns);
    expect(spawns).toHaveLength(1);
    const town = createTown(); town.rubble = []; town.pile = new PileField(0, 0, 200, 200);
    const debris = spawnCollapseDebris(town, spawns[0]!);
    const panel = debris.find(r => r.skin === "roofing")!;
    expect(panel.x).toBeCloseTo(pose.x); expect(panel.y).toBeCloseTo(pose.y);
    expect(panel.heading).toBe(pose.heading);
    expect(panel.w).toBeCloseTo(pose.panelW); expect(panel.d).toBeCloseTo(pose.panelD);
    expect(panel.elev + panel.thickness).toBeCloseTo(pose.z);
  });

  it("settles a completely demolished hub and emits each roof panel only once", () => {
    const b = make(), pool = new ParticlePool();
    for (const c of b.cells) if (cellPresent(c)) applyCellDamage(b, c, 9999, 0, 1, pool, []);
    let spawns = 0;
    for (let i = 0; i < 600; i++) spawns += stepStructures([b], SIM_DT, pool, []).rubbleSpawns.filter(s => s.preservePanelPose).length;
    expect(b.fullyDown).toBe(true);
    expect(spawns).toBe(b.roofs.length);
    expect(stepStructures([b], SIM_DT, pool, []).rubbleSpawns).toHaveLength(0);
  });
});
