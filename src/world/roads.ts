import { aabbOverlap, clamp, convexOverlap, len, lerp, pointBounds, wrapAngle } from "../game/math";
import { SpatialHash } from "../sim/spatial";
import type { JunctionType, RoadClass, RoadSurfaceKind } from "../structure/types";
import { drivewayPavementColor } from "./drivewayStyle";

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
  /** Clipped world polygon when the ribbon is not a rectangle (driveway/host). */
  poly?: { x: number; y: number }[];
}

export interface RoadNetwork {
  nodes: RoadNode[];
  segments: RoadSegment[];
  lanes: Lane[];
  accesses: RoadAccess[];
  mesh: RoadMeshQuad[];
}

export function emptyTerrain(ox: number, oy: number, w: number, d: number, cell = 2.4): TerrainField {
  const cols = Math.max(2, Math.ceil(w / cell) + 1);
  const rows = Math.max(2, Math.ceil(d / cell) + 1);
  return { ox, oy, cell, cols, rows, height: new Float32Array(cols * rows) };
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
  const span = Math.max(1e-6, polylineLength(points));
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
  const total = polylineLength(points);
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

/** Consecutive point pairs of a polyline with their heading and length. */
function polylineEdges(points: readonly RoadPoint[]): { i: number; a: RoadPoint; b: RoadPoint; heading: number; length: number }[] {
  const edges = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    edges.push({ i, a, b, heading: Math.atan2(b.y - a.y, b.x - a.x), length: len(b.x - a.x, b.y - a.y) });
  }
  return edges;
}

