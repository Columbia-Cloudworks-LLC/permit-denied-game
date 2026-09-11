import { CELL } from "../game/constants";
import { aabbOverlap, clamp } from "../game/math";
import { Rng } from "../game/rng";
import type { Building, Lot, LotFrontage, LotIdentity, LotSetbacks, LotSide, LotZone } from "../structure/types";
import { createBuildingFromArchetype } from "../structure/building";
import { ARCHETYPES, pickArchetype } from "./archetypes";
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

export interface NhoodReject {
  kind: "lot" | "building" | "driveway" | "junction";
  reason: string;
  points: { x: number; y: number }[];
}

export interface NhoodDebug {
  rejected: NhoodReject[];
}

function defaultSetbacks(rng?: Rng): LotSetbacks {
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
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
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

function pointInPoly(x: number, y: number, poly: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const hit = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y + 1e-9) + a.x;
    if (hit) inside = !inside;
  }
  return inside;
}

export function convexOverlap(a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[]): boolean {
  return !separatingAxis(a, b) && !separatingAxis(b, a);
}

function separatingAxis(a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    const nx = p.y - q.y;
    const ny = q.x - p.x;
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const v of a) {
      const d = v.x * nx + v.y * ny;
      if (d < minA) minA = d;
      if (d > maxA) maxA = d;
    }
    for (const v of b) {
      const d = v.x * nx + v.y * ny;
      if (d < minB) minB = d;
      if (d > maxB) maxB = d;
    }
    if (maxA < minB - 1e-4 || maxB < minA - 1e-4) return true;
  }
  return false;
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
  const inset = seg.width * 0.5 + seg.shoulder + PARCEL.roadGap;
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

