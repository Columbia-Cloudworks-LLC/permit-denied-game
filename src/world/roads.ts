import { aabbOverlap, clamp, len, lerp, wrapAngle } from "../game/math";
import { SpatialHash } from "../sim/spatial";
import type { JunctionType, RoadClass, RoadSurfaceKind } from "../structure/types";

export interface RoadPoint {
  x: number;
  y: number;
  elev: number;
}

export interface RoadNode {
  id: string;
  x: number;
  y: number;
  elev: number;
  segmentIds: string[];
  junction: JunctionType;
}

export interface RoadSegment {
  id: string;
  startId: string;
  endId: string;
  points: RoadPoint[];
  roadClass: RoadClass;
  surface: RoadSurfaceKind;
  width: number;
  shoulder: number;
  layer: number;
  laneIds: string[];
}

export interface Lane {
  id: string;
  segmentId: string;
  dir: 1 | -1;
  offset: number;
  width: number;
  speedClass: number;
  next: string[];
}

export interface RoadAccess {
  id: string;
  lotId: string;
  segmentId: string;
  laneId: string;
  t: number;
  x: number;
  y: number;
  kind: "driveway" | "parking" | "frontage";
}

export interface TerrainField {
  ox: number;
  oy: number;
  cell: number;
  cols: number;
  rows: number;
  height: Float32Array;
}

export interface RoadSurfaceHit {
  on: boolean;
  elev: number;
  layer: number;
  segmentId: string | null;
  heading: number;
  t: number;
  dist: number;
}

export interface RoadMeshQuad {
  x: number;
  y: number;
  w: number;
  d: number;
  z: number;
  heading: number;
  color: number;
  kind: "pavement" | "shoulder" | "mark" | "deck";
}

export interface RoadNetwork {
  nodes: RoadNode[];
  segments: RoadSegment[];
  lanes: Lane[];
  accesses: RoadAccess[];
  mesh: RoadMeshQuad[];
}

export const EMPTY_NETWORK: RoadNetwork = {
  nodes: [],
  segments: [],
  lanes: [],
  accesses: [],
  mesh: [],
};

export function emptyTerrain(ox: number, oy: number, w: number, d: number, cell = 2.4): TerrainField {
  const cols = Math.max(2, Math.ceil(w / cell) + 1);
  const rows = Math.max(2, Math.ceil(d / cell) + 1);
  return { ox, oy, cell, cols, rows, height: new Float32Array(cols * rows) };
}

export function setTerrainHeight(field: TerrainField, x: number, y: number, z: number): void {
  const ix = clamp(Math.round((x - field.ox) / field.cell), 0, field.cols - 1);
  const iy = clamp(Math.round((y - field.oy) / field.cell), 0, field.rows - 1);
  field.height[iy * field.cols + ix] = z;
}

export function terrainHeightAt(field: TerrainField, x: number, y: number): number {
  const fx = (x - field.ox) / field.cell;
  const fy = (y - field.oy) / field.cell;
  const x0 = clamp(Math.floor(fx), 0, field.cols - 1);
  const y0 = clamp(Math.floor(fy), 0, field.rows - 1);
  const x1 = clamp(x0 + 1, 0, field.cols - 1);
  const y1 = clamp(y0 + 1, 0, field.rows - 1);
  const tx = clamp(fx - x0, 0, 1);
  const ty = clamp(fy - y0, 0, 1);
  const h00 = field.height[y0 * field.cols + x0]!;
  const h10 = field.height[y0 * field.cols + x1]!;
  const h01 = field.height[y1 * field.cols + x0]!;
  const h11 = field.height[y1 * field.cols + x1]!;
  return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), ty);
}

export function projectPointToPolyline(
  points: readonly RoadPoint[],
  x: number,
  y: number,
): { x: number; y: number; elev: number; t: number; dist: number; heading: number; index: number } {
  let best = { x: points[0]!.x, y: points[0]!.y, elev: points[0]!.elev, t: 0, dist: Infinity, heading: 0, index: 0 };
  let walked = 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += len(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
  }
  const span = Math.max(1e-6, total);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen = len(dx, dy) || 1e-6;
    const u = clamp(((x - a.x) * dx + (y - a.y) * dy) / (segLen * segLen), 0, 1);
    const px = a.x + dx * u;
    const py = a.y + dy * u;
    const dist = len(x - px, y - py);
    if (dist < best.dist) {
      best = {
        x: px,
        y: py,
        elev: lerp(a.elev, b.elev, u),
        t: (walked + u * segLen) / span,
        dist,
        heading: Math.atan2(dy, dx),
        index: i,
      };
    }
    walked += segLen;
  }
  return best;
}

export function samplePolyline(points: readonly RoadPoint[], t: number): RoadPoint & { heading: number } {
  const u = clamp(t, 0, 1);
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += len(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
  }
  let remain = u * total;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const segLen = len(b.x - a.x, b.y - a.y) || 1e-6;
    if (remain <= segLen || i === points.length - 2) {
      const s = remain / segLen;
      return {
        x: lerp(a.x, b.x, s),
        y: lerp(a.y, b.y, s),
        elev: lerp(a.elev, b.elev, s),
        heading: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }
    remain -= segLen;
  }
  const last = points[points.length - 1]!;
  const prev = points[points.length - 2] ?? last;
  return { ...last, heading: Math.atan2(last.y - prev.y, last.x - prev.x) };
}

export function offsetPoint(x: number, y: number, heading: number, across: number): { x: number; y: number } {
  return { x: x - Math.sin(heading) * across, y: y + Math.cos(heading) * across };
}

