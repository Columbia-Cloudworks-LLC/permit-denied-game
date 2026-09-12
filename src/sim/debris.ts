import { MATERIALS } from '../structure/materials';
import { DEBRIS, DOZER } from "../game/constants";
import { clamp, len } from "../game/math";
import { Rng } from "../game/rng";
import type { ParticlePool } from "../fx/particles";
import type {
  DebrisLayer,
  DebrisShape,
  DebrisSkin,
  GroundKind,
  GroundMark,
  Material,
  Rubble,
  VehicleProfile,
  WorldEvent,
} from "../structure/types";
import type { Dozer } from "../vehicle/dozer";
import { dozerForward, dozerSpeed } from "../vehicle/dozer";
import type { Town } from "../world/town";
import { SpatialHash } from "./spatial";
import { pileResistance, queryObstruction } from "./pile";
import { siteContaining, siteFeel } from "../structure/site";

let nextDebrisId = 1;
const playRng = new Rng(0xdeb415);
const nearbyBodies: Rubble[] = [];
const bodyHash = new SpatialHash<Rubble>(2.2);
const contacted = new Set<number>();

export interface DebrisStepStats {
  active: number;
  sleeping: number;
  contactPairs: number;
  conversions: number;
  distanceCleanups: number;
  emergencyCleanups: number;
  bodyMass: number;
  pileMass: number;
}

const emptyDebrisStats = (): DebrisStepStats => ({
  active: 0,
  sleeping: 0,
  contactPairs: 0,
  conversions: 0,
  distanceCleanups: 0,
  emergencyCleanups: 0,
  bodyMass: 0,
  pileMass: 0,
});

let debrisClock = 0;

let stepStats = emptyDebrisStats();

export function lastDebrisStats(): DebrisStepStats {
  return stepStats;
}

export interface CollapseSpawn {
  x: number;
  y: number;
  dx: number;
  dy: number;
  material: Material;
  floor: number;
  cellSize: number;
  source?: "wall" | "roof";
  heading?: number;
  elev?: number;
  panelW?: number;
  panelD?: number;
  preservePanelPose?: boolean;
}

export function resetDebrisSim(seed = 0xdeb415): void {
  nextDebrisId = 1;
  bodyHashTown = null; bodySnapshot = []; bodyHash.clear();
  unattendedSince = new WeakMap();
  playRng.reset(seed ^ 0xdeb415);
  contacted.clear();
  debrisClock = 0;
  stepStats = emptyDebrisStats();
}

export function rubbleAabb(r: Rubble): { x: number; y: number; w: number; d: number } {
  const ext = 0.5 * Math.hypot(r.w, r.d) + 0.06;
  return { x: r.x - ext, y: r.y - ext, w: ext * 2, d: ext * 2 };
}

export function totalDebrisMass(town: Town): number {
  let sum = town.pile.totalMass();
  for (const r of town.rubble) sum += r.mass;
  return sum;
}

function materialDensity(material: Material): number { return MATERIALS[material].density; }
function crushabilityOf(material: Material): number { return MATERIALS[material].crushability; }
function frictionOf(material: Material): number { return MATERIALS[material].friction; }

function cellVolume(cellSize: number): number {
  return cellSize * cellSize * 1.85;
}

function makeRubble(init: {
  yardOwner?: string;
  x: number;
  y: number;
  w: number;
  d: number;
  material: Material;
  layer: DebrisLayer;
  shape?: DebrisShape;
  skin?: DebrisSkin;
  heading?: number;
  elev?: number;
  thickness?: number;
  mass?: number;
  vx?: number;
  vy?: number;
  omega?: number;
  seed?: number;
}): Rubble {
  const shape = init.shape ?? defaultShape(init.material, init.layer, init.w, init.d);
  const thickness = init.thickness ?? defaultThickness(init.material, shape, init.layer);
  const mass = init.mass ?? Math.max(0.08, init.w * init.d * thickness * materialDensity(init.material) * 3.4);
  const seed = init.seed ?? ((nextDebrisId * 1103515245 + Math.floor(init.x * 97) + Math.floor(init.y * 53)) >>> 0);
  return {
    id: nextDebrisId++,
    x: init.x,
    y: init.y,
    vx: init.vx ?? 0,
    vy: init.vy ?? 0,
    vz: 0,
    heading: init.heading ?? 0,
    omega: init.omega ?? 0,
    w: init.w,
    d: init.d,
    elev: init.elev ?? 0,
    thickness,
    mass,
    material: init.material,
    shape,
    layer: init.layer,
    skin: init.skin ?? "default",
    seed,
    hp: 14 + mass * 8,
    damage: 0,
    crushability: crushabilityOf(init.material),
    friction: frictionOf(init.material),
    sleeping: false,
    sleepT: 0,
    touchedAt: debrisClock,
  };
}

function defaultShape(material: Material, layer: DebrisLayer, w: number, d: number): DebrisShape {
  if (material === "wood") return w > d * 1.55 ? "beam" : "panel";
  if (material === "metal") return w > d * 1.4 ? "beam" : "panel";
  if (material === "glass") return "chunk";
  if (layer === "fragment") return "chunk";
  return "chunk";
}

function defaultThickness(material: Material, shape: DebrisShape, layer: DebrisLayer): number {
  if (material === "glass") return 0.05;
  if (shape === "panel") return layer === "remnant" ? 0.12 : 0.06;
  if (shape === "beam") return layer === "remnant" ? 0.18 : 0.09;
  if (material === "concrete") return layer === "remnant" ? 0.34 : 0.16;
  if (material === "brick") return layer === "remnant" ? 0.28 : 0.1;
  return layer === "remnant" ? 0.22 : 0.1;
}

export function addDebrisBody(town: Town, init: Parameters<typeof makeRubble>[0]): Rubble {
  const r = makeRubble(init);
  r.yardOwner = init.yardOwner ?? town.debrisOwnerAt?.(init.x, init.y);
  const support = town.pile.heightAt(r.x, r.y);
  r.elev = Math.max(r.elev, support);
  town.rubble.push(r);
  return r;
}

function addMark(
  town: Town,
  x: number,
  y: number,
  kind: GroundKind,
  material: Material,
  heading = 0,
  owner?: string,
): void {
  if (town.marks.length >= DEBRIS.cosmeticCap) {
    town.marks.splice(0, 24);
  }
  const rng = playRng;
  const mark: GroundMark = {
    x,
    y,
    w: kind === "scrape" ? rng.range(0.28, 0.7) : rng.range(0.08, 0.22),
    d: kind === "scrape" ? rng.range(0.05, 0.1) : rng.range(0.06, 0.16),
    heading,
    kind,
    material,
    seed: rng.int(1, 1_000_000),
    alpha: kind === "dust" ? 0.22 : kind === "scrape" ? 0.35 : 0.7,
  };
  mark.yardOwner = owner ?? town.debrisOwnerAt?.(x, y);
  town.marks.push(mark);
  town.visualRevision++;
}