export function allocateFrontage(
  segments: readonly RoadSegment[],
  nodes: readonly RoadNode[],
  count: number,
  rng: Rng,
  existing: readonly Lot[] = [],
  roads?: readonly RoadSegment[],
): { lots: Lot[]; rejected: NhoodReject[] } {
  const lots: Lot[] = [...existing];
  const rejected: NhoodReject[] = [];
  const publicSegs = segments.filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp");
  const checkRoads = (roads ?? publicSegs).filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp");
  const publicIds = new Set(
    [...publicSegs, ...checkRoads].map((s) => s.id),
  );
  const ordered = [...publicSegs];
  for (let i = ordered.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = ordered[i]!;
    ordered[i] = ordered[j]!;
    ordered[j] = tmp;
  }
  const safety = Math.max(count * 4, existing.length + 8);

  for (const seg of ordered) {
    if (lots.length >= safety) break;
    const path = polylineLength(seg.points);
    if (path < PARCEL.minFront + 2) continue;
    const startClear = nodeDegree(nodes, seg.startId, publicIds) >= 3 ? PARCEL.junctionClear : 1.4;
    const endClear = nodeDegree(nodes, seg.endId, publicIds) >= 3 ? PARCEL.junctionClear : 1.4;
    let cursor = startClear;
    const usable = path - endClear;
    let slot = 0;
    const side0: LotSide = rng.chance(0.5) ? 1 : -1;
    while (cursor + PARCEL.minFront <= usable && lots.length < safety) {
      const front = clamp(rng.range(PARCEL.minFront, PARCEL.maxFront), PARCEL.minFront, usable - cursor);
      const depth = rng.range(PARCEL.minDepth, PARCEL.maxDepth);
      const t0 = cursor / path;
      const t1 = (cursor + front) / path;
      const side: LotSide = slot % 2 === 0 ? side0 : side0 === 1 ? -1 : 1;
      slot++;
      cursor += front + PARCEL.lotGap;
      const made = tryParcel(seg, side, t0, t1, depth, lots, rng, rejected, checkRoads);
      if (made) lots.push(made);
      const other: LotSide = side === 1 ? -1 : 1;
      const twin = tryParcel(seg, other, t0, t1, depth * rng.range(0.92, 1.06), lots, rng, rejected, checkRoads);
      if (twin) lots.push(twin);
    }
  }
  return { lots, rejected };
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
): Lot | null {
  const geom = parcelFromFrontage(seg, side, t0, t1, depth);
  if (geom.boundary.some((p) => Number.isNaN(p.x))) return null;
  const box = aabbOfPoints(geom.boundary);
  if (box.w < 4 || box.d < 4) return null;
  if (parcelHitsRoad(geom.boundary, publicSegs, 0)) {
    rejected.push({ kind: "lot", reason: "road-corridor", points: geom.boundary });
    return null;
  }
  for (const o of lots) {
    if (convexOverlap(geom.boundary, o.boundary)) {
      rejected.push({ kind: "lot", reason: "lot-overlap", points: geom.boundary });
      return null;
    }
  }
  const setbacks = defaultSetbacks(rng);
  const buildable = buildableFromParcel(geom.boundary, geom.heading, setbacks);
  if (buildable.w < 3.2 || buildable.d < 2.8) {
    rejected.push({ kind: "lot", reason: "envelope", points: geom.boundary });
    return null;
  }
  const n = lots.length;
  const frontage: LotFrontage = { segmentId: seg.id, side, t0, t1 };
  const mid = samplePolyline(seg.points, (t0 + t1) * 0.5);
  const heading = geom.heading;
  return completeLot({
    id: `lot${n}`,
    x: box.x,
    y: box.y,
    w: box.w,
    d: box.d,
    heading,
    zone: zoneForLot(n, 100, seg.roadClass),
    identity: identityFor(n, 100, seg.roadClass, rng),
    accessId: "",
    templateId: "",
    frontage,
    boundary: geom.boundary,
    buildable,
    setbacks,
    arrivalX: mid.x + Math.cos(heading) * 2.2,
    arrivalY: mid.y + Math.sin(heading) * 2.2,
  });
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

export function expandStreets(b: RoadBuilder, rng: Rng, pass: number): boolean {
  const publicSegs = b.segments.filter((s) => s.roadClass !== "driveway" && s.roadClass !== "ramp");
  if (!publicSegs.length) return false;
  const ranked = [...publicSegs].sort((a, c) => polylineLength(c.points) - polylineLength(a.points));
  const host = ranked.find((s) => polylineLength(s.points) >= 14) ?? ranked[0];
  if (!host) return false;
  const path = polylineLength(host.points);
  if (path < 10) return false;
  const t = 0.22 + ((pass * 0.173) % 0.56);
  const p = samplePolyline(host.points, t);
  const junction = b.joinAt(p.x, p.y, p.elev, host.layer);
  const lenOut = rng.range(22, 38);
  const side = pass % 2 === 0 ? 1 : -1;
  const heading = p.heading + side * (Math.PI * 0.5);
  const deadEnd = pass % 3 === 2;
  const reach = deadEnd ? lenOut * 0.72 : lenOut;
  const ex = junction.x + Math.cos(heading) * reach;
  const ey = junction.y + Math.sin(heading) * reach;
  const end = b.node(ex, ey, p.elev, undefined, host.layer);
  const kind = pass % 4 === 1 ? "service" : "residential";
  b.segment(junction, end, linePoints(pt(junction), pt(end)), { roadClass: kind, layer: host.layer });
  if (!deadEnd && pass % 3 === 0 && ranked.length > 1) {
    const other = ranked[(pass + 1) % ranked.length]!;
    const q = samplePolyline(other.points, clamp(1 - t, 0.18, 0.82));
    const join = b.joinAt(q.x, q.y, q.elev, other.layer);
    if (join.id !== end.id && other.layer === host.layer) {
      b.segment(end, join, linePoints(pt(end), pt(join)), { roadClass: "residential", layer: host.layer });
    }
  }
  return true;
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

export function placeBuildingInLot(
  lot: Lot,
  rng: Rng,
  buildings: readonly Building[],
  publicSegs: readonly RoadSegment[],
  corridors: readonly { x: number; y: number }[][],
): Building | null {
  const tried = new Set<string>();
  const ranked = [...ARCHETYPES.filter((a) => a.zones[lot.zone] > 0)].sort(
    (a, c) => a.w * a.d - c.w * c.d || pickArchetype(lot.zone, rng).w - 0,
  );
  for (let attempt = 0; attempt < ranked.length; attempt++) {
    const archetype = attempt === 0 ? pickArchetype(lot.zone, rng) : ranked[attempt]!;
    if (tried.has(archetype.id)) continue;
    tried.add(archetype.id);
    const bw = archetype.w * CELL;
    const bd = archetype.d * CELL;
    const env = lot.buildable;
    const probe = createBuildingFromArchetype(archetype.id, "probe", 0, 0);
    const extras = probe.decorBoxes.map((d) => ({ x: d.x, y: d.y, w: d.w, d: d.d }));
    const minX = Math.min(0, ...extras.map((d) => d.x));
    const minY = Math.min(0, ...extras.map((d) => d.y));
    const maxX = Math.max(bw, ...extras.map((d) => d.x + d.w));
    const maxY = Math.max(bd, ...extras.map((d) => d.y + d.d));
    const unionW = maxX - minX;
    const unionD = maxY - minY;
    if (unionW + 0.08 > env.w || unionD + 0.08 > env.d) continue;
    const fx = Math.cos(lot.heading);
    const fy = Math.sin(lot.heading);
    let ux = env.x + (env.w - unionW) * 0.5;
    let uy = env.y + (env.d - unionD) * 0.5;
    if (fx > 0.45) ux = env.x + env.w - unionW - 0.08;
    else if (fx < -0.45) ux = env.x + 0.08;
    if (fy > 0.45) uy = env.y + env.d - unionD - 0.08;
    else if (fy < -0.45) uy = env.y + 0.08;
    ux = clamp(ux, env.x, env.x + env.w - unionW);
    uy = clamp(uy, env.y, env.y + env.d - unionD);
    const x = ux - minX;
    const y = uy - minY;
    const box = { x, y, w: bw, d: bd };
    if (!aabbContainedInBox(box, env) || !aabbContainedInPoly(box, lot.boundary)) continue;
    if (boxHitsPublicRoad(box, publicSegs)) continue;
    if (buildings.some((o) => aabbOverlap(box.x - 0.4, box.y - 0.4, box.w + 0.8, box.d + 0.8, o.x, o.y, o.w * o.cellSize, o.d * o.cellSize))) {
      continue;
    }
    if (corridors.some((poly) => convexOverlap(aabbCorners(box), poly))) continue;
    const building = createBuildingFromArchetype(archetype.id, `LOT ${buildings.length + 1} ${archetype.label}`, x, y);
    const occupy = [
      box,
      ...building.decorBoxes.map((d) => ({ x: d.x, y: d.y, w: d.w, d: d.d })),
    ];
    if (occupy.some((ob) => !aabbContainedInBox(ob, env) || !aabbContainedInPoly(ob, lot.boundary))) {
      continue;
    }
    if (occupy.some((ob) => boxHitsPublicRoad(ob, publicSegs))) continue;
    return building;
  }
  return null;
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
  const corridor = corridorPoly(join.x, join.y, arrival.x, arrival.y, PARCEL.driveWidth);
  for (const o of others) {
    if (o.id === lot.id) continue;
    if (convexOverlap(corridor, o.boundary)) {
      return { corridor, reject: { kind: "driveway", reason: "cross-lot", points: corridor } };
    }
  }
  const drive = b.segment(join, arrival, linePoints(pt(join), pt(arrival), 1.2), {
    roadClass: "driveway",
    width: PARCEL.driveWidth,
    shoulder: 0.12,
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