export function polylineLength(points: readonly RoadPoint[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += len(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
  }
  return total;
}

function splitPolyline(
  points: readonly RoadPoint[],
  t: number,
): { mid: RoadPoint & { heading: number }; a: RoadPoint[]; b: RoadPoint[] } {
  const mid = samplePolyline(points, t);
  const total = Math.max(1e-6, polylineLength(points));
  const cut = clamp(t, 0, 1) * total;
  const a: RoadPoint[] = [{ x: points[0]!.x, y: points[0]!.y, elev: points[0]!.elev }];
  const b: RoadPoint[] = [{ x: mid.x, y: mid.y, elev: mid.elev }];
  let walked = 0;
  let passed = false;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    const segLen = len(p1.x - p0.x, p1.y - p0.y) || 1e-6;
    const next = walked + segLen;
    if (!passed) {
      if (cut <= next || i === points.length - 2) {
        if (len(a[a.length - 1]!.x - mid.x, a[a.length - 1]!.y - mid.y) > 1e-4) {
          a.push({ x: mid.x, y: mid.y, elev: mid.elev });
        }
        if (len(mid.x - p1.x, mid.y - p1.y) > 1e-4) b.push({ x: p1.x, y: p1.y, elev: p1.elev });
        passed = true;
      } else if (len(a[a.length - 1]!.x - p1.x, a[a.length - 1]!.y - p1.y) > 1e-4) {
        a.push({ x: p1.x, y: p1.y, elev: p1.elev });
      }
    } else if (len(b[b.length - 1]!.x - p1.x, b[b.length - 1]!.y - p1.y) > 1e-4) {
      b.push({ x: p1.x, y: p1.y, elev: p1.elev });
    }
    walked = next;
  }
  if (a.length < 2) a.push({ x: mid.x, y: mid.y, elev: mid.elev });
  if (b.length < 2) {
    const last = points[points.length - 1]!;
    b.push({ x: last.x, y: last.y, elev: last.elev });
  }
  return { mid, a, b };
}

function segmentIntersect(
  a0: { x: number; y: number },
  a1: { x: number; y: number },
  b0: { x: number; y: number },
  b1: { x: number; y: number },
): { x: number; y: number; ta: number; tb: number } | null {
  const ax = a1.x - a0.x;
  const ay = a1.y - a0.y;
  const bx = b1.x - b0.x;
  const by = b1.y - b0.y;
  const den = ax * by - ay * bx;
  if (Math.abs(den) < 1e-8) return null;
  const dx = b0.x - a0.x;
  const dy = b0.y - a0.y;
  const ta = (dx * by - dy * bx) / den;
  const tb = (dx * ay - dy * ax) / den;
  if (ta < -1e-4 || ta > 1 + 1e-4 || tb < -1e-4 || tb > 1 + 1e-4) return null;
  return { x: a0.x + ax * ta, y: a0.y + ay * ta, ta: clamp(ta, 0, 1), tb: clamp(tb, 0, 1) };
}

function polylineIntersect(
  a: readonly RoadPoint[],
  b: readonly RoadPoint[],
): { x: number; y: number; elev: number; ta: number; tb: number } | null {
  const la = Math.max(1e-6, polylineLength(a));
  const lb = Math.max(1e-6, polylineLength(b));
  let wa = 0;
  for (let i = 0; i < a.length - 1; i++) {
    const a0 = a[i]!;
    const a1 = a[i + 1]!;
    const ea = len(a1.x - a0.x, a1.y - a0.y) || 1e-6;
    let wb = 0;
    for (let j = 0; j < b.length - 1; j++) {
      const b0 = b[j]!;
      const b1 = b[j + 1]!;
      const eb = len(b1.x - b0.x, b1.y - b0.y) || 1e-6;
      const hit = segmentIntersect(a0, a1, b0, b1);
      if (hit) {
        const ta = (wa + hit.ta * ea) / la;
        const tb = (wb + hit.tb * eb) / lb;
        if (ta > 0.02 && ta < 0.98 && tb > 0.02 && tb < 0.98) {
          return {
            x: hit.x,
            y: hit.y,
            elev: lerp(a0.elev, a1.elev, hit.ta),
            ta,
            tb,
          };
        }
      }
      wb += eb;
    }
    wa += ea;
  }
  return null;
}

export function segmentAabb(seg: RoadSegment): { x: number; y: number; w: number; d: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const pad = seg.width * 0.5 + seg.shoulder + 0.4;
  for (const p of seg.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, d: maxY - minY + pad * 2 };
}

export interface RoadIndex {
  hash: SpatialHash<RoadSegment>;
  nodeById: Map<string, RoadNode>;
  segmentById: Map<string, RoadSegment>;
  laneById: Map<string, Lane>;
  accessById: Map<string, RoadAccess>;
}

const indexCache = new WeakMap<RoadNetwork, RoadIndex>();

export function invalidateNetworkIndex(network: RoadNetwork): void {
  indexCache.delete(network);
}

export function indexNetwork(network: RoadNetwork): RoadIndex {
  const cached = indexCache.get(network);
  if (cached) return cached;
  const hash = new SpatialHash<RoadSegment>(8);
  const nodeById = new Map<string, RoadNode>();
  const segmentById = new Map<string, RoadSegment>();
  const laneById = new Map<string, Lane>();
  const accessById = new Map<string, RoadAccess>();
  for (const n of network.nodes) nodeById.set(n.id, n);
  for (const s of network.segments) {
    segmentById.set(s.id, s);
    const box = segmentAabb(s);
    hash.insert(box.x, box.y, box.w, box.d, s);
  }
  for (const l of network.lanes) laneById.set(l.id, l);
  for (const a of network.accesses) accessById.set(a.id, a);
  const idx = { hash, nodeById, segmentById, laneById, accessById };
  indexCache.set(network, idx);
  return idx;
}

