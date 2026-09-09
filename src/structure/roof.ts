import { FLOOR_Z } from "../game/constants";
import type { ParticlePool } from "../fx/particles";
import { debrisKind } from "../fx/particles";
import type { Building, Material, RoofAxis, RoofSection, RoofStyle, WorldEvent } from "./types";
import { cellPresent } from "./types";

export interface RoofDebrisSpawn {
  x: number;
  y: number;
  dx: number;
  dy: number;
  material: Material;
  floor: number;
  cellSize: number;
  source: "roof";
}

function wallTopZ(floors: number): number {
  return (floors - 1) * FLOOR_Z + FLOOR_Z * 0.92;
}

function occupiedTop(building: Building): { gx: number; gy: number }[] {
  const top = building.floors - 1;
  const out: { gx: number; gy: number }[] = [];
  for (let gx = 0; gx < building.w; gx++) {
    for (let gy = 0; gy < building.d; gy++) {
      const cell = building.grid[top]?.[gx]?.[gy];
      if (cell && cellPresent(cell)) out.push({ gx, gy });
    }
  }
  return out;
}

function bbox(cells: { gx: number; gy: number }[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    if (c.gx < minX) minX = c.gx;
    if (c.gx > maxX) maxX = c.gx;
    if (c.gy < minY) minY = c.gy;
    if (c.gy > maxY) maxY = c.gy;
  }
  return { minX, maxX, minY, maxY };
}

function solidRect(cells: { gx: number; gy: number }[]): boolean {
  if (cells.length === 0) return false;
  const b = bbox(cells);
  const w = b.maxX - b.minX + 1;
  const d = b.maxY - b.minY + 1;
  if (w * d !== cells.length) return false;
  const have = new Set(cells.map((c) => `${c.gx},${c.gy}`));
  for (let gx = b.minX; gx <= b.maxX; gx++) {
    for (let gy = b.minY; gy <= b.maxY; gy++) {
      if (!have.has(`${gx},${gy}`)) return false;
    }
  }
  return true;
}

function connected(cells: { gx: number; gy: number }[]): { gx: number; gy: number }[][] {
  const key = (c: { gx: number; gy: number }) => `${c.gx},${c.gy}`;
  const leftover = new Map(cells.map((c) => [key(c), c]));
  const comps: { gx: number; gy: number }[][] = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  while (leftover.size) {
    const start = leftover.values().next().value!;
    leftover.delete(key(start));
    const stack = [start];
    const comp = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const [dx, dy] of dirs) {
        const k = `${cur.gx + dx},${cur.gy + dy}`;
        const n = leftover.get(k);
        if (!n) continue;
        leftover.delete(k);
        stack.push(n);
        comp.push(n);
      }
    }
    comps.push(comp);
  }
  return comps;
}

function roofMaterial(building: Building): Material {
  if (building.kind === "house") return "wood";
  if (building.roof === "shed") return "metal";
  return building.secondary === "metal" ? "metal" : "wood";
}

function chooseAxis(building: Building, cells: { gx: number; gy: number }[]): RoofAxis {
  if (building.roofAxis) return building.roofAxis;
  const b = bbox(cells);
  const w = b.maxX - b.minX + 1;
  const d = b.maxY - b.minY + 1;
  return w >= d ? "x" : "y";
}

function supportOf(
  cells: { gx: number; gy: number }[],
  pred: (c: { gx: number; gy: number }) => boolean,
): { gx: number; gy: number }[] {
  return cells.filter(pred);
}

function makeSection(
  id: number,
  style: RoofStyle,
  support: { gx: number; gy: number }[],
  verts: RoofSection["verts"],
  material: Material,
  ridge?: RoofSection["ridge"],
): RoofSection {
  return {
    id,
    style,
    support,
    verts,
    ridge,
    state: "intact",
    sag: 0,
    unsupportedTime: 0,
    fallT: 0,
    fallDx: 0,
    fallDy: 0,
    material,
  };
}

function worldBox(building: Building, minX: number, maxX: number, minY: number, maxY: number, oh: number) {
  const cs = building.cellSize;
  return {
    x0: building.x + minX * cs - oh,
    x1: building.x + (maxX + 1) * cs + oh,
    y0: building.y + minY * cs - oh,
    y1: building.y + (maxY + 1) * cs + oh,
  };
}

