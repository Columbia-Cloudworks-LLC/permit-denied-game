import { DOZER, POLICE_CRUISE } from '../game/constants';
import { clamp, wrapAngle } from '../game/math';
import { Rng } from '../game/rng';
import type { CampaignLevelId } from '../game/campaign';
import type { DistrictId } from '../game/session';
import { cellPresent, cellWorldBox, type WorldEvent } from '../structure/types';
import { edgeExitNodes } from '../world/edgeRoads';
import { indexNetwork, offsetPoint, polylineLength, roadSurfaceAt, samplePolyline, type Lane, type RoadNetwork, type RoadSegment } from '../world/roads';
import { policeMayLeaveRoad, rockBetween } from '../world/routing';
import type { Town } from '../world/town';
import { dozerSpeed, type Dozer } from './dozer';
import { vehicleDefinition } from './definitions';
import { countVehicleHit, createVehicle } from './runtime';
import type { TrafficAgent, TrafficRole, VehicleState } from './types';

/**
 * Through traffic and police. Civilians enter at a map-edge exit, drive lanes to another exit
 * and leave; they keep their following distance and slow for corners. They ignore the dozer
 * until it is in the road just ahead or right beside them: then they brake, steer around it if
 * the road has room, and otherwise turn back. Civilians never leave the road.
 * Police ignore speed and lane rules, pass traffic, and ram the dozer until three hits wreck them.
 */

export interface TrafficConfig {
  /** Most civilian cars on the map at once. */
  civilians: number;
  /** Most Code Enforcement cruisers at once; zero turns dispatch off. */
  police: number;
  /** Seconds from an enforcement alert to its cruiser reaching the map edge. */
  policeDelay: number;
  /** Seconds between a police car going down and the next one arriving. */
  policeCooldown: number;
  /** Buses join the mix on city streets. */
  city: boolean;
}

interface Exit { x: number; y: number; inbound: string; outbound: string }

export interface TrafficState {
  config: TrafficConfig;
  rng: Rng;
  time: number;
  spawnT: number;
  policeT: number;
  /** Code Enforcement alert: cruisers dispatch wants on the map (0 until the run earns one). */
  alert: number;
  /** Police requested by the sandbox key, waiting for a clear entrance. */
  policeQueued: number;
  exits: Exit[];
  laneBlocked: Set<string>;
  blockT: number;
  /** Standing props on the pavement, refreshed with the blocked lanes. */
  roadProps: Town['props'];
  /** Junction node and the civilians crossing it now; several may hold it when their movements do not cross. */
  junctions: Map<string, JunctionHold[]>;
}

type Point = { x: number; y: number };

/** One car's claim on a junction: when it joined, when its platoon first took the junction, the road it comes in on and the line it drives across. */
interface JunctionHold { id: number; at: number; since: number; from: string; line: Point[] }

/** Cruise speed by road class, scaled up from posted limits so a car can outrun the dozer. */
const CRUISE: Record<RoadSegment['roadClass'], number> = {
  highway: 15, arterial: 12.5, commercial: 10.5, rural: 12, residential: 9.5, service: 7, ramp: 9, driveway: 4,
};
const POLICE_RAM = 13;
const POLICE_HITS = 3;
const RAM_HEAT = 10;
const RAM_TRACK = 7;
/** The driver's view: a cone out of the front bumper. Buildings block it. */
export const SIGHT = { range: 30, halfAngle: (55 * Math.PI) / 180 };
const MEMORY = 8;
/** How close beside a car the dozer has to be before the driver minds it. */
const NEAR = 2.6;
/** Seconds a platoon may keep feeding one junction before cross traffic gets its turn. */
const PLATOON = 5;
/** Lines across a junction closer than this conflict; the two lanes of the narrowest road sit just wider apart. */
const LINE_GAP = 1.2;
/** A car standing in a junction blocks lines passing within this of its centre. */
const STANDING_GAP = 1.6;
const ACCEL = 6.5;
const BRAKE = 13;
const POINT_STEP = 1.2;
const DOZER_LEAD = 0.6;
/** Lane points dropped each side of a turn. */
const CORNER_TRIM = 2;
/** Most a car moves off its lane's centre toward the kerb. */
const KERB_PAD = 0.3;
/** Distance over which a car off its line gets back onto it. */
const STRAIGHTEN = 5;
/** Clear air a driver leaves beside something it goes around. */
const PASS_MARGIN = 0.75;
/** A car heading for an exit within this distance of it keeps new arrivals out until it has left. */
const EXIT_CLEAR = 26;

const DENSITY: Record<CampaignLevelId, number> = {
  county: 6, village: 8, township: 12, suburb: 14, 'city-borough': 22, 'city-downtown': 28, 'governors-mansion': 6,
};
const DISTRICT_DENSITY: Record<DistrictId, number> = { classic: 4, d10: 6, d30: 12, d100: 24 };

export function trafficConfigFor(town: Pick<Town, 'campaignLevel' | 'district'>, police: boolean): TrafficConfig {
  const civilians = town.campaignLevel ? DENSITY[town.campaignLevel] : DISTRICT_DENSITY[town.district];
  const city = town.campaignLevel === 'city-borough' || town.campaignLevel === 'city-downtown' || town.district === 'd100';
  return { civilians, police: police ? 2 : 0, policeDelay: 4, policeCooldown: 14, city };
}

/** Traffic for a generated town; null when it has no road out to the edge. */
export function createTraffic(town: Town, config: TrafficConfig): TrafficState | null {
  const exits = findExits(town);
  if (!exits.length) return null;
  const state: TrafficState = {
    config, rng: new Rng(town.seed ^ 0x7af1c), time: 0, spawnT: 1, policeT: config.policeDelay, alert: 0,
    policeQueued: 0, exits, laneBlocked: new Set(), blockT: 0, roadProps: [], junctions: new Map(),
  };
  seedTraffic(town, state);
  return state;
}

/**
 * Raise the Code Enforcement alert (1: one cruiser, 2: two), capped by the config. It never
 * lowers; returns whether this call escalated.
 */
export function raiseEnforcement(state: TrafficState, level: number): boolean {
  const next = Math.min(state.config.police, level);
  if (next <= state.alert) return false;
  state.alert = next;
  state.policeT = Math.min(state.policeT, state.config.policeDelay);
  return true;
}

/** Rubble heaped between a cruiser and the dozer is cover: no straight charge across it. */
export function rubbleBetween(town: Pick<Town, 'pile'>, x0: number, y0: number, x1: number, y1: number): boolean {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  // The last few metres are the dozer's own work face.
  for (let i = 1; i < n - 3; i++) if (town.pile.heightAt(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) > 0.5) return true;
  return false;
}

/** Ask for one police car at an edge, now or as soon as an entrance is clear. */
export function requestPolice(state: TrafficState): void {
  state.policeQueued++;
}

function findExits(town: Town): Exit[] {
  const idx = indexNetwork(town.network);
  const exits: Exit[] = [];
  for (const n of edgeExitNodes(town.network, town)) {
    const seg = idx.segmentById.get(n.segmentIds[0]!);
    if (!seg) continue;
    let inbound = '', outbound = '';
    for (const id of seg.laneIds) {
      const lane = idx.laneById.get(id)!;
      if ((seg.endId === n.id) === (lane.dir === 1)) outbound = id;
      else inbound = id;
    }
    if (inbound && outbound) exits.push({ x: n.x, y: n.y, inbound, outbound });
  }
  return exits;
}

// ---------------------------------------------------------------- lane geometry

const laneCache = new WeakMap<RoadNetwork, Map<string, { x: number; y: number }[]>>();

/** Points along a lane in its direction of travel, offset to its side of the road. */
export function lanePoints(network: RoadNetwork, laneId: string): { x: number; y: number }[] {
  let cache = laneCache.get(network);
  if (!cache) laneCache.set(network, (cache = new Map()));
  const hit = cache.get(laneId);
  if (hit) return hit;
  const idx = indexNetwork(network);
  const lane = idx.laneById.get(laneId), seg = lane && idx.segmentById.get(lane.segmentId);
  const pts: { x: number; y: number }[] = [];
  if (lane && seg) {
    const total = polylineLength(seg.points), count = Math.max(2, Math.ceil(total / POINT_STEP));
    for (let i = 0; i <= count; i++) {
      const t = lane.dir === 1 ? i / count : 1 - i / count;
      const p = samplePolyline(seg.points, t);
      pts.push(offsetPoint(p.x, p.y, p.heading, lane.offset));
    }
  }
  cache.set(laneId, pts);
  return pts;
}