const nearbySegs: RoadSegment[] = [];

export function roadSurfaceAt(
  network: RoadNetwork,
  x: number,
  y: number,
  currentLayer?: number,
): RoadSurfaceHit {
  const idx = indexNetwork(network);
  idx.hash.query(x - 1.2, y - 1.2, 2.4, 2.4, nearbySegs);
  let best: RoadSurfaceHit = { on: false, elev: 0, layer: currentLayer ?? 0, segmentId: null, heading: 0, t: 0, dist: Infinity };
  for (const seg of nearbySegs) {
    if (currentLayer !== undefined && seg.layer !== currentLayer) continue;
    const hit = projectPointToPolyline(seg.points, x, y);
    const half = seg.width * 0.5 + seg.shoulder;
    if (hit.dist <= half && hit.dist < best.dist) {
      best = {
        on: true,
        elev: hit.elev,
        layer: seg.layer,
        segmentId: seg.id,
        heading: hit.heading,
        t: hit.t,
        dist: hit.dist,
      };
    }
  }
  if (best.on || currentLayer !== undefined) return best;
  for (const seg of nearbySegs) {
    const hit = projectPointToPolyline(seg.points, x, y);
    const half = seg.width * 0.5 + seg.shoulder;
    if (hit.dist <= half && hit.dist < best.dist) {
      best = {
        on: true,
        elev: hit.elev,
        layer: seg.layer,
        segmentId: seg.id,
        heading: hit.heading,
        t: hit.t,
        dist: hit.dist,
      };
    }
  }
  return best;
}

export function projectPointToRoad(
  network: RoadNetwork,
  x: number,
  y: number,
  layer?: number,
): { x: number; y: number; elev: number; heading: number; segmentId: string | null; on: boolean } {
  const idx = indexNetwork(network);
  idx.hash.query(x - 4, y - 4, 8, 8, nearbySegs);
  let best = { x, y, elev: 0, heading: 0, segmentId: null as string | null, on: false, dist: Infinity };
  for (const seg of nearbySegs) {
    if (layer !== undefined && seg.layer !== layer) continue;
    const hit = projectPointToPolyline(seg.points, x, y);
    if (hit.dist < best.dist) {
      best = {
        x: hit.x,
        y: hit.y,
        elev: hit.elev,
        heading: hit.heading,
        segmentId: seg.id,
        on: hit.dist <= seg.width * 0.5 + seg.shoulder,
        dist: hit.dist,
      };
    }
  }
  return best;
}