function gablePlanes(
  building: Building,
  cells: { gx: number; gy: number }[],
  axis: RoofAxis,
  id0: number,
): RoofSection[] {
  const b = bbox(cells);
  const eaveZ = wallTopZ(building.floors);
  const ridgeZ = eaveZ + 1.08;
  const oh = 0.14;
  const box = worldBox(building, b.minX, b.maxX, b.minY, b.maxY, oh);
  const mat = roofMaterial(building);
  if (axis === "x") {
    const ridgeY = (box.y0 + box.y1) * 0.5;
    const midGy = (b.minY + b.maxY) * 0.5;
    const ridge = { ax: box.x0, ay: ridgeY, az: ridgeZ, bx: box.x1, by: ridgeY, bz: ridgeZ };
    return [
      makeSection(
        id0,
        "gable",
        supportOf(cells, (c) => c.gy <= midGy),
        [
          { x: box.x0, y: box.y0, z: eaveZ },
          { x: box.x1, y: box.y0, z: eaveZ },
          { x: box.x1, y: ridgeY, z: ridgeZ },
          { x: box.x0, y: ridgeY, z: ridgeZ },
        ],
        mat,
        ridge,
      ),
      makeSection(
        id0 + 1,
        "gable",
        supportOf(cells, (c) => c.gy >= midGy),
        [
          { x: box.x0, y: ridgeY, z: ridgeZ },
          { x: box.x1, y: ridgeY, z: ridgeZ },
          { x: box.x1, y: box.y1, z: eaveZ },
          { x: box.x0, y: box.y1, z: eaveZ },
        ],
        mat,
        ridge,
      ),
    ];
  }
  const ridgeX = (box.x0 + box.x1) * 0.5;
  const midGx = (b.minX + b.maxX) * 0.5;
  const ridge = { ax: ridgeX, ay: box.y0, az: ridgeZ, bx: ridgeX, by: box.y1, bz: ridgeZ };
  return [
    makeSection(
      id0,
      "gable",
      supportOf(cells, (c) => c.gx <= midGx),
      [
        { x: box.x0, y: box.y0, z: eaveZ },
        { x: ridgeX, y: box.y0, z: ridgeZ },
        { x: ridgeX, y: box.y1, z: ridgeZ },
        { x: box.x0, y: box.y1, z: eaveZ },
      ],
      mat,
      ridge,
    ),
    makeSection(
      id0 + 1,
      "gable",
      supportOf(cells, (c) => c.gx >= midGx),
      [
        { x: ridgeX, y: box.y0, z: ridgeZ },
        { x: box.x1, y: box.y0, z: eaveZ },
        { x: box.x1, y: box.y1, z: eaveZ },
        { x: ridgeX, y: box.y1, z: ridgeZ },
      ],
      mat,
      ridge,
    ),
  ];
}

function shedPlane(building: Building, cells: { gx: number; gy: number }[], axis: RoofAxis, id: number): RoofSection {
  const b = bbox(cells);
  const eaveZ = wallTopZ(building.floors);
  const lowZ = eaveZ + 0.18;
  const highZ = eaveZ + 0.92;
  const oh = 0.1;
  const box = worldBox(building, b.minX, b.maxX, b.minY, b.maxY, oh);
  const verts =
    axis === "y"
      ? [
          { x: box.x0, y: box.y0, z: lowZ },
          { x: box.x1, y: box.y0, z: lowZ },
          { x: box.x1, y: box.y1, z: highZ },
          { x: box.x0, y: box.y1, z: highZ },
        ]
      : [
          { x: box.x0, y: box.y0, z: lowZ },
          { x: box.x1, y: box.y0, z: highZ },
          { x: box.x1, y: box.y1, z: highZ },
          { x: box.x0, y: box.y1, z: lowZ },
        ];
  return makeSection(id, "shed", cells, verts, roofMaterial(building));
}

function flatPlane(building: Building, cells: { gx: number; gy: number }[], id: number): RoofSection {
  const b = bbox(cells);
  const z = wallTopZ(building.floors) + 0.16;
  const oh = 0.06;
  const box = worldBox(building, b.minX, b.maxX, b.minY, b.maxY, oh);
  return makeSection(
    id,
    "flat",
    cells,
    [
      { x: box.x0, y: box.y0, z },
      { x: box.x1, y: box.y0, z },
      { x: box.x1, y: box.y1, z },
      { x: box.x0, y: box.y1, z },
    ],
    roofMaterial(building),
  );
}

