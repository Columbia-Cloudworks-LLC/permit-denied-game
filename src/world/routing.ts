import { len } from "../game/math";
import type { VehicleRole } from "../structure/types";
import {
  findRoadRoute,
  indexNetwork,
  nearestLane,
  roadSurfaceAt,
  type RoadNetwork,
  type RoadSegment,
} from "./roads";

export interface RouteRequest {
  startX: number;
  startY: number;
  destX: number;
  destY: number;
  role: VehicleRole;
  layer?: number;
  dozerNearby: boolean;
  pursuitAllowed: boolean;
  offRoadBlocked: boolean;
  destOnRoad: boolean;
}

export type RouteMode = "road" | "offroad-pursuit" | "blocked" | "inaccessible";

export interface RouteResult {
  ok: boolean;
  path: string[];
  mode: RouteMode;
  reason: string;
}

export function civilianMustStayOnRoad(): boolean {
  return true;
}

export function policeMayLeaveRoad(req: Pick<RouteRequest, "dozerNearby" | "pursuitAllowed" | "offRoadBlocked">): boolean {
  return req.dozerNearby && req.pursuitAllowed && !req.offRoadBlocked;
}

export function findTrafficRoute(network: RoadNetwork, req: RouteRequest): RouteResult {
  const startLane = nearestLane(network, req.startX, req.startY, req.layer);
  const destLane = nearestLane(network, req.destX, req.destY, req.layer);
  const startOn = roadSurfaceAt(network, req.startX, req.startY, req.layer).on;
  const destOn = req.destOnRoad || roadSurfaceAt(network, req.destX, req.destY, req.layer).on;

  if (req.role === "civilian") {
    if (!startOn) return { ok: false, path: [], mode: "inaccessible", reason: "civilian-off-road-start" };
    if (!destOn || !startLane || !destLane) {
      return { ok: false, path: [], mode: "inaccessible", reason: "civilian-dest-not-on-road" };
    }
    const path = findRoadRoute(network, startLane.id, destLane.id);
    if (path) return { ok: true, path, mode: "road", reason: "lane-path" };
    return { ok: false, path: [], mode: "blocked", reason: "road-blocked" };
  }

  if (startLane && destLane) {
    const path = findRoadRoute(network, startLane.id, destLane.id);
    if (path) return { ok: true, path, mode: "road", reason: "prefer-road" };
    if (!destOn) return { ok: false, path: [], mode: "inaccessible", reason: "dest-unreachable" };
    if (policeMayLeaveRoad(req)) {
      return { ok: true, path: [startLane.id], mode: "offroad-pursuit", reason: "nearby-pursuit" };
    }
    return { ok: false, path: [], mode: "blocked", reason: "road-blocked" };
  }

  if (!destOn && !policeMayLeaveRoad(req)) {
    return { ok: false, path: [], mode: "inaccessible", reason: "dest-off-road" };
  }
  if (policeMayLeaveRoad(req)) {
    return { ok: true, path: startLane ? [startLane.id] : [], mode: "offroad-pursuit", reason: "nearby-pursuit" };
  }
  return { ok: false, path: [], mode: "inaccessible", reason: "no-road-access" };
}

export function pickVerificationRoute(network: RoadNetwork): string[] | null {
  const drivewayPath = pickDrivewayDemoRoute(network);
  if (drivewayPath && drivewayPath.length >= 2) return drivewayPath;
  const idx = indexNetwork(network);
  const lanes = network.lanes.filter((l) => l.dir === 1 && idx.segmentById.get(l.segmentId)?.roadClass !== "driveway");
  if (lanes.length < 2) return lanes[0] ? [lanes[0].id] : null;
  let best: string[] | null = null;
  for (let i = 0; i < lanes.length; i++) {
    for (let j = lanes.length - 1; j > i; j--) {
      const path = findRoadRoute(network, lanes[i]!.id, lanes[j]!.id);
      if (path && path.length >= 2 && (!best || path.length > best.length)) best = path;
    }
  }
  return best ?? [lanes[0]!.id];
}

export function pickDrivewayDemoRoute(network: RoadNetwork): string[] | null {
  const idx = indexNetwork(network);
  const starts = network.lanes.filter((l) => {
    const seg = idx.segmentById.get(l.segmentId);
    return l.dir === 1 && seg && seg.roadClass !== "driveway" && seg.roadClass !== "ramp";
  });
  const drives = network.lanes.filter((l) => idx.segmentById.get(l.segmentId)?.roadClass === "driveway");
  let best: string[] | null = null;
  for (const start of starts) {
    for (const dest of drives) {
      const path = findRoadRoute(network, start.id, dest.id);
      if (!path || path.length < 2) continue;
      if (routeUsesIntersection(network, path) && (!best || path.length > best.length)) best = path;
    }
  }
  return best;
}

/** Each lane on the route with its segment and whether it ends at a junction. */
function routeLegs(network: RoadNetwork, path: readonly string[]): { seg: RoadSegment; junction: boolean }[] {
  const idx = indexNetwork(network);
  const legs: { seg: RoadSegment; junction: boolean }[] = [];
  for (const id of path) {
    const lane = idx.laneById.get(id);
    if (!lane) continue;
    const seg = idx.segmentById.get(lane.segmentId);
    if (!seg) continue;
    const node = idx.nodeById.get(lane.dir === 1 ? seg.endId : seg.startId);
    legs.push({ seg, junction: !!node && node.segmentIds.length >= 3 });
  }
  return legs;
}

function routeUsesIntersection(network: RoadNetwork, path: string[]): boolean {
  return routeLegs(network, path).some((leg) => leg.junction);
}

export function routeUsesCurveAndIntersection(network: RoadNetwork, path: string[]): boolean {
  let curved = false;
  let junction = false;
  for (const leg of routeLegs(network, path)) {
    const seg = leg.seg;
    if (seg.points.length >= 5) {
      const a = seg.points[0]!;
      const b = seg.points[seg.points.length - 1]!;
      const mid = seg.points[Math.floor(seg.points.length / 2)]!;
      const chord = len(b.x - a.x, b.y - a.y);
      const via = len(mid.x - a.x, mid.y - a.y) + len(b.x - mid.x, b.y - mid.y);
      if (via > chord + 0.12) curved = true;
    }
    if (leg.junction) junction = true;
  }
  return curved && junction;
}
