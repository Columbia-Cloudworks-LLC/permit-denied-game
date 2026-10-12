import { CELL } from "../game/constants";
import { aabbOverlap, clamp, convexOverlap, pointBounds, pointInPoly } from "../game/math";
import { Rng } from "../game/rng";
import type { Building, Lot, LotFrontage, LotIdentity, LotSetbacks, LotSide, LotZone } from "../structure/types";
import { createBuildingFromArchetype } from "../structure/building";
import { ARCHETYPES, pickArchetype, type Archetype } from "./archetypes";
import {
  linePoints,
  offsetPoint,
  polylineLength,
  projectPointToPolyline,
  pt,
  RoadBuilder,
  samplePolyline,
  type RoadNode,
  type RoadSegment,
} from "./roads";
import type { SurfaceGrid } from "./terrain";
import { lotEnvelopeRejected, roadCostAt, sampleSegmentCenterline } from "./terrain";
import { drivewayStyle } from "./drivewayStyle";

export const PARCEL = {
  minFront: 8.4,
  maxFront: 13.6,
  minDepth: 10.6,
  maxDepth: 14.2,
  junctionClear: 3.8,
  roadGap: 0.85,
  lotGap: 0.4,
  driveWidth: 2.05,
  maxExpand: 16,
} as const;

export type ParcelLotClass = {
  id: string;
  weight: number;
  minFront: number;
  maxFront: number;
  minDepth: number;
  maxDepth: number;
};

export type ParcelMetrics = {
  minFront: number;
  maxFront: number;
  minDepth: number;
  maxDepth: number;
  junctionClear: number;
  roadGap: number;
  lotGap: number;
  driveWidth: number;
  maxExpand: number;
  lotClasses?: readonly ParcelLotClass[];
  contiguousFrontage?: boolean;
};

export interface ParcelSetbackRange {
  setbackFront: [number, number];
  setbackSide: [number, number];
  setbackRear: [number, number];
}

let parcelOverride: ParcelMetrics | null = null;
let setbackOverride: ParcelSetbackRange | null = null;

export function currentParcel(): ParcelMetrics {
  return parcelOverride ?? PARCEL;
}

export function runWithParcelProfile<T>(
  parcel: ParcelMetrics | undefined,
  setbacks: ParcelSetbackRange | undefined,
  fn: () => T,
): T {
  const prevParcel = parcelOverride;
  const prevSetbacks = setbackOverride;
  if (parcel) parcelOverride = parcel;
  if (setbacks) setbackOverride = setbacks;
  try {
    return fn();
  } finally {
    parcelOverride = prevParcel;
    setbackOverride = prevSetbacks;
  }
}

export interface NhoodReject {
  kind: "lot" | "building" | "driveway" | "junction";
  reason: string;
  points: { x: number; y: number }[];
}

export interface NhoodDebug {
  rejected: NhoodReject[];
  urban?: import('./urbanGeography').UrbanGeographyReport;
}

function defaultSetbacks(rng?: Rng): LotSetbacks {
  if (setbackOverride) {
    if (!rng) {
      return {
        front: (setbackOverride.setbackFront[0] + setbackOverride.setbackFront[1]) / 2,
        side: (setbackOverride.setbackSide[0] + setbackOverride.setbackSide[1]) / 2,
        rear: (setbackOverride.setbackRear[0] + setbackOverride.setbackRear[1]) / 2,
      };
    }
    return {
      front: rng.range(setbackOverride.setbackFront[0], setbackOverride.setbackFront[1]),
      side: rng.range(setbackOverride.setbackSide[0], setbackOverride.setbackSide[1]),
      rear: rng.range(setbackOverride.setbackRear[0], setbackOverride.setbackRear[1]),
    };
  }
  if (!rng) return { front: 1.45, side: 0.85, rear: 1.15 };
  return {
    front: rng.range(1.25, 1.85),
    side: rng.range(0.7, 1.15),
    rear: rng.range(0.95, 1.55),
  };
}

export function completeLot(
  partial: Omit<Lot, "frontage" | "boundary" | "buildable" | "setbacks" | "arrivalX" | "arrivalY" | "drivewayId"> &
    Partial<Pick<Lot, "frontage" | "boundary" | "buildable" | "setbacks" | "arrivalX" | "arrivalY" | "drivewayId">>,
): Lot {
  const boundary =
    partial.boundary ??
    [
      { x: partial.x, y: partial.y },
      { x: partial.x + partial.w, y: partial.y },
      { x: partial.x + partial.w, y: partial.y + partial.d },
      { x: partial.x, y: partial.y + partial.d },
    ];
  const setbacks = partial.setbacks ?? defaultSetbacks();
  const buildable =
    partial.buildable ??
    insetAabb({ x: partial.x, y: partial.y, w: partial.w, d: partial.d }, setbacks.side, setbacks.front, setbacks.side, setbacks.rear);
  const fx = Math.cos(partial.heading);
  const fy = Math.sin(partial.heading);
  return {
    ...partial,
    frontage: partial.frontage ?? { segmentId: "", side: 1, t0: 0, t1: 1 },
    boundary,
    buildable,
    setbacks,
    arrivalX: partial.arrivalX ?? partial.x + partial.w * 0.5 - fx * 1.2,
    arrivalY: partial.arrivalY ?? partial.y + partial.d * 0.5 - fy * 1.2,
    drivewayId: partial.drivewayId ?? "",
  };
}