function laneClass(network: RoadNetwork, lane: Lane): RoadSegment['roadClass'] {
  return indexNetwork(network).segmentById.get(lane.segmentId)?.roadClass ?? 'residential';
}

/** The other direction of travel on the same segment. */
function oppositeLane(network: RoadNetwork, laneId: string): string | undefined {
  const idx = indexNetwork(network), lane = idx.laneById.get(laneId);
  return lane ? idx.segmentById.get(lane.segmentId)?.laneIds.find(id => id !== laneId) : undefined;
}

// ---------------------------------------------------------------- routing

interface RouteCost { avoidX?: number; avoidY?: number; police: boolean; blocked: ReadonlySet<string> }

/** Cheapest lane sequence from `start` by Dijkstra over lane links; costs are seconds plus penalties. */
function routeFrom(network: RoadNetwork, start: string, cost: RouteCost): { dist: Map<string, number>; prev: Map<string, string> } {
  const idx = indexNetwork(network);
  const dist = new Map<string, number>([[start, 0]]), prev = new Map<string, string>();
  const heap: [number, string][] = [[0, start]];
  const done = new Set<string>();
  while (heap.length) {
    const [d, id] = heapPop(heap);
    if (done.has(id)) continue;
    done.add(id);
    const lane = idx.laneById.get(id)!;
    for (const nextId of lane.next) {
      const next = idx.laneById.get(nextId);
      if (!next || done.has(nextId)) continue;
      const nd = d + laneCost(network, lane, next, cost);
      if (nd < (dist.get(nextId) ?? Infinity)) {
        dist.set(nextId, nd);
        prev.set(nextId, id);
        heapPush(heap, [nd, nextId]);
      }
    }
  }
  return { dist, prev };
}

function laneCost(network: RoadNetwork, from: Lane, lane: Lane, cost: RouteCost): number {
  const pts = lanePoints(network, lane.id), length = (pts.length - 1) * POINT_STEP;
  const cls = laneClass(network, lane);
  let c = length / (cost.police ? POLICE_CRUISE : CRUISE[cls]);
  if (cls === 'driveway') c += cost.police ? 2 : 60;
  if (from.segmentId === lane.segmentId) c += cost.police ? 3 : 25;
  if (cost.blocked.has(lane.id)) c += cost.police ? 8 : 120;
  if (cost.avoidX !== undefined && cost.avoidY !== undefined) {
    const near = pts.some(p => Math.hypot(p.x - cost.avoidX!, p.y - cost.avoidY!) < 7);
    if (near) c += 150;
  }
  return c;
}

function unwind(prev: ReadonlyMap<string, string>, start: string, end: string): string[] {
  const out = [end];
  while (out[0] !== start) {
    const p = prev.get(out[0]!);
    if (!p) return [start];
    out.unshift(p);
  }
  return out;
}

function heapPush(h: [number, string][], item: [number, string]): void {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p]![0] <= h[i]![0]) break;
    [h[p], h[i]] = [h[i]!, h[p]!];
    i = p;
  }
}

function heapPop(h: [number, string][]): [number, string] {
  const top = h[0]!, last = h.pop()!;
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l]![0] < h[m]![0]) m = l;
      if (r < h.length && h[r]![0] < h[m]![0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i]!, h[m]!];
      i = m;
    }
  }
  return top;
}

/** Replace the agent's route from its current lane, keeping the points still ahead on that lane. */
function replan(town: Town, state: TrafficState, v: VehicleState, a: TrafficAgent, startLane?: string): void {
  const network = town.network;
  const current = startLane ?? a.lanes[a.path[a.pathIndex]?.lane ?? 0] ?? a.exitLane;
  const aware = state.time - a.sawAt < MEMORY;
  const cost: RouteCost = {
    police: a.role === 'police', blocked: state.laneBlocked,
    ...(a.role === 'civilian' && aware ? { avoidX: a.sawX, avoidY: a.sawY } : {}),
  };
  const { dist, prev } = routeFrom(network, current, cost);
  let target: string | undefined;
  if (a.role === 'police') target = laneNearest(network, a.sawX, a.sawY, dist);
  else {
    let best = Infinity;
    for (const e of state.exits) {
      const d = (dist.get(e.outbound) ?? Infinity) + (e.outbound === a.exitLane ? 0 : 45);
      if (d < best) { best = d; target = e.outbound; }
    }
    if (target) a.exitLane = target;
  }
  const lanes = target ? unwind(prev, current, target) : [current];
  setPath(network, v, a, lanes, startLane !== undefined);
}

/** The reachable lane passing closest to a point. */
function laneNearest(network: RoadNetwork, x: number, y: number, reachable: ReadonlyMap<string, number>): string | undefined {
  let best: string | undefined, bestD = Infinity;
  for (const id of reachable.keys()) {
    const lane = indexNetwork(network).laneById.get(id);
    if (!lane || laneClass(network, lane) === 'driveway') continue;
    for (const p of lanePoints(network, id)) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = id; }
    }
  }
  return best;
}

/** Whether driving from the end of one lane onto the next is a turn onto another road, not straight on or a U-turn. */
function turnsOnto(network: RoadNetwork, fromId: string, toId: string): boolean {
  const idx = indexNetwork(network), from = idx.laneById.get(fromId), to = idx.laneById.get(toId);
  if (!from || !to || from.segmentId === to.segmentId) return false;
  const p = lanePoints(network, fromId), q = lanePoints(network, toId);
  if (p.length < 2 || q.length < 2) return false;
  const out = Math.atan2(p[p.length - 1]!.y - p[p.length - 2]!.y, p[p.length - 1]!.x - p[p.length - 2]!.x);
  return Math.abs(wrapAngle(Math.atan2(q[1]!.y - q[0]!.y, q[1]!.x - q[0]!.x) - out)) > 0.35;
}

function setPath(network: RoadNetwork, v: VehicleState, a: TrafficAgent, lanes: string[], fresh: boolean): void {
  const path: TrafficAgent['path'] = [];
  const idx = indexNetwork(network), hw = vehicleDefinition(v.definitionId).width * v.scale * 0.5;
  lanes.forEach((id, li) => {
    const pts = lanePoints(network, id);
    // Lanes sit close to the centre line, so a car keeps toward its own kerb as far as the pavement allows.
    const lane = idx.laneById.get(id), seg = lane && idx.segmentById.get(lane.segmentId);
    const pad = lane && seg ? clamp(seg.width * 0.5 - Math.abs(lane.offset) - hw - 0.05, 0, KERB_PAD) * Math.sign(lane.offset) * lane.dir : 0;
    // Lanes meet at the middle of a junction, which makes every turn a hook. Leaving out the last
    // stretch in and the first stretch out turns it into a corner a car can follow without swinging wide.
    const trim = pts.length > CORNER_TRIM * 4;
    const from = trim && li > 0 && turnsOnto(network, lanes[li - 1]!, id) ? CORNER_TRIM : 0;
    const to = trim && li < lanes.length - 1 && turnsOnto(network, id, lanes[li + 1]!) ? pts.length - CORNER_TRIM : pts.length;
    for (let i = from; i < to; i++) {
      const p = pts[i]!, q = pts[Math.max(0, i - 1)]!, r = pts[Math.min(pts.length - 1, i + 1)]!, l = Math.hypot(r.x - q.x, r.y - q.y) || 1;
      path.push({ x: p.x - (r.y - q.y) / l * pad, y: p.y + (r.x - q.x) / l * pad, lane: li });
    }
  });
  a.lanes = lanes;
  a.path = path;
  // Resume at the closest point ahead on the first lane.
  let best = 0, bestD = Infinity;
  const f = Math.cos(v.heading), g = Math.sin(v.heading);
  for (let i = 0; i < path.length && path[i]!.lane === 0; i++) {
    const dx = path[i]!.x - v.x, dy = path[i]!.y - v.y, d = Math.hypot(dx, dy);
    if (!fresh && dx * f + dy * g < -0.5) continue;
    if (d < bestD) { bestD = d; best = i; }
  }
  a.pathIndex = best;
}

