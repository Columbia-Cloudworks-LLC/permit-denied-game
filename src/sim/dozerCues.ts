import { HARD_LOT_COVERS, SOFT_LOT_COVERS } from "../render/coverPalette";
import type { CoverKind, Material, WorldEvent } from "../structure/types";
import { DOZER } from "../game/constants";
import { dozerForward, dozerSpeed, kickChassis, type Dozer } from "../vehicle/dozer";
import { groundPatchContains, surfaceAt } from "../world/terrain";
import type { Town } from "../world/town";
import type { ParticlePool } from "../fx/particles";
import { pointOnRoad } from "../world/roads";
import { fadeTreadMarks } from "../world/seasonTracks";
import { addSurfaceMark } from "./debris";

const SOFT = new Set<CoverKind>(SOFT_LOT_COVERS);
const HARD = new Set<CoverKind>(HARD_LOT_COVERS);

export function coverAtPoint(town: Town, x: number, y: number): CoverKind | undefined {
  let best: { cover: CoverKind; z: number } | undefined;
  for (const patch of town.ground) {
    if (!groundPatchContains(patch, x, y)) continue;
    if (!best || patch.z >= best.z) best = { cover: patch.cover, z: patch.z };
  }
  if (best) return best.cover;
  if (!town.surface) return undefined;
  const surface = surfaceAt(town.surface, x, y);
  switch (surface) {
    case "grass":
      return "grass";
    case "scrub":
      return "scrub";
    case "dirt":
    case "wet-edge":
      return "dirt";
    case "prairie":
      return "grass";
    case "duff":
    case "leaf-litter":
    case "forest-floor":
    case "forest-core":
      return "forest-floor";
    case "gravel":
      return "gravel";
    case "field":
      return "planted";
    case "water":
      return "water";
    case "developed":
      return "lot";
    default: {
      const _never: never = surface;
      return _never;
    }
  }
}

export function emitDozerCues(
  town: Town,
  dozer: Dozer,
  particles: ParticlePool,
  events: WorldEvent[],
  dt: number,
): void {
  const speed = dozerSpeed(dozer);
  const load = dozer.pushT > 0 || dozer.bladeDown;
  const moving = speed > 0.55;
  const impact = dozer.lastImpact > 0.12 && dozer.lastImpact + dt >= 0.2;
  const f = dozerForward(dozer);
  rideTracks(town, dozer, f, dt);
  if (dozer.bladeLanded) events.push({ kind: "blade-drop", x: dozer.x + f.x * DOZER.bladeReach, y: dozer.y + f.y * DOZER.bladeReach, z: 0, mag: 0.4 + Math.min(0.3, speed * 0.04) });
  const pivoting = Math.abs(dozer.yaw) > DOZER.steer * 0.45;
  if (!moving && !impact && !pivoting) return;

  const cover = coverAtPoint(town, dozer.x, dozer.y);
  if (moving) movingCues(town, dozer, particles, events, cover, f, speed, load, dt);
  if (pivoting) pivotCue(town, dozer, particles, events, cover, f, speed, dt);
  if (impact) impactCue(town, dozer, particles, events, cover, f);
}

/** Track centrelines sit this far either side of the hull's axis. */
const TRACK_OFFSET = 0.62;
/** Height a road edge stands above the lot beside it, for the track crawl. */
const CURB = 0.12;

/** Ground height under one track: settled pile, plus a curb step on a road. */
function trackGround(town: Town, x: number, y: number): number {
  return town.pile.sample(x, y).height + (pointOnRoad(town.network, x, y) ? CURB : 0);
}

/**
 * Track crawl: the hull rolls toward whichever track rides lower, and a track that mounts or
 * drops off a curb or pile edge kicks the roll, so the dozer rides over things rather than
 * clipping through. Presentation only.
 */