function aabbOfPoints(points: readonly { x: number; y: number }[]): { x: number; y: number; w: number; d: number } {
  const { minX, minY, maxX, maxY } = pointBounds(points);
  return { x: minX, y: minY, w: maxX - minX, d: maxY - minY };
}

function insetAabb(
  box: { x: number; y: number; w: number; d: number },
  left: number,
  top: number,
  right: number,
  bottom: number,
): { x: number; y: number; w: number; d: number } {
  return {
    x: box.x + left,
    y: box.y + top,
    w: Math.max(0.2, box.w - left - right),
    d: Math.max(0.2, box.d - top - bottom),
  };
}

function aabbCorners(box: { x: number; y: number; w: number; d: number }): { x: number; y: number }[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.d },
    { x: box.x, y: box.y + box.d },
  ];
}

export function aabbContainedInPoly(
  box: { x: number; y: number; w: number; d: number },
  poly: readonly { x: number; y: number }[],
): boolean {
  return aabbCorners(box).every((p) => pointInPoly(p.x, p.y, poly));
}

export function aabbContainedInBox(
  inner: { x: number; y: number; w: number; d: number },
  outer: { x: number; y: number; w: number; d: number },
  eps = 0.04,
): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.d <= outer.y + outer.d + eps
  );
}

function corridorPoly(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
): { x: number; y: number }[] {
  const heading = Math.atan2(by - ay, bx - ax);
  const hw = width * 0.5;
  const a0 = offsetPoint(ax, ay, heading, hw);
  const a1 = offsetPoint(ax, ay, heading, -hw);
  const b0 = offsetPoint(bx, by, heading, hw);
  const b1 = offsetPoint(bx, by, heading, -hw);
  return [a0, b0, b1, a1];
}