function stripFallback(
  building: Building,
  cells: { gx: number; gy: number }[],
  style: RoofStyle,
  axis: RoofAxis,
  id0: number,
): RoofSection[] {
  if (style === "flat") return [flatPlane(building, cells, id0)];
  if (style === "shed") return [shedPlane(building, cells, axis, id0)];
  const b = bbox(cells);
  const eaveZ = wallTopZ(building.floors);
  const ridgeZ = eaveZ + 1.08;
  const cs = building.cellSize;
  const oh = 0.08;
  const mat = roofMaterial(building);
  const have = new Set(cells.map((c) => `${c.gx},${c.gy}`));
  const sections: RoofSection[] = [];
  let id = id0;
  if (axis === "x") {
    const ridgeY = building.y + ((b.minY + b.maxY + 1) * 0.5) * cs;
    const ridge = {
      ax: building.x + b.minX * cs - oh,
      ay: ridgeY,
      az: ridgeZ,
      bx: building.x + (b.maxX + 1) * cs + oh,
      by: ridgeY,
      bz: ridgeZ,
    };
    for (let gy = b.minY; gy <= b.maxY; gy++) {
      const row = cells.filter((c) => c.gy === gy);
      if (row.length === 0) continue;
      const rb = bbox(row);
      const y0 = building.y + gy * cs - (gy === b.minY ? oh : 0);
      const y1 = building.y + (gy + 1) * cs + (gy === b.maxY ? oh : 0);
      const t0 = (gy - b.minY) / Math.max(1, b.maxY - b.minY + 1);
      const t1 = (gy + 1 - b.minY) / Math.max(1, b.maxY - b.minY + 1);
      const mid = 0.5;
      const zAt = (t: number) => eaveZ + (ridgeZ - eaveZ) * (1 - Math.abs(t - mid) / mid);
      const x0 = building.x + rb.minX * cs - oh;
      const x1 = building.x + (rb.maxX + 1) * cs + oh;
      sections.push(
        makeSection(
          id++,
          "gable",
          row,
          [
            { x: x0, y: y0, z: zAt(t0) },
            { x: x1, y: y0, z: zAt(t0) },
            { x: x1, y: y1, z: zAt(t1) },
            { x: x0, y: y1, z: zAt(t1) },
          ],
          mat,
          ridge,
        ),
      );
    }
    void have;
    return sections;
  }
  const ridgeX = building.x + ((b.minX + b.maxX + 1) * 0.5) * cs;
  const ridge = {
    ax: ridgeX,
    ay: building.y + b.minY * cs - oh,
    az: ridgeZ,
    bx: ridgeX,
    by: building.y + (b.maxY + 1) * cs + oh,
    bz: ridgeZ,
  };
  for (let gx = b.minX; gx <= b.maxX; gx++) {
    const col = cells.filter((c) => c.gx === gx);
    if (col.length === 0) continue;
    const cb = bbox(col);
    const x0 = building.x + gx * cs - (gx === b.minX ? oh : 0);
    const x1 = building.x + (gx + 1) * cs + (gx === b.maxX ? oh : 0);
    const t0 = (gx - b.minX) / Math.max(1, b.maxX - b.minX + 1);
    const t1 = (gx + 1 - b.minX) / Math.max(1, b.maxX - b.minX + 1);
    const mid = 0.5;
    const zAt = (t: number) => eaveZ + (ridgeZ - eaveZ) * (1 - Math.abs(t - mid) / mid);
    const y0 = building.y + cb.minY * cs - oh;
    const y1 = building.y + (cb.maxY + 1) * cs + oh;
    sections.push(
      makeSection(
        id++,
        "gable",
        col,
        [
          { x: x0, y: y0, z: zAt(t0) },
          { x: x1, y: y0, z: zAt(t1) },
          { x: x1, y: y1, z: zAt(t1) },
          { x: x0, y: y1, z: zAt(t0) },
        ],
        mat,
        ridge,
      ),
    );
  }
  return sections;
}

export function generateRoofs(building: Building): RoofSection[] {
  const cells = occupiedTop(building);
  if (cells.length === 0) return [];
  const sections: RoofSection[] = [];
  let nextId = 1;
  for (const comp of connected(cells)) {
    const axis = chooseAxis(building, comp);
    if (solidRect(comp)) {
      if (building.roof === "flat") sections.push(flatPlane(building, comp, nextId++));
      else if (building.roof === "shed") sections.push(shedPlane(building, comp, axis, nextId++));
      else {
        const planes = gablePlanes(building, comp, axis, nextId);
        nextId += planes.length;
        sections.push(...planes);
      }
    } else {
      const extra = stripFallback(building, comp, building.roof, axis, nextId);
      nextId += extra.length;
      sections.push(...extra);
    }
  }
  return sections;
}