function rideTracks(town: Town, dozer: Dozer, f: { x: number; y: number }, dt: number): void {
  const rx = -f.y, ry = f.x;
  const step = (side: number) => {
    const x = dozer.x + rx * TRACK_OFFSET * side, y = dozer.y + ry * TRACK_OFFSET * side;
    const now = trackGround(town, x, y);
    return { now, rise: now - trackGround(town, x - dozer.vx * dt, y - dozer.vy * dt) };
  };
  const left = step(-1), right = step(1);
  dozer.rideRoll = Math.max(-0.026, Math.min(0.026, (right.now - left.now) / (TRACK_OFFSET * 2)));
  // Mounting an edge noses the hull up; a step under one track only rolls it.
  const roll = right.rise - left.rise, lift = (right.rise + left.rise) / 2;
  if (Math.abs(roll) > 0.04 || Math.abs(lift) > 0.04) kickChassis(dozer, clampKick(-lift * 2.2), clampKick(roll * 2.2));
}

function clampKick(v: number): number {
  return Math.max(-0.4, Math.min(0.4, v));
}

/** True when the odometer crossed a whole multiple of 1/scale this step. */
function odoTick(dozer: Dozer, speed: number, dt: number, scale: number): boolean {
  return ((dozer.odo * scale) | 0) !== (((dozer.odo - speed * dt) * scale) | 0);
}

const TRACK_SIDES = [-1, 1] as const;

/** Exhaust under load or heat, blade sparks on pavement, tread marks and dust on soft off-road ground, scrapes on hard covers at speed. */
function movingCues(town: Town, dozer: Dozer, particles: ParticlePool, events: WorldEvent[], cover: CoverKind | undefined, f: { x: number; y: number }, speed: number, load: boolean, dt: number): void {
  if ((dozer.heat > 0.22 || load) && odoTick(dozer, speed, dt, 1.6)) {
    const stackX = dozer.x - f.x * 0.72;
    const stackY = dozer.y - f.y * 0.72;
    const n = dozer.heat > 0.7 ? 2 : 1;
    particles.spawn("dust", stackX, stackY, 1.15 + dozer.heat * 0.35, n, 0.18 + speed * 0.04, 0.55);
  }
  if (dozer.bladeDown && speed > 0.9 && odoTick(dozer, speed, dt, 2.4)) bladeSparkCue(town, dozer, particles, events, f, speed);
  if (!cover) return;
  if (SOFT.has(cover) && odoTick(dozer, speed, dt, 1.15) && !pointOnRoad(town.network, dozer.x, dozer.y)) treadCue(town, dozer, particles, cover, f, speed, load);
  if (HARD.has(cover) && speed > 2.4 && odoTick(dozer, speed, dt, 0.85)) scrapeCue(town, dozer, particles, f);
}

/** Clumps a pivoting track throws: snow, gravel, or the tread tint of the soft cover. */
function churnTint(town: Town, cover: CoverKind): number | undefined {
  if (town.groundCondition === "snow" || town.season === "winter") return 0xe6ecef;
  if (cover === "gravel") return 0x8a8478;
  return TREAD_TINT[cover];
}

/**
 * A pivot churns the ground under the inside track, the one held still or run backward, and
 * a hard turn at speed binds the tracks with a groan. Ticks on heading so a neutral turn,
 * which covers no distance, still throws clumps.
 */
function pivotCue(town: Town, dozer: Dozer, particles: ParticlePool, events: WorldEvent[], cover: CoverKind | undefined, f: { x: number; y: number }, speed: number, dt: number): void {
  if (((dozer.heading * 4) | 0) === (((dozer.heading - dozer.yaw * dt) * 4) | 0)) return;
  const side = Math.sign(dozer.yaw);
  const x = dozer.x - f.y * TRACK_OFFSET * side, y = dozer.y + f.x * TRACK_OFFSET * side;
  if (speed > 2.2) events.push({ kind: "track-bind", x, y, z: 0.1, mag: Math.min(1, speed / DOZER.maxSpeed + Math.abs(dozer.yaw) / DOZER.steer * 0.5) });
  if (!cover || PAVED.has(cover) || cover === "tracks" || cover === "water" || pointOnRoad(town.network, x, y)) return;
  const tint = churnTint(town, cover);
  particles.spawn("crop", x, y, 0.08, 3, 1.1, 1.9, undefined, tint);
  particles.spawn("dust", x, y, 0.1, 1, 0.5, 0.6, undefined, tint);
}