export function parcelFromFrontage(
  seg: RoadSegment,
  side: LotSide,
  t0: number,
  t1: number,
  depth: number,
): { boundary: { x: number; y: number }[]; heading: number } {
  const a = samplePolyline(seg.points, t0);
  const b = samplePolyline(seg.points, t1);
  const inset = seg.width * 0.5 + seg.shoulder + currentParcel().roadGap;
  const f0 = offsetPoint(a.x, a.y, a.heading, inset * side);
  const f1 = offsetPoint(b.x, b.y, b.heading, inset * side);
  const r0 = offsetPoint(a.x, a.y, a.heading, (inset + depth) * side);
  const r1 = offsetPoint(b.x, b.y, b.heading, (inset + depth) * side);
  const heading = a.heading + (side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
  return { boundary: [f0, f1, r1, r0], heading };
}

function buildableFromParcel(
  boundary: readonly { x: number; y: number }[],
  heading: number,
  setbacks: LotSetbacks,
): { x: number; y: number; w: number; d: number } {
  void heading;
  const box = aabbOfPoints(boundary);
  let inset = insetAabb(box, setbacks.side, setbacks.front, setbacks.side, setbacks.rear);
  for (let i = 0; i < 12 && !aabbContainedInPoly(inset, boundary); i++) {
    inset = insetAabb(inset, 0.18, 0.18, 0.18, 0.18);
  }
  if (!aabbContainedInPoly(inset, boundary) || inset.w < 3.2 || inset.d < 2.8) {
    return { x: box.x, y: box.y, w: 0.2, d: 0.2 };
  }
  return inset;
}

function nodeDegree(nodes: readonly RoadNode[], id: string, publicIds: Set<string>): number {
  const node = nodes.find((n) => n.id === id);
  if (!node) return 1;
  return node.segmentIds.filter((sid) => publicIds.has(sid)).length;
}

/** Shared state while lots are cut along every public frontage. */
interface FrontageRun {
  lots: Lot[];
  rejected: NhoodReject[];
  roads: readonly RoadSegment[];
  grid: SurfaceGrid | undefined;
  rng: Rng;
  safety: number;
}

/** Usable frontage on one segment: lots run from `start` to `usable` along a path of length `path`. */
interface FrontageSpan {
  seg: RoadSegment;
  path: number;
  start: number;
  usable: number;
}

export function allocateFrontage(
  segments: readonly RoadSegment[],
  nodes: readonly RoadNode[],
  count: number,
  rng: Rng,
  existing: readonly Lot[] = [],
  roads?: readonly RoadSegment[],
  grid?: SurfaceGrid,
): { lots: Lot[]; rejected: NhoodReject[] } {
  const publicSegs = segments.filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp");
  const checkRoads = (roads ?? publicSegs).filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp");
  const publicIds = new Set(
    [...publicSegs, ...checkRoads].map((s) => s.id),
  );
  const ordered = orderFrontage(publicSegs, rng);
  const run: FrontageRun = { lots: [...existing], rejected: [], roads: checkRoads, grid, rng, safety: Math.max(count * 4, existing.length + 8) };
  for (const seg of ordered) {
    if (run.lots.length >= run.safety) break;
    parcelSegment(run, seg, nodes, publicIds);
  }
  return { lots: run.lots, rejected: run.rejected };
}

/** Contiguous towns walk frontage in id order; scattered ones shuffle it. */
function orderFrontage(publicSegs: readonly RoadSegment[], rng: Rng): RoadSegment[] {
  const ordered = [...publicSegs];
  if (currentParcel().contiguousFrontage) return ordered.sort((a, b) => a.id.localeCompare(b.id));
  for (let i = ordered.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = ordered[i]!;
    ordered[i] = ordered[j]!;
    ordered[j] = tmp;
  }
  return ordered;
}

function parcelSegment(run: FrontageRun, seg: RoadSegment, nodes: readonly RoadNode[], publicIds: Set<string>): void {
  const path = polylineLength(seg.points);
  const parcel = currentParcel();
  if (path < parcel.minFront + 2) return;
  const startClear = nodeDegree(nodes, seg.startId, publicIds) >= 3 ? parcel.junctionClear : 1.4;
  const endClear = nodeDegree(nodes, seg.endId, publicIds) >= 3 ? parcel.junctionClear : 1.4;
  const span: FrontageSpan = { seg, path, start: startClear, usable: path - endClear };
  if (!parcel.contiguousFrontage) {
    alternatingFrontage(run, parcel, span);
    return;
  }
  for (const side of [1, -1] as const) contiguousFrontage(run, parcel, span, side);
}

/** Back-to-back lots down one side; a short leftover is squeezed into the last lot. */
function contiguousFrontage(run: FrontageRun, parcel: ParcelMetrics, span: FrontageSpan, side: LotSide): void {
  const { rng, lots } = run;
  const { usable, path } = span;
  let cursor = span.start;
  while (cursor + parcel.minFront * 0.92 <= usable && lots.length < run.safety) {
    const leftover = usable - cursor;
    const lotClass = pickLotClass(parcel, rng);
    const { minFront, maxFront, minDepth, maxDepth } = lotClassBounds(parcel, lotClass);
    const squeeze = leftover < minFront && leftover >= minFront * 0.88;
    if (!squeeze && cursor + minFront > usable) break;
    const front = squeeze ? leftover : clamp(rng.range(minFront, maxFront), Math.min(minFront, leftover), leftover);
    const depth = rng.range(minDepth, maxDepth);
    const t0 = cursor / path;
    const t1 = (cursor + front) / path;
    cursor += front + parcel.lotGap;
    const made = tryParcel(span.seg, side, t0, t1, depth, lots, rng, run.rejected, run.roads, lotClass?.id, run.grid, minDepth);
    if (made) lots.push(made);
  }
}

/** Facing pairs of lots, starting on a random side and alternating which side is cut first. */
function alternatingFrontage(run: FrontageRun, parcel: ParcelMetrics, span: FrontageSpan): void {
  const { rng, lots } = run;
  const { usable, path } = span;
  let cursor = span.start;
  let slot = 0;
  const side0: LotSide = rng.chance(0.5) ? 1 : -1;
  while (cursor + parcel.minFront <= usable && lots.length < run.safety) {
    const lotClass = pickLotClass(parcel, rng);
    const { minFront, maxFront, minDepth, maxDepth } = lotClassBounds(parcel, lotClass);
    if (cursor + minFront > usable) break;
    const front = clamp(rng.range(minFront, maxFront), minFront, usable - cursor);
    const depth = rng.range(minDepth, maxDepth);
    const t0 = cursor / path;
    const t1 = (cursor + front) / path;
    const side: LotSide = slot % 2 === 0 ? side0 : oppositeSide(side0);
    slot++;
    cursor += front + parcel.lotGap;
    const classId = lotClass?.id;
    const made = tryParcel(span.seg, side, t0, t1, depth, lots, rng, run.rejected, run.roads, classId, run.grid, minDepth);
    if (made) lots.push(made);
    const twin = tryParcel(span.seg, oppositeSide(side), t0, t1, depth * rng.range(0.92, 1.06), lots, rng, run.rejected, run.roads, classId, run.grid, minDepth);
    if (twin) lots.push(twin);
  }
}

const oppositeSide = (side: LotSide): LotSide => side === 1 ? -1 : 1;

/** Frontage and depth range of a picked lot class, falling back to the parcel profile. */
function lotClassBounds(
  parcel: ParcelMetrics,
  lotClass: ParcelLotClass | undefined,
): { minFront: number; maxFront: number; minDepth: number; maxDepth: number } {
  return {
    minFront: lotClass?.minFront ?? parcel.minFront,
    maxFront: lotClass?.maxFront ?? parcel.maxFront,
    minDepth: lotClass?.minDepth ?? parcel.minDepth,
    maxDepth: lotClass?.maxDepth ?? parcel.maxDepth,
  };
}

function pickLotClass(parcel: ParcelMetrics, rng: Rng): ParcelLotClass | undefined {
  const classes = parcel.lotClasses;
  if (!classes?.length) return undefined;
  let pick = rng.range(0, classes.reduce((sum, entry) => sum + entry.weight, 0));
  for (const entry of classes) {
    pick -= entry.weight;
    if (pick <= 0) return entry;
  }
  return classes[classes.length - 1];
}

type ParcelGeom = ReturnType<typeof parcelFromFrontage>;
type Box = { x: number; y: number; w: number; d: number };

/** Bounding box of a well-formed parcel at least 4 units each way, else null. */
function parcelBox(geom: ParcelGeom): Box | null {
  if (geom.boundary.some((p) => Number.isNaN(p.x))) return null;
  const box = aabbOfPoints(geom.boundary);
  return box.w < 4 || box.d < 4 ? null : box;
}

function parcelBlocked(boundary: ParcelGeom['boundary'], lots: readonly Lot[], publicSegs: readonly RoadSegment[]): NhoodReject['reason'] | null {
  if (parcelHitsRoad(boundary, publicSegs, 0)) return "road-corridor";
  if (lots.some((o) => convexOverlap(boundary, o.boundary))) return "lot-overlap";
  return null;
}

const envelopeTooSmall = (buildable: Box): boolean => buildable.w < 3.2 || buildable.d < 2.8;

/** Everything about a new lot that does not depend on how deep its parcel ends up. */
interface LotDraft {
  id: string;
  zone: LotZone;
  identity: LotIdentity;
  templateId: string;
  frontage: LotFrontage;
  setbacks: LotSetbacks;
  mid: { x: number; y: number };
}

function draftLot(draft: LotDraft, geom: ParcelGeom, box: Box, buildable: Box): Lot {
  const heading = geom.heading;
  return completeLot({
    id: draft.id,
    x: box.x,
    y: box.y,
    w: box.w,
    d: box.d,
    heading,
    zone: draft.zone,
    identity: draft.identity,
    accessId: "",
    templateId: draft.templateId,
    frontage: draft.frontage,
    boundary: geom.boundary,
    buildable,
    setbacks: draft.setbacks,
    arrivalX: draft.mid.x + Math.cos(heading) * 2.2,
    arrivalY: draft.mid.y + Math.sin(heading) * 2.2,
  });
}

function tryParcel(
  seg: RoadSegment,
  side: LotSide,
  t0: number,
  t1: number,
  depth: number,
  lots: readonly Lot[],
  rng: Rng,
  rejected: NhoodReject[],
  publicSegs: readonly RoadSegment[] = [seg],
  classId?: string,
  grid?: SurfaceGrid,
  minDepth = currentParcel().minDepth,
): Lot | null {
  const firstGeom = parcelFromFrontage(seg, side, t0, t1, depth);
  const firstBox = parcelBox(firstGeom);
  if (!firstBox) return null;
  const blocked = parcelBlocked(firstGeom.boundary, lots, publicSegs);
  if (blocked) {
    rejected.push({ kind: "lot", reason: blocked, points: firstGeom.boundary });
    return null;
  }
  const setbacks = defaultSetbacks(rng);
  const firstBuildable = buildableFromParcel(firstGeom.boundary, firstGeom.heading, setbacks);
  if (envelopeTooSmall(firstBuildable)) {
    rejected.push({ kind: "lot", reason: "envelope", points: firstGeom.boundary });
    return null;
  }
  const n = lots.length;
  const draft: LotDraft = {
    id: `lot${n}`,
    zone: zoneForLot(n, 100, seg.roadClass),
    identity: identityFor(n, 100, seg.roadClass, rng),
    templateId: classId ?? "",
    frontage: { segmentId: seg.id, side, t0, t1 },
    setbacks,
    mid: samplePolyline(seg.points, (t0 + t1) * 0.5),
  };

  const firstLot = draftLot(draft, firstGeom, firstBox, firstBuildable);
  if (!grid || !lotEnvelopeRejected(grid, firstLot)) return firstLot;
  const shallower = shallowerParcel(draft, seg, depth, Math.min(depth, minDepth), lots, publicSegs, grid);
  if (shallower) return shallower;
  rejected.push({ kind: "lot", reason: "terrain", points: firstGeom.boundary });
  return null;
}

/** Pull the back line toward the street in 1.15-unit steps until the terrain accepts the lot. */
function shallowerParcel(draft: LotDraft, seg: RoadSegment, depth: number, floor: number, lots: readonly Lot[], publicSegs: readonly RoadSegment[], grid: SurfaceGrid): Lot | null {
  const { side, t0, t1 } = draft.frontage;
  for (let depthTry = depth - 1.15; depthTry >= floor - 1e-6; depthTry -= 1.15) {
    const geom = parcelFromFrontage(seg, side, t0, t1, Math.max(floor, depthTry));
    const box = parcelBox(geom);
    if (!box || parcelBlocked(geom.boundary, lots, publicSegs)) break;
    const buildable = buildableFromParcel(geom.boundary, geom.heading, draft.setbacks);
    if (envelopeTooSmall(buildable)) break;
    const lot = draftLot(draft, geom, box, buildable);
    if (!lotEnvelopeRejected(grid, lot)) return lot;
  }
  return null;
}

function boxHitsPublicRoad(
  box: { x: number; y: number; w: number; d: number },
  segments: readonly RoadSegment[],
): boolean {
  return parcelHitsRoad(aabbCorners(box), segments, 0);
}

function streetCorridors(seg: RoadSegment, pad = 0): { x: number; y: number }[][] {
  const half = seg.width * 0.5 + seg.shoulder + pad;
  const polys: { x: number; y: number }[][] = [];
  for (let i = 0; i < seg.points.length - 1; i++) {
    const a = seg.points[i]!;
    const b = seg.points[i + 1]!;
    polys.push(corridorPoly(a.x, a.y, b.x, b.y, half * 2));
  }
  return polys;
}

export function parcelHitsRoad(
  boundary: readonly { x: number; y: number }[],
  segments: readonly RoadSegment[],
  pad = 0,
): boolean {
  if (boundary.length < 3) return false;
  for (const seg of segments) {
    if (seg.roadClass === "driveway") continue;
    for (const corridor of streetCorridors(seg, pad)) {
      if (convexOverlap(boundary, corridor)) return true;
    }
  }
  return false;
}

/** A proposed side street off `host` at `p`, optionally looping back to another segment. */
type StreetCandidate = {
  host: RoadSegment;
  p: ReturnType<typeof samplePolyline>;
  ex: number;
  ey: number;
  kind: RoadSegment["roadClass"];
  other?: { seg: RoadSegment; q: ReturnType<typeof samplePolyline> };
  cost: number;
};

export function expandStreets(b: RoadBuilder, rng: Rng, pass: number, grid?: SurfaceGrid): boolean {
  const publicSegs = b.segments.filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp");
  if (!publicSegs.length) return false;
  const ranked = [...publicSegs].sort((a, c) => {
    const lenDelta = polylineLength(c.points) - polylineLength(a.points);
    if (!grid || Math.abs(lenDelta) > 0.1) return lenDelta;
    return meanSegCost(grid, a) - meanSegCost(grid, c);
  });
  const hosts = ranked.filter((s) => polylineLength(s.points) >= 14);
  const pool = hosts.length ? hosts : ranked;
  let best: StreetCandidate | null = null;
  for (let h = 0; h < Math.min(4, pool.length); h++) {
    const cand = streetCandidate(pool[h]!, pass + h, ranked, rng, grid);
    if (cand && (!best || cand.cost < best.cost)) best = cand;
  }
  if (!best) return false;
  buildStreet(b, best);
  return true;
}

/** Candidate `k` (pass plus host index) picks the branch point, side, length, dead end and loop-back. */
function streetCandidate(host: RoadSegment, k: number, ranked: readonly RoadSegment[], rng: Rng, grid: SurfaceGrid | undefined): StreetCandidate | null {
  const path = polylineLength(host.points);
  if (path < 10) return null;
  const t = 0.22 + ((k * 0.173) % 0.56);
  const p = samplePolyline(host.points, t);
  const lenOut = rng.range(22, 38);
  const side = k % 2 === 0 ? 1 : -1;
  const heading = p.heading + side * (Math.PI * 0.5);
  const deadEnd = k % 3 === 2;
  const reach = deadEnd ? lenOut * 0.72 : lenOut;
  const ex = p.x + Math.cos(heading) * reach;
  const ey = p.y + Math.sin(heading) * reach;
  const cost = grid ? finiteExpansionCost(grid, p.x, p.y, ex, ey) : 1;
  const cand: StreetCandidate = { host, p, ex, ey, kind: k % 4 === 1 ? "service" : "residential", cost };
  if (!deadEnd && k % 3 === 0 && ranked.length > 1) {
    const other = ranked[(k + 1) % ranked.length]!;
    if (other.layer === host.layer) cand.other = { seg: other, q: samplePolyline(other.points, clamp(1 - t, 0.18, 0.82)) };
  }
  return cand;
}

function buildStreet(b: RoadBuilder, best: StreetCandidate): void {
  const junction = b.joinAt(best.p.x, best.p.y, best.p.elev, best.host.layer);
  const end = b.node(best.ex, best.ey, best.p.elev, undefined, best.host.layer);
  b.segment(junction, end, linePoints(pt(junction), pt(end)), { roadClass: best.kind, layer: best.host.layer });
  if (!best.other) return;
  const join = b.joinAt(best.other.q.x, best.other.q.y, best.other.q.elev, best.other.seg.layer);
  if (join.id !== end.id) {
    b.segment(end, join, linePoints(pt(end), pt(join)), { roadClass: "residential", layer: best.host.layer });
  }
}

function finiteExpansionCost(grid: SurfaceGrid, x0: number, y0: number, x1: number, y1: number): number {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.ceil(dist));
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = roadCostAt(grid, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    sum += Number.isFinite(c) ? c : 12;
  }
  return sum / (n + 1);
}

