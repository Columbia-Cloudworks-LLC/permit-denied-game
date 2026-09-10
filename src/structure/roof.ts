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
  heading: number;
  elev: number;
  panelW: number;
  panelD: number;
}

function wallTopZ(floors: number): number {
  return floors * FLOOR_Z;
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
  const c = vertsCenter(verts);
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
    hingeX: c.x,
    hingeY: c.y,
    hingeZ: c.z,
    tiltAx: 1,
    tiltAy: 0,
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

function ranchGableBays(
  building: Building,
  cells: { gx: number; gy: number }[],
  axis: RoofAxis,
  id0: number,
): RoofSection[] {
  if (axis !== "x") return gablePlanes(building, cells, axis, id0);
  const b = bbox(cells);
  const eaveZ = wallTopZ(building.floors);
  const ridgeZ = eaveZ + 1.08;
  const oh = 0.14;
  const full = worldBox(building, b.minX, b.maxX, b.minY, b.maxY, oh);
  const ridgeY = (full.y0 + full.y1) * 0.5;
  const midGy = (b.minY + b.maxY) * 0.5;
  const mat = roofMaterial(building);
  const cs = building.cellSize;
  const sections: RoofSection[] = [];
  let id = id0;
  for (let gx = b.minX; gx <= b.maxX; gx++) {
    const col = cells.filter((c) => c.gx === gx);
    if (col.length === 0) continue;
    const x0 = building.x + gx * cs - (gx === b.minX ? oh : 0);
    const x1 = building.x + (gx + 1) * cs + (gx === b.maxX ? oh : 0);
    const ridge = { ax: x0, ay: ridgeY, az: ridgeZ, bx: x1, by: ridgeY, bz: ridgeZ };
    const north = supportOf(col, (c) => c.gy <= midGy);
    const south = supportOf(col, (c) => c.gy >= midGy);
    if (north.length) {
      sections.push(
        makeSection(
          id++,
          "gable",
          north,
          [
            { x: x0, y: full.y0, z: eaveZ },
            { x: x1, y: full.y0, z: eaveZ },
            { x: x1, y: ridgeY, z: ridgeZ },
            { x: x0, y: ridgeY, z: ridgeZ },
          ],
          mat,
          ridge,
        ),
      );
    }
    if (south.length) {
      sections.push(
        makeSection(
          id++,
          "gable",
          south,
          [
            { x: x0, y: ridgeY, z: ridgeZ },
            { x: x1, y: ridgeY, z: ridgeZ },
            { x: x1, y: full.y1, z: eaveZ },
            { x: x0, y: full.y1, z: eaveZ },
          ],
          mat,
          ridge,
        ),
      );
    }
  }
  return sections.length ? sections : gablePlanes(building, cells, axis, id0);
}

function shedPlane(building: Building, cells: { gx: number; gy: number }[], axis: RoofAxis, id: number): RoofSection {
  const b = bbox(cells);
  const eaveZ = wallTopZ(building.floors);
  const lowZ = eaveZ;
  const highZ = eaveZ + 0.92;
  const oh = 0.12;
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
  const z = wallTopZ(building.floors);
  const oh = 0.12;
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
      else if (building.archetypeId === "ranch") {
        const planes = ranchGableBays(building, comp, axis, nextId);
        nextId += planes.length;
        sections.push(...planes);
      } else {
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

function vertsCenter(verts: { x: number; y: number; z: number }[]): { x: number; y: number; z: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of verts) {
    x += v.x;
    y += v.y;
    z += v.z;
  }
  const n = Math.max(1, verts.length);
  return { x: x / n, y: y / n, z: z / n };
}

/** Ease-in so the panel tips first, then drops. */
function roofFallEase(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (1.12 - 0.12 * u);
}

export function roofTiltAngle(roof: RoofSection): number {
  return roof.sag * 0.3 + roofFallEase(roof.fallT) * 0.98;
}

function rotateAroundHinge(
  v: { x: number; y: number; z: number },
  roof: RoofSection,
  angle: number,
): { x: number; y: number; z: number } {
  const ax = roof.tiltAx;
  const ay = roof.tiltAy;
  const al = Math.hypot(ax, ay) || 1;
  const kx = ax / al;
  const ky = ay / al;
  const px = v.x - roof.hingeX;
  const py = v.y - roof.hingeY;
  const pz = v.z - roof.hingeZ;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = kx * px + ky * py;
  const cx = ky * pz;
  const cy = -kx * pz;
  const cz = kx * py - ky * px;
  return {
    x: roof.hingeX + px * cos + cx * sin + kx * dot * (1 - cos),
    y: roof.hingeY + py * cos + cy * sin + ky * dot * (1 - cos),
    z: roof.hingeZ + pz * cos + cz * sin,
  };
}

export function displacedRoofVerts(roof: RoofSection): { x: number; y: number; z: number }[] {
  const angle = roofTiltAngle(roof);
  const slide = roofFallEase(roof.fallT);
  const drop = slide * 1.05;
  return roof.verts.map((v) => {
    const r = angle === 0 ? { x: v.x, y: v.y, z: v.z } : rotateAroundHinge(v, roof, angle);
    return {
      x: r.x + roof.fallDx * slide * 0.55,
      y: r.y + roof.fallDy * slide * 0.55,
      z: r.z - drop,
    };
  });
}

type RoofEdge = "minX" | "maxX" | "minY" | "maxY";

function sameBaySide(a: RoofSection, b: RoofSection): boolean {
  const aMin = Math.min(...a.support.map((s) => s.gy));
  const aMax = Math.max(...a.support.map((s) => s.gy));
  const bMin = Math.min(...b.support.map((s) => s.gy));
  const bMax = Math.max(...b.support.map((s) => s.gy));
  return aMax >= bMin && bMax >= aMin;
}

function neighborBayGone(building: Building, roof: RoofSection, dgx: number): boolean {
  const gxs = roof.support.map((s) => s.gx);
  const mine = gxs[0];
  if (mine == null) return false;
  const want = mine + dgx;
  const partner = building.roofs.find(
    (other) =>
      other.id !== roof.id &&
      other.style === roof.style &&
      other.support.some((s) => s.gx === want) &&
      sameBaySide(roof, other),
  );
  if (!partner) return false;
  return partner.state === "gone" || partner.state === "falling";
}

function exposedRoofEdges(building: Building, roof: RoofSection): RoofEdge[] {
  const edges: RoofEdge[] = [];
  if (roof.state === "gone") return edges;
  if (neighborBayGone(building, roof, -1)) edges.push("minX");
  if (neighborBayGone(building, roof, 1)) edges.push("maxX");
  if (roof.state === "sagging" || roof.state === "falling") {
    if (roof.fallDy > 0.2) edges.push("maxY");
    else if (roof.fallDy < -0.2) edges.push("minY");
    if (roof.fallDx > 0.2) edges.push("maxX");
    else if (roof.fallDx < -0.2) edges.push("minX");
  }
  return edges;
}

function roofEdgeJag(id: number, i: number, k: number): number {
  return (((id * 17 + i * 13 + k * 5) % 7) - 3) * 0.03;
}

/** Deterministic bites on exposed roof edges. Stable across frames. */
export function applyBrokenRoofEdge(
  building: Building,
  roof: RoofSection,
  verts: { x: number; y: number; z: number }[],
): { x: number; y: number; z: number }[] {
  const edges = exposedRoofEdges(building, roof);
  if (edges.length === 0) return verts;
  const xs = verts.map((v) => v.x);
  const ys = verts.map((v) => v.y);
  const zs = verts.map((v) => v.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const pad = 0.1;
  return verts.map((v, i) => {
    let { x, y, z } = v;
    const j = roofEdgeJag(roof.id, i, 1);
    const j2 = roofEdgeJag(roof.id, i, 2);
    if (edges.includes("minX") && v.x <= minX + pad) {
      x += Math.abs(j);
      z -= Math.abs(j2) * 0.4;
    }
    if (edges.includes("maxX") && v.x >= maxX - pad) {
      x -= Math.abs(j);
      z -= Math.abs(j2) * 0.4;
    }
    if (edges.includes("minY") && v.y <= minY + pad) {
      y += Math.abs(j);
      z -= Math.abs(j2) * 0.35;
    }
    if (edges.includes("maxY") && v.y >= maxY - pad) {
      y -= Math.abs(j);
      z -= Math.abs(j2) * 0.35;
    }
    if ((roof.state === "sagging" || roof.state === "falling") && v.z <= minZ + 0.2) {
      z -= Math.abs(roofEdgeJag(roof.id, i, 3)) * 0.45;
    }
    return { x, y, z };
  });
}

export interface RoofRafterBeam {
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  kind: "rafter" | "plate";
}

function lerp3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  t: number,
): { x: number; y: number; z: number } {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/** Sloped framing that rides the displaced roof plane. */
export function ranchRafterBeams(roof: RoofSection): RoofRafterBeam[] {
  const verts = displacedRoofVerts(roof);
  if (verts.length < 4) return [];
  const ranked = verts.slice().sort((a, b) => b.z - a.z);
  const ridgePair = [ranked[0]!, ranked[1]!];
  const eavePair = [ranked[ranked.length - 1]!, ranked[ranked.length - 2]!];
  const alongX = Math.abs(ridgePair[0]!.x - ridgePair[1]!.x) >= Math.abs(ridgePair[0]!.y - ridgePair[1]!.y);
  const key = (v: { x: number; y: number }) => (alongX ? v.x : v.y);
  ridgePair.sort((a, b) => key(a) - key(b));
  eavePair.sort((a, b) => key(a) - key(b));
  const sink = 0.08;
  const sinkV = (v: { x: number; y: number; z: number }) => ({ x: v.x, y: v.y, z: v.z - sink });
  const e0 = sinkV(eavePair[0]!);
  const e1 = sinkV(eavePair[1]!);
  const r0 = sinkV(ridgePair[0]!);
  const r1 = sinkV(ridgePair[1]!);
  const beams: RoofRafterBeam[] = [
    { a: e0, b: e1, kind: "plate" },
    { a: r0, b: r1, kind: "plate" },
  ];
  for (let i = 0; i < 3; i++) {
    const t = 0.16 + i * 0.34;
    beams.push({ a: lerp3(e0, e1, t), b: lerp3(r0, r1, t), kind: "rafter" });
  }
  return beams;
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

/** Trapezoid from the top-floor wall up the live shed plane. Null if no shed rise. */
export function shedWallVerts(
  building: Building,
  face: "south" | "east",
  along0: number,
  along1: number,
  plane: number,
  z0: number,
): { x: number; y: number; z: number }[] | null {
  const live = building.roofs.some(
    (r) => r.style === "shed" && (r.state === "intact" || r.state === "sagging"),
  );
  if (!live) return null;
  const lo = Math.min(along0, along1);
  const hi = Math.max(along0, along1);
  const zAt = (along: number) => {
    const inset = 0.04;
    return face === "south"
      ? roofHeightAt(building, along, plane - inset)
      : roofHeightAt(building, plane - inset, along);
  };
  const zLo = zAt(lo);
  const zHi = zAt(hi);
  if (zLo == null || zHi == null) return null;
  const story = wallTopZ(building.floors);
  if (zLo <= story + 0.03 && zHi <= story + 0.03) return null;
  const pt = (along: number, z: number) =>
    face === "south" ? { x: along, y: plane, z } : { x: plane, y: along, z };
  return [pt(lo, z0), pt(hi, z0), pt(hi, zHi), pt(lo, zLo)];
}

/** Height on the gable outline at a world X (south) or Y (east) along the face. */
export function gableZAlong(cap: GableEndCap, along: number): number {
  const a = cap.face === "south" ? cap.a.x : cap.a.y;
  const b = cap.face === "south" ? cap.b.x : cap.b.y;
  const p = cap.face === "south" ? cap.peak.x : cap.peak.y;
  if (along <= p) {
    const span = p - a;
    if (Math.abs(span) < 1e-8) return cap.peak.z;
    const t = Math.max(0, Math.min(1, (along - a) / span));
    return cap.a.z + (cap.peak.z - cap.a.z) * t;
  }
  const span = b - p;
  if (Math.abs(span) < 1e-8) return cap.peak.z;
  const t = Math.max(0, Math.min(1, (along - p) / span));
  return cap.peak.z + (cap.b.z - cap.peak.z) * t;
}

/** One house-shaped wall: story rectangle plus the gable peak, no shared eave edge. */
export function gableWallVerts(
  cap: GableEndCap,
  along0: number,
  along1: number,
  plane: number,
  z0: number,
): { x: number; y: number; z: number }[] {
  const lo = Math.min(along0, along1);
  const hi = Math.max(along0, along1);
  const peakAlong = cap.face === "south" ? cap.peak.x : cap.peak.y;
  const pt = (along: number, z: number) =>
    cap.face === "south" ? { x: along, y: plane, z } : { x: plane, y: along, z };
  const verts = [pt(lo, z0), pt(hi, z0), pt(hi, gableZAlong(cap, hi))];
  if (peakAlong > lo + 1e-4 && peakAlong < hi - 1e-4) {
    verts.push(pt(peakAlong, cap.peak.z));
  }
  verts.push(pt(lo, gableZAlong(cap, lo)));
  return verts;
}

/** Viewer-facing gable outline from the story top up to the ridge. */
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
  const eaveZ = Math.min(...live.flatMap((r) => r.verts.map((v) => v.z))) - sag;
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

function ridgeIdentity(ridge: NonNullable<RoofSection["ridge"]>): string {
  return `${ridge.ax}:${ridge.ay}:${ridge.az}:${ridge.bx}:${ridge.by}:${ridge.bz}`;
}

/** Front-most live section of a shared ridge draws it; demolished partners drop their segment. */
export function sectionOwnsRidge(building: Building, roof: RoofSection): boolean {
  if (!roof.ridge || roof.state === "falling" || roof.state === "gone") return false;
  const key = ridgeIdentity(roof.ridge);
  const mine = sectionCenter(roof);
  const mineFront = mine.x + mine.y;
  for (const other of building.roofs) {
    if (other.id === roof.id) continue;
    if (!other.ridge || other.state === "gone" || other.state === "falling") continue;
    if (ridgeIdentity(other.ridge) !== key) continue;
    const theirs = sectionCenter(other);
    const theirFront = theirs.x + theirs.y;
    if (theirFront > mineFront || (theirFront === mineFront && other.id > roof.id)) return false;
  }
  return true;
}

function sectionCenter(roof: RoofSection): { x: number; y: number; z: number } {
  return vertsCenter(roof.verts);
}

function supportWorld(
  building: Building,
  s: { gx: number; gy: number },
): { x: number; y: number } {
  return {
    x: building.x + (s.gx + 0.5) * building.cellSize,
    y: building.y + (s.gy + 0.5) * building.cellSize,
  };
}

function updateRoofHinge(building: Building, roof: RoofSection): void {
  if (roof.state === "falling" || roof.state === "gone") return;
  const top = building.floors - 1;
  let hx = 0;
  let hy = 0;
  let have = 0;
  let lx = 0;
  let ly = 0;
  let lost = 0;
  for (const s of roof.support) {
    const cell = building.grid[top]?.[s.gx]?.[s.gy];
    const p = supportWorld(building, s);
    if (cell && cellPresent(cell)) {
      hx += p.x;
      hy += p.y;
      have++;
    } else {
      lx += p.x;
      ly += p.y;
      lost++;
    }
  }
  if (have > 0) {
    roof.hingeX = hx / have;
    roof.hingeY = hy / have;
    roof.hingeZ = heightOnPoly(roof.verts, roof.hingeX, roof.hingeY) ?? sectionCenter(roof).z;
  } else {
    const c = sectionCenter(roof);
    roof.hingeX = c.x;
    roof.hingeY = c.y;
    roof.hingeZ = c.z;
  }
  let dx = roof.fallDx;
  let dy = roof.fallDy;
  if (lost > 0 && have > 0) {
    dx = lx / lost - roof.hingeX;
    dy = ly / lost - roof.hingeY;
  } else if (lost > 0 && have === 0) {
    const c = sectionCenter(roof);
    dx = lx / lost - c.x;
    dy = ly / lost - c.y;
  }
  const len = Math.hypot(dx, dy);
  if (len > 1e-4) {
    dx /= len;
    dy /= len;
    roof.fallDx = dx;
    roof.fallDy = dy;
    roof.tiltAx = -dy;
    roof.tiltAy = dx;
  }
}

export function roofHandoffPose(roof: RoofSection): {
  x: number;
  y: number;
  z: number;
  heading: number;
  panelW: number;
  panelD: number;
} {
  const verts = displacedRoofVerts(roof);
  const c = vertsCenter(verts);
  const ranked = verts.slice().sort((a, b) => b.z - a.z);
  const ridge = ranked[0]!;
  const eave = ranked[ranked.length - 1]!;
  const heading = Math.atan2(eave.y - ridge.y, eave.x - ridge.x);
  const xs = verts.map((v) => v.x);
  const ys = verts.map((v) => v.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const alongSlope = Math.hypot(eave.x - ridge.x, eave.y - ridge.y);
  return {
    x: c.x,
    y: c.y,
    z: c.z,
    heading,
    panelW: Math.max(0.55, Math.min(spanX, spanY) + 0.12),
    panelD: Math.max(0.34, alongSlope * 0.42),
  };
}

function startRoofFall(building: Building, roof: RoofSection, particles: ParticlePool, events: WorldEvent[]): void {
  if (roof.state === "falling" || roof.state === "gone") return;
  updateRoofHinge(building, roof);
  roof.state = "falling";
  roof.fallT = 0;
  const leanL = Math.hypot(roof.fallDx, roof.fallDy);
  if (leanL < 0.08) {
    const buildL = Math.hypot(building.leanX, building.leanY);
    roof.fallDx = buildL > 0.15 ? building.leanX / buildL : 0.2;
    roof.fallDy = buildL > 0.15 ? building.leanY / buildL : 0.55;
    roof.tiltAx = -roof.fallDy;
    roof.tiltAy = roof.fallDx;
  }
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
      roof.fallT += dt / 0.52;
      if (roof.fallT >= 1) {
        roof.fallT = 1;
        const pose = roofHandoffPose(roof);
        roof.state = "gone";
        building.roofDirty = true;
        rubbleSpawns.push({
          x: pose.x,
          y: pose.y,
          dx: roof.fallDx,
          dy: roof.fallDy,
          material: roof.material,
          floor: building.floors,
          cellSize: building.cellSize,
          source: "roof",
          heading: pose.heading,
          elev: Math.max(0.06, Math.min(0.86, pose.z - 0.06)),
          panelW: pose.panelW,
          panelD: pose.panelD,
        });
      }
      continue;
    }
    updateRoofHinge(building, roof);
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