// ---------------------------------------------------------------- spawning

const CIVILIAN_MIX: readonly [string, number][] = [['car', 45], ['hatchback', 20], ['pickup', 20], ['panel-van', 10], ['box-truck', 5]];

function pickCivilian(state: TrafficState): string {
  const mix = state.config.city ? [...CIVILIAN_MIX, ['bus', 6] as [string, number]] : CIVILIAN_MIX;
  let roll = state.rng.next() * mix.reduce((n, [, w]) => n + w, 0);
  for (const [id, w] of mix) if ((roll -= w) <= 0) return id;
  return 'car';
}

function newAgent(role: TrafficRole, exitLane: string, cruise: number): TrafficAgent {
  return {
    role, mode: role === 'police' ? 'pursue' : 'cruise', lanes: [], path: [], pathIndex: 0, exitLane, cruise,
    modeT: 0, turnStartHeading: 0, sawX: 0, sawY: 0, sawAt: -Infinity, repathAt: 0, stuckT: 0, jamT: 0, hitCd: 0,
    dozerContact: 0, bladeContact: 0, ramContact: 0, ramAfter: 0, ramFails: 0, swerve: 0,
    pass: 0, passKey: '', passX: 0, passY: 0, passR: 0, waitT: 0, blockedBy: '', pushT: 0, pushKey: '', backoffs: 0, turnAt: 0,
  };
}

function spotClear(town: Town, x: number, y: number, radius: number): boolean {
  return !town.vehicles.some(v => Math.hypot(v.x - x, v.y - y) < radius);
}

/** Place a vehicle on a lane at point `at`, heading along it. */
function placeOnLane(town: Town, state: TrafficState, id: string, role: TrafficRole, laneId: string, at: number): VehicleState | null {
  const pts = lanePoints(town.network, laneId);
  if (pts.length < 3) return null;
  const i = clamp(at, 0, pts.length - 2), p = pts[i]!, q = pts[i + 1]!;
  if (!spotClear(town, p.x, p.y, 4)) return null;
  const heading = Math.atan2(q.y - p.y, q.x - p.x);
  const v = createVehicle(id, p.x, p.y, heading, state.rng.int(0, 1));
  const lane = indexNetwork(town.network).laneById.get(laneId)!;
  const cruise = role === 'police' ? POLICE_CRUISE : CRUISE[laneClass(town.network, lane)] * state.rng.range(0.9, 1.1);
  const exit = role === 'civilian' ? state.rng.pick(state.exits).outbound : laneId;
  const a = newAgent(role, exit, cruise);
  v.traffic = a;
  v.autonomous = true;
  v.sleeping = false;
  v.routeStatus = 'driving';
  v.vx = Math.cos(heading) * cruise * 0.6;
  v.vy = Math.sin(heading) * cruise * 0.6;
  if (role === 'police') {
    v.wreckAfterHits = POLICE_HITS;
    v.hits = 0;
  }
  town.vehicles.push(v);
  replan(town, state, v, a, laneId);
  a.pathIndex = Math.max(a.pathIndex, i);
  return v;
}

/** Enter at a random clear edge, away from the dozer. */
function spawnAtEdge(town: Town, state: TrafficState, dozer: Dozer, role: TrafficRole): VehicleState | null {
  const order = state.exits.map(e => ({ e, k: state.rng.next() })).sort((a, b) => a.k - b.k).map(o => o.e);
  for (const e of order) {
    if (Math.hypot(e.x - dozer.x, e.y - dozer.y) < 16) continue;
    // Nobody at the entrance or on the last stretch of the way out, so a new arrival never meets a leaving car nose to nose.
    if (town.vehicles.some(o => {
      const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy);
      return d < 6 || (d < EXIT_CLEAR && dx * Math.cos(o.heading) + dy * Math.sin(o.heading) > 0.85 * d);
    })) continue;
    const v = placeOnLane(town, state, role === 'police' ? 'police-cruiser' : pickCivilian(state), role, e.inbound, 2);
    if (v) {
      if (role === 'civilian') {
        const others = state.exits.filter(o => o !== e);
        if (others.length) { v.traffic!.exitLane = state.rng.pick(others).outbound; replan(town, state, v, v.traffic!); }
      }
      return v;
    }
  }
  return null;
}

/** Start with some cars already on public lanes, clear of the dozer's spawn. */
function seedTraffic(town: Town, state: TrafficState): void {
  const idx = indexNetwork(town.network);
  const lanes = town.network.lanes.filter(l => laneClass(town.network, l) !== 'driveway' && lanePoints(town.network, l.id).length > 6);
  const want = Math.round(state.config.civilians * 0.6);
  for (let tries = 0; tries < want * 6 && civilians(town) < want && lanes.length; tries++) {
    const lane = state.rng.pick(lanes), pts = lanePoints(town.network, lane.id);
    const at = state.rng.int(1, pts.length - 3), p = pts[at]!;
    if (Math.hypot(p.x - town.spawnX, p.y - town.spawnY) < 14 || !idx.laneById.has(lane.id)) continue;
    placeOnLane(town, state, pickCivilian(state), 'civilian', lane.id, at);
  }
}

const isAgent = (v: VehicleState, role?: TrafficRole) => !!v.traffic && v.status === 'operational' && (!role || v.traffic.role === role);
const civilians = (town: Town) => town.vehicles.filter(v => isAgent(v, 'civilian')).length;
const police = (town: Town) => town.vehicles.filter(v => isAgent(v, 'police')).length;

function stepSpawns(town: Town, state: TrafficState, dozer: Dozer, dt: number): void {
  state.spawnT -= dt;
  if (state.spawnT <= 0) {
    state.spawnT = (26 / Math.max(1, state.config.civilians)) * state.rng.range(0.6, 1.4);
    if (civilians(town) < state.config.civilians) spawnAtEdge(town, state, dozer, 'civilian');
  }
  const active = police(town);
  if (state.policeQueued > 0 && spawnAtEdge(town, state, dozer, 'police')) state.policeQueued--;
  if (!state.alert) return;
  if (active >= state.alert) {
    state.policeT = Math.max(state.policeT, state.config.policeCooldown);
    return;
  }
  state.policeT -= dt;
  if (state.policeT <= 0 && spawnAtEdge(town, state, dozer, 'police')) state.policeT = state.config.policeCooldown;
}

// ---------------------------------------------------------------- perception

/** Whether the dozer is inside the driver's forward cone and not hidden behind a building. */
export function seesDozer(town: Town, v: VehicleState, dozer: Dozer): boolean {
  const d = vehicleDefinition(v.definitionId), f = Math.cos(v.heading), g = Math.sin(v.heading);
  const fx = v.x + f * d.length * 0.5 * v.scale, fy = v.y + g * d.length * 0.5 * v.scale;
  const dx = dozer.x - fx, dy = dozer.y - fy, dist = Math.hypot(dx, dy);
  if (dist > SIGHT.range) return false;
  if (dist > 1e-3 && (dx * f + dy * g) / dist < Math.cos(SIGHT.halfAngle)) return false;
  return !sightBlocked(town, fx, fy, dozer.x, dozer.y);
}

/** A standing ground- or first-floor cell between the two points. */
export function sightBlocked(town: Town, x0: number, y0: number, x1: number, y1: number): boolean {
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  for (const b of town.buildings) {
    if (b.retired) continue;
    const bw = b.w * b.cellSize, bd = b.d * b.cellSize;
    if (b.x > maxX || b.y > maxY || b.x + bw < minX || b.y + bd < minY) continue;
    if (!segmentHitsBox(x0, y0, x1, y1, { x: b.x - 1, y: b.y - 1, w: bw + 2, d: bd + 2 })) continue;
    for (const c of b.cells) {
      if (c.floor > 1 || !cellPresent(c)) continue;
      if (segmentHitsBox(x0, y0, x1, y1, cellWorldBox(b, c))) return true;
    }
  }
  return false;
}

/** Slab test of a line segment against an axis-aligned box. */
function segmentHitsBox(x0: number, y0: number, x1: number, y1: number, box: { x: number; y: number; w: number; d: number }): boolean {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  for (const [p, d, lo, hi] of [[x0, dx, box.x, box.x + box.w], [y0, dy, box.y, box.y + box.d]] as const) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return false;
      continue;
    }
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