export function roofCoversOnlyOccupied(building: Building): boolean {
  const top = building.floors - 1;
  const occupied = new Set(
    occupiedTop(building).map((c) => `${c.gx},${c.gy}`),
  );
  for (const roof of building.roofs) {
    for (const s of roof.support) {
      if (!occupied.has(`${s.gx},${s.gy}`)) return false;
      const cell = building.grid[top]?.[s.gx]?.[s.gy];
      if (!cell || !cellPresent(cell)) return false;
    }
  }
  return true;
}

export function displacedRoofVerts(roof: RoofSection): { x: number; y: number; z: number }[] {
  const drop = roof.sag * 0.35 + roof.fallT * 1.7;
  return roof.verts.map((v) => ({
    x: v.x + roof.fallDx * roof.fallT * 0.9,
    y: v.y + roof.fallDy * roof.fallT * 0.9,
    z: v.z - drop,
  }));
}

function heightOnPoly(verts: { x: number; y: number; z: number }[], x: number, y: number): number | null {
  if (verts.length < 3) return null;
  for (let i = 1; i < verts.length - 1; i++) {
    const z = baryZ(verts[0]!, verts[i]!, verts[i + 1]!, x, y);
    if (z != null) return z;
  }
  return null;
}

function baryZ(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
  x: number,
  y: number,
): number | null {
  const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(d) < 1e-9) return null;
  const wa = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / d;
  const wb = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / d;
  const wc = 1 - wa - wb;
  const eps = 1e-4;
  if (wa < -eps || wb < -eps || wc < -eps) return null;
  return wa * a.z + wb * b.z + wc * c.z;
}

/** Roof plane Z at a world XY, or null if the point is outside every live section. */
export function roofHeightAt(building: Building, x: number, y: number): number | null {
  let best: number | null = null;
  for (const roof of building.roofs) {
    if (roof.state === "gone") continue;
    const z = heightOnPoly(displacedRoofVerts(roof), x, y);
    if (z == null) continue;
    if (best == null || z > best) best = z;
  }
  return best;
}

export type GableEndFace = "east" | "west" | "south" | "north";

export interface GableEndCap {
  face: GableEndFace;
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  peak: { x: number; y: number; z: number };
}

/** Viewer-facing gable wall triangles from the flat story top up to the ridge. */
export function gableEndCaps(building: Building): GableEndCap[] {
  const live = building.roofs.filter(
    (r) => r.style === "gable" && (r.state === "intact" || r.state === "sagging") && r.ridge,
  );
  if (live.length === 0) return [];
  const ridge = live[0]!.ridge!;
  const cells = live.flatMap((r) => r.support);
  if (cells.length === 0) return [];
  const b = bbox(cells);
  const cs = building.cellSize;
  const x0 = building.x + b.minX * cs;
  const x1 = building.x + (b.maxX + 1) * cs;
  const y0 = building.y + b.minY * cs;
  const y1 = building.y + (b.maxY + 1) * cs;
  const sag = Math.max(...live.map((r) => r.sag * 0.35));
  const eaveZ = Math.min(...live.flatMap((r) => r.verts.map((v) => v.z))) - sag - 0.03;
  const peakZ = ridge.az - sag;
  const axisX = Math.abs(ridge.ay - ridge.by) < 1e-3;
  if (axisX) {
    const py = (ridge.ay + ridge.by) * 0.5;
    return [
      {
        face: "east",
        a: { x: x1, y: y0, z: eaveZ },
        b: { x: x1, y: y1, z: eaveZ },
        peak: { x: x1, y: py, z: peakZ },
      },
    ];
  }
  const px = (ridge.ax + ridge.bx) * 0.5;
  return [
    {
      face: "south",
      a: { x: x0, y: y1, z: eaveZ },
      b: { x: x1, y: y1, z: eaveZ },
      peak: { x: px, y: y1, z: peakZ },
    },
  ];
}

export function gablePlanesSloped(roofs: RoofSection[]): boolean {
  const gables = roofs.filter((r) => r.style === "gable" && r.state !== "gone");
  if (gables.length < 2) return false;
  const a = gables[0]!;
  const b = gables[1]!;
  const zSpread = (r: RoofSection) => {
    const zs = r.verts.map((v) => v.z);
    return Math.max(...zs) - Math.min(...zs);
  };
  if (zSpread(a) < 0.35 || zSpread(b) < 0.35) return false;
  if (!a.ridge || !b.ridge) return false;
  const sameRidge =
    Math.abs(a.ridge.ax - b.ridge.ax) < 1e-6 &&
    Math.abs(a.ridge.ay - b.ridge.ay) < 1e-6 &&
    Math.abs(a.ridge.az - b.ridge.az) < 1e-6;
  return sameRidge;
}