export function nearestRoadAccess(network: RoadNetwork, x: number, y: number): RoadAccess | null {
  let best: RoadAccess | null = null;
  let bestD = Infinity;
  for (const a of network.accesses) {
    const d = len(a.x - x, a.y - y);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

export function connectedLanes(network: RoadNetwork, laneId: string): Lane[] {
  const idx = indexNetwork(network);
  const lane = idx.laneById.get(laneId);
  if (!lane) return [];
  return lane.next.map((id) => idx.laneById.get(id)).filter((l): l is Lane => !!l);
}

export function canTransitionBetweenSurfaces(
  network: RoadNetwork,
  fromLayer: number,
  toLayer: number,
  x: number,
  y: number,
): boolean {
  if (fromLayer === toLayer) return true;
  const a = roadSurfaceAt(network, x, y, fromLayer);
  const b = roadSurfaceAt(network, x, y, toLayer);
  if (!a.on || !b.on || !a.segmentId || !b.segmentId) return false;
  const idx = indexNetwork(network);
  const sa = idx.segmentById.get(a.segmentId);
  const sb = idx.segmentById.get(b.segmentId);
  if (!sa || !sb) return false;
  if (sa.roadClass === "ramp" || sb.roadClass === "ramp") return Math.abs(a.elev - b.elev) < 0.45;
  return false;
}

export function findRoadRoute(
  network: RoadNetwork,
  startLaneId: string,
  destLaneId: string,
): string[] | null {
  const idx = indexNetwork(network);
  if (!idx.laneById.has(startLaneId) || !idx.laneById.has(destLaneId)) return null;
  if (startLaneId === destLaneId) return [startLaneId];
  const seen = new Set<string>([startLaneId]);
  const q: { id: string; path: string[] }[] = [{ id: startLaneId, path: [startLaneId] }];
  while (q.length) {
    const cur = q.shift()!;
    for (const next of connectedLanes(network, cur.id)) {
      if (seen.has(next.id)) continue;
      const path = [...cur.path, next.id];
      if (next.id === destLaneId) return path;
      seen.add(next.id);
      q.push({ id: next.id, path });
    }
  }
  return null;
}

export function nearestLane(network: RoadNetwork, x: number, y: number, layer?: number): Lane | null {
  const surf = roadSurfaceAt(network, x, y, layer);
  if (!surf.on || !surf.segmentId) return null;
  const idx = indexNetwork(network);
  const seg = idx.segmentById.get(surf.segmentId);
  if (!seg) return null;
  return idx.laneById.get(seg.laneIds[0] ?? "") ?? null;
}

export interface RoadIssue {
  code: string;
  detail: string;
}

export function validateRoadNetwork(network: RoadNetwork): { ok: boolean; issues: RoadIssue[] } {
  const issues: RoadIssue[] = [];
  const nodeIds = new Set<string>();
  const segIds = new Set<string>();
  const laneIds = new Set<string>();
  const accessIds = new Set<string>();
  for (const n of network.nodes) {
    if (nodeIds.has(n.id)) issues.push({ code: "dup-node", detail: n.id });
    nodeIds.add(n.id);
  }
  for (const s of network.segments) {
    if (segIds.has(s.id)) issues.push({ code: "dup-seg", detail: s.id });
    segIds.add(s.id);
    if (!nodeIds.has(s.startId) || !nodeIds.has(s.endId)) {
      issues.push({ code: "dangle-node", detail: s.id });
    }
    if (s.points.length < 2) issues.push({ code: "geom", detail: `${s.id} needs two points` });
    for (const laneId of s.laneIds) {
      if (!network.lanes.some((l) => l.id === laneId)) issues.push({ code: "dangle-lane", detail: `${s.id} -> ${laneId}` });
    }
    const rise = Math.abs(s.points[0]!.elev - s.points[s.points.length - 1]!.elev);
    let path = 0;
    for (let i = 0; i < s.points.length - 1; i++) {
      path += len(s.points[i + 1]!.x - s.points[i]!.x, s.points[i + 1]!.y - s.points[i]!.y);
    }
    const grade = path > 0.2 ? rise / path : 0;
    const maxGrade = s.roadClass === "highway" || s.roadClass === "arterial" ? 0.08 : s.roadClass === "ramp" ? 0.18 : 0.14;
    if (grade > maxGrade) issues.push({ code: "grade", detail: `${s.id} grade ${grade.toFixed(3)}` });
  }
  for (const l of network.lanes) {
    if (laneIds.has(l.id)) issues.push({ code: "dup-lane", detail: l.id });
    laneIds.add(l.id);
    if (!segIds.has(l.segmentId)) issues.push({ code: "dangle-seg", detail: l.id });
    for (const n of l.next) {
      if (!network.lanes.some((o) => o.id === n)) issues.push({ code: "dangle-next", detail: `${l.id} -> ${n}` });
    }
  }
  for (const a of network.accesses) {
    if (accessIds.has(a.id)) issues.push({ code: "dup-access", detail: a.id });
    accessIds.add(a.id);
    if (!segIds.has(a.segmentId)) issues.push({ code: "dangle-access", detail: a.id });
  }
  const layerPairs = new Map<string, number>();
  for (const s of network.segments) {
    for (const o of network.segments) {
      if (s.id >= o.id) continue;
      if (s.layer === o.layer) continue;
      const ab = segmentAabb(s);
      const bb = segmentAabb(o);
      if (!aabbOverlap(ab.x, ab.y, ab.w, ab.d, bb.x, bb.y, bb.w, bb.d)) continue;
      const mid = s.points[Math.floor(s.points.length / 2)]!;
      const hit = projectPointToPolyline(o.points, mid.x, mid.y);
      if (hit.dist < (s.width + o.width) * 0.25) {
        const clearance = Math.abs(mid.elev - hit.elev);
        layerPairs.set(`${s.id}:${o.id}`, clearance);
        if (clearance < 1.4 && s.roadClass !== "ramp" && o.roadClass !== "ramp") {
          issues.push({ code: "clearance", detail: `${s.id} crosses ${o.id} with ${clearance.toFixed(2)}` });
        }
      }
    }
  }
  void layerPairs;
  return { ok: issues.length === 0, issues };
}

function reachableSegments(
  network: RoadNetwork,
  startX: number,
  startY: number,
  layer?: number,
): Set<string> {
  const idx = indexNetwork(network);
  const surf = roadSurfaceAt(network, startX, startY, layer);
  const startId = surf.segmentId ?? network.segments[0]?.id;
  const seen = new Set<string>();
  if (!startId) return seen;
  const startSeg = idx.segmentById.get(startId);
  if (!startSeg) return seen;
  seen.add(startId);
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop()!;
    const seg = idx.segmentById.get(id);
    if (!seg) continue;
    for (const nid of [seg.startId, seg.endId]) {
      const node = idx.nodeById.get(nid);
      if (!node) continue;
      for (const sid of node.segmentIds) {
        if (seen.has(sid)) continue;
        const other = idx.segmentById.get(sid);
        if (!other || other.layer !== seg.layer) continue;
        seen.add(sid);
        stack.push(sid);
      }
    }
  }
  return seen;
}

export function roadsConnected(network: RoadNetwork): boolean {
  if (network.segments.length === 0) return false;
  const origin = network.segments[0]!.points[0]!;
  const seen = reachableSegments(network, origin.x, origin.y, network.segments[0]!.layer);
  const ground = network.segments.filter((s) => s.layer === network.segments[0]!.layer);
  return ground.every((s) => seen.has(s.id));
}

export function publicStreetsReachable(network: RoadNetwork, startX: number, startY: number): boolean {
  const seen = reachableSegments(network, startX, startY);
  const publicSegs = network.segments.filter((s) => s.roadClass !== "driveway" && s.layer === 0);
  if (publicSegs.length === 0) return network.segments.length === 0;
  return publicSegs.every((s) => seen.has(s.id));
}

export function aabbOverlapsRoad(
  network: RoadNetwork,
  x: number,
  y: number,
  w: number,
  d: number,
  ignoreDriveway = false,
): boolean {
  const samples = [
    [x, y],
    [x + w, y],
    [x, y + d],
    [x + w, y + d],
    [x + w * 0.5, y + d * 0.5],
    [x + w * 0.5, y],
    [x + w * 0.5, y + d],
    [x, y + d * 0.5],
    [x + w, y + d * 0.5],
  ];
  for (const [px, py] of samples) {
    const hit = roadSurfaceAt(network, px, py);
    if (!hit.on || !hit.segmentId) continue;
    const seg = indexNetwork(network).segmentById.get(hit.segmentId);
    if (ignoreDriveway && seg?.roadClass === "driveway") continue;
    if (seg?.roadClass === "driveway") continue;
    return true;
  }
  return false;
}

export function derivedRoadBoxes(network: RoadNetwork): { x: number; y: number; w: number; d: number }[] {
  const boxes: { x: number; y: number; w: number; d: number }[] = [];
  for (const seg of network.segments) {
    for (let i = 0; i < seg.points.length - 1; i++) {
      const a = seg.points[i]!;
      const b = seg.points[i + 1]!;
      const heading = Math.atan2(b.y - a.y, b.x - a.x);
      const midX = (a.x + b.x) * 0.5;
      const midY = (a.y + b.y) * 0.5;
      const length = len(b.x - a.x, b.y - a.y) + 0.2;
      const width = seg.width + seg.shoulder * 2;
      const hx = Math.abs(Math.cos(heading)) * length * 0.5 + Math.abs(Math.sin(heading)) * width * 0.5;
      const hy = Math.abs(Math.sin(heading)) * length * 0.5 + Math.abs(Math.cos(heading)) * width * 0.5;
      boxes.push({ x: midX - hx, y: midY - hy, w: hx * 2, d: hy * 2 });
    }
  }
  for (const node of network.nodes) {
    if (node.segmentIds.length < 2) continue;
    const r = 2.1;
    boxes.push({ x: node.x - r, y: node.y - r, w: r * 2, d: r * 2 });
  }
  return boxes;
}

const PAVEMENT: Record<RoadClass, number> = {
  rural: 0x3a3a3c,
  residential: 0x3e3c3a,
  commercial: 0x3a3a3c,
  arterial: 0x323234,
  highway: 0x2c2c30,
  service: 0x42403c,
  driveway: 0x5a5248,
  ramp: 0x3a3a3c,
};

const SHOULDER: Record<RoadClass, number> = {
  rural: 0x6a6558,
  residential: 0x6a6558,
  commercial: 0x6a6558,
  arterial: 0x5a5850,
  highway: 0x5a5850,
  service: 0x6a6558,
  driveway: 0x6a5a40,
  ramp: 0x6a6558,
};

export function buildRoadMesh(network: RoadNetwork): RoadMeshQuad[] {
  const mesh: RoadMeshQuad[] = [];
  for (const node of network.nodes) {
    if (node.segmentIds.length < 2) continue;
    const segs = node.segmentIds
      .map((id) => network.segments.find((s) => s.id === id))
      .filter((s): s is RoadSegment => !!s && s.roadClass !== "driveway");
    if (segs.length < 2) continue;
    const r = Math.max(...segs.map((s) => s.width * 0.62));
    mesh.push({
      x: node.x - r,
      y: node.y - r,
      w: r * 2,
      d: r * 2,
      z: node.elev,
      heading: 0,
      color: PAVEMENT[segs[0]!.roadClass],
      kind: segs[0]!.layer > 0 ? "deck" : "pavement",
    });
  }
  for (const seg of network.segments) {
    for (let i = 0; i < seg.points.length - 1; i++) {
      const a = seg.points[i]!;
      const b = seg.points[i + 1]!;
      const heading = Math.atan2(b.y - a.y, b.x - a.x);
      const midX = (a.x + b.x) * 0.5;
      const midY = (a.y + b.y) * 0.5;
      const length = len(b.x - a.x, b.y - a.y) + 0.16;
      const z = (a.elev + b.elev) * 0.5;
      if (seg.shoulder > 0.05 && seg.roadClass !== "driveway") {
        mesh.push({
          x: midX,
          y: midY,
          w: length,
          d: seg.width + seg.shoulder * 2,
          z,
          heading,
          color: SHOULDER[seg.roadClass],
          kind: "shoulder",
        });
      }
      mesh.push({
        x: midX,
        y: midY,
        w: length,
        d: seg.width,
        z,
        heading,
        color: PAVEMENT[seg.roadClass],
        kind: seg.layer > 0 ? "deck" : "pavement",
      });
      const nearEnd = i <= 0 || i >= seg.points.length - 2;
      const junction = network.nodes.some(
        (n) => (n.id === seg.startId || n.id === seg.endId) && n.segmentIds.length >= 3,
      );
      if (seg.roadClass !== "driveway" && seg.roadClass !== "service" && !(junction && nearEnd)) {
        mesh.push({
          x: midX,
          y: midY,
          w: Math.max(0.4, length * 0.45),
          d: 0.1,
          z: z + 0.01,
          heading,
          color: 0xd4c56a,
          kind: "mark",
        });
      }
    }
  }
  return mesh;
}

export interface BuilderOpts {
  roadClass?: RoadClass;
  surface?: RoadSurfaceKind;
  width?: number;
  shoulder?: number;
  layer?: number;
}

export class RoadBuilder {
  private nodeN = 0;
  private segN = 0;
  private laneN = 0;
  private accessN = 0;
  readonly nodes: RoadNode[] = [];
  readonly segments: RoadSegment[] = [];
  readonly lanes: Lane[] = [];
  readonly accesses: RoadAccess[] = [];

  node(x: number, y: number, elev = 0, id?: string, layer?: number): RoadNode {
    const existing = this.nodes.find((n) => {
      if (len(n.x - x, n.y - y) >= 0.35) return false;
      if (Math.abs(n.elev - elev) > 0.45) return false;
      if (layer === undefined) return true;
      return nodeTouchesLayer(this, n, layer);
    });
    if (existing) {
      existing.elev = (existing.elev + elev) * 0.5;
      return existing;
    }
    const node: RoadNode = { id: id ?? `n${this.nodeN++}`, x, y, elev, segmentIds: [], junction: "none" };
    this.nodes.push(node);
    return node;
  }

  segment(a: RoadNode, b: RoadNode, points: RoadPoint[], opts: BuilderOpts = {}): RoadSegment {
    const roadClass = opts.roadClass ?? "rural";
    const width = opts.width ?? widthFor(roadClass);
    const id = `s${this.segN++}`;
    const laneA: Lane = {
      id: `l${this.laneN++}`,
      segmentId: id,
      dir: 1,
      offset: -width * 0.22,
      width: width * 0.42,
      speedClass: speedFor(roadClass),
      next: [],
    };
    const laneB: Lane = {
      id: `l${this.laneN++}`,
      segmentId: id,
      dir: -1,
      offset: width * 0.22,
      width: width * 0.42,
      speedClass: speedFor(roadClass),
      next: [],
    };
    this.lanes.push(laneA, laneB);
    const seg: RoadSegment = {
      id,
      startId: a.id,
      endId: b.id,
      points: points.length >= 2 ? points : [pt(a), pt(b)],
      roadClass,
      surface: opts.surface ?? (roadClass === "driveway" ? "gravel" : "asphalt"),
      width,
      shoulder: opts.shoulder ?? (roadClass === "driveway" ? 0.15 : 0.35),
      layer: opts.layer ?? 0,
      laneIds: [laneA.id, laneB.id],
    };
    a.segmentIds.push(id);
    b.segmentIds.push(id);
    this.segments.push(seg);
    return seg;
  }

  access(lotId: string, seg: RoadSegment, t: number, kind: RoadAccess["kind"] = "driveway"): RoadAccess {
    const p = samplePolyline(seg.points, t);
    const a: RoadAccess = {
      id: `a${this.accessN++}`,
      lotId,
      segmentId: seg.id,
      laneId: seg.laneIds[0]!,
      t,
      x: p.x,
      y: p.y,
      kind,
    };
    this.accesses.push(a);
    return a;
  }

  dropAccessesForLots(keepLotIds: Set<string>): void {
    for (let i = this.accesses.length - 1; i >= 0; i--) {
      if (!keepLotIds.has(this.accesses[i]!.lotId)) this.accesses.splice(i, 1);
    }
  }

  nodeById(id: string): RoadNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  /** Snap to an endpoint, or split a same-layer segment whose interior contains the point. */
  joinAt(x: number, y: number, elev = 0, layer = 0): RoadNode {
    const nearNode = this.nodes.find((n) => {
      if (len(n.x - x, n.y - y) >= 0.45) return false;
      if (Math.abs(n.elev - elev) > 0.45) return false;
      return nodeTouchesLayer(this, n, layer) || n.segmentIds.length === 0;
    });
    if (nearNode) return nearNode;

    let best: { seg: RoadSegment; t: number; dist: number } | null = null;
    for (const seg of this.segments) {
      if (seg.layer !== layer) continue;
      const hit = projectPointToPolyline(seg.points, x, y);
      const snap = seg.width * 0.5 + seg.shoulder + 0.55;
      if (hit.dist > snap) continue;
      if (!best || hit.dist < best.dist) best = { seg, t: hit.t, dist: hit.dist };
    }
    if (best) return this.splitSegment(best.seg, best.t).node;
    return this.node(x, y, elev, undefined, layer);
  }

  splitSegment(seg: RoadSegment, t: number): { node: RoadNode; oldId?: string; first?: RoadSegment; second?: RoadSegment; cut?: number } {
    const u = clamp(t, 0, 1);
    const start = this.nodeById(seg.startId);
    const end = this.nodeById(seg.endId);
    if (!start || !end) return { node: this.node(seg.points[0]!.x, seg.points[0]!.y, seg.points[0]!.elev) };
    if (u <= 0.04) return { node: start };
    if (u >= 0.96) return { node: end };
    const split = splitPolyline(seg.points, u);
    const mid = this.node(split.mid.x, split.mid.y, split.mid.elev, undefined, seg.layer);
    if (mid.id === start.id || mid.id === end.id) return { node: mid };
    if (seg.startId === mid.id || seg.endId === mid.id) return { node: mid };
    if (start.segmentIds.includes(seg.id) && end.segmentIds.includes(seg.id) && mid.segmentIds.includes(seg.id)) {
      return { node: mid };
    }

    const opts: BuilderOpts = {
      roadClass: seg.roadClass,
      surface: seg.surface,
      width: seg.width,
      shoulder: seg.shoulder,
      layer: seg.layer,
    };
    this.detachSegment(seg);
    const first = this.segment(start, mid, split.a, opts);
    const second = this.segment(mid, end, split.b, opts);
    this.remapAccesses(seg.id, first, second, u);
    return { node: mid, oldId: seg.id, first, second, cut: u };
  }

  normalizeJunctions(): void {
    let guard = 0;
    while (guard++ < 48) {
      let changed = false;
      const segs = [...this.segments];
      for (let i = 0; i < segs.length; i++) {
        const a = this.segments.find((s) => s.id === segs[i]!.id);
        if (!a) continue;
        for (let j = i + 1; j < segs.length; j++) {
          const b = this.segments.find((s) => s.id === segs[j]!.id);
          if (!b) continue;
          if (a.layer !== b.layer) continue;
          if (sharesEndpoint(a, b)) continue;
          const hit = polylineIntersect(a.points, b.points);
          if (!hit) continue;
          const na = this.splitSegment(a, hit.ta).node;
          const liveB = this.segments.find((s) => s.id === b.id) ?? this.segmentNear(hit.x, hit.y, b.layer);
          if (liveB) this.splitSegment(liveB, projectPointToPolyline(liveB.points, hit.x, hit.y).t);
          const snapped = this.joinAt(hit.x, hit.y, hit.elev, a.layer);
          if (snapped.id !== na.id) {
            this.mergeNodes(na, snapped);
          }
          changed = true;
          break;
        }
        if (changed) break;
      }
      if (!changed) {
        for (const node of [...this.nodes]) {
          const touch = this.interiorHit(node);
          if (!touch) continue;
          this.splitSegment(touch.seg, touch.t);
          changed = true;
          break;
        }
      }
      if (!changed) break;
    }
    this.stripDegenerate();
  }

  finish(opts: { normalize?: boolean } = {}): RoadNetwork {
    if (opts.normalize !== false) this.normalizeJunctions();
    for (const lane of this.lanes) lane.next = [];
    this.wireLanes();
    for (const n of this.nodes) n.junction = junctionOf(n.segmentIds.length);
    const network: RoadNetwork = {
      nodes: this.nodes,
      segments: this.segments,
      lanes: this.lanes,
      accesses: this.accesses,
      mesh: [],
    };
    network.mesh = buildRoadMesh(network);
    return network;
  }

  private wireLanes(): void {
    const bySeg = new Map(this.segments.map((s) => [s.id, s]));
    const laneOf = new Map(this.lanes.map((l) => [l.id, l]));
    for (const node of this.nodes) {
      const incoming: { lane: Lane; heading: number }[] = [];
      for (const sid of node.segmentIds) {
        const seg = bySeg.get(sid);
        if (!seg) continue;
        for (const lid of seg.laneIds) {
          const lane = laneOf.get(lid);
          if (!lane) continue;
          const end = samplePolyline(seg.points, lane.dir === 1 ? 1 : 0);
          const start = samplePolyline(seg.points, lane.dir === 1 ? 0 : 1);
          const towardNode =
            (lane.dir === 1 && seg.endId === node.id) || (lane.dir === -1 && seg.startId === node.id);
          incoming.push({
            lane,
            heading: towardNode
              ? Math.atan2(end.y - start.y, end.x - start.x)
              : Math.atan2(start.y - end.y, start.x - end.x),
          });
        }
      }
      for (const a of incoming) {
        const arrives =
          (bySeg.get(a.lane.segmentId)?.endId === node.id && a.lane.dir === 1) ||
          (bySeg.get(a.lane.segmentId)?.startId === node.id && a.lane.dir === -1);
        if (!arrives) continue;
        for (const b of incoming) {
          if (a.lane.id === b.lane.id) continue;
          const leaves =
            (bySeg.get(b.lane.segmentId)?.startId === node.id && b.lane.dir === 1) ||
            (bySeg.get(b.lane.segmentId)?.endId === node.id && b.lane.dir === -1);
          if (!leaves) continue;
          const sa = bySeg.get(a.lane.segmentId);
          const sb = bySeg.get(b.lane.segmentId);
          if (sa && sb && sa.layer !== sb.layer && sa.roadClass !== "ramp" && sb.roadClass !== "ramp") continue;
          a.lane.next.push(b.lane.id);
        }
      }
    }
    for (const lane of this.lanes) {
      if (lane.next.length > 0) continue;
      const seg = bySeg.get(lane.segmentId);
      if (!seg) continue;
      const endId = lane.dir === 1 ? seg.endId : seg.startId;
      const node = this.nodes.find((n) => n.id === endId);
      if (node && node.segmentIds.length === 1) continue;
    }
  }

  private detachSegment(seg: RoadSegment): void {
    const idx = this.segments.indexOf(seg);
    if (idx >= 0) this.segments.splice(idx, 1);
    for (const lid of seg.laneIds) {
      const li = this.lanes.findIndex((l) => l.id === lid);
      if (li >= 0) this.lanes.splice(li, 1);
    }
    for (const n of this.nodes) {
      n.segmentIds = n.segmentIds.filter((id) => id !== seg.id);
    }
  }

  private remapAccesses(oldId: string, first: RoadSegment, second: RoadSegment, cut: number): void {
    for (const a of this.accesses) {
      if (a.segmentId !== oldId) continue;
      if (a.t <= cut) {
        a.segmentId = first.id;
        a.laneId = first.laneIds[0]!;
        a.t = cut > 1e-4 ? a.t / cut : 0;
      } else {
        a.segmentId = second.id;
        a.laneId = second.laneIds[0]!;
        a.t = (a.t - cut) / Math.max(1e-4, 1 - cut);
      }
    }
  }

  private segmentNear(x: number, y: number, layer: number): RoadSegment | undefined {
    let best: RoadSegment | undefined;
    let bestD = Infinity;
    for (const seg of this.segments) {
      if (seg.layer !== layer) continue;
      const hit = projectPointToPolyline(seg.points, x, y);
      if (hit.dist < bestD) {
        bestD = hit.dist;
        best = seg;
      }
    }
    return best;
  }

  private interiorHit(node: RoadNode): { seg: RoadSegment; t: number } | null {
    const layers = new Set<number>();
    for (const sid of node.segmentIds) {
      const s = this.segments.find((seg) => seg.id === sid);
      if (s) layers.add(s.layer);
    }
    for (const seg of this.segments) {
      if (seg.startId === node.id || seg.endId === node.id) continue;
      if (layers.size && !layers.has(seg.layer)) continue;
      const hit = projectPointToPolyline(seg.points, node.x, node.y);
      if (hit.dist <= Math.max(0.4, seg.width * 0.35) && hit.t > 0.04 && hit.t < 0.96) {
        return { seg, t: hit.t };
      }
    }
    return null;
  }

  private mergeNodes(keep: RoadNode, drop: RoadNode): void {
    if (keep.id === drop.id) return;
    for (const seg of this.segments) {
      if (seg.startId === drop.id) seg.startId = keep.id;
      if (seg.endId === drop.id) seg.endId = keep.id;
    }
    for (const sid of drop.segmentIds) {
      if (!keep.segmentIds.includes(sid)) keep.segmentIds.push(sid);
    }
    const idx = this.nodes.indexOf(drop);
    if (idx >= 0) this.nodes.splice(idx, 1);
  }

  private stripDegenerate(): void {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const seg = this.segments[i]!;
      if (seg.startId === seg.endId && polylineLength(seg.points) < 0.6) this.detachSegment(seg);
    }
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i]!;
      n.segmentIds = n.segmentIds.filter((id) => this.segments.some((s) => s.id === id));
      if (n.segmentIds.length === 0) this.nodes.splice(i, 1);
    }
  }
}