// ---------------------------------------------------------------- driving

interface Obstacle { x: number; y: number; heading: number; hl: number; hw: number; vx: number; vy: number; speed: number; key: string; agent?: TrafficAgent; dozer?: boolean }

function obstacles(town: Town, dozer: Dozer, roadProps: readonly Town['props'][number][]): Obstacle[] {
  const out: Obstacle[] = town.vehicles.map(v => {
    const d = vehicleDefinition(v.definitionId);
    return { x: v.x, y: v.y, heading: v.heading, hl: d.length * v.scale * 0.5, hw: d.width * v.scale * 0.5, vx: v.vx, vy: v.vy, speed: Math.hypot(v.vx, v.vy), key: `v${v.id}`, agent: v.traffic && v.status === 'operational' ? v.traffic : undefined };
  });
  // The dozer's box runs from its tail to the blade edge and is as wide as the blade.
  const front = DOZER.bladeReach + DOZER.bladeDepth, mid = (front - DOZER.length * 0.5) * 0.5;
  const bx = dozer.x + Math.cos(dozer.heading) * mid, by = dozer.y + Math.sin(dozer.heading) * mid;
  const body = { heading: dozer.heading, hl: (front + DOZER.length * 0.5) * 0.5, hw: DOZER.bladeHalf * (dozer.bladeWidthMul ?? 1) + 0.15, vx: dozer.vx, vy: dozer.vy, speed: dozerSpeed(dozer), key: 'dozer', dozer: true };
  out.push({ x: bx, y: by, ...body });
  // A dozer on the move also blocks the spot it is about to reach.
  if (body.speed > 2) out.push({ x: bx + dozer.vx * DOZER_LEAD, y: by + dozer.vy * DOZER_LEAD, ...body });
  for (const p of roadProps) if (!p.broken) out.push({ x: p.x + p.w / 2, y: p.y + p.d / 2, heading: 0, hl: p.w / 2, hw: p.d / 2, vx: 0, vy: 0, speed: 0, key: `p${p.id}` });
  return out;
}

/** Distance from a point to an obstacle's rectangle. */
function boxDistance(o: Obstacle, x: number, y: number): number {
  const dx = x - o.x, dy = y - o.y, c = Math.cos(o.heading), s = Math.sin(o.heading);
  const a = Math.abs(dx * c + dy * s) - o.hl, b = Math.abs(-dx * s + dy * c) - o.hw;
  return Math.hypot(Math.max(0, a), Math.max(0, b)) + Math.min(0, Math.max(a, b));
}

/**
 * Free distance along the path before something blocks it, and that blocker. `shift` moves the
 * path sideways (left of travel is positive) and `skip` names an obstacle to leave out: together
 * they test the line a car takes around something.
 */
function pathGap(v: VehicleState, a: TrafficAgent, obs: readonly Obstacle[], reach: number, shift = 0, skip = ''): { gap: number; blocker?: Obstacle } {
  const d = vehicleDefinition(v.definitionId), half = d.width * v.scale * 0.5 + 0.1, nose = d.length * v.scale * 0.5;
  const self = `v${v.id}`;
  const near = obs.filter(o => o.key !== self && o.key !== skip && Math.hypot(o.x - v.x, o.y - v.y) < reach + nose + 4 + Math.abs(shift));
  if (!near.length) return { gap: Infinity };
  // A car that is off its line (coming out of a turn, say) sweeps the ground between: start from where it
  // meets the line and carry its sideways error forward, fading over the distance it takes to straighten up.
  const p0 = a.path[Math.max(0, a.pathIndex - 1)], p1 = a.path[a.pathIndex];
  let px = v.x, py = v.y, ex = 0, ey = 0;
  if (p0 && p1 && p0 !== p1) {
    const dx = p1.x - p0.x, dy = p1.y - p0.y, t = ((v.x - p0.x) * dx + (v.y - p0.y) * dy) / (dx * dx + dy * dy);
    px = p0.x + dx * t; py = p0.y + dy * t;
    ex = v.x - px; ey = v.y - py;
    const e = Math.hypot(ex, ey);
    if (e > 1.5) { ex *= 1.5 / e; ey *= 1.5 / e; }
  }
  let walked = 0;
  for (let i = a.pathIndex; i < a.path.length && walked < reach + nose; i++) {
    const p = a.path[i]!, step = Math.hypot(p.x - px, p.y - py), parts = Math.max(1, Math.ceil(step / 0.6));
    const ux = step > 1e-6 ? (p.x - px) / step : Math.cos(v.heading), uy = step > 1e-6 ? (p.y - py) / step : Math.sin(v.heading);
    const sx = -uy * shift, sy = ux * shift;
    for (let k = 1; k <= parts; k++) {
      const at = walked + step * k / parts, fade = Math.max(0, 1 - at / STRAIGHTEN);
      const x = px + (p.x - px) * k / parts + sx + ex * fade, y = py + (p.y - py) * k / parts + sy + ey * fade;
      if (at < nose * 0.5) continue;
      for (const o of near) {
        // Traffic coming the other way is in its own lane beside this one: it counts only if the two would touch.
        const oncoming = o.agent && Math.cos(o.heading) * ux + Math.sin(o.heading) * uy < -0.3;
        if (boxDistance(o, x, y) < (oncoming ? half - 0.1 : half)) return { gap: Math.max(0, at - nose - 0.4), blocker: o };
      }
    }
    walked += step;
    px = p.x; py = p.y;
  }
  return { gap: Infinity };
}

/** Pure-pursuit steering toward the path point one look-ahead away, nudged sideways by `swerve`. */
function pursue(v: VehicleState, a: TrafficAgent, speed: number): { steer: number; turnAhead: number; askew: number } {
  const d = vehicleDefinition(v.definitionId), wb = d.drive.wheelbase * v.scale;
  const f = Math.cos(v.heading), g = Math.sin(v.heading);
  while (a.pathIndex < a.path.length - 1) {
    const p = a.path[a.pathIndex]!, dx = p.x - v.x, dy = p.y - v.y;
    if (Math.hypot(dx, dy) < 1 || dx * f + dy * g < 0) a.pathIndex++;
    else break;
  }
  const look = clamp(Math.abs(speed) * 0.42 + 1.6, 1.8, 5.5);
  let target = a.path[a.path.length - 1]!;
  for (let i = a.pathIndex; i < a.path.length; i++) {
    if (Math.hypot(a.path[i]!.x - v.x, a.path[i]!.y - v.y) >= look) { target = a.path[i]!; break; }
  }
  let tx = target.x, ty = target.y;
  if (a.swerve) {
    const h = Math.atan2(ty - v.y, tx - v.x);
    tx -= Math.sin(h) * a.swerve;
    ty += Math.cos(h) * a.swerve;
  }
  const alpha = wrapAngle(Math.atan2(ty - v.y, tx - v.x) - v.heading);
  const dist = Math.max(0.5, Math.hypot(tx - v.x, ty - v.y));
  // How sharply the road bends over the next stretch, for corner speed.
  const far = a.path[Math.min(a.path.length - 1, a.pathIndex + 6)]!;
  const turnAhead = Math.abs(wrapAngle(Math.atan2(far.y - v.y, far.x - v.x) - v.heading));
  // How far the car points off the lane it is on.
  const here = a.path[a.pathIndex]!, on = a.path[Math.min(a.path.length - 1, a.pathIndex + 1)]!;
  const askew = on === here ? 0 : Math.abs(wrapAngle(Math.atan2(on.y - here.y, on.x - here.x) - v.heading));
  return { steer: Math.atan2(2 * wb * Math.sin(alpha), dist), turnAhead, askew };
}

function forwardSpeed(v: VehicleState): number {
  return v.vx * Math.cos(v.heading) + v.vy * Math.sin(v.heading);
}

function drive(v: VehicleState, speed: number, steer: number): void {
  const cur = forwardSpeed(v);
  const braking = Math.abs(speed) < Math.abs(cur) || Math.sign(speed) !== Math.sign(cur);
  v.control = { speed, steer, accel: braking ? BRAKE : ACCEL };
}