function meanSegCost(grid: SurfaceGrid, seg: RoadSegment): number {
  const samples = sampleSegmentCenterline(seg);
  let sum = 0;
  let n = 0;
  for (const p of samples) {
    const cost = roadCostAt(grid, p.x, p.y);
    if (!Number.isFinite(cost)) return Infinity;
    sum += cost;
    n++;
  }
  return n ? sum / n : Infinity;
}

function remapLotFrontage(lot: Lot, oldId: string, first: RoadSegment, second: RoadSegment, cut: number): void {
  if (lot.frontage.segmentId !== oldId) return;
  const mid = (lot.frontage.t0 + lot.frontage.t1) * 0.5;
  if (mid <= cut) {
    lot.frontage.segmentId = first.id;
    lot.frontage.t0 = cut > 1e-4 ? lot.frontage.t0 / cut : 0;
    lot.frontage.t1 = cut > 1e-4 ? Math.min(1, lot.frontage.t1 / cut) : 1;
  } else {
    lot.frontage.segmentId = second.id;
    lot.frontage.t0 = (lot.frontage.t0 - cut) / Math.max(1e-4, 1 - cut);
    lot.frontage.t1 = (lot.frontage.t1 - cut) / Math.max(1e-4, 1 - cut);
  }
}

export function archetypeFootprint(archetype: Pick<Archetype, "w" | "d" | "cellSize">): { w: number; d: number } {
  const cell = archetype.cellSize ?? CELL;
  return { w: archetype.w * cell, d: archetype.d * cell };
}

