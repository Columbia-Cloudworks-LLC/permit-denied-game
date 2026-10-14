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
  /** Presentation only: radians of nose-down chassis pitch; negative squats the rear. */
  pitch: number;
  pitchVel: number;
  /** Presentation only: radians of hull roll; positive lifts the right-hand (+heading rotation) side. */
  roll: number;
  rollVel: number;
  /** Roll the ground under the tracks asks for (curbs, piles); set by the world step. */
  rideRoll: number;
  /** Signed yaw rate this step, in rad/s. */
  yaw: number;
  /** True only on the step the blade drops. */
  bladeLanded: boolean;
  /** Unit normal of the last solid contact, pointing out of the obstacle. */
  hitNx: number;
  hitNy: number;
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
    pitch: 0,
    pitchVel: 0,
    roll: 0,
    rollVel: 0,
    rideRoll: 0,
    yaw: 0,
    bladeLanded: false,
    hitNx: 0,
    hitNy: 0,
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
  stepPush(d, input, dt);

  const f = dozerForward(d);
  const speed = dozerSpeed(d);
  const along = d.vx * f.x + d.vy * f.y;
  const steerScale = 1 / (1 + speed * DOZER.steerSpeedFalloff);
  d.yaw = input.steer * DOZER.steer * steerScale;
  d.heading += d.yaw * dt;

  const nextAlong = nextAlongSpeed(d, input, along, Math.min(1, Math.abs(d.yaw) / DOZER.steer), dt);
  const latX = d.vx - along * f.x;
  const latY = d.vy - along * f.y;
  const latScale = Math.max(0, 1 - DOZER.lateralGrip * dt);
  d.vx = nextAlong * f.x + latX * latScale;
  d.vy = nextAlong * f.y + latY * latScale;
  capDozerSpeed(d, input);

  d.x += d.vx * dt;
  d.y += d.vy * dt;
  d.odo += nextAlong * dt;

  d.heat = Math.max(0, d.heat - DOZER.heatCool * dt);
  d.track = Math.max(0, d.track - DOZER.trackCool * dt);
  d.lastImpact = Math.max(0, d.lastImpact - dt);
  settleChassis(d, along, nextAlong, dt);
}

const PITCH = { brake: 0.07, squat: -0.042, impact: 0.035, max: 0.13, bladeDrop: 0.3 } as const;
const ROLL = { impact: 0.03, max: 0.026 } as const;
/** Spring-damper on the hull: stiff enough to read at once, damped to one small overshoot. */
const CHASSIS = { stiffness: 121, damping: 13 } as const;

/**
 * Braking dips the nose and hard throttle squats the rear; the ground under the tracks rolls
 * the hull. Impacts kick on top, and a spring-damper settles both back to their targets.
 */
function settleChassis(d: Dozer, along: number, nextAlong: number, dt: number): void {
  const surge = dt > 0 ? (nextAlong - along) / dt / DOZER.accel : 0;
  const slowing = Math.sign(along) !== 0 && Math.sign(surge) === -Math.sign(along);
  const pitchTarget = Math.min(1, Math.abs(surge)) * (slowing ? PITCH.brake : PITCH.squat);
  d.pitchVel += (CHASSIS.stiffness * (pitchTarget - d.pitch) - CHASSIS.damping * d.pitchVel) * dt;
  d.pitch = clamp(d.pitch + d.pitchVel * dt, -PITCH.max, PITCH.max);
  d.rollVel += (CHASSIS.stiffness * (d.rideRoll - d.roll) - CHASSIS.damping * d.rollVel) * dt;
  d.roll = clamp(d.roll + d.rollVel * dt, -ROLL.max, ROLL.max);
}

/** Track crawl: a kick to the hull's pitch and roll rates, as when a track mounts a curb or a pile. */
export function kickChassis(d: Dozer, pitch: number, roll: number): void {
  d.pitchVel += pitch;
  d.rollVel += roll;
}

/** Holding the blade starts a timed push once the cooldown allows; the blade stays down for the push. */
function stepPush(d: Dozer, input: DriveInput, dt: number): void {
  if (input.blade && d.pushCd <= 0 && d.pushT <= 0) {
    d.pushT = DOZER.pushSeconds * input.pushMul;
    d.pushCd = DOZER.pushCooldown;
  }
  const wasDown = d.bladeDown;
  d.bladeDown = input.blade || d.pushT > 0;
  d.bladeLanded = d.bladeDown && !wasDown;
  // The blade's weight landing rocks the nose down.
  if (d.bladeLanded) d.pitchVel += PITCH.bladeDrop;
  if (d.pushT > 0) d.pushT -= dt;
  if (d.pushCd > 0 && d.pushT <= 0) d.pushCd -= dt;
}

/**
 * Forward speed after throttle or coasting, plus the push surge while driving forward. Pivoting
 * (scrub 0..1) drags the tracks sideways: it lowers the speed the throttle holds, bleeds any
 * excess at scrubDecel, and adds to coasting drag, so a neutral turn sheds momentum.
 */
function nextAlongSpeed(d: Dozer, input: DriveInput, along: number, scrub: number, dt: number): number {
  const throttle = input.throttle;
  if (throttle === 0) return approach(along, 0, (DOZER.coast + DOZER.scrubDecel * scrub) * dt) + (d.pushT > 0 ? DOZER.pushForce * dt : 0);
  const reach = 1 - DOZER.scrubSlow * scrub;
  const target = (throttle > 0 ? DOZER.maxSpeed * input.engineMul * Math.min(1, throttle) : DOZER.maxReverse * Math.max(-1, throttle)) * reach;
  const scrubbing = scrub > 0 && Math.sign(along) === Math.sign(target) && Math.abs(along) > Math.abs(target);
  const acc = scrubbing ? DOZER.scrubDecel : throttle > 0 ? DOZER.accel * input.engineMul : DOZER.reverseAccel;
  const next = approach(along, target, acc * dt);
  return d.pushT > 0 && throttle > 0 ? next + DOZER.pushForce * dt : next;
}

/** Clamp to reverse or forward top speed; a push may run slightly over. */
function capDozerSpeed(d: Dozer, input: DriveInput): void {
  const max = input.throttle < 0 ? DOZER.maxReverse : DOZER.maxSpeed * input.engineMul * (d.pushT > 0 ? 1.12 : 1);
  const sp = dozerSpeed(d);
  if (sp > max) {
    d.vx *= max / sp;
    d.vy *= max / sp;
  }
}

function applyDozerImpulse(d: Dozer, nx: number, ny: number, depth: number, bounce: number): number {
  d.x += nx * depth;
  d.y += ny * depth;
  const vn = d.vx * nx + d.vy * ny;
  if (vn > 0) return 0;
  const impact = -vn;
  d.vx -= vn * nx * (1 + bounce);
  d.vy -= vn * ny * (1 + bounce);
  d.vx *= 1 - DOZER.impactLoss * 0.15;
  d.vy *= 1 - DOZER.impactLoss * 0.15;
  d.lastImpact = Math.max(d.lastImpact, Math.min(0.36, 0.07 + impact * 0.09));
  d.hitNx = nx;
  d.hitNy = ny;
  // A head-on hit throws the nose down and a hit from behind rocks it back; a glancing hit lifts the struck side.
  const fx = Math.cos(d.heading), fy = Math.sin(d.heading);
  d.pitch = clamp(d.pitch - (nx * fx + ny * fy) * impact * PITCH.impact, -PITCH.max, PITCH.max);
  d.roll = clamp(d.roll - (ny * fx - nx * fy) * impact * ROLL.impact, -ROLL.max, ROLL.max);
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