function onRoad(town: Town, x: number, y: number): boolean {
  return roadSurfaceAt(town.network, x, y).on;
}

const clusterCache = new WeakMap<RoadNetwork, Map<string, string>>();

/** Junction nodes within a few units of each other share one reservation, keyed by the first node id. */
function junctionCluster(network: RoadNetwork, nodeId: string): string {
  let map = clusterCache.get(network);
  if (!map) {
    map = new Map();
    const junctions = network.nodes.filter(n => n.segmentIds.length >= 3);
    for (const n of junctions) {
      if (map.has(n.id)) continue;
      const stack = [n];
      map.set(n.id, n.id);
      while (stack.length) {
        const cur = stack.pop()!;
        for (const o of junctions) {
          if (map.has(o.id) || Math.hypot(o.x - cur.x, o.y - cur.y) > 6) continue;
          map.set(o.id, n.id);
          stack.push(o);
        }
      }
    }
    clusterCache.set(network, map);
  }
  return map.get(nodeId) ?? nodeId;
}

interface Junction { id: string; x: number; y: number; along: number; radius: number; from: string; line: Point[] }

/** Shortest distance between two line segments; zero when they cross. */
function segmentGap(a: Point, b: Point, c: Point, d: Point): number {
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return 0;
  const reach = (p: Point, q: Point, r: Point) => {
    const dx = r.x - q.x, dy = r.y - q.y, l = dx * dx + dy * dy;
    const t = l > 1e-9 ? clamp(((p.x - q.x) * dx + (p.y - q.y) * dy) / l, 0, 1) : 0;
    return Math.hypot(p.x - q.x - dx * t, p.y - q.y - dy * t);
  };
  return Math.min(reach(a, c, d), reach(b, c, d), reach(c, a, b), reach(d, a, b));
}

/** Two lines across a junction that pass closer than a car's width. */
function linesCross(p: readonly Point[], q: readonly Point[], gap = LINE_GAP): boolean {
  for (let i = 1; i < p.length; i++)
    for (let k = 1; k < q.length; k++)
      if (segmentGap(p[i - 1]!, p[i]!, q[k - 1]!, q[k]!) < gap) return true;
  return false;
}

/** How far a junction's box reaches from its node: half the widest road meeting there, and a little more. */
function junctionRadius(network: RoadNetwork, node: RoadNetwork['nodes'][number]): number {
  const idx = indexNetwork(network);
  return Math.max(...node.segmentIds.map(id => idx.segmentById.get(id)?.width ?? 3)) * 0.5 + 0.6;
}

/** The junctions (three or more roads meeting) the route crosses within `reach` along the path, nearest first. */
function junctionsAhead(town: Town, v: VehicleState, a: TrafficAgent, reach: number): Junction[] {
  const idx = indexNetwork(town.network), out: Junction[] = [];
  let walked = 0, px = v.x, py = v.y;
  for (let i = a.pathIndex; i < a.path.length && walked < reach; i++) {
    const p = a.path[i]!;
    walked += Math.hypot(p.x - px, p.y - py);
    px = p.x; py = p.y;
    const next = a.path[i + 1];
    if (!next || next.lane === p.lane) continue;
    const lane = idx.laneById.get(a.lanes[p.lane]!), seg = lane && idx.segmentById.get(lane.segmentId);
    const node = seg && idx.nodeById.get(lane!.dir === 1 ? seg.endId : seg.startId);
    if (!node || node.segmentIds.length < 3) continue;
    // The line driven across: a couple of points back down the lane in, the lane ends, and a couple of points up the lane out.
    const line = [a.path[Math.max(0, i - 2)]!, p, next, a.path[Math.min(a.path.length - 1, i + 3)]!];
    out.push({ id: junctionCluster(town.network, node.id), x: node.x, y: node.y, along: walked + Math.hypot(node.x - p.x, node.y - p.y), radius: junctionRadius(town.network, node), from: seg!.id, line });
  }
  return out;
}

/**
 * Two movements through a junction that get along: one follows the other in from the same road
 * (for a while, so the side road gets its turn), or their lines across never come close.
 */
function flowsTogether(h: JunctionHold, j: Junction, now: number): boolean {
  if (h.from === j.from) return now - h.since < PLATOON;
  return !linesCross(h.line, j.line);
}

/** Nothing crossing this car's line holds the junction or stands in it. */
function junctionFree(town: Town, state: TrafficState, v: VehicleState, j: Junction): boolean {
  const live = (state.junctions.get(j.id) ?? []).filter(h => h.id !== v.id && state.time - h.at < 10 && town.vehicles.some(o => o.id === h.id && o.status === 'operational'));
  if (!live.every(h => flowsTogether(h, j, state.time))) return false;
  // Someone standing in the junction with no matching claim closes only the lines that run over them.
  return !town.vehicles.some(o => o !== v && o.traffic && o.status === 'operational' && Math.hypot(o.x - j.x, o.y - j.y) < j.radius &&
    !live.some(h => h.id === o.id && flowsTogether(h, j, state.time)) && linesCross([o, o], j.line, STANDING_GAP));
}
/**
 * Take the coming junction when nothing crossing it is in the way and there is room to drive
 * clear of it; otherwise the speed that stops short of it. Junctions too close together to stop
 * between are taken as one, so nobody waits inside a junction for the next.
 */
function yieldAtJunction(town: Town, state: TrafficState, v: VehicleState, a: TrafficAgent, obs: readonly Obstacle[], speed: number, skip: string): number {
  const half = vehicleDefinition(v.definitionId).length * v.scale * 0.5;
  const reach = 6 + Math.max(0, speed) * speed / 18 + half;
  const ahead = junctionsAhead(town, v, a, reach + 16);
  const mine = (id: string) => !!state.junctions.get(id)?.some(h => h.id === v.id);
  // Stopped short of the next junction: give it up so cross traffic is not held for nothing.
  const waiting = a.stuckT > 0.4 && !!ahead[0] && ahead[0].along > ahead[0].radius + half + 0.5;
  releaseJunctions(town, state, v, half, new Set(waiting ? [] : ahead.map(j => j.id)));
  const k = ahead.findIndex(j => !mine(j.id));
  const first = ahead[k];
  if (!first || first.along > reach) return Infinity;
  const chain = [first];
  for (let i = k + 1; i < ahead.length; i++) {
    const prev = chain[chain.length - 1]!, next = ahead[i]!;
    if (next.along - prev.along >= prev.radius + next.radius + half * 2 + 1.2) break;
    chain.push(next);
  }
  const need = chain.filter((j, i) => !mine(j.id) && chain.findIndex(q => q.id === j.id) === i);
  let open = need.every(j => junctionFree(town, state, v, j));
  if (open) {
    // Don't block the box: something stopped beyond has to leave room to pull clear of the last junction.
    const last = chain[chain.length - 1]!, room = last.along + last.radius + half + 0.3;
    const beyond = pathGap(v, a, obs, room, a.swerve, skip);
    // Only a queue is worth waiting out; a wreck or the dozer past the junction is dealt with once there.
    open = !beyond.blocker?.agent || beyond.gap >= room || beyond.blocker.speed > 1.5;
  }
  if (!open) return Math.sqrt(2 * 9 * Math.max(0, first.along - first.radius - half - 1));
  for (const j of need) {
    const holds = state.junctions.get(j.id) ?? [];
    // A follower inherits the platoon's start, so a long stream still yields to the side road.
    const since = holds.reduce((t, h) => h.from === j.from ? Math.min(t, h.since) : t, state.time);
    holds.push({ id: v.id, at: state.time, since, from: j.from, line: j.line });
    state.junctions.set(j.id, holds);
  }
  return Infinity;
}

/** Let go of any junction this car holds once it is out of the box and not headed back into it. */
function releaseJunctions(town: Town, state: TrafficState, v: VehicleState, half: number, keep: ReadonlySet<string>): void {
  for (const [id, holds] of state.junctions) {
    if (keep.has(id) || !holds.some(h => h.id === v.id)) continue;
    const inside = town.network.nodes.some(n => n.segmentIds.length >= 3 && junctionCluster(town.network, n.id) === id &&
      Math.hypot(n.x - v.x, n.y - v.y) < junctionRadius(town.network, n) + half + 0.3);
    if (inside) continue;
    const rest = holds.filter(h => h.id !== v.id);
    if (rest.length) state.junctions.set(id, rest); else state.junctions.delete(id);
  }
}
/**
 * The sideways offset that takes this car around a stopped obstacle, or undefined when neither
 * side works: the line has to stay on the pavement, clear of everything else, with nobody oncoming.
 */