export function spawnCollapseDebris(town: Town, spawn: CollapseSpawn, bodyLimit = Infinity): Rubble[] {
  const rng = new Rng(
    (Math.floor(spawn.x * 1009) ^ Math.floor(spawn.y * 917) ^ (spawn.floor * 131) ^ materialSeed(spawn.material)) >>> 0,
  );
  const volume = spawn.preservePanelPose && spawn.panelW && spawn.panelD
    ? spawn.panelW * spawn.panelD * .14 : cellVolume(spawn.cellSize);
  const budget = volume * materialDensity(spawn.material);
  // A large collapse must not allocate thousands of bodies before the cleanup
  // pass. Keep the excess as owned, editable pile mass at the collapse location.
  if (town.rubble.length >= bodyLimit) {
    town.pile.addMass(spawn.x, spawn.y, budget, spawn.material);
    return [];
  }
  const dirL = len(spawn.dx, spawn.dy) || 1;
  const dx = spawn.dx / dirL;
  const dy = spawn.dy / dirL;
  const heap = town.pile.heightAt(spawn.x, spawn.y);
  const created: Rubble[] = [];

  const fines = spawn.material === "glass" ? budget * 0.72 : budget * 0.12;
  town.pile.addMass(spawn.x, spawn.y, fines, spawn.material);
  let remaining = budget - fines;

  const remnantPlans = spawn.source === "roof" ? roofRemnantPlan(spawn.material, rng, spawn) : remnantPlan(spawn.material, rng);
  const roofing = spawn.source === "roof";
  const baseHeading = spawn.heading ?? Math.atan2(dy, dx);
  const startElev = spawn.elev ?? heap + rng.range(0, 0.08 + spawn.floor * 0.06);
  for (const plan of remnantPlans) {
    if (remaining < 0.08) break;
    const mass = Math.min(remaining * plan.massShare, remaining);
    remaining -= mass;
    const exactPanel = spawn.preservePanelPose && plan.shape === "panel";
    const jitter = exactPanel ? 0 : roofing ? 0.08 : 0.28;
    const ox = (rng.range(-jitter, jitter) + plan.along * dx) * (roofing ? 0.55 : spawn.cellSize);
    const oy = (rng.range(-jitter, jitter) + plan.along * dy) * (roofing ? 0.55 : spawn.cellSize);
    const body = addDebrisBody(town, {
      x: spawn.x + ox,
      y: spawn.y + oy,
      w: plan.w,
      d: plan.d,
      material: spawn.material,
      layer: "remnant",
      shape: plan.shape,
      skin: plan.skin,
      heading: exactPanel ? baseHeading : baseHeading + rng.range(roofing ? -0.28 : -0.9, roofing ? 0.28 : 0.9),
      elev: Math.max(heap, startElev + (roofing ? plan.along * 0.04 : rng.range(0, 0.08))),
      thickness: plan.thickness,
      mass,
      vx: dx * rng.range(roofing ? 0.15 : 0.4, roofing ? 0.7 : 1.8) + rng.range(-0.28, 0.28),
      vy: dy * rng.range(roofing ? 0.15 : 0.4, roofing ? 0.7 : 1.8) + rng.range(-0.28, 0.28),
      omega: exactPanel ? 0 : rng.range(roofing ? -1.6 : -4, roofing ? 1.6 : 4),
      seed: rng.int(1, 0x7fffffff),
    });
    created.push(body);
  }

  const fragCount = spawn.material === "glass" ? rng.int(1, 3) : roofing ? rng.int(0, 1) : rng.int(1, 3);
  for (let i = 0; i < fragCount && remaining > 0.04; i++) {
    const mass = Math.min(remaining / Math.max(1, fragCount - i), remaining * 0.55);
    remaining -= mass;
    const ang = rng.range(0, Math.PI * 2);
    const rad = rng.range(0.12, 0.55) * spawn.cellSize;
    const fw = spawn.material === "wood" ? rng.range(0.28, 0.55) : rng.range(0.12, 0.32);
    const fd = spawn.material === "wood" ? rng.range(0.06, 0.12) : rng.range(0.08, 0.2);
    created.push(
      addDebrisBody(town, {
        x: spawn.x + Math.cos(ang) * rad + dx * 0.12,
        y: spawn.y + Math.sin(ang) * rad + dy * 0.12,
        w: fw,
        d: fd,
        material: spawn.material,
        layer: "fragment",
        heading: ang + rng.range(-0.4, 0.4),
        elev: heap + rng.range(0.02, 0.16 + spawn.floor * 0.05),
        mass,
        vx: dx * rng.range(0.8, 2.6) + Math.cos(ang) * rng.range(0.4, 1.8),
        vy: dy * rng.range(0.8, 2.6) + Math.sin(ang) * rng.range(0.4, 1.8),
        omega: rng.range(-8, 8),
        seed: rng.int(1, 0x7fffffff),
      }),
    );
  }

  if (remaining > 0.02) {
    town.pile.addMass(spawn.x + dx * 0.15, spawn.y + dy * 0.15, remaining, spawn.material);
    remaining = 0;
  }

  const cosmeticN = spawn.material === "glass" ? 10 : roofing ? 2 : 3;
  for (let i = 0; i < cosmeticN; i++) {
    const kind: GroundKind =
      spawn.material === "glass" ? "glass" : spawn.material === "wood" ? "splinter" : i === 0 ? "dust" : "chip";
    addMark(
      town,
      spawn.x + rng.range(-0.45, 0.45) + dx * 0.2,
      spawn.y + rng.range(-0.45, 0.45) + dy * 0.2,
      kind,
      spawn.material,
      rng.range(0, Math.PI * 2),
    );
  }

  return created;
}