/** Widen and deepen a frontage lot so a landmark can sit inside the buildable envelope. */
export function expandLotToFit(
  lot: Lot,
  neededW: number,
  neededD: number,
  publicSegs: readonly RoadSegment[],
  others: readonly Lot[],
  grid?: SurfaceGrid,
): string[] | null {
  const seg = publicSegs.find((s) => s.id === lot.frontage.segmentId);
  if (!seg) return null;
  const path = polylineLength(seg.points);
  if (path < 6) return null;
  const setbacks = lot.setbacks;
  const depth = neededD + setbacks.front + setbacks.rear + 0.4;
  const width = neededW + setbacks.side * 2 + 0.4;
  const mid = clamp((lot.frontage.t0 + lot.frontage.t1) * 0.5, 0.08, 0.92);
  const halfT = (width * 0.5) / path;
  const t0 = clamp(mid - halfT, 0.02, 0.9);
  const t1 = clamp(mid + halfT, t0 + 0.05, 0.98);
  const geom = parcelFromFrontage(seg, lot.frontage.side, t0, t1, depth);
  if (geom.boundary.some((p) => Number.isNaN(p.x)) || parcelHitsRoad(geom.boundary, publicSegs)) return null;
  const buildable = buildableFromParcel(geom.boundary, geom.heading, setbacks);
  if (buildable.w + 0.05 < neededW || buildable.d + 0.05 < neededD) return null;
  const box = aabbOfPoints(geom.boundary);
  if (grid && lotEnvelopeRejected(grid, { ...lot, x: box.x, y: box.y, w: box.w, d: box.d, buildable })) return null;
  const evicted: string[] = [];
  for (const other of others) {
    if (other.id === lot.id) continue;
    if (convexOverlap(geom.boundary, other.boundary)) evicted.push(other.id);
  }
  lot.frontage.t0 = t0;
  lot.frontage.t1 = t1;
  lot.boundary = geom.boundary;
  lot.heading = geom.heading;
  lot.buildable = buildable;
  lot.x = box.x;
  lot.y = box.y;
  lot.w = box.w;
  lot.d = box.d;
  return evicted;
}