function supportFraction(building: Building, roof: RoofSection): { have: number; total: number } {
  const top = building.floors - 1;
  let have = 0;
  for (const s of roof.support) {
    const cell = building.grid[top]?.[s.gx]?.[s.gy];
    if (cell && cellPresent(cell)) have++;
  }
  return { have, total: Math.max(1, roof.support.length) };
}

function sectionCenter(roof: RoofSection): { x: number; y: number; z: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of roof.verts) {
    x += v.x;
    y += v.y;
    z += v.z;
  }
  const n = Math.max(1, roof.verts.length);
  return { x: x / n, y: y / n, z: z / n };
}

function startRoofFall(building: Building, roof: RoofSection, particles: ParticlePool, events: WorldEvent[]): void {
  if (roof.state === "falling" || roof.state === "gone") return;
  roof.state = "falling";
  roof.fallT = 0;
  const leanL = Math.hypot(building.leanX, building.leanY);
  roof.fallDx = leanL > 0.15 ? building.leanX / leanL : 0.35;
  roof.fallDy = leanL > 0.15 ? building.leanY / leanL : 0.1;
  building.roofDirty = true;
  building.structureDirty = true;
  const c = sectionCenter(roof);
  particles.burst(debrisKind(roof.material), c.x, c.y, c.z, 1.1);
  particles.collapseCloud(c.x, c.y, c.z, roof.fallDx, roof.fallDy);
  events.push({
    kind: "collapse",
    x: c.x,
    y: c.y,
    z: c.z,
    mag: 0.85,
    material: roof.material,
  });
}

export function roofsNeedStep(building: Building): boolean {
  for (const roof of building.roofs) {
    if (roof.state === "sagging" || roof.state === "falling") return true;
    if (roof.sag > 1e-4 || roof.unsupportedTime > 1e-4) return true;
  }
  return false;
}

export function stepRoofs(
  building: Building,
  dt: number,
  particles: ParticlePool,
  events: WorldEvent[],
  rubbleSpawns: RoofDebrisSpawn[],
): void {
  if (building.roofs.length === 0) return;
  let present = 0;
  let total = 0;
  for (const roof of building.roofs) {
    if (roof.state === "gone") continue;
    const frac = supportFraction(building, roof);
    present += frac.have;
    total += frac.total;
    if (roof.state === "falling") {
      roof.fallT += dt / 0.48;
      if (roof.fallT >= 1) {
        roof.state = "gone";
        roof.fallT = 1;
        building.roofDirty = true;
        const c = sectionCenter(roof);
        const disp = 0.55 + building.floors * 0.2;
        rubbleSpawns.push({
          x: c.x + roof.fallDx * disp,
          y: c.y + roof.fallDy * disp,
          dx: roof.fallDx,
          dy: roof.fallDy,
          material: roof.material,
          floor: building.floors,
          cellSize: building.cellSize,
          source: "roof",
        });
      }
      continue;
    }
    const ratio = frac.have / frac.total;
    if (ratio >= 0.55) {
      roof.unsupportedTime = Math.max(0, roof.unsupportedTime - dt * 2);
      roof.sag = Math.max(0, roof.sag - dt * 1.2);
      if (roof.unsupportedTime <= 1e-4) roof.state = "intact";
      continue;
    }
    roof.unsupportedTime += dt;
    roof.sag = Math.min(1, roof.unsupportedTime / 0.26);
    if (roof.unsupportedTime > 0.1) roof.state = "sagging";
    building.roofDirty = true;
    if (frac.have === 0 || roof.unsupportedTime > 0.36) {
      startRoofFall(building, roof, particles, events);
    }
  }
  if (total > 0 && present / total < 0.35) {
    for (const roof of building.roofs) {
      if (roof.state === "intact" || roof.state === "sagging") {
        startRoofFall(building, roof, particles, events);
      }
    }
  }
  building.roofDirty = roofsNeedStep(building);
}

export function roofsSettled(building: Building): boolean {
  return building.roofs.every((r) => r.state === "gone" || (r.state === "intact" && r.sag <= 1e-4));
}

export function liveRoofCount(building: Building): number {
  return building.roofs.filter((r) => r.state !== "gone").length;
}