/** Churned mud on bare ground; crushed, greener sod on grass and scrub. */
const TREAD_TINT: Partial<Record<CoverKind, number>> = { dirt: 0x2a1f12, lot: 0x2e2416, planted: 0x2c2214, grass: 0x34391f, scrub: 0x383a22 };

function treadCue(town: Town, dozer: Dozer, particles: ParticlePool, cover: CoverKind, f: { x: number; y: number }, speed: number, load: boolean): void {
  fadeTreadMarks(town, "tire");
  for (const side of TRACK_SIDES) {
    addSurfaceMark(town, dozer.x - f.y * 0.62 * side, dozer.y + f.x * 0.62 * side, "tire", "concrete", dozer.heading);
    town.marks[town.marks.length - 1]!.tint = TREAD_TINT[cover];
  }
  particles.spawn("dust", dozer.x, dozer.y, 0.12, load ? 3 : 1, 0.35 + speed * 0.08, 0.7);
}

function scrapeCue(town: Town, dozer: Dozer, particles: ParticlePool, f: { x: number; y: number }): void {
  addSurfaceMark(town, dozer.x, dozer.y, "scrape", "concrete", dozer.heading);
  if (dozer.bladeDown) particles.spawn("concrete", dozer.x + f.x * 0.9, dozer.y + f.y * 0.9, 0.18, 1, 0.4, 0.9);
}

/** Covers hard enough for a lowered blade edge to strike sparks. */
const PAVED = new Set<CoverKind>(["driveway", "parking", "concrete"]);

/** A lowered blade dragged over pavement throws sparks from its cutting edge and grinds. */
function bladeSparkCue(town: Town, dozer: Dozer, particles: ParticlePool, events: WorldEvent[], f: { x: number; y: number }, speed: number): void {
  const x = dozer.x + f.x * DOZER.bladeReach, y = dozer.y + f.y * DOZER.bladeReach;
  const cover = coverAtPoint(town, x, y);
  if (!pointOnRoad(town.network, x, y) && !(cover && PAVED.has(cover))) return;
  // Each blade corner throws a fan out to its side and a little ahead, riding the dozer's own speed.
  const spray = 2.4 + speed * 0.45;
  for (const sign of [-1, 1]) {
    const rx = -f.y * sign, ry = f.x * sign;
    const vx = dozer.vx + (rx + f.x * 0.45) * spray, vy = dozer.vy + (ry + f.y * 0.45) * spray;
    particles.sparks(x + rx * DOZER.bladeHalf, y + ry * DOZER.bladeHalf, vx, vy, 3, 1.2);
  }
  events.push({ kind: "scrape", x, y, z: 0.06, mag: Math.min(0.9, 0.3 + speed * 0.06), material: "concrete" });
}

/** A hard hit throws grit or dust; on pavement it scrapes, and on parking or concrete it sparks. */
function impactCue(town: Town, dozer: Dozer, particles: ParticlePool, events: WorldEvent[], cover: CoverKind | undefined, f: { x: number; y: number }): void {
  const hardHit = !cover || HARD.has(cover);
  particles.burst(hardHit ? "concrete" : "dust", dozer.x + f.x * 0.8, dozer.y + f.y * 0.8, 0.22, 0.35 + dozer.lastImpact * 0.25);
  if (!hardHit) return;
  addSurfaceMark(town, dozer.x + f.x * 0.7, dozer.y + f.y * 0.7, "scrape", impactMaterial(cover), dozer.heading);
  if (cover === "parking" || cover === "concrete") {
    particles.spawn("metal", dozer.x + f.x, dozer.y + f.y, 0.35, 2, 1.1, 2.4);
    events.push({ kind: "spark", x: dozer.x + f.x, y: dozer.y + f.y, z: 0.4, mag: 0.28, material: "metal" });
  }
}

function impactMaterial(cover: CoverKind | undefined): Material {
  if (cover === "dirt" || cover === "lot" || cover === "tracks") return "wood";
  if (cover === "parking" || cover === "concrete") return "concrete";
  return "concrete";
}