function nodeTouchesLayer(b: RoadBuilder, node: RoadNode, layer: number): boolean {
  if (node.segmentIds.length === 0) return true;
  return node.segmentIds.some((id) => b.segments.find((s) => s.id === id)?.layer === layer);
}

function sharesEndpoint(a: RoadSegment, b: RoadSegment): boolean {
  return a.startId === b.startId || a.startId === b.endId || a.endId === b.startId || a.endId === b.endId;
}

export function pt(p: { x: number; y: number; elev?: number }): RoadPoint {
  return { x: p.x, y: p.y, elev: p.elev ?? 0 };
}

export function linePoints(a: RoadPoint, b: RoadPoint, step = 2.4): RoadPoint[] {
  const dist = len(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(dist / step));
  const out: RoadPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), elev: lerp(a.elev, b.elev, t) });
  }
  return out;
}

export function curvePoints(
  a: RoadPoint,
  ctrl: RoadPoint,
  b: RoadPoint,
  step = 1.4,
): RoadPoint[] {
  const est = len(ctrl.x - a.x, ctrl.y - a.y) + len(b.x - ctrl.x, b.y - ctrl.y);
  const n = Math.max(4, Math.ceil(est / step));
  const out: RoadPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y,
      elev: u * u * a.elev + 2 * u * t * ctrl.elev + t * t * b.elev,
    });
  }
  return out;
}

