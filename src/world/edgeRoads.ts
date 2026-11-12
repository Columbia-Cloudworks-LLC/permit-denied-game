import { len } from "../game/math";
import { hashSeed, mixSeed } from "../game/rng";
import { aridLandscape, SOILS, type ClimateEnvelope } from "./climate";
import { linePoints, projectPointToRoad, pt, samplePolyline, polylineLength, type RoadBuilder, type RoadMeshQuad, type RoadNetwork, type RoadNode, type RoadSegment } from "./roads";

export interface EdgeBounds { minX: number; minY: number; maxX: number; maxY: number }
interface Box { x: number; y: number; w: number; d: number }
type Side = "west" | "north" | "east" | "south";

const SIDES: readonly Side[] = ["west", "north", "east", "south"];
/** Unit direction of travel from the town toward each map edge. */
const OUTWARD: Record<Side, { x: number; y: number }> = {
  west: { x: -1, y: 0 }, north: { x: 0, y: -1 }, east: { x: 1, y: 0 }, south: { x: 0, y: 1 },
};
/** A new junction keeps this far from an existing node along its host road. */
const JUNCTION_SPACING = 4.5;
const SAMPLE_STEP = 2.4;

interface Candidate { side: Side; x: number; y: number; host: RoadSegment; t: number; node?: RoadNode; cost: number }

/**
 * Run straight public roads from the town out to the map edges so traffic can enter and leave.
 * One road per side at most, each from the closest point on an existing public road whose
 * straight run to the edge stays clear of lots, buildings and other roads. Returns the exit nodes.
 */
export function addEdgeRoads(b: RoadBuilder, bounds: EdgeBounds, blockers: readonly Box[]): RoadNode[] {
  const exits: RoadNode[] = [];
  for (const side of SIDES) {
    if (alreadyExits(b, bounds, side)) continue;
    const best = bestCandidate(b, bounds, blockers, side);
    if (!best) continue;
    const start = best.node ?? b.splitSegment(best.host, best.t).node;
    const end = edgePoint(bounds, side, start.x, start.y);
    const exit = b.node(end.x, end.y, 0, undefined, 0);
    b.segment(start, exit, linePoints(pt(start), pt(exit)), { roadClass: exitClass(best.host), width: best.host.width });
    exits.push(exit);
  }
  return exits;
}

/** Whether a public road already ends on this edge. */
function alreadyExits(b: RoadBuilder, bounds: EdgeBounds, side: Side): boolean {
  return b.nodes.some(n => n.segmentIds.length === 1 && distanceToEdge(bounds, side, n.x, n.y) < 1.5 &&
    b.segments.some(s => s.id === n.segmentIds[0] && isPublic(s)));
}

function bestCandidate(b: RoadBuilder, bounds: EdgeBounds, blockers: readonly Box[], side: Side): Candidate | undefined {
  let best: Candidate | undefined;
  for (const c of candidates(b, bounds, side)) {
    if (best && c.cost >= best.cost) continue;
    if (!corridorClear(b, bounds, blockers, c)) continue;
    best = c;
  }
  return best;
}

function* candidates(b: RoadBuilder, bounds: EdgeBounds, side: Side): Generator<Candidate> {
  const dir = OUTWARD[side];
  for (const host of b.segments) {
    if (!isPublic(host) || host.layer !== 0) continue;
    const total = polylineLength(host.points);
    const steps = Math.max(1, Math.floor(total / SAMPLE_STEP));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = samplePolyline(host.points, t);
      const along = t * total;
      const node = along < 0.6 ? b.nodeById(host.startId) : total - along < 0.6 ? b.nodeById(host.endId) : undefined;
      if (node) {
        if (!nodeCanBranch(b, node, dir)) continue;
      } else {
        if (along < JUNCTION_SPACING || total - along < JUNCTION_SPACING) continue;
        // Only branch across the host road, never along it.
        if (Math.abs(Math.cos(p.heading) * dir.x + Math.sin(p.heading) * dir.y) > 0.5) continue;
      }
      const x = node?.x ?? p.x, y = node?.y ?? p.y;
      const cost = distanceToEdge(bounds, side, x, y);
      if (cost < 2) continue;
      yield { side, x, y, host, t, node, cost };
    }
  }
}

/** A node may branch toward the edge when no road already leaves it in that direction. */
function nodeCanBranch(b: RoadBuilder, node: RoadNode, dir: { x: number; y: number }): boolean {
  if (node.segmentIds.length >= 4) return false;
  for (const id of node.segmentIds) {
    const seg = b.segments.find(s => s.id === id);
    if (!seg) continue;
    const pts = seg.points;
    const from = seg.startId === node.id ? pts[0]! : pts[pts.length - 1]!;
    const to = seg.startId === node.id ? pts[1]! : pts[pts.length - 2]!;
    const l = len(to.x - from.x, to.y - from.y) || 1;
    if (((to.x - from.x) * dir.x + (to.y - from.y) * dir.y) / l > 0.7) return false;
  }
  return true;
}