/** Append a copy of `p` unless it repeats the list's last point. */
function pushDistinct(list: RoadPoint[], p: RoadPoint): void {
  const last = list[list.length - 1]!;
  if (len(last.x - p.x, last.y - p.y) > 1e-4) list.push({ x: p.x, y: p.y, elev: p.elev });
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
    const next = walked + (len(p1.x - p0.x, p1.y - p0.y) || 1e-6);
    if (passed) pushDistinct(b, p1);
    else if (cut <= next || i === points.length - 2) {
      pushDistinct(a, mid);
      pushDistinct(b, p1);
      passed = true;
    } else pushDistinct(a, p1);
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

function segmentAabb(seg: RoadSegment): { x: number; y: number; w: number; d: number } {
  const pad = seg.width * 0.5 + seg.shoulder + 0.4;
  const { minX, minY, maxX, maxY } = pointBounds(seg.points);
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
  const consider = (seg: RoadSegment): void => {
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
  };
  for (const seg of nearbySegs) {
    if (currentLayer === undefined || seg.layer === currentLayer) consider(seg);
  }
  if (best.on || currentLayer !== undefined) return best;
  for (const seg of nearbySegs) consider(seg);
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

function connectedLanes(network: RoadNetwork, laneId: string): Lane[] {
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
  const nodeIds = uniqueIds(network.nodes, "dup-node", issues);
  const segIds = new Set<string>();
  for (const s of network.segments) {
    if (segIds.has(s.id)) issues.push({ code: "dup-seg", detail: s.id });
    segIds.add(s.id);
    segmentIssues(network, s, nodeIds, issues);
  }
  laneIssues(network, segIds, issues);
  const accessIds = new Set<string>();
  for (const a of network.accesses) {
    if (accessIds.has(a.id)) issues.push({ code: "dup-access", detail: a.id });
    accessIds.add(a.id);
    if (!segIds.has(a.segmentId)) issues.push({ code: "dangle-access", detail: a.id });
  }
  for (const s of network.segments) clearanceIssues(network, s, issues);
  return { ok: issues.length === 0, issues };
}

function uniqueIds(items: readonly { id: string }[], code: string, issues: RoadIssue[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) issues.push({ code, detail: item.id });
    ids.add(item.id);
  }
  return ids;
}

function clearanceIssues(network: RoadNetwork, s: RoadSegment, issues: RoadIssue[]): void {
  for (const o of network.segments) {
    if (s.id < o.id && s.layer !== o.layer) clearanceIssue(s, o, issues);
  }
}

const maxGrade = (roadClass: RoadClass): number =>
  roadClass === "highway" || roadClass === "arterial" ? 0.08 : roadClass === "ramp" ? 0.18 : 0.14;

function segmentIssues(network: RoadNetwork, s: RoadSegment, nodeIds: ReadonlySet<string>, issues: RoadIssue[]): void {
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
  if (grade > maxGrade(s.roadClass)) issues.push({ code: "grade", detail: `${s.id} grade ${grade.toFixed(3)}` });
}

function laneIssues(network: RoadNetwork, segIds: ReadonlySet<string>, issues: RoadIssue[]): void {
  const laneIds = new Set<string>();
  for (const l of network.lanes) {
    if (laneIds.has(l.id)) issues.push({ code: "dup-lane", detail: l.id });
    laneIds.add(l.id);
    if (!segIds.has(l.segmentId)) issues.push({ code: "dangle-seg", detail: l.id });
    for (const n of l.next) {
      if (!network.lanes.some((o) => o.id === n)) issues.push({ code: "dangle-next", detail: `${l.id} -> ${n}` });
    }
  }
}

/** Segments on different layers that cross need 1.4 units of headroom unless one is a ramp. */
function clearanceIssue(s: RoadSegment, o: RoadSegment, issues: RoadIssue[]): void {
  const ab = segmentAabb(s);
  const bb = segmentAabb(o);
  if (!aabbOverlap(ab.x, ab.y, ab.w, ab.d, bb.x, bb.y, bb.w, bb.d)) return;
  const mid = s.points[Math.floor(s.points.length / 2)]!;
  const hit = projectPointToPolyline(o.points, mid.x, mid.y);
  if (!(hit.dist < (s.width + o.width) * 0.25)) return;
  const clearance = Math.abs(mid.elev - hit.elev);
  if (clearance < 1.4 && s.roadClass !== "ramp" && o.roadClass !== "ramp") {
    issues.push({ code: "clearance", detail: `${s.id} crosses ${o.id} with ${clearance.toFixed(2)}` });
  }
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
  if (!startId || !idx.segmentById.get(startId)) return seen;
  seen.add(startId);
  const stack = [startId];
  while (stack.length) {
    const seg = idx.segmentById.get(stack.pop()!);
    if (seg) pushSameLayerNeighbours(idx, seg, seen, stack);
  }
  return seen;
}

function pushSameLayerNeighbours(idx: ReturnType<typeof indexNetwork>, seg: RoadSegment, seen: Set<string>, stack: string[]): void {
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
    for (const edge of polylineEdges(seg.points)) {
      const { a, b, heading } = edge;
      const midX = (a.x + b.x) * 0.5;
      const midY = (a.y + b.y) * 0.5;
      const length = edge.length + 0.2;
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
  rural: 0x4a463c,
  residential: 0x8c8880,
  commercial: 0x7a7872,
  arterial: 0x5e5c58,
  highway: 0x4a4846,
  service: 0x5a564c,
  driveway: 0x5a4e3c,
  ramp: 0x5a5852,
};

const CURB: Record<RoadClass, number> = {
  rural: 0x5a5448,
  residential: 0x9a968e,
  commercial: 0x8a8882,
  arterial: 0x6a6864,
  highway: 0x5c5a56,
  service: 0x6a6458,
  driveway: 0x6a5a40,
  ramp: 0x6a6860,
};

function pavementColor(seg: RoadSegment): number {
  if (seg.roadClass === "driveway") return drivewayPavementColor(seg.surface);
  return PAVEMENT[seg.roadClass];
}

function usesCurb(roadClass: RoadClass): boolean {
  switch (roadClass) {
    case "residential":
    case "commercial":
    case "arterial":
    case "highway":
      return true;
    case "rural":
    case "service":
    case "driveway":
    case "ramp":
      return false;
    default: {
      const _never: never = roadClass;
      return _never;
    }
  }
}

/** World polygon for a mesh quad. `x`/`y` are centers, matching `drawOrientedGround`. */
export function meshQuadPolygon(q: RoadMeshQuad): { x: number; y: number }[] {
  if (q.poly && q.poly.length >= 3) return q.poly;
  const fx = Math.cos(q.heading);
  const fy = Math.sin(q.heading);
  const hl = q.w * 0.5;
  const hw = q.d * 0.5;
  return [
    { x: q.x + fx * hl - fy * hw, y: q.y + fy * hl + fx * hw },
    { x: q.x + fx * hl + fy * hw, y: q.y + fy * hl - fx * hw },
    { x: q.x - fx * hl + fy * hw, y: q.y - fy * hl - fx * hw },
    { x: q.x - fx * hl - fy * hw, y: q.y - fy * hl + fx * hw },
  ];
}

interface HalfPlane {
  ox: number;
  oy: number;
  nx: number;
  ny: number;
}

function remainCut(cut: number, consumed: number): number {
  return Math.max(0, cut - consumed);
}

function approachSin(along: number, other: number): number {
  return Math.max(0.25, Math.abs(Math.sin(wrapAngle(other - along))));
}

function clipPolyHalfPlane(
  poly: readonly { x: number; y: number }[],
  plane: HalfPlane,
  eps = 1e-7,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const n = poly.length;
  if (n === 0) return out;
  for (let i = 0; i < n; i++) {
    const cur = poly[i]!;
    const prev = poly[(i + n - 1) % n]!;
    const c = (cur.x - plane.ox) * plane.nx + (cur.y - plane.oy) * plane.ny;
    const p = (prev.x - plane.ox) * plane.nx + (prev.y - plane.oy) * plane.ny;
    const cIn = c >= -eps;
    const pIn = p >= -eps;
    if (cIn !== pIn) {
      const t = p / (p - c);
      out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t });
    }
    if (cIn) out.push(cur);
  }
  return out;
}