export function widthFor(roadClass: RoadClass): number {
  switch (roadClass) {
    case "highway":
      return 7.2;
    case "arterial":
      return 5.6;
    case "commercial":
      return 4.4;
    case "rural":
      return 4.2;
    case "residential":
      return 3.4;
    case "service":
      return 2.8;
    case "ramp":
      return 3.6;
    case "driveway":
      return 1.8;
    default: {
      const _never: never = roadClass;
      return _never;
    }
  }
}

function speedFor(roadClass: RoadClass): number {
  switch (roadClass) {
    case "highway":
      return 4;
    case "arterial":
      return 3;
    case "commercial":
    case "rural":
      return 2;
    case "residential":
    case "ramp":
      return 1;
    case "service":
    case "driveway":
      return 0;
    default: {
      const _never: never = roadClass;
      return _never;
    }
  }
}

function junctionOf(n: number): JunctionType {
  if (n <= 1) return "end";
  if (n === 2) return "none";
  if (n === 3) return "T";
  if (n === 4) return "cross";
  return "Y";
}

export function pointOnRoad(network: RoadNetwork, x: number, y: number, layer?: number): boolean {
  return roadSurfaceAt(network, x, y, layer).on;
}

export function headingToward(fromX: number, fromY: number, toX: number, toY: number): number {
  return wrapAngle(Math.atan2(toY - fromY, toX - fromX));
}