/** The straight run to the edge misses every lot, building, open space and unrelated road. */
function corridorClear(b: RoadBuilder, bounds: EdgeBounds, blockers: readonly Box[], c: Candidate): boolean {
  const end = edgePoint(bounds, c.side, c.x, c.y);
  const half = c.host.width * 0.5 + c.host.shoulder + 0.5;
  const skip = c.host.width * 0.5 + c.host.shoulder + 0.4;
  const dir = OUTWARD[c.side];
  const sx = c.x + dir.x * skip, sy = c.y + dir.y * skip;
  const box: Box = {
    x: Math.min(sx, end.x) - (dir.x ? 0 : half),
    y: Math.min(sy, end.y) - (dir.y ? 0 : half),
    w: Math.abs(end.x - sx) + (dir.x ? 0 : half * 2),
    d: Math.abs(end.y - sy) + (dir.y ? 0 : half * 2),
  };
  if (box.w <= 0 || box.d <= 0) return false;
  for (const o of blockers) if (overlap(box, o)) return false;
  const touching = new Set(c.node ? c.node.segmentIds : [c.host.id]);
  for (const seg of b.segments) {
    if (touching.has(seg.id) || seg.layer !== 0) continue;
    const pad = seg.width * 0.5 + seg.shoulder;
    const grown: Box = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, d: box.d + pad * 2 };
    if (polylineHitsBox(seg, grown)) return false;
  }
  return true;
}

function polylineHitsBox(seg: RoadSegment, box: Box): boolean {
  const total = polylineLength(seg.points);
  const steps = Math.max(2, Math.ceil(total / 0.5));
  for (let i = 0; i <= steps; i++) {
    const p = samplePolyline(seg.points, i / steps);
    if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.d) return true;
  }
  return false;
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.d && a.y + a.d > b.y;
const isPublic = (s: RoadSegment) => s.roadClass !== "driveway" && s.roadClass !== "ramp";
const exitClass = (host: RoadSegment) => host.roadClass === "service" ? "residential" : host.roadClass;

function distanceToEdge(bounds: EdgeBounds, side: Side, x: number, y: number): number {
  if (side === "west") return x - bounds.minX;
  if (side === "east") return bounds.maxX - x;
  if (side === "north") return y - bounds.minY;
  return bounds.maxY - y;
}

function edgePoint(bounds: EdgeBounds, side: Side, x: number, y: number): { x: number; y: number } {
  if (side === "west") return { x: bounds.minX, y };
  if (side === "east") return { x: bounds.maxX, y };
  if (side === "north") return { x, y: bounds.minY };
  return { x, y: bounds.maxY };
}

/** Public road ends on the map boundary: where traffic enters and leaves. */
export function edgeExitNodes(network: { nodes: readonly RoadNode[]; segments: readonly RoadSegment[] }, bounds: EdgeBounds): RoadNode[] {
  return network.nodes.filter(n => {
    if (n.segmentIds.length !== 1) return false;
    const seg = network.segments.find(s => s.id === n.segmentIds[0]);
    if (!seg || !isPublic(seg)) return false;
    return SIDES.some(side => Math.abs(distanceToEdge(bounds, side, n.x, n.y)) < 1.5);
  });
}


const CURB_WIDTH = 0.2;
const BLEACHED_ASPHALT = 0x8c877c;
const DECOMPOSED_GRANITE = 0xc2ab84;
const WASH_CONCRETE = 0xb4ae9c;
const HEAT_CRACK = 0x2e2c2a;
const CRACK_SPACING = 2.6;

function mix(a: number, b: number, t: number): number {
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) << shift;
  return channel(16) | channel(8) | channel(0);
}

/** Uncurbed classes carry a soft shoulder: mud and grass where it rains, bare soil where it does not. */
const softShoulder = (s: RoadSegment) => s.roadClass === "rural" || s.roadClass === "service" || s.roadClass === "driveway" || s.roadClass === "ramp";

/** Desert colour of one road quad on its segment, or `undefined` to leave it alone. */
export function aridRoadColor(quad: Pick<RoadMeshQuad, "kind" | "color" | "d">, seg: RoadSegment, climate: Pick<ClimateEnvelope, "soil">): number | undefined {
  const soil = SOILS[climate.soil];
  if (quad.kind === "shoulder") return softShoulder(seg) && quad.d > CURB_WIDTH ? soil.verge : undefined;
  if (quad.kind !== "pavement") return undefined;
  switch (seg.surface) {
    case "asphalt":
      return mix(quad.color, BLEACHED_ASPHALT, 0.42);
    case "gravel":
      return mix(DECOMPOSED_GRANITE, soil.verge, 0.35);
    case "dirt":
      return soil.track;
    case "concrete":
      return mix(quad.color, WASH_CONCRETE, 0.4);
    default: {
      const _never: never = seg.surface;
      return _never;
    }
  }
}