export function placeBuildingInLot(
  lot: Lot,
  rng: Rng,
  buildings: readonly Building[],
  publicSegs: readonly RoadSegment[],
  corridors: readonly { x: number; y: number }[][],
  pick?: (lot: Lot, rng: Rng, tried: ReadonlySet<string>) => Archetype | undefined,
): Building | null {
  const tried = new Set<string>();
  const ranked = [...ARCHETYPES.filter((a) => a.zones[lot.zone] > 0)].sort(
    (a, c) => a.w * a.d - c.w * c.d || pickArchetype(lot.zone, rng).w - 0,
  );
  const attempts = pick ? ARCHETYPES.length : ranked.length;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const archetype = pick
      ? pick(lot, rng, tried)
      : attempt === 0 ? pickArchetype(lot.zone, rng) : ranked[attempt]!;
    if (!archetype) break;
    if (tried.has(archetype.id)) continue;
    tried.add(archetype.id);
    const building = fitArchetypeInLot(lot, archetype, buildings, publicSegs, corridors);
    if (building) return building;
  }
  return null;
}

/** Footprint plus decor of an archetype placed at the origin. */
function archetypeUnion(archetype: Archetype): { bw: number; bd: number; minX: number; minY: number; unionW: number; unionD: number } {
  const cell = archetype.cellSize ?? CELL;
  const bw = archetype.w * cell;
  const bd = archetype.d * cell;
  const probe = createBuildingFromArchetype(archetype.id, "probe", 0, 0);
  const extras = probe.decorBoxes.map((d) => ({ x: d.x, y: d.y, w: d.w, d: d.d }));
  const minX = Math.min(0, ...extras.map((d) => d.x));
  const minY = Math.min(0, ...extras.map((d) => d.y));
  const maxX = Math.max(bw, ...extras.map((d) => d.x + d.w));
  const maxY = Math.max(bd, ...extras.map((d) => d.y + d.d));
  return { bw, bd, minX, minY, unionW: maxX - minX, unionD: maxY - minY };
}

