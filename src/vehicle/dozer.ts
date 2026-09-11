import { DOZER } from "../game/constants";
import { approach, clamp, circleAabb, len } from "../game/math";

export interface Dozer {
  /** One-step movement origin, consumed by world-space terrain constraints. */
  motionStartX?: number;
  motionStartY?: number;
  pileResistance?: number;
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  bladeDown: boolean;
  pushT: number;
  pushCd: number;
  heat: number;
  track: number;
  lastImpact: number;
  odo: number;
}

export function createDozer(x: number, y: number, heading: number): Dozer {
  return {
    x,
    y,
    heading,
    vx: 0,
    vy: 0,
    bladeDown: false,
    pushT: 0,
    pushCd: 0,
    heat: 0,
    track: 0,
    lastImpact: 0,
    odo: 0,
  };
}

export function dozerSpeed(d: Dozer): number {
  return len(d.vx, d.vy);
}

export function dozerForward(d: Dozer): { x: number; y: number } {
  return { x: Math.cos(d.heading), y: Math.sin(d.heading) };
}

export function bladePoints(d: Dozer): { x: number; y: number }[] {
  const f = dozerForward(d);
  const rx = -f.y;
  const ry = f.x;
  const reach = DOZER.bladeReach + (d.bladeDown ? 0.12 : 0);
  const cx = d.x + f.x * reach;
  const cy = d.y + f.y * reach;
  const pts: { x: number; y: number }[] = [];
  for (let i = -2; i <= 2; i++) {
    const t = (i / 2) * DOZER.bladeHalf;
    pts.push({
      x: cx + rx * t + f.x * DOZER.bladeDepth * 0.2,
      y: cy + ry * t + f.y * DOZER.bladeDepth * 0.2,
    });
  }
  return pts;
}

export interface DriveInput {
  throttle: number;
  steer: number;
  blade: boolean;
  engineMul: number;
  bladeMul: number;
  pushMul: number;
}

export function stepDozer(d: Dozer, input: DriveInput, dt: number): void {
  d.motionStartX = d.x;
  d.motionStartY = d.y;
  if (input.blade && d.pushCd <= 0 && d.pushT <= 0) {
    d.pushT = DOZER.pushSeconds * input.pushMul;
    d.pushCd = DOZER.pushCooldown;
  }
  d.bladeDown = input.blade || d.pushT > 0;
  if (d.pushT > 0) d.pushT -= dt;
  if (d.pushCd > 0 && d.pushT <= 0) d.pushCd -= dt;

  const f = dozerForward(d);
  const speed = dozerSpeed(d);
  const along = d.vx * f.x + d.vy * f.y;
  const steerScale = 1 / (1 + speed * DOZER.steerSpeedFalloff);
  d.heading += input.steer * DOZER.steer * steerScale * dt;

  let target = 0;
  if (input.throttle > 0) target = DOZER.maxSpeed * input.engineMul * Math.min(1, input.throttle);
  if (input.throttle < 0) target = DOZER.maxReverse * Math.max(-1, input.throttle);
  const acc = input.throttle >= 0 ? DOZER.accel * input.engineMul : DOZER.reverseAccel;
  let nextAlong = approach(along, target, acc * dt);
  if (input.throttle === 0) nextAlong = approach(along, 0, DOZER.coast * dt);
  if (d.pushT > 0 && input.throttle >= 0) nextAlong += DOZER.pushForce * dt;

  const latX = d.vx - along * f.x;
  const latY = d.vy - along * f.y;
  const latScale = Math.max(0, 1 - DOZER.lateralGrip * dt);
  d.vx = nextAlong * f.x + latX * latScale;
  d.vy = nextAlong * f.y + latY * latScale;

  const max = input.throttle < 0 ? DOZER.maxReverse : DOZER.maxSpeed * input.engineMul * (d.pushT > 0 ? 1.12 : 1);
  const sp = dozerSpeed(d);
  if (sp > max) {
    d.vx *= max / sp;
    d.vy *= max / sp;
  }

  d.x += d.vx * dt;
  d.y += d.vy * dt;
  d.odo += nextAlong * dt;

  d.heat = Math.max(0, d.heat - DOZER.heatCool * dt);
  d.track = Math.max(0, d.track - DOZER.trackCool * dt);
  d.lastImpact = Math.max(0, d.lastImpact - dt);
}

export function applyDozerImpulse(d: Dozer, nx: number, ny: number, depth: number, bounce: number): number {
  d.x += nx * depth;
  d.y += ny * depth;
  const vn = d.vx * nx + d.vy * ny;
  if (vn > 0) return 0;
  const impact = -vn;
  d.vx -= vn * nx * (1 + bounce);
  d.vy -= vn * ny * (1 + bounce);
  d.vx *= 1 - DOZER.impactLoss * 0.15;
  d.vy *= 1 - DOZER.impactLoss * 0.15;
  d.lastImpact = 0.08;
  return impact;
}

export function resolveCircleSolid(
  d: Dozer,
  x: number,
  y: number,
  w: number,
  dep: number,
  bounce = 0.12,
): number {
  const hit = circleAabb(d.x, d.y, DOZER.radius, x, y, w, dep);
  if (!hit.hit) return 0;
  return applyDozerImpulse(d, hit.nx, hit.ny, hit.depth, bounce);
}

export function clampDozer(d: Dozer, minX: number, minY: number, maxX: number, maxY: number): void {
  d.x = clamp(d.x, minX, maxX);
  d.y = clamp(d.y, minY, maxY);
}