function roofRemnantPlan(
  material: Material,
  rng: Rng,
  spawn: CollapseSpawn,
): { w: number; d: number; thickness: number; shape: DebrisShape; massShare: number; along: number; skin: DebrisSkin }[] {
  const panelW = spawn.panelW ?? rng.range(0.7, 1.05);
  const panelD = spawn.panelD ?? rng.range(0.32, 0.5);
  if (spawn.preservePanelPose) return [
    { w: panelW, d: panelD, thickness: .14, shape: "panel", massShare: .8, along: 0, skin: "roofing" },
    { w: Math.min(panelW, 1.1), d: .09, thickness: .08, shape: "beam", massShare: .2, along: .12, skin: "default" },
  ];
  if (material === "wood") {
    return [
      { w: panelW, d: panelD, thickness: 0.14, shape: "panel", massShare: 0.7, along: 0.28, skin: "roofing" },
      { w: rng.range(0.7, 1.05), d: 0.1, thickness: 0.1, shape: "beam", massShare: 0.16, along: -0.12, skin: "default" },
    ];
  }
  if (material === "metal") {
    return [
      { w: panelW, d: panelD * 0.85, thickness: 0.1, shape: "panel", massShare: 0.48, along: 0, skin: "default" },
      { w: rng.range(0.7, 1.1), d: 0.09, thickness: 0.08, shape: "beam", massShare: 0.22, along: 0.12, skin: "default" },
    ];
  }
  return remnantPlan(material, rng).map((plan) => ({ ...plan, skin: "default" as const }));
}

function remnantPlan(
  material: Material,
  rng: Rng,
): { w: number; d: number; thickness: number; shape: DebrisShape; massShare: number; along: number; skin: DebrisSkin }[] {
  switch (material) {
    case "wood":
      return [
        { w: rng.range(0.7, 1.15), d: rng.range(0.1, 0.16), thickness: 0.12, shape: "beam", massShare: 0.42, along: 0.15, skin: "default" },
        { w: rng.range(0.45, 0.8), d: rng.range(0.09, 0.14), thickness: 0.1, shape: "beam", massShare: 0.28, along: -0.1, skin: "default" },
        ...(rng.chance(0.35)
          ? [{ w: rng.range(0.5, 0.75), d: rng.range(0.32, 0.5), thickness: 0.08, shape: "panel" as const, massShare: 0.18, along: 0.05, skin: "default" as const }]
          : []),
      ];
    case "brick":
      return [
        { w: rng.range(0.38, 0.62), d: rng.range(0.28, 0.48), thickness: rng.range(0.22, 0.34), shape: "chunk", massShare: 0.48, along: 0.08, skin: "default" },
        { w: rng.range(0.2, 0.3), d: rng.range(0.1, 0.14), thickness: 0.09, shape: "chunk", massShare: 0.14, along: 0.2, skin: "default" },
      ];
    case "concrete":
      return [
        { w: rng.range(0.42, 0.72), d: rng.range(0.3, 0.52), thickness: rng.range(0.24, 0.42), shape: "chunk", massShare: 0.52, along: 0.1, skin: "default" },
        { w: rng.range(0.28, 0.48), d: rng.range(0.2, 0.36), thickness: rng.range(0.16, 0.3), shape: "chunk", massShare: 0.26, along: -0.12, skin: "default" },
      ];
    case "metal":
      return [
        { w: rng.range(0.7, 1.2), d: rng.range(0.08, 0.14), thickness: 0.1, shape: "beam", massShare: 0.4, along: 0.12, skin: "default" },
        { w: rng.range(0.4, 0.7), d: rng.range(0.22, 0.4), thickness: 0.07, shape: "panel", massShare: 0.28, along: -0.08, skin: "default" },
      ];
    case "glass":
      return [];
    default: {
      const _never: never = material;
      return _never;
    }
  }
}

function materialSeed(material: Material): number {
  switch (material) {
    case "wood":
      return 11;
    case "brick":
      return 23;
    case "concrete":
      return 37;
    case "metal":
      return 53;
    case "glass":
      return 71;
    default: {
      const _never: never = material;
      return _never;
    }
  }
}

export function spawnPropDebris(town: Town, x: number, y: number, w: number, d: number, material: Material): void {
  const cx = x + w * 0.5;
  const cy = y + d * 0.5;
  addDebrisBody(town, {
    x: cx,
    y: cy,
    w: Math.max(0.28, w * 0.7),
    d: Math.max(0.2, d * 0.65),
    material,
    layer: "remnant",
    heading: playRng.range(-0.4, 0.4),
    vx: playRng.range(-0.6, 0.6),
    vy: playRng.range(-0.6, 0.6),
    omega: playRng.range(-2, 2),
  });
  if (material !== "glass") {
    addDebrisBody(town, {
      x: cx + playRng.range(-0.2, 0.2),
      y: cy + playRng.range(-0.2, 0.2),
      w: playRng.range(0.16, 0.32),
      d: playRng.range(0.1, 0.18),
      material,
      layer: "fragment",
      heading: playRng.range(0, Math.PI * 2),
      vx: playRng.range(-1.4, 1.4),
      vy: playRng.range(-1.4, 1.4),
      omega: playRng.range(-6, 6),
    });
  }
  addMark(town, cx, cy, material === "wood" ? "splinter" : "chip", material, playRng.range(0, Math.PI));
}

function absorbBody(town: Town, r: Rubble): void {
  town.pile.addMass(r.x, r.y, r.mass, r.material, r.yardOwner);
  addMark(town, r.x, r.y, r.material === "wood" ? "splinter" : "chip", r.material, r.heading, r.yardOwner);
  const i = town.rubble.indexOf(r);
  if (i >= 0) town.rubble.splice(i, 1);
  stepStats.conversions++;
}

function heapScore(town: Town, r: Rubble): number {
  return town.pile.sample(r.x, r.y).mass + r.mass;
}

export interface CleanupCandidate {
  body: Rubble;
  dist2: number;
  sleeping: boolean;
  nearby: boolean;
  recent: boolean;
}

function layerCap(layer: DebrisLayer): number {
  return layer === "remnant" ? DEBRIS.remnantCap : DEBRIS.fragmentCap;
}

function touchingDozer(r: Rubble, dozerX: number, dozerY: number, touching: ReadonlySet<number>): boolean {
  if (touching.has(r.id)) return true;
  const reach = DOZER.radius + Math.max(r.w, r.d) * 0.45;
  const dx = r.x - dozerX;
  const dy = r.y - dozerY;
  return dx * dx + dy * dy <= reach * reach;
}

export function collectCleanupCandidates(
  bodies: readonly Rubble[],
  dozerX: number,
  dozerY: number,
  touching: ReadonlySet<number>,
  clock = debrisClock,
): CleanupCandidate[] {
  const protectR2 = DEBRIS.protectRadius * DEBRIS.protectRadius;
  const out: CleanupCandidate[] = [];
  for (const body of bodies) {
    if (touchingDozer(body, dozerX, dozerY, touching)) continue;
    const dx = body.x - dozerX;
    const dy = body.y - dozerY;
    const dist2 = dx * dx + dy * dy;
    out.push({
      body,
      dist2,
      sleeping: body.sleeping,
      nearby: dist2 <= protectR2,
      recent: clock - body.touchedAt < DEBRIS.interactGrace,
    });
  }
  out.sort((a, b) => {
    if (b.dist2 !== a.dist2) return b.dist2 - a.dist2;
    return b.body.id - a.body.id;
  });
  return out;
}