/**
 * Finish a built road mesh for desert and canyon country. Soft shoulders and ditches become bare
 * caliche or red-dirt verges in the zone's soil, asphalt bleaches, gravel drives turn to
 * decomposed granite, the roads out to the map edge crack in the heat, and a concrete low-water
 * crossing is poured wherever one of them fords a dry wash. Every other climate is left exactly
 * as built. Colour and garnish only: lanes, widths and collision never change.
 */
export function dressAridRoads(
  network: RoadNetwork,
  climate: Pick<ClimateEnvelope, "landscape" | "soil">,
  bounds: EdgeBounds,
  isWash: (x: number, y: number) => boolean = () => false,
): void {
  if (!aridLandscape(climate) || !network.mesh.length) return;
  const byId = new Map(network.segments.map(seg => [seg.id, seg]));
  for (const quad of network.mesh) {
    const id = projectPointToRoad(network, quad.x, quad.y).segmentId;
    const seg = id ? byId.get(id) : undefined;
    const color = seg && aridRoadColor(quad, seg, climate);
    if (color !== undefined) quad.color = color;
  }
  const exits = new Set(edgeExitNodes(network, bounds).map(n => n.id));
  for (const seg of network.segments) {
    if (!exits.has(seg.startId) && !exits.has(seg.endId)) continue;
    network.mesh.push(...heatCracks(seg), ...lowWaterCrossings(seg, isWash));
  }
}

/** Transverse shrinkage cracks along a sun-baked road, placed from the segment's own hash. */
function heatCracks(seg: RoadSegment): RoadMeshQuad[] {
  if (seg.surface !== "asphalt") return [];
  const total = polylineLength(seg.points), seed = hashSeed(`crack:${seg.id}:${Math.round(total * 8)}`);
  const out: RoadMeshQuad[] = [];
  for (let i = 0, along = CRACK_SPACING * 0.5; along < total - 0.6; i++, along += CRACK_SPACING) {
    const roll = mixSeed(seed + i * 7919) / 0x1_0000_0000;
    const p = samplePolyline(seg.points, Math.min(1, (along + (roll - 0.5) * 1.4) / total));
    const reach = seg.width * (0.45 + roll * 0.5), side = (roll * 7) % 1 - 0.5;
    const ox = -Math.sin(p.heading) * side * (seg.width - reach), oy = Math.cos(p.heading) * side * (seg.width - reach);
    out.push({ x: p.x + ox, y: p.y + oy, w: 0.05, d: reach, z: p.elev + 0.012, heading: p.heading + (roll - 0.5) * 0.5, color: HEAT_CRACK, kind: "mark" });
  }
  return out;
}

/** A concrete apron across each run of wash the road crosses, a little wider than the pavement and its shoulders. */
export function lowWaterCrossings(seg: RoadSegment, isWash: (x: number, y: number) => boolean): RoadMeshQuad[] {
  const total = polylineLength(seg.points), steps = Math.max(2, Math.ceil(total / 0.6));
  const out: RoadMeshQuad[] = [];
  let from = -1;
  for (let i = 0; i <= steps + 1; i++) {
    const p = i <= steps ? samplePolyline(seg.points, i / steps) : undefined;
    if (p && isWash(p.x, p.y)) {
      if (from < 0) from = i;
      continue;
    }
    if (from < 0) continue;
    const a = samplePolyline(seg.points, Math.max(0, from - 1) / steps), b = samplePolyline(seg.points, Math.min(steps, i) / steps);
    const length = len(b.x - a.x, b.y - a.y), heading = Math.atan2(b.y - a.y, b.x - a.x);
    const slab = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.elev + b.elev) / 2 + 0.014, heading };
    const width = seg.width + seg.shoulder * 2 + 0.5;
    out.push({ ...slab, w: length, d: width, color: WASH_CONCRETE, kind: "pavement" });
    // Raised kerbs along both edges keep the ford visible when the wash runs.
    for (const side of [1, -1]) {
      const off = side * (width / 2 - 0.08);
      out.push({ ...slab, x: slab.x - Math.sin(heading) * off, y: slab.y + Math.cos(heading) * off, z: slab.z + 0.004, w: length, d: 0.16, color: mix(WASH_CONCRETE, 0x5c5a50, 0.45), kind: "pavement" });
    }
    from = -1;
  }
  return out;
}