export function makeRaisedRoadFixture(): { network: RoadNetwork; terrain: TerrainField } {
  const b = new RoadBuilder();
  const groundA = b.node(0, 0, 0, "g0");
  const groundB = b.node(16, 0, 0, "g1");
  const deckA = b.node(4, 8, 1.6, "d0");
  const deckB = b.node(12, 8, 1.6, "d1");
  const ramp0 = b.node(4, 2.2, 0.2, "r0");
  const ramp1 = b.node(4, 6.2, 1.4, "r1");
  b.segment(groundA, groundB, linePoints(pt(groundA), pt(groundB)), { roadClass: "rural", layer: 0 });
  b.segment(deckA, deckB, linePoints(pt(deckA), pt(deckB)), { roadClass: "rural", layer: 1, width: 4 });
  b.segment(ramp0, ramp1, linePoints(pt(ramp0), pt(ramp1)), { roadClass: "ramp", layer: 1, width: 3.4 });
  const network = b.finish();
  const terrain = emptyTerrain(-2, -2, 22, 14);
  return { network, terrain };
}

export function makeCurveCrossFixture(): RoadNetwork {
  const b = new RoadBuilder();
  const w = b.node(2, 10, 0, "w");
  const c = b.node(14, 10, 0.2, "c");
  const e = b.node(26, 10, 0.4, "e");
  const n = b.node(14, 22, 0.2, "n");
  const s = b.node(14, 2, 0, "s");
  b.segment(w, c, curvePoints(pt(w), { x: 7, y: 7, elev: 0.1 }, pt(c)), { roadClass: "rural" });
  b.segment(c, e, linePoints(pt(c), pt(e)), { roadClass: "rural" });
  b.segment(n, c, linePoints(pt(n), pt(c)), { roadClass: "residential" });
  b.segment(c, s, linePoints(pt(c), pt(s)), { roadClass: "residential" });
  return b.finish();
}
