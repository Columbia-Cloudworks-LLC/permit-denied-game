import { ROAD } from "../game/constants";
import { approach, clamp, circleAabb, len } from "../game/math";
import type { RoadVehicle } from "../structure/types";

export function createRoadVehicle(
  x: number = ROAD.spawnX,
  y: number = ROAD.spawnY,
  heading: number = ROAD.spawnHeading,
): RoadVehicle {
  return {
    x,
    y,
    heading,
    vx: 0,
    vy: 0,
    odo: 0,
    alive: true,
  };
}

function roadForward(v: RoadVehicle): { x: number; y: number } {
  return { x: Math.cos(v.heading), y: Math.sin(v.heading) };
}

export function roadSpeed(v: RoadVehicle): number {
  return len(v.vx, v.vy);
}

export function stepRoadVehicle(v: RoadVehicle, dt: number): void {
  if (!v.alive) return;
  const f = roadForward(v);
  const along = v.vx * f.x + v.vy * f.y;
  const nextAlong = approach(along, ROAD.maxSpeed, ROAD.accel * dt);
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