let unattendedSince = new WeakMap<Rubble, number>();

export function enforceDistanceCleanup(
  town: Town,
  dozerX: number,
  dozerY: number,
  touching: ReadonlySet<number> = contacted,
): { distance: number; emergency: number } {
  let distance = 0;
  let emergency = 0;
  // Unattended destruction becomes the editable pile after a bounded grace.
  // Contact jitter must not keep distant bodies in the solver indefinitely.
  for (const r of [...town.rubble]) {
    const car = town.roadCar;
    const protectedNow = touchingDozer(r, dozerX, dozerY, touching)
      || Math.hypot(r.x - dozerX, r.y - dozerY) <= DEBRIS.retireRadius
      || (car?.alive && Math.hypot(r.x - car.x, r.y - car.y) <= DEBRIS.protectRadius);
    if (protectedNow) { unattendedSince.delete(r); continue; }
    const since = unattendedSince.get(r);
    if (since === undefined) { unattendedSince.set(r, debrisClock); continue; }
    if (debrisClock - since < DEBRIS.retireDelay || debrisClock - r.touchedAt < DEBRIS.retireDelay) continue;
    absorbBody(town, r);
    unattendedSince.delete(r);
    distance++;
  }
  for (const layer of ["remnant", "fragment"] as const) {
    const layerBodies = town.rubble.filter((r) => r.layer === layer);
    const cap = layerCap(layer);
    if (layerBodies.length <= cap) continue;
    const hardCap = cap + DEBRIS.hardOverflow;
    const candidates = collectCleanupCandidates(layerBodies, dozerX, dozerY, touching);
    const absorbed = new Set<number>();
    let count = layerBodies.length;
    for (const c of candidates) {
      if (count <= cap) break;
      if (!c.sleeping || c.nearby || c.recent) continue;
      absorbBody(town, c.body);
      absorbed.add(c.body.id);
      count--;
      distance++;
    }
    if (count > hardCap) {
      for (const c of candidates) {
        if (count <= hardCap) break;
        if (absorbed.has(c.body.id)) continue;
        absorbBody(town, c.body);
        absorbed.add(c.body.id);
        count--;
        emergency++;
      }
    }
  }
  stepStats.distanceCleanups += distance;
  stepStats.emergencyCleanups += emergency;
  return { distance, emergency };
}

export function crushBody(town: Town, r: Rubble, particles: ParticlePool): void {
  const budget = r.mass;
  const idx = town.rubble.indexOf(r);
  if (idx >= 0) town.rubble.splice(idx, 1);
  let used = 0;
  const rng = new Rng(r.seed ^ 0x51a11);
  if (r.layer === "remnant" && budget > 0.55 && r.material !== "glass") {
    const n = r.material === "concrete" || r.material === "brick" ? 3 : 2;
    const shares = splitMass(budget * 0.72, n, rng);
    for (const share of shares) {
      used += share;
      addDebrisBody(town, {
        yardOwner: r.yardOwner,
        x: r.x + rng.range(-0.16, 0.16),
        y: r.y + rng.range(-0.16, 0.16),
        w: Math.max(0.12, r.w * rng.range(0.32, 0.5)),
        d: Math.max(0.08, r.d * rng.range(0.35, 0.55)),
        material: r.material,
        layer: "fragment",
        heading: r.heading + rng.range(-0.8, 0.8),
        elev: r.elev,
        mass: share,
        vx: r.vx + rng.range(-0.8, 0.8),
        vy: r.vy + rng.range(-0.8, 0.8),
        omega: r.omega + rng.range(-5, 5),
        seed: rng.int(1, 0x7fffffff),
      });
    }
  }
  town.pile.addMass(r.x, r.y, Math.max(0, budget - used), r.material, r.yardOwner);
  particles.burst(r.material === "wood" ? "wood" : r.material === "brick" ? "brick" : r.material === "metal" ? "metal" : "concrete", r.x, r.y, r.elev + 0.1, 0.45, r.yardOwner);
  addMark(town, r.x, r.y, r.material === "wood" ? "splinter" : "chip", r.material, r.heading, r.yardOwner);
  addMark(town, r.x + 0.08, r.y, "dust", r.material, r.heading, r.yardOwner);
}

function splitMass(total: number, n: number, rng: Rng): number[] {
  const raw = Array.from({ length: n }, () => 0.7 + rng.range(0, 0.6));
  const sum = raw.reduce((s, v) => s + v, 0);
  return raw.map((v) => (total * v) / sum);
}

function invMass(r: Rubble): number {
  return r.sleeping ? 0 : 1 / Math.max(0.08, r.mass);
}

function invInertia(r: Rubble): number {
  if (r.sleeping) return 0;
  const i = (r.mass * (r.w * r.w + r.d * r.d)) / 12;
  return 1 / Math.max(0.02, i);
}

function wake(r: Rubble, interacted = false): void {
  r.sleeping = false;
  r.sleepT = 0;
  if (interacted) r.touchedAt = debrisClock;
}

interface Obb {
  x: number;
  y: number;
  heading: number;
  hl: number;
  hw: number;
}

function asObb(r: Rubble): Obb {
  return { x: r.x, y: r.y, heading: r.heading, hl: r.w * 0.5, hw: r.d * 0.5 };
}

function projectObb(o: Obb, ax: number, ay: number): [number, number] {
  const fx = Math.cos(o.heading);
  const fy = Math.sin(o.heading);
  const c = o.x * ax + o.y * ay;
  const extent = o.hl * Math.abs(fx * ax + fy * ay) + o.hw * Math.abs(-fy * ax + fx * ay);
  return [c - extent, c + extent];
}

