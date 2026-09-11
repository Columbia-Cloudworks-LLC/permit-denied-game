import { ROAD } from "../game/constants";
import { approach, clamp, circleAabb, len, wrapAngle } from "../game/math";
import type { RoadVehicle } from "../structure/types";
import { findRoadRoute } from "../world/roads";
import {
  indexNetwork,
  nearestLane,
  projectPointToRoad,
  roadSurfaceAt,
  samplePolyline,
} from "../world/roads";
import { pickVerificationRoute } from "../world/routing";
import type { Town } from "../world/town";

export function createRoadVehicle(
  x: number = ROAD.spawnX,
  y: number = ROAD.spawnY,
  heading: number = ROAD.spawnHeading,
  route: string[] = [],
  layer = 0,
): RoadVehicle {
  return {
    x,
    y,
    heading,
    vx: 0,
    vy: 0,
    odo: 0,
    alive: true,
    layer,
    elev: 0,
    laneId: route[0] ?? null,
    route,
    routeIndex: 0,
    waitT: 0,
    reversing: false,
  };
}

function roadForward(v: RoadVehicle): { x: number; y: number } {
  return { x: Math.cos(v.heading), y: Math.sin(v.heading) };
}

export function roadSpeed(v: RoadVehicle): number {
  return len(v.vx, v.vy);
}

export function attachRoadRoute(town: Town, v: RoadVehicle): void {
  if (v.route.length) return;
  const demo = pickVerificationRoute(town.network);
  if (demo && demo.length) {
    v.route = demo;
    v.routeIndex = 0;
    v.laneId = demo[0] ?? null;
    return;
  }
  const start = nearestLane(town.network, v.x, v.y, v.layer);
  const lanes = town.network.lanes.filter((l) => l.dir === 1);
  let path: string[] | null = start ? [start.id] : null;
  if (start) {
    for (let i = lanes.length - 1; i >= 0; i--) {
      const dest = lanes[i]!;
      if (dest.id === start.id) continue;
      const found = findRoadRoute(town.network, start.id, dest.id);
      if (found && found.length >= 2) {
        path = found;
        break;
      }
    }
  }
  if (!path) return;
  v.route = path;
  v.routeIndex = 0;
  v.laneId = path[0] ?? null;
}

export function stepRoadVehicle(v: RoadVehicle, town: Town, dt: number): void {
  if (!v.alive) return;
  attachRoadRoute(town, v);
  const idx = indexNetwork(town.network);
  if (v.waitT > 0.55) {
    v.reversing = !v.reversing;
    v.waitT = 0;
    if (v.routeIndex > 0) v.routeIndex -= 1;
    v.laneId = v.route[v.routeIndex] ?? v.laneId;
  }

  const lane = v.laneId ? idx.laneById.get(v.laneId) : null;
  const seg = lane ? idx.segmentById.get(lane.segmentId) : null;
  if (lane && seg) {
    const alongT = lane.dir === 1 ? 0.92 : 0.08;
    const target = samplePolyline(seg.points, v.reversing ? 1 - alongT : alongT);
    const want = Math.atan2(target.y - v.y, target.x - v.x);
    v.heading = wrapAngle(v.heading + wrapAngle(want - v.heading) * Math.min(1, ROAD.steer * dt));
    const proj = projectPointToRoad(town.network, v.x, v.y, v.layer);
    if (proj.on) {
      v.x = v.x * 0.72 + proj.x * 0.28;
      v.y = v.y * 0.72 + proj.y * 0.28;
      v.elev = proj.elev;
    }
    const distEnd = len(target.x - v.x, target.y - v.y);
    if (distEnd < 1.6 && !v.reversing) {
      v.routeIndex = Math.min(v.route.length - 1, v.routeIndex + 1);
      v.laneId = v.route[v.routeIndex] ?? v.laneId;
    }
  }

  const f = roadForward(v);
  const along = v.vx * f.x + v.vy * f.y;
  const goal = v.reversing ? -ROAD.maxSpeed * 0.45 : ROAD.maxSpeed;
  const nextAlong = approach(along, goal, ROAD.accel * dt);
  const latX = v.vx - along * f.x;
  const latY = v.vy - along * f.y;
  const latScale = Math.max(0, 1 - ROAD.lateralGrip * dt);
  v.vx = nextAlong * f.x + latX * latScale;
  v.vy = nextAlong * f.y + latY * latScale;
  const sp = roadSpeed(v);
  if (sp > ROAD.maxSpeed) {
    v.vx *= ROAD.maxSpeed / sp;
    v.vy *= ROAD.maxSpeed / sp;
  }
  v.x += v.vx * dt;
  v.y += v.vy * dt;
  v.odo += nextAlong * dt;
  const stay = roadSurfaceAt(town.network, v.x, v.y, v.layer);
  if (!stay.on) {
    const back = projectPointToRoad(town.network, v.x, v.y, v.layer);
    if (back.segmentId) {
      v.x = back.x;
      v.y = back.y;
      v.elev = back.elev;
    }
  }
}

export function resolveRoadSolid(
  v: RoadVehicle,
  x: number,
  y: number,
  w: number,
  d: number,
  bounce = 0.08,
): number {
  const hit = circleAabb(v.x, v.y, ROAD.radius, x, y, w, d);
  if (!hit.hit) return 0;
  v.x += hit.nx * hit.depth;
  v.y += hit.ny * hit.depth;
  const vn = v.vx * hit.nx + v.vy * hit.ny;
  if (vn > 0) return 0;
  v.vx -= vn * hit.nx * (1 + bounce);
  v.vy -= vn * hit.ny * (1 + bounce);
  return -vn;
}

export function clampRoadVehicle(v: RoadVehicle, minX: number, minY: number, maxX: number, maxY: number): void {
  v.x = clamp(v.x, minX, maxX);
  v.y = clamp(v.y, minY, maxY);
}