/** Centre a span in the envelope, or push it to the side the lot faces. */
function anchorAlong(start: number, size: number, span: number, facing: number): number {
  const pos = facing > 0.45 ? start + size - span - 0.08 : facing < -0.45 ? start + 0.08 : start + (size - span) * 0.5;
  return clamp(pos, start, start + size - span);
}

function fitArchetypeInLot(
  lot: Lot,
  archetype: Archetype,
  buildings: readonly Building[],
  publicSegs: readonly RoadSegment[],
  corridors: readonly { x: number; y: number }[][],
): Building | null {
  const env = lot.buildable;
  const { bw, bd, minX, minY, unionW, unionD } = archetypeUnion(archetype);
  if (unionW + 0.08 > env.w || unionD + 0.08 > env.d) return null;
  const x = anchorAlong(env.x, env.w, unionW, Math.cos(lot.heading)) - minX;
  const y = anchorAlong(env.y, env.d, unionD, Math.sin(lot.heading)) - minY;
  const box = { x, y, w: bw, d: bd };
  if (!footprintClear(box, lot, buildings, publicSegs, corridors)) return null;
  const building = createBuildingFromArchetype(archetype.id, `LOT ${buildings.length + 1} ${archetype.label}`, x, y);
  const occupy = [
    box,
    ...building.decorBoxes.map((d) => ({ x: d.x, y: d.y, w: d.w, d: d.d })),
  ];
  if (occupy.some((ob) => !aabbContainedInBox(ob, env) || !aabbContainedInPoly(ob, lot.boundary))) return null;
  if (occupy.some((ob) => boxHitsPublicRoad(ob, publicSegs))) return null;
  building.lotId = lot.id;
  return building;
}