function passOffset(town: Town, v: VehicleState, blocker: Obstacle, obs: readonly Obstacle[]): { offset: number; reach: number } | undefined {
  const d = vehicleDefinition(v.definitionId), half = d.length * v.scale * 0.5, hw = d.width * v.scale * 0.5;
  const f = Math.cos(v.heading), g = Math.sin(v.heading), self = `v${v.id}`;
  const local = (x: number, y: number) => ({ along: (x - v.x) * f + (y - v.y) * g, lat: -(x - v.x) * g + (y - v.y) * f });
  const at = local(blocker.x, blocker.y), dh = blocker.heading - v.heading;
  const wide = Math.abs(Math.cos(dh)) * blocker.hw + Math.abs(Math.sin(dh)) * blocker.hl;
  const long = Math.abs(Math.cos(dh)) * blocker.hl + Math.abs(Math.sin(dh)) * blocker.hw;
  const end = at.along + long + half + 1.5;
  const others = obs.filter(o => o.key !== self && o.key !== blocker.key);
  const sides = [at.lat + wide + hw + PASS_MARGIN, at.lat - wide - hw - PASS_MARGIN].sort((p, q) => Math.abs(p) - Math.abs(q));
  for (const offset of sides) {
    if (Math.abs(offset) > 4.5) continue;
    let ok = true;
    for (let s = half; s <= end && ok; s += 0.7) {
      // Swing out on the way up, then hold the offset alongside.
      const off = offset * clamp((s - half) / Math.max(1, at.along - long - half), 0, 1);
      const x = v.x + f * s - g * off, y = v.y + g * s + f * off;
      const edge = off + Math.sign(offset) * hw * 0.9;
      ok = onRoad(town, x, y) && onRoad(town, v.x + f * s - g * edge, v.y + g * s + f * edge) && !others.some(o => boxDistance(o, x, y) < hw + 0.3);
    }
    // Someone coming the other way down that line.
    ok &&= !others.some(o => {
      if (!o.agent || Math.cos(o.heading - v.heading) > -0.5) return false;
      const p = local(o.x, o.y);
      return Math.abs(p.lat - offset) < hw + o.hw + 0.4 && p.along > 0 && p.along < end + 6 + o.speed * 3;
    });
    if (ok) return { offset, reach: long };
  }
  return undefined;
}

/** The dozer right beside the car: the sideways lean away from it (0 when the road has no room), else undefined. */
function dozerBeside(town: Town, v: VehicleState, obs: readonly Obstacle[], half: number, hw: number): number | undefined {
  const body = obs.find(o => o.dozer);
  if (!body || boxDistance(body, v.x, v.y) > hw + NEAR) return undefined;
  const f = Math.cos(v.heading), g = Math.sin(v.heading), dx = body.x - v.x, dy = body.y - v.y;
  // Already behind the tail: nothing to do but drive on.
  if (dx * f + dy * g < -half) return undefined;
  const lean = (-dx * g + dy * f >= 0 ? -1 : 1) * 0.6, edge = lean + Math.sign(lean) * hw;
  return onRoad(town, v.x + f * half - g * edge, v.y + g * half + f * edge) ? lean : 0;
}

function endPass(a: TrafficAgent): void {
  a.mode = 'cruise';
  a.modeT = 0;
  a.pass = 0;
  a.passKey = '';
}

/**
 * Held up in cruise by something in the lane: back away from a dozer driving at the car, steer
 * around anything that has stopped, and turn back when there is no way round. True when it took
 * the controls this step.
 */
function handleBlocker(town: Town, state: TrafficState, v: VehicleState, a: TrafficAgent, obs: readonly Obstacle[], blocker: Obstacle, gap: number, dt: number): boolean {
  const d = vehicleDefinition(v.definitionId), f = Math.cos(v.heading), g = Math.sin(v.heading);
  const half = d.length * v.scale * 0.5, hw = d.width * v.scale * 0.5, speedNow = forwardSpeed(v);
  if (blocker.dozer) { a.sawX = blocker.x; a.sawY = blocker.y; a.sawAt = state.time; }
  if (blocker.dozer && -(blocker.vx * f + blocker.vy * g) > 1.5) {
    // It is driving at the car: back away while there is clear road behind, then turn and go.
    a.waitT += dt;
    if (a.waitT > 1.2) { return startTurn(state, v, a); }
    const tx = v.x - f * (half + 0.9), ty = v.y - g * (half + 0.9), self = `v${v.id}`;
    const room = onRoad(town, tx, ty) && !obs.some(o => o.key !== self && !o.dozer && boxDistance(o, tx, ty) < hw + 0.3);
    drive(v, room ? -3.5 : 0, 0);
    return true;
  }
  // Stopped traffic is waited out unless it has plainly broken down; only wrecks, props and the dozer turn a car back.
  const still = blocker.agent ? blocker.agent.stuckT > 8 : blocker.speed < 1.2;
  if (!still || Math.abs(speedNow) > 0.8) { a.waitT = 0; return false; }
  a.waitT += dt;
  if (a.waitT < (blocker.dozer ? 0.6 : 1.2)) return false;
  const way = passOffset(town, v, blocker, obs);
  if (way) {
    a.pass = way.offset; a.passKey = blocker.key; a.passX = blocker.x; a.passY = blocker.y; a.passR = way.reach;
    a.waitT = 0; a.stuckT = 0; a.modeT = 0;
    // Too close to swing out that far: back up first.
    a.mode = gap < 1.5 + Math.abs(way.offset) * 1.3 ? 'recoil' : 'pass';
    drive(v, 0, 0);
    return true;
  }
  if (!blocker.agent && a.waitT > (blocker.dozer ? 1.6 : 4.5)) {
    a.sawX = blocker.x; a.sawY = blocker.y; a.sawAt = state.time;
    return startTurn(state, v, a);
  }
  // A wreck or prop in the lane: look for another road before giving up on this one.
  if (!blocker.dozer && !blocker.agent && state.time >= a.repathAt) { a.repathAt = state.time + 3; replan(town, state, v, a); }
  return false;
}