function clipPolyPlanes(
  poly: readonly { x: number; y: number }[],
  planes: readonly HalfPlane[],
): { x: number; y: number }[] {
  let cur = poly.slice();
  for (const plane of planes) {
    cur = clipPolyHalfPlane(cur, plane);
    if (cur.length < 3) return [];
  }
  return cur;
}

function polyArea(poly: readonly { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

function outwardPlanes(poly: readonly { x: number; y: number }[]): HalfPlane[] {
  const ccw = polyArea(poly) > 0;
  const planes: HalfPlane[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const nx = ccw ? dy : -dy;
    const ny = ccw ? -dx : dx;
    const n = len(nx, ny) || 1;
    planes.push({ ox: a.x, oy: a.y, nx: nx / n, ny: ny / n });
  }
  return planes;
}

function subtractConvex(
  poly: readonly { x: number; y: number }[],
  hole: readonly { x: number; y: number }[],
): { x: number; y: number }[][] {
  if (poly.length < 3 || hole.length < 3 || !convexOverlap(poly, hole)) return [poly.slice()];
  const out: { x: number; y: number }[][] = [];
  for (const plane of outwardPlanes(hole)) {
    const piece = clipPolyHalfPlane(poly, plane);
    if (piece.length >= 3) out.push(piece);
  }
  return out;
}

function openShouldersAtDriveways(mesh: RoadMeshQuad[]): void {
  const holes = mesh.filter((q) => q.kind === "pavement" && q.color === PAVEMENT.driveway).map(meshQuadPolygon);
  if (holes.length === 0) return;
  const next: RoadMeshQuad[] = [];
  for (const q of mesh) {
    if (q.kind !== "shoulder") {
      next.push(q);
      continue;
    }
    let pieces: { x: number; y: number }[][] = [meshQuadPolygon(q)];
    for (const hole of holes) {
      const grown: { x: number; y: number }[][] = [];
      for (const piece of pieces) grown.push(...subtractConvex(piece, hole));
      pieces = grown;
    }
    for (const poly of pieces) {
      if (poly.length < 3) continue;
      next.push({ ...q, poly });
    }
  }
  mesh.length = 0;
  mesh.push(...next);
}

function drivewayKeepPlanes(network: RoadNetwork, seg: RoadSegment, node: RoadNode | undefined): HalfPlane[] {
  if (!node || seg.roadClass !== "driveway") return [];
  const driveOut = outgoingHeading(seg, node);
  const publics = segsAt(network, node, (s) => s.roadClass !== "driveway" && s.layer === seg.layer);
  const planes: HalfPlane[] = [];
  for (const host of publics) {
    const hostAlong = alongHeading(host, host.startId === node.id);
    const side = sideOf(hostAlong, driveOut);
    if (side === 0) continue;
    const edge = offsetPoint(node.x, node.y, hostAlong, side * (host.width * 0.5));
    planes.push({
      ox: edge.x,
      oy: edge.y,
      nx: -Math.sin(hostAlong) * side,
      ny: Math.cos(hostAlong) * side,
    });
  }
  return planes;
}

function segsAt(
  network: RoadNetwork,
  node: RoadNode,
  pred: (s: RoadSegment) => boolean,
): RoadSegment[] {
  const out: RoadSegment[] = [];
  for (const id of node.segmentIds) {
    const s = network.segments.find((x) => x.id === id);
    if (s && pred(s)) out.push(s);
  }
  return out;
}

/** Ids of the given segments meeting at each node. */
function segmentsByNode(segs: readonly RoadSegment[]): Map<string, string[]> {
  const nodeToSegs = new Map<string, string[]>();
  for (const s of segs) {
    for (const nid of [s.startId, s.endId]) {
      const list = nodeToSegs.get(nid) ?? [];
      list.push(s.id);
      nodeToSegs.set(nid, list);
    }
  }
  return nodeToSegs;
}

/** Segment ids sharing either end node with `seg` (including `seg` itself). */
function segmentNeighbors(seg: RoadSegment, nodeToSegs: ReadonlyMap<string, string[]>): string[] {
  return [...(nodeToSegs.get(seg.startId) ?? []), ...(nodeToSegs.get(seg.endId) ?? [])];
}

/** Segment ids reachable from `startId` through shared nodes without leaving `allowed`. */
function floodSegments(
  startId: string,
  byId: ReadonlyMap<string, RoadSegment>,
  nodeToSegs: ReadonlyMap<string, string[]>,
  allowed: ReadonlySet<string>,
): Set<string> {
  const seen = new Set<string>([startId]);
  const stack = [startId];
  while (stack.length) {
    const seg = byId.get(stack.pop()!);
    if (!seg) continue;
    for (const sid of segmentNeighbors(seg, nodeToSegs)) {
      if (!allowed.has(sid) || seen.has(sid)) continue;
      seen.add(sid);
      stack.push(sid);
    }
  }
  return seen;
}

function startHeading(seg: RoadSegment): number {
  const a = seg.points[0]!;
  const b = seg.points[1] ?? a;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function outgoingHeading(seg: RoadSegment, node: RoadNode): number {
  if (seg.startId === node.id) return startHeading(seg);
  const a = seg.points[seg.points.length - 1]!;
  const b = seg.points[seg.points.length - 2] ?? a;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function alongHeading(seg: RoadSegment, fromStart: boolean): number {
  if (fromStart) return startHeading(seg);
  const a = seg.points[seg.points.length - 2] ?? seg.points[0]!;
  const b = seg.points[seg.points.length - 1]!;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function nearlyStraightPair(a: RoadSegment, b: RoadSegment, node: RoadNode): boolean {
  const ha = outgoingHeading(a, node);
  const hb = outgoingHeading(b, node);
  return Math.abs(Math.abs(wrapAngle(ha - hb)) - Math.PI) < 0.38;
}

function isPublicJunction(publics: readonly RoadSegment[], node: RoadNode): boolean {
  if (publics.length >= 3) return true;
  if (publics.length === 2) return !nearlyStraightPair(publics[0]!, publics[1]!, node);
  return false;
}

function junctionHalf(publics: readonly RoadSegment[]): number {
  return Math.max(...publics.map((s) => s.width * 0.5), 0.8);
}

function junctionDisc(x: number, y: number, r: number, sides = 8): { x: number; y: number }[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2 - Math.PI / sides;
    return { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
  });
}

function sideOf(along: number, otherOut: number): 1 | -1 | 0 {
  const c = -Math.sin(along) * Math.cos(otherOut) + Math.cos(along) * Math.sin(otherOut);
  if (Math.abs(c) < 0.22) return 0;
  return c > 0 ? 1 : -1;
}

type EndCut = { pavement: number; shoulder: { 1: number; [-1]: number } };

function endCuts(
  network: RoadNetwork,
  seg: RoadSegment,
  node: RoadNode | undefined,
  fromStart: boolean,
): EndCut {
  const shoulder = { 1: 0, [-1]: 0 };
  if (!node) return { pavement: 0, shoulder };
  const publics = segsAt(network, node, (s) => s.roadClass !== "driveway" && s.layer === seg.layer);
  const drives = segsAt(network, node, (s) => s.roadClass === "driveway" && s.layer === seg.layer);
  const along = alongHeading(seg, fromStart);
  if (seg.roadClass === "driveway") return { pavement: drivewayPavementCut(seg, node, publics, along), shoulder };

  const junction = isPublicJunction(publics, node);
  const half = junction ? junctionHalf(publics) : 0;
  if (junction) {
    for (const o of publics) {
      if (o.id === seg.id) continue;
      const side = sideOf(along, outgoingHeading(o, node));
      if (side !== 0) shoulder[side] = Math.max(shoulder[side], half + o.shoulder);
    }
  }
  for (const d of drives) drivewayShoulderCut(seg, node, d, along, shoulder);
  return { pavement: half, shoulder };
}

/** A driveway stops at its host street's near edge, measured along the driveway. */
function drivewayPavementCut(seg: RoadSegment, node: RoadNode, publics: readonly RoadSegment[], along: number): number {
  const host = publics.find((s) => s.id !== seg.id) ?? publics[0];
  if (!host) return 0;
  const hostAlong = alongHeading(host, host.startId === node.id);
  return (host.width * 0.5) / approachSin(hostAlong, along);
}

/** Open the street shoulder wide enough for a driveway leaving node `node` on one side. */
function drivewayShoulderCut(seg: RoadSegment, node: RoadNode, d: RoadSegment, along: number, shoulder: EndCut['shoulder']): void {
  const outgoing = outgoingHeading(d, node);
  const side = sideOf(along, outgoing);
  if (side === 0) return;
  const ang = wrapAngle(outgoing - along);
  const s = approachSin(along, outgoing);
  const lean = Math.cos(ang);
  const centerOff = (seg.width * 0.5) * (Math.abs(lean) / s) * Math.sign(lean);
  shoulder[side] = Math.max(shoulder[side], Math.max(0.25, centerOff + d.width * 0.5 / s + 0.22));
}

function buildRoadMesh(network: RoadNetwork): RoadMeshQuad[] {
  const mesh: RoadMeshQuad[] = [];
  const nodeById = new Map(network.nodes.map((n) => [n.id, n]));
  for (const node of network.nodes) junctionMesh(network, node, mesh);
  for (const seg of network.segments) segmentMesh(network, seg, nodeById, mesh);
  openShouldersAtDriveways(mesh);
  return mesh;
}

/** Dead ends get a round cap; real junctions get a disc that covers every approach. */
function junctionMesh(network: RoadNetwork, node: RoadNode, mesh: RoadMeshQuad[]): void {
  const byLayer = new Map<number, RoadSegment[]>();
  for (const s of segsAt(network, node, (x) => x.roadClass !== "driveway")) {
    const list = byLayer.get(s.layer) ?? [];
    list.push(s);
    byLayer.set(s.layer, list);
  }
  for (const [, publics] of byLayer) {
    const seg = publics[0]!;
    if (publics.length !== 1 && !isPublicJunction(publics, node)) continue;
    const dead = publics.length === 1;
    const r = dead ? seg.width * 0.55 : junctionHalf(publics) + 0.05;
    mesh.push({
      x: node.x,
      y: node.y,
      w: r * 2,
      d: r * 2,
      z: node.elev,
      heading: 0,
      color: PAVEMENT[seg.roadClass],
      kind: seg.layer > 0 ? "deck" : "pavement",
      poly: junctionDisc(node.x, node.y, r, dead ? 6 : 8),
    });
  }
}

/** Per-segment cut-backs at both ends, shared by every edge of the segment. */
interface SegmentEnds {
  head: EndCut;
  tail: EndCut;
  last: number;
  atJunction: boolean;
  totalLen: number;
  drivePlanes: HalfPlane[];
}

function segmentMesh(network: RoadNetwork, seg: RoadSegment, nodeById: ReadonlyMap<string, RoadNode>, mesh: RoadMeshQuad[]): void {
  const start = nodeById.get(seg.startId);
  const end = nodeById.get(seg.endId);
  const head = endCuts(network, seg, start, true);
  const tail = endCuts(network, seg, end, false);
  const ends: SegmentEnds = {
    head,
    tail,
    last: seg.points.length - 2,
    atJunction: head.pavement > 0.05 || tail.pavement > 0.05,
    totalLen: polylineLength(seg.points),
    drivePlanes: [...drivewayKeepPlanes(network, seg, start), ...drivewayKeepPlanes(network, seg, end)],
  };
  let walked = 0;
  for (const edge of polylineEdges(seg.points)) {
    edgeMesh(seg, edge, walked, ends, mesh);
    walked += edge.length;
  }
}

type PolyEdge = ReturnType<typeof polylineEdges>[number];

function edgeMesh(seg: RoadSegment, edge: PolyEdge, walked: number, ends: SegmentEnds, mesh: RoadMeshQuad[]): void {
  const { i, a, b } = edge;
  const z = (a.elev + b.elev) * 0.5;
  const remaining = ends.totalLen - walked - edge.length;
  const cutA = remainCut(ends.head.pavement, walked);
  const cutB = remainCut(ends.tail.pavement, remaining);
  const driveway = seg.roadClass === "driveway";
  if (seg.shoulder > 0.05 && !driveway) {
    for (const side of [1, -1] as const) {
      shoulderMesh(seg, edge, z, side, remainCut(ends.head.shoulder[side], walked), remainCut(ends.tail.shoulder[side], remaining), mesh);
    }
  }
  const nearEnd = i <= 0 || i >= ends.last;
  pavementMesh(seg, edge, z, cutA, cutB, nearEnd, ends.drivePlanes, mesh);
  if (driveway || seg.roadClass === "service" || (nearEnd && ends.atJunction)) return;
  const mark = shortenEdge(a.x, a.y, b.x, b.y, cutA + 0.4, cutB + 0.4, 0.35);
  if (mark) {
    emitRibbon(mesh, makeRibbon(mark.ax, mark.ay, mark.bx, mark.by, 0.1, z + 0.01, 0xd4c56a, "mark", 0));
  }
}

/** Paved ribbon for one edge; driveways flare where they meet the street and clip to their keep planes. */
function pavementMesh(seg: RoadSegment, edge: PolyEdge, z: number, cutA: number, cutB: number, nearEnd: boolean, drivePlanes: readonly HalfPlane[], mesh: RoadMeshQuad[]): void {
  const { a, b } = edge;
  const driveway = seg.roadClass === "driveway";
  const paved = shortenEdge(a.x, a.y, b.x, b.y, cutA, cutB, driveway ? 0.05 : 0.1);
  if (!paved) return;
  const width = driveway && nearEnd ? seg.width * 1.08 : seg.width;
  const quad = makeRibbon(paved.ax, paved.ay, paved.bx, paved.by, width, z, pavementColor(seg), seg.layer > 0 ? "deck" : "pavement", driveway ? 0.04 : 0.06);
  emitRibbon(mesh, quad, driveway ? drivePlanes : []);
}

/** Shoulder strip on one side of an edge, plus a curb on curbed classes. */
function shoulderMesh(seg: RoadSegment, edge: PolyEdge, z: number, side: 1 | -1, sCut: number, eCut: number, mesh: RoadMeshQuad[]): void {
  const { a, b, heading } = edge;
  const trimmed = shortenEdge(a.x, a.y, b.x, b.y, sCut, eCut, 0.16);
  if (!trimmed) return;
  const o0 = offsetPoint(trimmed.ax, trimmed.ay, heading, side * (seg.width * 0.5 + seg.shoulder * 0.5));
  const o1 = offsetPoint(trimmed.bx, trimmed.by, heading, side * (seg.width * 0.5 + seg.shoulder * 0.5));
  emitRibbon(
    mesh,
    makeRibbon(o0.x, o0.y, o1.x, o1.y, seg.shoulder, z, SHOULDER[seg.roadClass], "shoulder", 0.04),
  );
  if (!usesCurb(seg.roadClass)) return;
  const c0 = offsetPoint(trimmed.ax, trimmed.ay, heading, side * (seg.width * 0.5 + 0.07));
  const c1 = offsetPoint(trimmed.bx, trimmed.by, heading, side * (seg.width * 0.5 + 0.07));
  emitRibbon(
    mesh,
    makeRibbon(c0.x, c0.y, c1.x, c1.y, 0.14, z + 0.005, CURB[seg.roadClass], "shoulder", 0.02),
  );
}

function shortenEdge(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cutA: number,
  cutB: number,
  minKeep = 0.08,
): { ax: number; ay: number; bx: number; by: number } | null {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = len(dx, dy);
  if (dist < cutA + cutB + minKeep) return null;
  const ux = dx / dist;
  const uy = dy / dist;
  return { ax: ax + ux * cutA, ay: ay + uy * cutA, bx: bx - ux * cutB, by: by - uy * cutB };
}

function makeRibbon(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  z: number,
  color: number,
  kind: RoadMeshQuad["kind"],
  seam = 0.06,
): RoadMeshQuad | null {
  const heading = Math.atan2(by - ay, bx - ax);
  const length = len(bx - ax, by - ay);
  if (length < 0.05) return null;
  return {
    x: (ax + bx) * 0.5,
    y: (ay + by) * 0.5,
    w: length + seam,
    d: width,
    z,
    heading,
    color,
    kind,
  };
}

function emitRibbon(
  mesh: RoadMeshQuad[],
  quad: RoadMeshQuad | null,
  planes: readonly HalfPlane[] = [],
): void {
  if (!quad) return;
  if (planes.length === 0) {
    mesh.push(quad);
    return;
  }
  const clipped = clipPolyPlanes(meshQuadPolygon(quad), planes);
  if (clipped.length < 3) return;
  quad.poly = clipped;
  mesh.push(quad);
}

/** One root segment per connected component of `ids`. */
function componentRoots(ids: ReadonlySet<string>, flood: (startId: string, allowed: ReadonlySet<string>) => Set<string>): string[] {
  const roots: string[] = [];
  const visited = new Set<string>();
  for (const id of ids) {
    if (visited.has(id)) continue;
    for (const x of flood(id, ids)) visited.add(x);
    roots.push(id);
  }
  return roots;
}

/** Breadth-first public path from `merged` into `target`; the segments on it, from the hit back, or null. */
function bridgeSegments(
  merged: ReadonlySet<string>,
  target: ReadonlySet<string>,
  byId: ReadonlyMap<string, RoadSegment>,
  nodeToSegs: ReturnType<typeof segmentsByNode>,
  allPublic: ReadonlySet<string>,
): string[] | null {
  const prev = new Map<string, string | null>();
  const q = [...merged];
  for (const id of merged) prev.set(id, null);
  let hit: string | undefined;
  while (q.length && !hit) {
    const seg = byId.get(q.shift()!);
    if (seg) hit = visitNeighbours(seg, nodeToSegs, allPublic, target, prev, q);
  }
  if (!hit) return null;
  const path: string[] = [];
  for (let cur: string | null = hit; cur; cur = prev.get(cur) ?? null) path.push(cur);
  return path;
}

function visitNeighbours(
  seg: RoadSegment,
  nodeToSegs: ReturnType<typeof segmentsByNode>,
  allPublic: ReadonlySet<string>,
  target: ReadonlySet<string>,
  prev: Map<string, string | null>,
  q: string[],
): string | undefined {
  for (const sid of segmentNeighbors(seg, nodeToSegs)) {
    if (!allPublic.has(sid) || prev.has(sid)) continue;
    prev.set(sid, seg.id);
    if (target.has(sid)) return sid;
    q.push(sid);
  }
  return undefined;
}

function lanesAtNode(node: RoadNode, bySeg: ReadonlyMap<string, RoadSegment>, laneOf: ReadonlyMap<string, Lane>): Lane[] {
  const lanes: Lane[] = [];
  for (const sid of node.segmentIds) {
    for (const lid of bySeg.get(sid)?.laneIds ?? []) {
      const lane = laneOf.get(lid);
      if (lane) lanes.push(lane);
    }
  }
  return lanes;
}

/** Whether a lane on `seg` arrives at (`end`) or departs from (`start`) node `nodeId`. */
function laneMeetsNode(seg: RoadSegment | undefined, lane: Lane, nodeId: string, at: "start" | "end"): boolean {
  const forward = at === "end" ? seg?.endId : seg?.startId;
  const backward = at === "end" ? seg?.startId : seg?.endId;
  return (forward === nodeId && lane.dir === 1) || (backward === nodeId && lane.dir === -1);
}

/** Link an arriving lane to every departing lane at the node, except across layers off a ramp. */
function linkDepartures(a: Lane, sa: RoadSegment | undefined, lanes: readonly Lane[], bySeg: ReadonlyMap<string, RoadSegment>, nodeId: string): void {
  for (const b of lanes) {
    if (a.id === b.id) continue;
    const sb = bySeg.get(b.segmentId);
    if (!laneMeetsNode(sb, b, nodeId, "start")) continue;
    if (sa && sb && sa.layer !== sb.layer && sa.roadClass !== "ramp" && sb.roadClass !== "ramp") continue;
    a.next.push(b.id);
  }
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

  /** Drop public streets and orphan driveways that sit outside the kept lot cluster. */
  dropPublicRoadsAwayFromLots(
    lots: readonly { x: number; y: number; w: number; d: number; drivewayId?: string; frontage?: { segmentId: string } }[],
    pad: number,
  ): void {
    if (!lots.length) return;
    const keep = new Set<string>();
    for (const lot of lots) {
      if (lot.drivewayId) keep.add(lot.drivewayId);
    }
    for (const seg of [...this.segments]) this.keepNearLots(seg, lots, pad, keep);
    for (const acc of this.accesses) keep.add(acc.segmentId);
    this.growNearKeep(keep, lots, pad * 1.5);
    this.connectKeptPublic(keep);
    this.dropRedundantFarPublic(keep, lots, pad);
    for (const seg of [...this.segments]) {
      if (!keep.has(seg.id)) this.detachSegment(seg);
    }
    this.stripDegenerate();
  }

  /** Keep a lot's own driveway or ramp, or split off the stretch of public street that serves the lots. */
  private keepNearLots(
    seg: RoadSegment,
    lots: readonly { x: number; y: number; w: number; d: number; drivewayId?: string }[],
    pad: number,
    keep: Set<string>,
  ): void {
    if (seg.roadClass === "driveway" || seg.roadClass === "ramp") {
      if (lots.some((lot) => lot.drivewayId === seg.id)) keep.add(seg.id);
      return;
    }
    if (keep.has(seg.id)) return;
    const live = this.segments.find((s) => s.id === seg.id);
    if (!live) return;
    const range = nearLotTRange(live, lots, pad);
    if (range) this.keepNearPortion(live, range.t0, range.t1, keep);
  }

  private keepNearPortion(seg: RoadSegment, raw0: number, raw1: number, keep: Set<string>): void {
    let t0 = Math.max(0, raw0 - 0.04);
    let t1 = Math.min(1, raw1 + 0.04);
    if (t1 - t0 < 0.1) {
      const mid = (t0 + t1) * 0.5;
      t0 = Math.max(0, mid - 0.08);
      t1 = Math.min(1, mid + 0.08);
    }
    let live = this.segments.find((s) => s.id === seg.id);
    if (!live) return;
    if (t0 > 0.05) {
      const cut = this.splitSegment(live, t0);
      live = cut.second;
      t1 = (t1 - t0) / Math.max(1e-4, 1 - t0);
    }
    if (!live) return;
    if (t1 < 0.95) {
      const cut = this.splitSegment(live, t1);
      if (cut.first) keep.add(cut.first.id);
      return;
    }
    keep.add(live.id);
  }

  private connectKeptPublic(keep: Set<string>): void {
    const publicSegs = this.segments.filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp");
    const byId = new Map(publicSegs.map((s) => [s.id, s]));
    const nodeToSegs = segmentsByNode(publicSegs);
    const flood = (startId: string, allowed: ReadonlySet<string>): Set<string> =>
      floodSegments(startId, byId, nodeToSegs, allowed);
    const remaining = new Set(publicSegs.filter((s) => keep.has(s.id)).map((s) => s.id));
    if (remaining.size <= 1) return;
    const roots = componentRoots(remaining, flood);
    if (roots.length <= 1) return;
    const allPublic = new Set(publicSegs.map((s) => s.id));
    const merged = flood(roots[0]!, remaining);
    for (let i = 1; i < roots.length; i++) {
      const target = flood(roots[i]!, remaining);
      const bridge = bridgeSegments(merged, target, byId, nodeToSegs, allPublic);
      if (!bridge) continue;
      for (const id of bridge) {
        keep.add(id);
        remaining.add(id);
        merged.add(id);
      }
      for (const id of target) merged.add(id);
    }
  }

  private growNearKeep(
    keep: Set<string>,
    lots: readonly { x: number; y: number; w: number; d: number }[],
    pad: number,
  ): void {
    let grown = true;
    while (grown) {
      grown = false;
      for (const seg of this.segments) {
        if (keep.has(seg.id) || seg.roadClass === "driveway" || seg.roadClass === "ramp") continue;
        if (!nearLotTRange(seg, lots, pad)) continue;
        const touches = [seg.startId, seg.endId].some((nid) => {
          const node = this.nodes.find((n) => n.id === nid);
          return node?.segmentIds.some((id) => keep.has(id));
        });
        if (!touches) continue;
        keep.add(seg.id);
        grown = true;
      }
    }
  }

  private dropRedundantFarPublic(
    keep: Set<string>,
    lots: readonly { x: number; y: number; w: number; d: number }[],
    pad: number,
  ): void {
    const accessIds = new Set(this.accesses.map((a) => a.segmentId));
    const far = [...keep]
      .map((id) => this.segments.find((s) => s.id === id))
      .filter((seg): seg is RoadSegment => !!seg && seg.roadClass !== "driveway" && seg.roadClass !== "ramp")
      .map((seg) => {
        const mid = samplePolyline(seg.points, 0.5);
        const dist = Math.min(...lots.map((lot) => {
          const dx = Math.max(lot.x - mid.x, 0, mid.x - lot.x - lot.w);
          const dy = Math.max(lot.y - mid.y, 0, mid.y - lot.y - lot.d);
          return Math.hypot(dx, dy);
        }));
        return { id: seg.id, dist };
      })
      .filter((entry) => entry.dist > pad && !accessIds.has(entry.id))
      .sort((a, b) => b.dist - a.dist);
    for (const entry of far) {
      keep.delete(entry.id);
      if (!this.publicKeepConnected(keep)) keep.add(entry.id);
    }
  }

  private publicKeepConnected(keep: Set<string>): boolean {
    const publicSegs = this.segments.filter(
      (s) => keep.has(s.id) && s.roadClass !== "driveway" && s.roadClass !== "ramp",
    );
    if (publicSegs.length <= 1) return publicSegs.length === 1;
    const allowed = new Set(publicSegs.map((s) => s.id));
    const byId = new Map(publicSegs.map((s) => [s.id, s]));
    const seen = floodSegments(publicSegs[0]!.id, byId, segmentsByNode(publicSegs), allowed);
    return seen.size === publicSegs.length;
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
    while (guard++ < 48 && (this.splitFirstCrossing() || this.splitFirstInteriorTouch())) {
      // Each pass changes the network, so rescan from the start.
    }
    this.stripDegenerate();
  }

  /** Split the first same-layer crossing between two segments that do not share an end. */
  private splitFirstCrossing(): boolean {
    const segs = [...this.segments];
    for (let i = 0; i < segs.length; i++) {
      const a = this.segments.find((s) => s.id === segs[i]!.id);
      if (!a) continue;
      for (let j = i + 1; j < segs.length; j++) {
        const b = this.segments.find((s) => s.id === segs[j]!.id);
        const hit = b && a.layer === b.layer && !sharesEndpoint(a, b) ? polylineIntersect(a.points, b.points) : null;
        if (!b || !hit) continue;
        this.splitAtCrossing(a, b, hit);
        return true;
      }
    }
    return false;
  }

  private splitAtCrossing(a: RoadSegment, b: RoadSegment, hit: NonNullable<ReturnType<typeof polylineIntersect>>): void {
    const na = this.splitSegment(a, hit.ta).node;
    const liveB = this.segments.find((s) => s.id === b.id) ?? this.segmentNear(hit.x, hit.y, b.layer);
    if (liveB) this.splitSegment(liveB, projectPointToPolyline(liveB.points, hit.x, hit.y).t);
    const snapped = this.joinAt(hit.x, hit.y, hit.elev, a.layer);
    if (snapped.id !== na.id) {
      this.mergeNodes(na, snapped);
    }
  }

  private splitFirstInteriorTouch(): boolean {
    for (const node of [...this.nodes]) {
      const touch = this.interiorHit(node);
      if (!touch) continue;
      this.splitSegment(touch.seg, touch.t);
      return true;
    }
    return false;
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
      const lanes = lanesAtNode(node, bySeg, laneOf);
      for (const a of lanes) {
        const sa = bySeg.get(a.segmentId);
        if (laneMeetsNode(sa, a, node.id, "end")) linkDepartures(a, sa, lanes, bySeg, node.id);
      }
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

function pointNearLot(p: { x: number; y: number }, lot: { x: number; y: number; w: number; d: number }, pad: number): boolean {
  const dx = Math.max(lot.x - p.x, 0, p.x - lot.x - lot.w);
  const dy = Math.max(lot.y - p.y, 0, p.y - lot.y - lot.d);
  return dx * dx + dy * dy <= pad * pad;
}

function nearLotTRange(
  seg: RoadSegment,
  lots: readonly { x: number; y: number; w: number; d: number }[],
  pad: number,
): { t0: number; t1: number } | null {
  let t0 = 1;
  let t1 = 0;
  const samples = 10;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = samplePolyline(seg.points, t);
    if (lots.some((lot) => pointNearLot(p, lot, pad))) {
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
  }
  if (t1 < t0) return null;
  return { t0, t1 };
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