/** Inside the lot, off public roads, clear of other buildings by 0.4 and of driveway corridors. */
function footprintClear(
  box: { x: number; y: number; w: number; d: number },
  lot: Lot,
  buildings: readonly Building[],
  publicSegs: readonly RoadSegment[],
  corridors: readonly { x: number; y: number }[][],
): boolean {
  if (!aabbContainedInBox(box, lot.buildable) || !aabbContainedInPoly(box, lot.boundary)) return false;
  if (boxHitsPublicRoad(box, publicSegs)) return false;
  if (buildings.some((o) => aabbOverlap(box.x - 0.4, box.y - 0.4, box.w + 0.8, box.d + 0.8, o.x, o.y, o.w * o.cellSize, o.d * o.cellSize))) return false;
  return !corridors.some((poly) => convexOverlap(aabbCorners(box), poly));
}

export function attachDriveway(
  b: RoadBuilder,
  lot: Lot,
  building: Building,
  others: readonly Lot[],
): { corridor: { x: number; y: number }[]; reject?: NhoodReject } | null {
  const seg = b.segments.find((s) => s.id === lot.frontage.segmentId);
  if (!seg) return { corridor: [], reject: { kind: "driveway", reason: "missing-frontage", points: lot.boundary } };
  const t = clamp((lot.frontage.t0 + lot.frontage.t1) * 0.5, lot.frontage.t0 + 0.04, lot.frontage.t1 - 0.04);
  const curb = samplePolyline(seg.points, t);
  const split = b.splitSegment(seg, t);
  const join = split.node;
  if (split.oldId && split.first && split.second && split.cut !== undefined) {
    remapLotFrontage(lot, split.oldId, split.first, split.second, split.cut);
    for (const o of others) remapLotFrontage(o, split.oldId, split.first, split.second, split.cut);
  }
  const live =
    b.segments.find((s) => (s.startId === join.id || s.endId === join.id) && s.roadClass !== "driveway") ??
    split.first ??
    seg;
  if (live.id !== lot.frontage.segmentId) {
    const hit = projectPointToPolyline(live.points, join.x, join.y);
    lot.frontage.segmentId = live.id;
    lot.frontage.t0 = clamp(hit.t - 0.08, 0, 1);
    lot.frontage.t1 = clamp(hit.t + 0.08, 0, 1);
  }
  const bw = building.w * building.cellSize;
  const bd = building.d * building.cellSize;
  const towardStreetX = -Math.cos(lot.heading);
  const towardStreetY = -Math.sin(lot.heading);
  const arrivalX = building.x + bw * 0.5 + towardStreetX * (Math.abs(towardStreetX) > 0.5 ? bw * 0.5 + 0.55 : 0.2);
  const arrivalY = building.y + bd * 0.5 + towardStreetY * (Math.abs(towardStreetY) > 0.5 ? bd * 0.5 + 0.55 : 0.2);
  const arrival = b.node(arrivalX, arrivalY, curb.elev, undefined, seg.layer);
  const style = drivewayStyle(lot.identity);
  const corridor = corridorPoly(join.x, join.y, arrival.x, arrival.y, style.width);
  for (const o of others) {
    if (o.id === lot.id) continue;
    if (convexOverlap(corridor, o.boundary)) {
      return { corridor, reject: { kind: "driveway", reason: "cross-lot", points: corridor } };
    }
  }
  const drive = b.segment(join, arrival, linePoints(pt(join), pt(arrival), 1.2), {
    roadClass: "driveway",
    width: style.width,
    surface: style.surface,
    shoulder: style.shoulder,
    layer: seg.layer,
  });
  const host = b.segments.find((s) => s.id === lot.frontage.segmentId) ?? live;
  const acc = b.access(lot.id, host, projectPointToPolyline(host.points, join.x, join.y).t, "driveway");
  lot.accessId = acc.id;
  lot.drivewayId = drive.id;
  lot.arrivalX = arrival.x;
  lot.arrivalY = arrival.y;
  return { corridor };
}

function zoneForLot(i: number, count: number, roadClass: RoadSegment["roadClass"]): LotZone {
  if (roadClass === "service" || roadClass === "commercial") return i % 3 === 0 ? "industrial" : "commercial";
  if (i === 0) return "commercial";
  if (i >= count - 2) return "industrial";
  if (i % 7 === 0) return "commercial";
  return "residential";
}

function identityFor(i: number, count: number, roadClass: RoadSegment["roadClass"], rng: Rng): LotIdentity {
  if (roadClass === "service") return rng.chance(0.5) ? "utility" : "contractor";
  if (i === 0 || (roadClass === "rural" && i % 11 === 0)) return "shop";
  if (i % 9 === 3) return "service";
  if (i % 5 === 2 || (roadClass === "rural" && i % 4 === 1)) return "farm";
  if (i === count - 1) return "utility";
  return "residence";
}

/** Used by graph tests; re-export join under a stable name. */