function stepCivilian(town: Town, state: TrafficState, v: VehicleState, a: TrafficAgent, dozer: Dozer, obs: readonly Obstacle[], dt: number): boolean {
  const d = vehicleDefinition(v.definitionId), f = Math.cos(v.heading), g = Math.sin(v.heading);
  const half = d.length * v.scale * 0.5, hw = d.width * v.scale * 0.5, self = `v${v.id}`;
  a.modeT += dt;

  if (a.mode === 'turn-forward' || a.mode === 'turn-reverse') return threePointTurn(town, state, v, a, obs, half);
  if (a.mode === 'recoil') {
    drive(v, -2.5, 0);
    if (a.modeT > 0.8) {
      a.modeT = 0;
      if (a.pass) a.mode = 'pass';
      else { a.mode = 'cruise'; replan(town, state, v, a); }
    }
    return true;
  }
  // Going around something: track it, and finish once it is behind the tail or gone.
  if (a.mode === 'pass') {
    const o = obs.find(o => o.key === a.passKey);
    if (o) { a.passX = o.x; a.passY = o.y; }
    const behind = (a.passX - v.x) * f + (a.passY - v.y) * g < -(half + a.passR + 0.4);
    if (!o || behind || a.modeT > 9) endPass(a);
  }

  const speedNow = forwardSpeed(v);
  // Only a dozer right beside the car matters off the path: ease off and lean away from it.
  const beside = dozerBeside(town, v, obs, half, hw);
  a.swerve += clamp((a.mode === 'pass' ? a.pass : beside ?? 0) - a.swerve, -dt * 2.2, dt * 2.2);
  const { steer, turnAhead, askew } = pursue(v, a, speedNow);
  // Slow for the bend ahead, and hold that until the car is square in its lane again.
  let target = a.cruise * Math.max(0.32, 1 - turnAhead / 1.5) * clamp(1.25 - askew / 0.8, 0.35, 1);
  if (a.mode === 'pass') target = Math.min(target, 3.5);
  if (beside !== undefined) target = Math.min(target, 4);
  a.pushT = Math.max(0, a.pushT - dt);
  if (a.pushT > 0) target = Math.min(target, 2.5);
  const reach = 3 + Math.max(0, speedNow) * 1.3;
  const skip = a.mode === 'pass' ? a.passKey : a.pushT > 0 ? a.pushKey : '';
  const { gap, blocker } = pathGap(v, a, obs, Math.min(24, reach), a.swerve, skip);
  if (blocker) {
    // Hold well back from anything that is not traffic, to leave room to steer around it.
    const standoff = blocker.agent ? 0.8 : 2.4, lead = Math.max(0, blocker.vx * f + blocker.vy * g);
    // Slow enough to stop behind it even if it brakes hard.
    target = Math.min(target, Math.sqrt(lead * lead * 0.7 + 2 * 9 * Math.max(0, gap - standoff)));
    // Behind moving traffic, settle at a time gap instead of riding its bumper.
    if (blocker.agent && lead > 0.5) target = Math.min(target, Math.max(0, lead + (gap - standoff - 0.45 * Math.max(0, speedNow)) * 1.5));
  }
  a.blockedBy = blocker?.key ?? '';
  target = Math.min(target, yieldAtJunction(town, state, v, a, obs, speedNow, skip));
  if (target < 0.3 && Math.abs(speedNow) < 0.3) a.stuckT += dt; else a.stuckT = Math.max(0, a.stuckT - dt * 2);

  if (a.mode === 'cruise' && blocker && gap < 6) {
    if (handleBlocker(town, state, v, a, obs, blocker, gap, dt)) return true;
  } else a.waitT = Math.max(0, a.waitT - dt);
  // Stopped nose to nose with a car from the other direction, on a narrow road or at a junction mouth: both squeeze by.
  if (blocker?.agent && a.pushT <= 0 && Math.abs(speedNow) < 1 && blocker.speed < 1 && Math.cos(blocker.heading - v.heading) < -0.3) { a.pushT = 1.5; a.pushKey = blocker.key; }
  if (blocker?.agent && blocker.agent.blockedBy === self && Math.abs(speedNow) < 2) {
    // Two cars each in the other's way: the older one eases past at once; the newer waits, then backs off to make room.
    if (v.id < idOf(town, blocker.agent)) { a.pushT = 2; a.pushKey = blocker.key; }
    else if (a.stuckT > 2) {
      a.stuckT = 0;
      if (++a.backoffs >= 4 && Math.cos(blocker.heading - v.heading) < -0.5) { a.backoffs = 0; return startTurn(state, v, a); }
      a.mode = 'recoil'; a.modeT = 0;
      return true;
    }
  }
  // A longer lock-up with no clear pair to blame: ease past whoever is in front.
  if (a.stuckT > 10 && blocker?.agent && a.pushT <= 0) { a.pushT = 2.5; a.pushKey = blocker.key; a.stuckT = 6; }
  // Pressing on but going nowhere: something unseen holds the car. Back off and try again.
  a.jamT = target > 1 && Math.abs(speedNow) < 0.3 ? a.jamT + dt : 0;
  if (a.jamT > 2) { a.jamT = 0; a.mode = 'recoil'; a.modeT = 0; return true; }
  // The way round has closed: drop back into the lane and think again.
  if (a.mode === 'pass' && a.stuckT > 2.5) endPass(a);
  if (a.stuckT > 6 && state.time >= a.repathAt) { a.repathAt = state.time + 3; replan(town, state, v, a); }
  if (a.stuckT > 30 && Math.hypot(v.x - dozer.x, v.y - dozer.y) > 25) return false;

  drive(v, target, steer);
  // Leave the map at the exit.
  const end = a.path[a.path.length - 1];
  if (end && a.pathIndex >= a.path.length - 3 && a.lanes[a.lanes.length - 1] === a.exitLane && state.exits.some(e => Math.hypot(e.x - v.x, e.y - v.y) < 3.5)) return false;
  if (a.pathIndex >= a.path.length - 1 && end && Math.hypot(end.x - v.x, end.y - v.y) < 2) replan(town, state, v, a);
  return true;
}

function idOf(town: Town, a: TrafficAgent): number {
  return town.vehicles.find(v => v.traffic === a)?.id ?? 0;
}

function startTurn(state: TrafficState, v: VehicleState, a: TrafficAgent): boolean {
  a.turnAt = state.time;
  a.mode = 'turn-forward';
  a.modeT = 0;
  a.waitT = 0;
  a.pass = 0;
  a.passKey = '';
  a.turnStartHeading = v.heading;
  return true;
}

/** Swing toward the far lane, back up the other way, then drive off on the opposite lane. */
function threePointTurn(town: Town, state: TrafficState, v: VehicleState, a: TrafficAgent, obs: readonly Obstacle[], half: number): boolean {
  const lane = a.lanes[a.path[a.pathIndex]?.lane ?? 0] ?? a.exitLane;
  const opposite = oppositeLane(town.network, lane);
  const pts = opposite ? lanePoints(town.network, opposite) : [];
  const f = Math.cos(v.heading), g = Math.sin(v.heading);
  let side = 1;
  if (pts.length) {
    const p = pts[Math.floor(pts.length / 2)]!;
    side = f * (p.y - v.y) - g * (p.x - v.x) >= 0 ? 1 : -1;
  }
  const turned = Math.abs(wrapAngle(v.heading - a.turnStartHeading));
  // Boxed in with no room to swing either way: give up and drive on from here.
  if (state.time - a.turnAt > 8) return finishTurn(town, state, v, a, turned > 1.57 ? opposite : undefined);
  // Each swing also stops short of anything in the way.
  const self = `v${v.id}`, hw = vehicleDefinition(v.definitionId).width * v.scale * 0.5;
  const open = (p: { x: number; y: number }) => !obs.some(o => o.key !== self && boxDistance(o, p.x, p.y) < hw + 0.15);
  if (a.mode === 'turn-forward') {
    const nose = { x: v.x + f * (half + 0.6), y: v.y + g * (half + 0.6) };
    drive(v, open(nose) ? 2.6 : 0, 0.65 * side);
    if (turned > 1.25 || a.modeT > 1.8 || !onRoad(town, nose.x, nose.y)) {
      if (turned > 2.4) return finishTurn(town, state, v, a, opposite);
      a.mode = 'turn-reverse';
      a.modeT = 0;
    }
    return true;
  }
  const tail = { x: v.x - f * (half + 0.6), y: v.y - g * (half + 0.6) };
  drive(v, open(tail) ? -2.8 : 0, -0.65 * side);
  if (turned > 2.5 || a.modeT > 2 || !onRoad(town, tail.x, tail.y)) {
    if (turned > 1.9 || a.modeT > 2) return finishTurn(town, state, v, a, opposite);
    a.mode = 'turn-forward';
    a.modeT = 0;
  }
  return true;
}

function finishTurn(town: Town, state: TrafficState, v: VehicleState, a: TrafficAgent, opposite: string | undefined): boolean {
  a.mode = 'cruise';
  a.modeT = 0;
  a.repathAt = state.time + 1.2;
  replan(town, state, v, a, opposite);
  return true;
}

/** Closing speed when the police nose meets the dozer's full footprint, blade included. */
function noseStrike(v: VehicleState, a: TrafficAgent, dozer: Dozer): void {
  const d = vehicleDefinition(v.definitionId), f = Math.cos(v.heading), g = Math.sin(v.heading);
  const nose = d.length * v.scale * 0.5;
  const body: Obstacle = { x: dozer.x + Math.cos(dozer.heading) * DOZER.bladeReach * 0.25, y: dozer.y + Math.sin(dozer.heading) * DOZER.bladeReach * 0.25,
    heading: dozer.heading, hl: DOZER.length * 0.5 + DOZER.bladeReach * 0.25, hw: DOZER.width * 0.5 + 0.1, vx: 0, vy: 0, speed: 0, key: 'dozer' };
  const hw = d.width * v.scale * 0.4;
  const touching = [-hw, 0, hw].some(side => boxDistance(body, v.x + f * nose - g * side, v.y + g * nose + f * side) < 0.3);
  if (!touching) return;
  const dx = dozer.x - v.x, dy = dozer.y - v.y, l = Math.hypot(dx, dy) || 1;
  const closing = ((v.vx - dozer.vx) * dx + (v.vy - dozer.vy) * dy) / l;
  a.ramContact = Math.max(a.ramContact, closing, 0.01);
}