function obbOverlap(a: Obb, b: Obb): { hit: boolean; nx: number; ny: number; depth: number; px: number; py: number } {
  const axes = [
    [Math.cos(a.heading), Math.sin(a.heading)],
    [-Math.sin(a.heading), Math.cos(a.heading)],
    [Math.cos(b.heading), Math.sin(b.heading)],
    [-Math.sin(b.heading), Math.cos(b.heading)],
  ] as const;
  let minDepth = Infinity;
  let nx = 1;
  let ny = 0;
  for (const [ax, ay] of axes) {
    const [a0, a1] = projectObb(a, ax, ay);
    const [b0, b1] = projectObb(b, ax, ay);
    const o = Math.min(a1, b1) - Math.max(a0, b0);
    if (o <= 0) return { hit: false, nx: 0, ny: 0, depth: 0, px: 0, py: 0 };
    if (o < minDepth) {
      minDepth = o;
      nx = ax;
      ny = ay;
    }
  }
  if ((b.x - a.x) * nx + (b.y - a.y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { hit: true, nx, ny, depth: minDepth, px: (a.x + b.x) * 0.5, py: (a.y + b.y) * 0.5 };
}

function closestOnObb(px: number, py: number, o: Obb): { x: number; y: number; along: number; across: number } {
  const fx = Math.cos(o.heading);
  const fy = Math.sin(o.heading);
  const rx = -fy;
  const ry = fx;
  const dx = px - o.x;
  const dy = py - o.y;
  let along = dx * fx + dy * fy;
  let across = dx * rx + dy * ry;
  const inside = Math.abs(along) <= o.hl && Math.abs(across) <= o.hw;
  if (inside) {
    const gapA = o.hl - Math.abs(along);
    const gapC = o.hw - Math.abs(across);
    if (gapA < gapC) along = Math.sign(along || 1) * o.hl;
    else across = Math.sign(across || 1) * o.hw;
  } else {
    along = clamp(along, -o.hl, o.hl);
    across = clamp(across, -o.hw, o.hw);
  }
  return { x: o.x + fx * along + rx * across, y: o.y + fy * along + ry * across, along, across };
}

function circleObb(
  cx: number,
  cy: number,
  radius: number,
  o: Obb,
): { hit: boolean; nx: number; ny: number; depth: number; px: number; py: number; across: number } {
  const c = closestOnObb(cx, cy, o);
  const dx = cx - c.x;
  const dy = cy - c.y;
  const dist = Math.hypot(dx, dy);
  if (dist >= radius) return { hit: false, nx: 0, ny: 0, depth: 0, px: 0, py: 0, across: c.across };
  if (dist < 1e-5) {
    const fx = Math.cos(o.heading);
    const fy = Math.sin(o.heading);
    return { hit: true, nx: fx, ny: fy, depth: radius, px: c.x, py: c.y, across: c.across };
  }
  return { hit: true, nx: dx / dist, ny: dy / dist, depth: radius - dist, px: c.x, py: c.y, across: c.across };
}

function applyImpulse(
  r: Rubble,
  nx: number,
  ny: number,
  px: number,
  py: number,
  jn: number,
  jt: number,
): void {
  if (r.sleeping) wake(r);
  const im = invMass(r);
  const ii = invInertia(r);
  const ix = nx * jn - ny * jt;
  const iy = ny * jn + nx * jt;
  r.vx += ix * im;
  r.vy += iy * im;
  const rx = px - r.x;
  const ry = py - r.y;
  r.omega += (rx * iy - ry * ix) * ii;
}

function resolveBodies(a: Rubble, b: Rubble): number {
  const hit = obbOverlap(asObb(a), asObb(b));
  if (!hit.hit) return 0;
  const imA = invMass(a);
  const imB = invMass(b);
  const invSum = imA + imB;
  if (invSum <= 1e-8) return 0;
  const corr = Math.min(DEBRIS.maxCorrect, Math.max(0, hit.depth - DEBRIS.slop) * DEBRIS.baumgarte);
  if (a.sleeping && hit.depth > 0.02) wake(a);
  if (b.sleeping && hit.depth > 0.02) wake(b);
  a.x -= hit.nx * corr * (imA / invSum);
  a.y -= hit.ny * corr * (imA / invSum);
  b.x += hit.nx * corr * (imB / invSum);
  b.y += hit.ny * corr * (imB / invSum);

  const rax = hit.px - a.x;
  const ray = hit.py - a.y;
  const rbx = hit.px - b.x;
  const rby = hit.py - b.y;
  const vax = a.vx - a.omega * ray;
  const vay = a.vy + a.omega * rax;
  const vbx = b.vx - b.omega * rby;
  const vby = b.vy + b.omega * rbx;
  const rvx = vax - vbx;
  const rvy = vay - vby;
  const vn = rvx * hit.nx + rvy * hit.ny;
  if (vn > 0) return hit.depth;
  const rnA = rax * hit.ny - ray * hit.nx;
  const rnB = rbx * hit.ny - rby * hit.nx;
  const denom = invSum + rnA * rnA * invInertia(a) + rnB * rnB * invInertia(b);
  const j = (-(1 + DEBRIS.rest) * vn) / Math.max(1e-5, denom);
  const jn = clamp(j, 0, 4.5);
  const tx = -hit.ny;
  const ty = hit.nx;
  const vt = rvx * tx + rvy * ty;
  const mu = Math.min(a.friction, b.friction);
  const jt = clamp(-vt / Math.max(1e-5, denom), -jn * mu, jn * mu);
  applyImpulse(a, hit.nx, hit.ny, hit.px, hit.py, jn, jt);
  applyImpulse(b, -hit.nx, -hit.ny, hit.px, hit.py, jn, jt);
  return jn;
}

interface VehicleContact {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  radius: number;
  profile: VehicleProfile;
  blade?: { cx: number; cy: number; heading: number; hl: number; hw: number; z0: number };
}

function bladeOf(dozer: Dozer): VehicleContact["blade"] {
  const f = dozerForward(dozer);
  const reach = DOZER.bladeReach + (dozer.bladeDown ? 0.1 : 0);
  return {
    cx: dozer.x + f.x * reach,
    cy: dozer.y + f.y * reach,
    heading: dozer.heading,
    hl: (DOZER.bladeDepth + 0.14) * 0.5,
    hw: DOZER.bladeHalf,
    z0: dozer.bladeDown ? 0.02 : 0.28,
  };
}

function resolveVehicleBody(
  v: VehicleContact,
  r: Rubble,
  useBlade: boolean,
  events: WorldEvent[],
  particles: ParticlePool,
): number {
  const top = r.elev + r.thickness;
  if (useBlade && v.blade) {
    if (top < v.blade.z0 + 0.04) return 0;
    const bladeObb = {
      x: v.blade.cx,
      y: v.blade.cy,
      heading: v.blade.heading,
      hl: v.blade.hl,
      hw: v.blade.hw,
    };
    const hit = obbOverlap(bladeObb, asObb(r));
    if (!hit.hit) return 0;
    const fx = Math.cos(bladeObb.heading);
    const fy = Math.sin(bladeObb.heading);
    const rx = -fy;
    const ry = fx;
    const across = clamp((r.x - bladeObb.x) * rx + (r.y - bladeObb.y) * ry, -bladeObb.hw, bladeObb.hw);
    const front = {
      x: bladeObb.x + fx * bladeObb.hl + rx * across,
      y: bladeObb.y + fy * bladeObb.hl + ry * across,
    };
    const onDebris = closestOnObb(front.x, front.y, asObb(r));
    const nx = r.x - onDebris.x || fx;
    const ny = r.y - onDebris.y || fy;
    const nl = Math.hypot(nx, ny);
    const nnx = nl > 1e-5 ? nx / nl : fx;
    const nny = nl > 1e-5 ? ny / nl : fy;
    return finishVehicleHit(v, r, nnx, nny, onDebris.x, onDebris.y, hit.depth, across, v.blade.hw, events, particles);
  }
  if (top < v.profile.clearance && r.layer === "fragment") return 0;
  const hit = circleObb(v.x, v.y, v.radius, asObb(r));
  if (!hit.hit) return 0;
  return finishVehicleHit(v, r, -hit.nx, -hit.ny, hit.px, hit.py, hit.depth, 0, 1, events, particles);
}

function finishVehicleHit(
  v: VehicleContact,
  r: Rubble,
  nx: number,
  ny: number,
  px: number,
  py: number,
  depth: number,
  across: number,
  halfW: number,
  events: WorldEvent[],
  particles: ParticlePool,
): number {
  wake(r, true);
  const imB = invMass(r);
  const imV = 1 / Math.max(0.4, v.profile.mass * 2.1);
  const invSum = imB + imV;
  const corr = Math.min(DEBRIS.maxCorrect, Math.max(0, depth - DEBRIS.slop) * 0.4);
  r.x += nx * corr * (imB / invSum);
  r.y += ny * corr * (imB / invSum);

  const rx = px - r.x;
  const ry = py - r.y;
  const bvx = r.vx - r.omega * ry;
  const bvy = r.vy + r.omega * rx;
  const rvx = bvx - v.vx;
  const rvy = bvy - v.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn > 0.02) return 0;
  const rn = rx * ny - ry * nx;
  const denom = imB + imV + rn * rn * invInertia(r);
  let j = (-(1 + DEBRIS.rest) * vn) / Math.max(1e-5, denom);
  const end = Math.abs(across) > halfW * 0.78;
  if (end) j *= 0.38;
  const jn = clamp(j, 0, 3.8);
  const tx = -ny;
  const ty = nx;
  const vt = rvx * tx + rvy * ty;
  const jt = clamp(-vt / Math.max(1e-5, denom), -jn * r.friction, jn * r.friction);
  applyImpulse(r, nx, ny, px, py, jn, jt);

  const slip = Math.abs(vt);
  if (slip > 0.9 && playRng.chance(0.12)) {
    particles.spawn("dust", px, py, 0.08, 2, 0.7, 0.45);
    addMark(townScratch, px, py, "scrape", r.material, v.heading, r.yardOwner);
    events.push({ kind: "scrape", x: px, y: py, z: 0.1, mag: Math.min(1.1, slip * 0.18), material: r.material });
  } else if (jn > 0.55 && playRng.chance(0.08)) {
    events.push({ kind: "scrape", x: px, y: py, z: 0.12, mag: Math.min(0.8, jn * 0.25), material: r.material });
  }
  return jn * v.profile.resistanceMul;
}

let townScratch: Town;

function integrateBody(town: Town, r: Rubble, dt: number): void {
  const support = supportHeight(town, r);
  if (r.sleeping) {
    if (r.elev > support + 0.035) wake(r);
    else {
      r.sleepT += dt;
      r.vx = 0;
      r.vy = 0;
      r.omega = 0;
      r.vz = 0;
      return;
    }
  }
  const maxRide = r.layer === "fragment" ? 0.4 : 0.12;
  if (r.elev > 0.9) {
    r.elev = Math.min(r.elev, 0.9);
    if (r.elev > support + 0.04) wake(r);
  }
  if (r.elev > support + 0.015) {
    r.vz -= DEBRIS.gravity * dt;
    r.elev += r.vz * dt;
    if (r.elev < support) {
      r.elev = support;
      r.vz *= -0.08;
      if (Math.abs(r.vz) < 0.6) r.vz = 0;
    }
  } else {
    r.vz *= Math.max(0, 1 - 8 * dt);
    if (r.elev < support) r.elev = approachElev(r.elev, support, 2.8 * dt);
    if (r.elev > support + maxRide) r.elev = support + maxRide;
  }

  const slope = town.pile.slope(r.x, r.y);
  const compact = town.pile.sample(r.x, r.y).compact;
  if (r.layer === "fragment" && compact < 0.72) {
    r.vx -= slope.dx * 2.4 * dt;
    r.vy -= slope.dy * 2.4 * dt;
  }

  const drag = r.layer === "fragment" ? 2.6 : 2.1;
  r.vx *= 1 - drag * dt;
  r.vy *= 1 - drag * dt;
  r.omega *= 1 - 3.4 * dt;
  r.x += r.vx * dt;
  r.y += r.vy * dt;
  r.heading += r.omega * dt;
  r.x = clamp(r.x, town.minX + 0.2, town.maxX - 0.2);
  r.y = clamp(r.y, town.minY + 0.2, town.maxY - 0.2);

  const speed = Math.hypot(r.vx, r.vy);
  if (speed < DEBRIS.sleepSpeed && Math.abs(r.omega) < DEBRIS.sleepOmega && Math.abs(r.vz) < 0.15 && Math.abs(r.elev - support) < 0.04) {
    r.sleepT += dt;
    if (r.sleepT > DEBRIS.sleepTime) {
      r.sleeping = true;
      r.vx = 0;
      r.vy = 0;
      r.omega = 0;
      r.vz = 0;
    }
  } else {
    r.sleepT = 0;
  }
}

function approachElev(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

const supportCache = new WeakMap<Rubble, { pile: Town['pile']; revision: number; hash: number; elev: number; height: number }>();
function supportHeight(town: Town, r: Rubble): number {
  const old = supportCache.get(r);
  if (r.sleeping && old?.pile === town.pile && old.revision === town.pile.revision && old.hash === bodyHashRevision && old.elev === r.elev) return old.height;
  const height = calculateSupportHeight(town, r);
  supportCache.set(r, { pile: town.pile, revision: town.pile.revision, hash: bodyHashRevision, elev: r.elev, height });
  return height;
}
function calculateSupportHeight(town: Town, r: Rubble): number {
  let support = Math.min(0.7, town.pile.heightAt(r.x, r.y));
  if (r.layer === "remnant") return support;
  const box = rubbleAabb(r);
  bodyHash.query(box.x, box.y, box.w, box.d, nearbyBodies);
  for (const other of nearbyBodies) {
    if (other.id === r.id || other.layer !== "remnant") continue;
    if (other.elev > r.elev + 0.02) continue;
    const dx = other.x - r.x;
    const dy = other.y - r.y;
    const reach = (Math.max(r.w, r.d) + Math.max(other.w, other.d)) * 0.42;
    if (dx * dx + dy * dy > reach * reach) continue;
    const top = other.elev + other.thickness * 0.45;
    if (top > support) support = top;
  }
  return Math.min(0.85, support);
}

let bodyHashTown: Town | null = null;
let bodyHashRevision = 0;
let bodySnapshot: { body: Rubble; x: number; y: number; w: number; d: number; heading: number; elev: number }[] = [];
function rebuildBodyHash(town: Town): void {
  if (bodyHashTown === town && bodySnapshot.length === town.rubble.length && town.rubble.every((r, i) => {
    const old = bodySnapshot[i]!;
    return old.body === r && old.x === r.x && old.y === r.y && old.w === r.w && old.d === r.d && old.heading === r.heading && old.elev === r.elev;
  })) return;
  bodyHashTown = town;
  bodyHashRevision++;
  bodySnapshot = town.rubble.map(r => ({ body: r, x: r.x, y: r.y, w: r.w, d: r.d, heading: r.heading, elev: r.elev }));
  bodyHash.clear();
  for (const r of town.rubble) {
    const box = rubbleAabb(r);
    bodyHash.insert(box.x, box.y, box.w, box.d, r);
  }
}

function applyVehicleResistance(vx: { vx: number; vy: number }, heading: number, load: number, profile: VehicleProfile): void {
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  const along = vx.vx * fx + vx.vy * fy;
  const capacity = profile.pushForce * (0.65 + profile.traction);
  const slow = clamp((load * profile.resistanceMul) / (capacity + 3.5), 0, DEBRIS.maxPushSlow);
  const next = along * (1 - slow * 0.82);
  const latX = vx.vx - along * fx;
  const latY = vx.vy - along * fy;
  vx.vx = next * fx + latX;
  vx.vy = next * fy + latY;
}

function reactivatePileMass(
  town: Town,
  x: number,
  y: number,
  mass: number,
  material: Material,
  heading: number,
  vx: number,
  vy: number,
  owner?: string,
): void {
  if (mass <= 1e-6) return;
  if (mass < 0.05) {
    town.pile.addMass(x, y, mass, material, owner);
    return;
  }
  const n = mass > 0.38 ? 2 : 1;
  let left = mass;
  for (let i = 0; i < n; i++) {
    const share = i === n - 1 ? left : mass / n;
    left -= share;
    addDebrisBody(town, {
      yardOwner: owner,
      x: x + playRng.range(-0.14, 0.14),
      y: y + playRng.range(-0.14, 0.14),
      w: material === "wood" ? playRng.range(0.28, 0.5) : playRng.range(0.16, 0.34),
      d: material === "wood" ? playRng.range(0.08, 0.14) : playRng.range(0.1, 0.2),
      material,
      layer: "fragment",
      heading: heading + playRng.range(-0.5, 0.5),
      mass: share,
      vx: vx * 0.25 + Math.cos(heading) * playRng.range(0.35, 1.4),
      vy: vy * 0.25 + Math.sin(heading) * playRng.range(0.35, 1.4),
      omega: playRng.range(-4, 4),
    });
  }
}

function interactWithPile(
  town: Town,
  v: VehicleContact,
  bladeDown: boolean,
  events: WorldEvent[],
  particles: ParticlePool,
  dt: number,
): number {
  const fx = Math.cos(v.heading);
  const fy = Math.sin(v.heading);
  const px = bladeDown && v.blade ? v.blade.cx : v.x;
  const py = bladeDown && v.blade ? v.blade.cy : v.y;
  const sample = town.pile.sample(px, py);
  const under = town.pile.sample(v.x, v.y);
  const use = sample.mass + sample.height >= under.mass + under.height ? sample : under;
  if (use.height < 0.035 && use.mass < 0.06) return 0;
  let load = pileResistance(use.height, use.compact, use.mass) * 0.3 * v.profile.resistanceMul;
  if (bladeDown && v.blade && (use.mass > 0.08 || use.height > 0.05)) {
    const take = Math.min(use.mass, (0.62 + v.profile.pushForce * 0.035) * dt * 7.2);
    if (take > 0.012) {
      const extracted = town.pile.extractDisk(px, py, 0.78, take);
      if (extracted.mass > 0.012) {
        const pushed = extracted.mass * 0.52;
        const spawned = extracted.mass - pushed;
        if (pushed > 0.008) {
          town.pile.addMass(px + fx * 0.9, py + fy * 0.9, pushed, extracted.material, extracted.owners);
        }
        let owned = 0;
        for (const [owner, fraction] of Object.entries(extracted.owners ?? {})) {
          owned += fraction;
          reactivatePileMass(town, px + fx * .32, py + fy * .32, spawned * fraction, extracted.material, v.heading, v.vx, v.vy, owner);
        }
        if (owned < 1 - 1e-6) reactivatePileMass(town, px + fx * .32, py + fy * .32, spawned * (1 - owned), extracted.material, v.heading, v.vx, v.vy);
        town.pile.compactPoint(px, py, 0.28 * dt);
        if (playRng.chance(0.14)) {
          particles.spawn("dust", px, py, 0.1, 2, 0.8, 0.4);
          events.push({ kind: "scrape", x: px, y: py, z: 0.08, mag: 0.35, material: extracted.material });
        }
        load += extracted.mass * 1.05 * v.profile.resistanceMul;
      }
    }
  } else {
    town.pile.compactPoint(v.x, v.y, 0.18 * dt);
  }
  const site = siteContaining(town, v.x, v.y);
  if (site) load += siteFeel(site, v.x, v.y) * 0.35 * v.profile.resistanceMul;
  return load;
}

function trimActive(town: Town, focusX: number, focusY: number): void {
  const awake = town.rubble.filter((r) => !r.sleeping);
  if (awake.length <= DEBRIS.activeCap) return;
  const ranked = awake
    .map((r) => ({
      r,
      dist: Math.hypot(r.x - focusX, r.y - focusY),
      speed: Math.hypot(r.vx, r.vy) + Math.abs(r.omega) * 0.15,
    }))
    .sort((a, b) => {
      const aSlow = a.speed < DEBRIS.sleepSpeed * 2.5 ? 0 : 1;
      const bSlow = b.speed < DEBRIS.sleepSpeed * 2.5 ? 0 : 1;
      if (aSlow !== bSlow) return aSlow - bSlow;
      return b.dist - a.dist;
    });
  let over = awake.length - DEBRIS.activeCap;
  for (const item of ranked) {
    if (over <= 0) break;
    if (item.speed > 1.15 && item.dist < 8) continue;
    if (heapScore(town, item.r) > 2.4) continue;
    absorbBody(town, item.r);
    over--;
  }
}

function dozerProfile(dozer: Dozer, engineMul: number): VehicleProfile {
  return {
    mass: DOZER.mass,
    radius: DOZER.radius,
    pushForce: DOZER.pushForce * engineMul,
    traction: 1,
    clearance: dozer.bladeDown ? 0.05 : 0.26,
    resistanceMul: 1,
  };
}

export function stepDebris(
  town: Town,
  dozer: Dozer,
  particles: ParticlePool,
  events: WorldEvent[],
  engineMul: number,
  dt: number,
): { load: number } {
  townScratch = town;
  stepStats = emptyDebrisStats();
  debrisClock += dt;
  rebuildBodyHash(town);
  let load = 0;
  let contactPairs = 0;
  contacted.clear();

  for (let iter = 0; iter < DEBRIS.solverIters; iter++) {
    // Query from moving pieces; sleeping pieces remain in the hash as targets.
    // Snapshot membership so a newly woken piece cannot duplicate a pair.
    const active = town.rubble.filter(r => !r.sleeping);
    if (!active.length) break;
    const activeIds = new Set(active.map(r => r.id));
    if (iter > 0) rebuildBodyHash(town);
    for (const r of active) {
      const box = rubbleAabb(r);
      bodyHash.query(box.x - 0.05, box.y - 0.05, box.w + 0.1, box.d + 0.1, nearbyBodies);
      for (const other of nearbyBodies) {
        if (other.id === r.id || (activeIds.has(other.id) && other.id < r.id)) continue;
        contactPairs++;
        resolveBodies(r, other);
      }
    }
  }

  const profile = dozerProfile(dozer, engineMul);
  const v: VehicleContact = {
    x: dozer.x,
    y: dozer.y,
    vx: dozer.vx,
    vy: dozer.vy,
    heading: dozer.heading,
    radius: DOZER.radius,
    profile,
    blade: bladeOf(dozer),
  };

  bodyHash.query(dozer.x - 3.2, dozer.y - 3.2, 6.4, 6.4, nearbyBodies);
  for (const r of nearbyBodies) {
    let j = 0;
    if (dozer.bladeDown) {
      j = resolveVehicleBody(v, r, true, events, particles);
      if (j > 0) contacted.add(r.id);
    }
    if (!contacted.has(r.id)) {
      j += resolveVehicleBody(v, r, false, events, particles);
    }
    load += j;

    const dist = Math.hypot(r.x - dozer.x, r.y - dozer.y);
    if (dist < DOZER.radius * 0.78 && r.elev + r.thickness * 0.5 < 0.4) {
      r.damage += r.crushability * (0.55 + dozerSpeed(dozer) * 0.12) * dt;
      town.pile.compactPoint(r.x, r.y, 0.7 * dt);
      if (r.damage >= 1 && r.crushability > 0.2) {
        events.push({ kind: "crush", x: r.x, y: r.y, z: r.elev, mag: 0.55 + r.mass * 0.2, material: r.material });
        crushBody(town, r, particles);
      }
    }
  }

  load += interactWithPile(town, v, dozer.bladeDown, events, particles, dt);
  applyVehicleResistance(dozer, dozer.heading, load, profile);
  if (load > 0.35) dozer.lastImpact = Math.max(dozer.lastImpact, 0.05);
  rebuildBodyHash(town);

  if (town.roadCar && town.roadCar.alive) {
    const car = town.roadCar;
    const rp: VehicleProfile = {
      mass: 1.35,
      radius: 0.7,
      pushForce: 2.4,
      traction: 0.5,
      clearance: 0.13,
      resistanceMul: 2.55,
    };
    const cv: VehicleContact = {
      x: car.x,
      y: car.y,
      vx: car.vx,
      vy: car.vy,
      heading: car.heading,
      radius: rp.radius,
      profile: rp,
    };
    let carLoad = 0;
    bodyHash.query(car.x - 2.4, car.y - 2.4, 4.8, 4.8, nearbyBodies);
    for (const r of nearbyBodies) {
      carLoad += resolveVehicleBody(cv, r, false, events, particles);
    }
    carLoad += interactWithPile(town, cv, false, events, particles, dt);
    applyVehicleResistance(car, car.heading, carLoad, rp);
  }

  for (const r of town.rubble) integrateBody(town, r, dt);
  enforceDistanceCleanup(town, dozer.x, dozer.y, contacted);
  trimActive(town, dozer.x, dozer.y);

  let active = 0;
  let bodyMass = 0;
  for (const r of town.rubble) {
    bodyMass += r.mass;
    if (r.sleeping) continue;
    active++;
  }
  stepStats = {
    active,
    sleeping: town.rubble.length - active,
    contactPairs,
    conversions: stepStats.conversions,
    distanceCleanups: stepStats.distanceCleanups,
    emergencyCleanups: stepStats.emergencyCleanups,
    bodyMass,
    pileMass: town.pile.totalMass(),
  };

  return { load };
}

export function depositSettledParticles(town: Town, particles: ParticlePool): void {
  for (const p of particles.items) {
    if (!p.alive || !p.settled || p.kind === "dust") continue;
    if (p.life > 0.4) continue;
    const kind: GroundKind = p.kind === "glass" ? "glass" : p.kind === "wood" ? "splinter" : "chip";
    const material: Material = p.kind;
    addMark(town, p.x, p.y, kind, material, p.rot);
    town.marks[town.marks.length - 1]!.yardOwner = p.yardOwner;
    p.alive = false;
  }
}

export function obstructionAt(town: Town, x: number, y: number, radius = 0.7) {
  const base = queryObstruction(town.pile, town.rubble, x, y, radius);
  const site = siteContaining(town, x, y);
  if (!site) return base;
  const feel = siteFeel(site, x, y);
  return {
    ...base,
    resistance: base.resistance + feel * 0.32,
  };
}

export function pathBlocked(town: Town, x: number, y: number, radius = 0.7): boolean {
  return obstructionAt(town, x, y, radius).blocked;
}