function stepPolice(town: Town, state: TrafficState, v: VehicleState, a: TrafficAgent, dozer: Dozer, obs: readonly Obstacle[], dt: number): void {
  a.modeT += dt;
  // Dispatch radios the dozer's position; police always know where it is.
  a.sawX = dozer.x;
  a.sawY = dozer.y;
  const dist = Math.hypot(dozer.x - v.x, dozer.y - v.y);
  const speedNow = forwardSpeed(v);
  if (a.mode === 'recoil') {
    drive(v, -5, 0);
    if (a.modeT > 0.9) { a.mode = dist < 20 ? 'ram' : 'pursue'; a.modeT = 0; }
    return;
  }
  // Lanes first; the cruiser leaves the road only at close range with a clear line to the dozer.
  if (a.mode === 'pursue' && policeMayLeaveRoad({
    dozerNearby: dist < 22, pursuitAllowed: state.time >= a.ramAfter,
    offRoadBlocked: (dist >= 9 && !seesDozer(town, v, dozer)) || rubbleBetween(town, v.x, v.y, dozer.x, dozer.y) || rockBetween(town.surface, v.x, v.y, dozer.x, dozer.y),
  })) { a.mode = 'ram'; a.modeT = 0; }
  if (a.mode === 'ram') {
    noseStrike(v, a, dozer);
    if (dist > 28) { a.mode = 'pursue'; a.repathAt = 0; }
    else {
      const lead = Math.min(0.5, dist / 20);
      const tx = dozer.x + dozer.vx * lead, ty = dozer.y + dozer.vy * lead;
      const alpha = wrapAngle(Math.atan2(ty - v.y, tx - v.x) - v.heading);
      // Facing away: reverse-steer around instead of circling wide.
      if (Math.abs(alpha) > 2.2 && dist < 8) drive(v, -4, -Math.sign(alpha) * 0.65);
      else drive(v, POLICE_RAM * Math.max(0.45, 1 - Math.abs(alpha) / 2), clamp(alpha * 1.4, -0.65, 0.65));
      a.stuckT = Math.abs(speedNow) < 0.4 ? a.stuckT + dt : 0;
      if (a.stuckT > 1.5) {
        a.stuckT = 0;
        // Twice wedged short of the dozer: take the roads round for a while.
        if (++a.ramFails >= 2) { a.ramFails = 0; a.mode = 'pursue'; a.ramAfter = state.time + 4; a.repathAt = 0; }
        else { a.mode = 'recoil'; a.modeT = 0; }
      }
      return;
    }
  }
  if (state.time >= a.repathAt) {
    a.repathAt = state.time + 0.5;
    replan(town, state, v, a);
  }
  const { steer, turnAhead } = pursue(v, a, speedNow);
  let target = POLICE_CRUISE * Math.max(0.45, 1 - turnAhead / 1.9);
  const { gap, blocker } = pathGap(v, a, obs, Math.min(20, 3 + Math.max(0, speedNow) * 0.9));
  // Go around traffic instead of queueing behind it.
  const wantSwerve = blocker && !blocker.dozer && gap < 9 ? 1.7 : 0;
  a.swerve += clamp(wantSwerve - a.swerve, -dt * 3, dt * 3);
  if (gap < 1.6) target = Math.min(target, 2.5);
  a.stuckT = Math.abs(speedNow) < 0.4 ? a.stuckT + dt : Math.max(0, a.stuckT - dt);
  if (a.stuckT > 3) { a.mode = 'recoil'; a.modeT = 0; a.stuckT = 0; a.swerve = -1.7; }
  drive(v, target, steer);
}

// ---------------------------------------------------------------- world step

/** Lanes buried under rubble or wrecks; refreshed about once a second. */
function refreshBlocked(town: Town, state: TrafficState): void {
  state.laneBlocked.clear();
  state.roadProps = town.props.filter(p => !p.broken && onRoad(town, p.x + p.w / 2, p.y + p.d / 2));
  const wrecks: { x: number; y: number }[] = town.vehicles.filter(v => v.status !== 'operational');
  for (const p of state.roadProps) wrecks.push({ x: p.x + p.w / 2, y: p.y + p.d / 2 });
  for (const lane of town.network.lanes) {
    const pts = lanePoints(town.network, lane.id);
    for (let i = 0; i < pts.length; i += 2) {
      const p = pts[i]!;
      if (town.pile.heightAt(p.x, p.y) > 0.35 || wrecks.some(w => Math.hypot(w.x - p.x, w.y - p.y) < 1.2)) {
        state.laneBlocked.add(lane.id);
        break;
      }
    }
  }
}

/** Drivers perceive, decide and set their controls for this step. */
export function stepTraffic(town: Town, dozer: Dozer, dt: number): void {
  const state = town.traffic;
  if (!state) return;
  state.time += dt;
  state.blockT -= dt;
  if (state.blockT <= 0) { state.blockT = 1; refreshBlocked(town, state); }
  stepSpawns(town, state, dozer, dt);
  const obs = obstacles(town, dozer, state.roadProps);
  const gone = new Set<VehicleState>();
  for (const v of town.vehicles) {
    const a = v.traffic;
    if (!a) continue;
    if (v.status !== 'operational') { v.control = undefined; continue; }
    a.hitCd = Math.max(0, a.hitCd - dt);
    if (a.role === 'police') stepPolice(town, state, v, a, dozer, obs, dt);
    else if (!stepCivilian(town, state, v, a, dozer, obs, dt)) gone.add(v);
  }
  if (gone.size) town.vehicles = town.vehicles.filter(v => !gone.has(v));
  for (const [id, holds] of state.junctions) {
    const live = holds.filter(h => state.time - h.at <= 10 && town.vehicles.some(v => v.id === h.id && v.status === 'operational'));
    if (live.length) state.junctions.set(id, live); else state.junctions.delete(id);
  }
}

/** Read this step's dozer contacts: every police collision is one of its three hits, and a ram hurts the dozer. */
export function settleTraffic(town: Town, dozer: Dozer, events: WorldEvent[]): void {
  if (!town.traffic) return;
  const moving = dozerSpeed(dozer);
  for (const v of town.vehicles) {
    const a = v.traffic;
    if (!a) continue;
    const contact = a.dozerContact, blade = a.bladeContact, ram = a.ramContact;
    a.dozerContact = 0;
    a.bladeContact = 0;
    a.ramContact = 0;
    if (a.role !== 'police' || v.status !== 'operational') continue;
    // Any touch while charging ends the charge: back off and come again.
    if (ram > 0 && a.mode === 'ram') { a.mode = 'recoil'; a.modeT = 0; a.ramFails = 0; }
    if (a.hitCd > 0) continue;
    const rammed = ram > 2, struck = contact > 2 || (blade > 0 && moving > 2);
    if (!rammed && !struck) continue;
    a.hitCd = 0.9;
    const force = Math.min(12, Math.max(ram, contact));
    countVehicleHit(v);
    events.push({ kind: 'impact', x: v.x, y: v.y, z: 0.6, mag: Math.min(1, force / 8), material: 'metal' as WorldEvent['material'] });
    if (rammed) {
      // Heat and track wear cool off quickly, so one cruiser stings and two at once hurt.
      dozer.heat = Math.min(100, dozer.heat + RAM_HEAT + force * 1.1);
      dozer.track = Math.min(100, dozer.track + RAM_TRACK + force * 0.8);
      // A jolt, not a shove: the heavier the dozer is set to push, the less it moves.
      const dx = dozer.x - v.x, dy = dozer.y - v.y, l = Math.hypot(dx, dy) || 1;
      const kick = force * vehicleDefinition(v.definitionId).mass / (vehicleDefinition(v.definitionId).mass + 24);
      dozer.vx += dx / l * kick;
      dozer.vy += dy / l * kick;
    }
    if (v.status === 'operational') { a.mode = 'recoil'; a.modeT = 0; }
  }
}
