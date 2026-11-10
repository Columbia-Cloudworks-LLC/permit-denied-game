import { vehicleDefinition } from '../vehicle/definitions';
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
import { pointOnRoad } from "../world/roads";
import { SpatialHash } from "./spatial";
import { pileResistance, queryObstruction } from "./pile";
import { siteContaining, siteFeel } from "../structure/site";

let nextDebrisId = 1;
const playRng = new Rng(0xdeb415);
const nearbyBodies: Rubble[] = [];
/** Cells near a fragment's own size, so a query in a dense heap returns its real neighbours. */
const bodyHash = new SpatialHash<Rubble>(0.8);
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
  remnantHash.clear(); remnantCount = -1;
  unattendedSince = new WeakMap();
  playRng.reset(seed ^ 0xdeb415);
  contacted.clear();
  debrisClock = 0;
  stepStats = emptyDebrisStats();
}

/** Half-size of the square that bounds a body at any heading. */
function rubbleExtent(r: Rubble): number {
  return 0.5 * Math.hypot(r.w, r.d) + 0.06;
}

export function rubbleAabb(r: Rubble): { x: number; y: number; w: number; d: number } {
  const ext = rubbleExtent(r);
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

/** Bodies fall from where they broke off, up to this height; taller drops would float over the wreck. */
const MAX_AIR = 1.6;

/** Lighter material is thrown further: timber about 1.06, concrete about 0.78. */
function throwScale(material: Material): number {
  return 1.25 - materialDensity(material) * 0.35;
}

/** Height a piece of storey `floor` starts its drop from, above the heap it lands on. */
function dropHeight(floor: number, rng: Rng): number {
  return Math.min(MAX_AIR, 0.1 + (floor + rng.range(0.2, 1)) * 0.55);
}

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
  vz?: number;
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
    vz: init.vz ?? 0,
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

function markSize(kind: GroundKind, rng: { range: (a: number, b: number) => number }): { w: number; d: number; alpha: number } {
  switch (kind) {
    case "scrape":
      return { w: rng.range(0.28, 0.7), d: rng.range(0.05, 0.1), alpha: 0.35 };
    case "tire":
      // Longer than the 0.87 m tread-cue spacing, so a run of marks reads as one continuous track.
      return { w: rng.range(0.94, 1.0), d: rng.range(0.32, 0.36), alpha: 0.34 };
    case "oil":
      return { w: rng.range(0.22, 0.48), d: rng.range(0.16, 0.32), alpha: 0.32 };
    case "crack":
      return { w: rng.range(0.45, 0.95), d: rng.range(0.04, 0.08), alpha: 0.4 };
    case "dust":
      return { w: rng.range(0.12, 0.28), d: rng.range(0.08, 0.2), alpha: 0.22 };
    case "chip":
    case "splinter":
    case "glass":
      return { w: rng.range(0.08, 0.22), d: rng.range(0.06, 0.16), alpha: 0.7 };
    case "season-track":
      return { w: rng.range(0.42, 0.7), d: rng.range(0.12, 0.2), alpha: 0.5 };
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function addSurfaceMark(
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
  const size = markSize(kind, rng);
  const mark: GroundMark = {
    x,
    y,
    w: size.w,
    d: size.d,
    heading,
    kind,
    material,
    seed: rng.int(1, 1_000_000),
    alpha: size.alpha,
  };
  mark.yardOwner = owner ?? town.debrisOwnerAt?.(x, y);
  town.marks.push(mark);
  town.visualRevision++;
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
  addSurfaceMark(town, x, y, kind, material, heading, owner);
}

/** One collapse's spawn, its seeded stream and the mass still to place. */
interface CollapseBurst {
  town: Town;
  spawn: CollapseSpawn;
  rng: Rng;
  dx: number;
  dy: number;
  heap: number;
  roofing: boolean;
  created: Rubble[];
  remaining: number;
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

  const fines = spawn.material === "glass" ? budget * 0.72 : budget * 0.12;
  town.pile.addMass(spawn.x, spawn.y, fines, spawn.material);
  const burst: CollapseBurst = { town, spawn, rng, dx, dy, heap, roofing: spawn.source === "roof", created: [], remaining: budget - fines };

  spawnRemnants(burst);
  spawnFragments(burst);
  if (burst.remaining > 0.02) {
    town.pile.addMass(spawn.x + dx * 0.15, spawn.y + dy * 0.15, burst.remaining, spawn.material);
    burst.remaining = 0;
  }
  spawnCollapseMarks(burst);
  return burst.created;
}

/** Large pieces (wall sections or roof panels) take most of the mass, slid along the collapse direction. */
function spawnRemnants(burst: CollapseBurst): void {
  const { spawn, rng, dx, dy } = burst;
  const remnantPlans = burst.roofing ? roofRemnantPlan(spawn.material, rng, spawn) : remnantPlan(spawn.material, rng);
  const baseHeading = spawn.heading ?? Math.atan2(dy, dx);
  const startElev = spawn.elev ?? burst.heap + (burst.roofing ? rng.range(0, 0.08 + spawn.floor * 0.06) : dropHeight(spawn.floor, rng));
  for (const plan of remnantPlans) {
    if (burst.remaining < 0.08) break;
    const mass = Math.min(burst.remaining * plan.massShare, burst.remaining);
    burst.remaining -= mass;
    burst.created.push(addDebrisBody(burst.town, remnantBody(burst, plan, baseHeading, startElev, mass)));
  }
}

/** Roof panels slide off gently; wall sections are thrown and spun harder. */
const ROOF_REMNANT = { jitter: 0.08, turn: 0.28, minSpeed: 0.15, maxSpeed: 0.7, spin: 1.6 } as const;
const WALL_REMNANT = { jitter: 0.28, turn: 0.9, minSpeed: 0.4, maxSpeed: 1.8, spin: 4 } as const;

function remnantBody(
  burst: CollapseBurst,
  plan: ReturnType<typeof remnantPlan>[number],
  baseHeading: number,
  startElev: number,
  mass: number,
): Parameters<typeof makeRubble>[0] {
  const { spawn, rng, dx, dy, roofing } = burst;
  const tune = roofing ? ROOF_REMNANT : WALL_REMNANT;
  const exactPanel = spawn.preservePanelPose && plan.shape === "panel";
  const jitter = exactPanel ? 0 : tune.jitter;
  const scale = roofing ? 0.55 : spawn.cellSize;
  const fling = roofing ? 1 : throwScale(spawn.material) * (1 + spawn.floor * 0.18);
  const ox = (rng.range(-jitter, jitter) + plan.along * dx) * scale;
  const oy = (rng.range(-jitter, jitter) + plan.along * dy) * scale;
  return {
    x: spawn.x + ox,
    y: spawn.y + oy,
    w: plan.w,
    d: plan.d,
    material: spawn.material,
    layer: "remnant",
    shape: plan.shape,
    skin: plan.skin,
    heading: exactPanel ? baseHeading : baseHeading + rng.range(-tune.turn, tune.turn),
    elev: Math.max(burst.heap, startElev + (roofing ? plan.along * 0.04 : rng.range(0, 0.08))),
    thickness: plan.thickness,
    mass,
    vx: dx * rng.range(tune.minSpeed, tune.maxSpeed) * fling + rng.range(-0.28, 0.28),
    vy: dy * rng.range(tune.minSpeed, tune.maxSpeed) * fling + rng.range(-0.28, 0.28),
    omega: exactPanel ? 0 : rng.range(-tune.spin, tune.spin),
    seed: rng.int(1, 0x7fffffff),
  };
}

/** A few small flying fragments thrown outward. */
function spawnFragments(burst: CollapseBurst): void {
  const { spawn, rng } = burst;
  const fragCount = spawn.material === "glass" ? rng.int(1, 3) : burst.roofing ? rng.int(0, 1) : rng.int(1, 3);
  for (let i = 0; i < fragCount && burst.remaining > 0.04; i++) {
    const mass = Math.min(burst.remaining / Math.max(1, fragCount - i), burst.remaining * 0.55);
    burst.remaining -= mass;
    burst.created.push(addDebrisBody(burst.town, fragmentBody(burst, mass)));
  }
}

/** Fragment footprint per material as [length range, width range]: a single brick, a sliver of glass, a splinter, a bar. */
const FRAGMENT_SIZE: Record<Material, readonly [number, number, number, number]> = {
  wood: [0.28, 0.55, 0.06, 0.12],
  brick: [0.17, 0.24, 0.08, 0.12],
  concrete: [0.12, 0.32, 0.08, 0.2],
  metal: [0.26, 0.5, 0.04, 0.08],
  glass: [0.1, 0.26, 0.04, 0.1],
};

function fragmentBody(burst: CollapseBurst, mass: number): Parameters<typeof makeRubble>[0] {
  const { spawn, rng, dx, dy } = burst;
  const [w0, w1, d0, d1] = FRAGMENT_SIZE[spawn.material];
  const ang = rng.range(0, Math.PI * 2);
  const rad = rng.range(0.12, 0.55) * spawn.cellSize;
  const fling = throwScale(spawn.material) * (1 + spawn.floor * 0.18);
  return {
    x: spawn.x + Math.cos(ang) * rad + dx * 0.12,
    y: spawn.y + Math.sin(ang) * rad + dy * 0.12,
    w: rng.range(w0, w1),
    d: rng.range(d0, d1),
    material: spawn.material,
    layer: "fragment",
    shape: spawn.material === "wood" || spawn.material === "metal" ? "beam" : "chunk",
    heading: ang + rng.range(-0.4, 0.4),
    elev: burst.roofing ? burst.heap + rng.range(0.02, 0.16 + spawn.floor * 0.05) : burst.heap + dropHeight(spawn.floor, rng),
    mass,
    vx: (dx * rng.range(0.8, 2.6) + Math.cos(ang) * rng.range(0.4, 1.8)) * fling,
    vy: (dy * rng.range(0.8, 2.6) + Math.sin(ang) * rng.range(0.4, 1.8)) * fling,
    // Small pieces are kicked up and out; they arc and land after the big ones.
    vz: rng.range(0.6, 2.4),
    omega: rng.range(-8, 8),
    seed: rng.int(1, 0x7fffffff),
  };
}

/** Ground marks: glass shards, wood splinters, or a dust patch and chips. */
function spawnCollapseMarks(burst: CollapseBurst): void {
  const { town, spawn, rng, dx, dy } = burst;
  const cosmeticN = spawn.material === "glass" ? 10 : burst.roofing ? 2 : 3;
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
}

function roofRemnantPlan(
  material: Material,
  rng: Rng,
  spawn: CollapseSpawn,
): { w: number; d: number; thickness: number; shape: DebrisShape; massShare: number; along: number; skin: DebrisSkin }[] {
  const panelW = spawn.panelW ?? rng.range(0.7, 1.05);
  const panelD = spawn.panelD ?? rng.range(0.32, 0.5);
  if (spawn.preservePanelPose) return [
    { w: panelW, d: panelD, thickness: .14, shape: "panel", massShare: .52, along: 0, skin: "roofing" },
    { w: Math.min(panelW, 1.1) * 0.72, d: .09, thickness: .08, shape: "beam", massShare: .18, along: .12, skin: "default" },
    { w: panelW * rng.range(0.32, 0.55), d: panelD * rng.range(0.35, 0.62), thickness: .1, shape: "chunk", massShare: .16, along: -.1, skin: "default" },
    { w: rng.range(0.38, 0.7), d: .07, thickness: .07, shape: "beam", massShare: .14, along: .22, skin: "default" },
  ];
  if (material === "wood") {
    return [
      { w: panelW * rng.range(0.55, 0.85), d: panelD * rng.range(0.45, 0.75), thickness: 0.14, shape: "panel", massShare: 0.38, along: 0.28, skin: "roofing" },
      { w: rng.range(0.7, 1.05), d: 0.1, thickness: 0.1, shape: "beam", massShare: 0.22, along: -0.12, skin: "default" },
      { w: rng.range(0.35, 0.62), d: rng.range(0.08, 0.14), thickness: 0.08, shape: "beam", massShare: 0.16, along: 0.08, skin: "default" },
      { w: rng.range(0.28, 0.5), d: rng.range(0.22, 0.4), thickness: 0.09, shape: "chunk", massShare: 0.12, along: -0.2, skin: "default" },
    ];
  }
  if (material === "metal") {
    return [
      { w: panelW * 0.72, d: panelD * 0.55, thickness: 0.1, shape: "panel", massShare: 0.32, along: 0, skin: "default" },
      { w: rng.range(0.7, 1.1), d: 0.09, thickness: 0.08, shape: "beam", massShare: 0.24, along: 0.12, skin: "default" },
      { w: rng.range(0.4, 0.7), d: rng.range(0.08, 0.16), thickness: 0.07, shape: "beam", massShare: 0.18, along: -0.16, skin: "default" },
      { w: rng.range(0.22, 0.42), d: rng.range(0.18, 0.34), thickness: 0.08, shape: "chunk", massShare: 0.12, along: 0.2, skin: "default" },
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
        { w: rng.range(0.7, 1.15), d: rng.range(0.1, 0.16), thickness: 0.12, shape: "beam", massShare: 0.36, along: 0.15, skin: "default" },
        { w: rng.range(0.45, 0.8), d: rng.range(0.09, 0.14), thickness: 0.1, shape: "beam", massShare: 0.24, along: -0.1, skin: "default" },
        { w: rng.range(0.22, 0.4), d: rng.range(0.18, 0.32), thickness: 0.1, shape: "chunk", massShare: 0.14, along: 0.22, skin: "default" },
        ...(rng.chance(0.4)
          ? [{ w: rng.range(0.38, 0.62), d: rng.range(0.22, 0.4), thickness: 0.08, shape: "panel" as const, massShare: 0.14, along: 0.05, skin: "default" as const }]
          : []),
      ];
    case "brick":
      return [
        { w: rng.range(0.38, 0.62), d: rng.range(0.28, 0.48), thickness: rng.range(0.22, 0.34), shape: "chunk", massShare: 0.4, along: 0.08, skin: "default" },
        { w: rng.range(0.18, 0.32), d: rng.range(0.1, 0.18), thickness: 0.09, shape: "chunk", massShare: 0.16, along: 0.2, skin: "default" },
        { w: rng.range(0.22, 0.38), d: rng.range(0.08, 0.14), thickness: 0.08, shape: "beam", massShare: 0.12, along: -0.16, skin: "default" },
      ];
    case "concrete":
      return [
        { w: rng.range(0.42, 0.72), d: rng.range(0.3, 0.52), thickness: rng.range(0.24, 0.42), shape: "chunk", massShare: 0.42, along: 0.1, skin: "default" },
        { w: rng.range(0.22, 0.4), d: rng.range(0.16, 0.3), thickness: rng.range(0.14, 0.26), shape: "chunk", massShare: 0.22, along: -0.12, skin: "default" },
        { w: rng.range(0.28, 0.5), d: rng.range(0.08, 0.14), thickness: 0.1, shape: "beam", massShare: 0.14, along: 0.18, skin: "default" },
      ];
    case "metal":
      return [
        { w: rng.range(0.7, 1.2), d: rng.range(0.08, 0.14), thickness: 0.1, shape: "beam", massShare: 0.34, along: 0.12, skin: "default" },
        { w: rng.range(0.32, 0.55), d: rng.range(0.16, 0.3), thickness: 0.07, shape: "panel", massShare: 0.2, along: -0.08, skin: "default" },
        { w: rng.range(0.4, 0.7), d: rng.range(0.07, 0.12), thickness: 0.07, shape: "beam", massShare: 0.16, along: 0.2, skin: "default" },
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

function absorbBody(town: Town, r: Rubble): void {
  absorbBodyAt(town, town.rubble.indexOf(r), r);
}

/** Absorb the body at a known index (or a body no longer listed, with i < 0). */
function absorbBodyAt(town: Town, i: number, r: Rubble = town.rubble[i]!): void {
  town.pile.addMass(r.x, r.y, r.mass, r.material, r.yardOwner);
  addMark(town, r.x, r.y, r.material === "wood" ? "splinter" : "chip", r.material, r.heading, r.yardOwner);
  if (i >= 0) town.rubble.splice(i, 1);
  stepStats.conversions++;
}

function heapScore(town: Town, r: Rubble): number {
  return town.pile.sample(r.x, r.y).mass + r.mass;
}

interface CleanupCandidate {
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

function collectCleanupCandidates(
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

const CLEANUP_LAYERS = ["remnant", "fragment"] as const;

export function enforceDistanceCleanup(
  town: Town,
  dozerX: number,
  dozerY: number,
  touching: ReadonlySet<number> = contacted,
): { distance: number; emergency: number } {
  const result = { distance: retireUnattended(town, dozerX, dozerY, touching), emergency: 0 };
  for (const layer of CLEANUP_LAYERS) trimLayer(town, layer, dozerX, dozerY, touching, result);
  stepStats.distanceCleanups += result.distance;
  stepStats.emergencyCleanups += result.emergency;
  return result;
}

type RoadCar = Town["vehicles"][number];
/** Cars that protect the debris around them this step: alive, and autonomous or moving. */
const guardCars: RoadCar[] = [];

function collectGuardCars(town: Town): void {
  guardCars.length = 0;
  for (const car of town.vehicles) {
    if (car.alive && (car.autonomous || Math.hypot(car.vx, car.vy) > .05)) guardCars.push(car);
  }
}

/** Near the dozer, freshly touched, or near a moving or autonomous vehicle. */
function debrisProtected(r: Rubble, dozerX: number, dozerY: number, touching: ReadonlySet<number>): boolean {
  if (touchingDozer(r, dozerX, dozerY, touching) || Math.hypot(r.x - dozerX, r.y - dozerY) <= DEBRIS.retireRadius) return true;
  for (const car of guardCars) if (Math.hypot(r.x - car.x, r.y - car.y) <= DEBRIS.protectRadius) return true;
  return false;
}

/** Unattended chunks on pavement outlast the usual grace before joining the pile. */
function lingersOnRoad(town: Town, r: Rubble, since: number): boolean {
  const age = Math.min(debrisClock - since, debrisClock - r.touchedAt);
  return age < DEBRIS.retireDelay * DEBRIS.roadLinger && pointOnRoad(town.network, r.x, r.y);
}

/** Unattended destruction becomes the editable pile after a bounded grace; returns bodies absorbed. */
function retireUnattended(town: Town, dozerX: number, dozerY: number, touching: ReadonlySet<number>): number {
  let distance = 0;
  collectGuardCars(town);
  const bodies = town.rubble;
  // Contact jitter must not keep distant bodies in the solver indefinitely.
  // Absorbing removes bodies[i], so the index only advances past survivors.
  for (let i = 0; i < bodies.length;) {
    const r = bodies[i]!;
    if (debrisProtected(r, dozerX, dozerY, touching)) { unattendedSince.delete(r); i++; continue; }
    const since = unattendedSince.get(r);
    if (since === undefined) { unattendedSince.set(r, debrisClock); i++; continue; }
    if (debrisClock - since < DEBRIS.retireDelay || debrisClock - r.touchedAt < DEBRIS.retireDelay || lingersOnRoad(town, r, since)) { i++; continue; }
    absorbBodyAt(town, i);
    unattendedSince.delete(r);
    distance++;
  }
  return distance;
}

/** Over a layer's cap, absorb quiet distant sleepers first, then anything past the hard cap. */
function trimLayer(
  town: Town,
  layer: (typeof CLEANUP_LAYERS)[number],
  dozerX: number,
  dozerY: number,
  touching: ReadonlySet<number>,
  result: { distance: number; emergency: number },
): void {
  const cap = layerCap(layer);
  let inLayer = 0;
  for (const r of town.rubble) if (r.layer === layer) inLayer++;
  if (inLayer <= cap) return;
  const layerBodies = town.rubble.filter((r) => r.layer === layer);
  const candidates = collectCleanupCandidates(layerBodies, dozerX, dozerY, touching);
  const absorbed = new Set<number>();
  let count = layerBodies.length;
  for (const c of candidates) {
    if (count <= cap) break;
    if (!c.sleeping || c.nearby || c.recent) continue;
    absorbBody(town, c.body);
    absorbed.add(c.body.id);
    count--;
    result.distance++;
  }
  const hardCap = cap + DEBRIS.hardOverflow;
  for (const c of candidates) {
    if (count <= hardCap) break;
    if (absorbed.has(c.body.id)) continue;
    absorbBody(town, c.body);
    absorbed.add(c.body.id);
    count--;
    result.emergency++;
  }
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

/** Result of the last obbOverlap call; read it before the next call. */
const overlap = { nx: 0, ny: 0, depth: 0, px: 0, py: 0 };

/**
 * Separating-axis test of two oriented boxes. On a hit, fills `overlap` with the
 * minimum-depth axis (pointing from a to b) and the midpoint, and returns true.
 */
function obbOverlap(
  ax: number, ay: number, aHeading: number, ahl: number, ahw: number,
  bx: number, by: number, bHeading: number, bhl: number, bhw: number,
): boolean {
  const afx = Math.cos(aHeading), afy = Math.sin(aHeading);
  const bfx = Math.cos(bHeading), bfy = Math.sin(bHeading);
  let minDepth = Infinity;
  let nx = 1;
  let ny = 0;
  for (let k = 0; k < 4; k++) {
    const x = k === 0 ? afx : k === 1 ? -afy : k === 2 ? bfx : -bfy;
    const y = k === 0 ? afy : k === 1 ? afx : k === 2 ? bfy : bfx;
    const ca = ax * x + ay * y;
    const ea = ahl * Math.abs(afx * x + afy * y) + ahw * Math.abs(-afy * x + afx * y);
    const cb = bx * x + by * y;
    const eb = bhl * Math.abs(bfx * x + bfy * y) + bhw * Math.abs(-bfy * x + bfx * y);
    const o = Math.min(ca + ea, cb + eb) - Math.max(ca - ea, cb - eb);
    if (o <= 0) return false;
    if (o < minDepth) {
      minDepth = o;
      nx = x;
      ny = y;
    }
  }
  if ((bx - ax) * nx + (by - ay) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  overlap.nx = nx;
  overlap.ny = ny;
  overlap.depth = minDepth;
  overlap.px = (ax + bx) * 0.5;
  overlap.py = (ay + by) * 0.5;
  return true;
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
  if (r.sleeping) return;
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

/**
 * Resolve one overlapping pair. `a` is awake; `b` may be asleep, and then acts as a fixed
 * obstacle unless `a` strikes it hard enough to wake it. Resting overlap alone never wakes a
 * sleeper, so a settled heap stays out of the solver.
 */
function resolveBodies(a: Rubble, b: Rubble): number {
  // Boxes whose bounding circles are apart cannot touch; most hash neighbours stop here.
  const dx = b.x - a.x, dy = b.y - a.y, reach = (Math.hypot(a.w, a.d) + Math.hypot(b.w, b.d)) * 0.5;
  if (dx * dx + dy * dy > reach * reach) return 0;
  if (!obbOverlap(a.x, a.y, a.heading, a.w * 0.5, a.d * 0.5, b.x, b.y, b.heading, b.w * 0.5, b.d * 0.5)) return 0;
  const { nx, ny, depth, px, py } = overlap;
  const imA = invMass(a);
  if (b.sleeping) {
    const closing = (a.vx - a.omega * (py - a.y)) * nx + (a.vy + a.omega * (px - a.x)) * ny;
    if (closing > DEBRIS.sleepSpeed && closing / Math.max(1e-5, imA) > DEBRIS.wakeImpulse) wake(b);
  }
  const imB = invMass(b);
  const invSum = imA + imB;
  if (invSum <= 1e-8) return 0;
  const corr = Math.min(DEBRIS.maxCorrect, Math.max(0, depth - DEBRIS.slop) * DEBRIS.baumgarte);
  a.x -= nx * corr * (imA / invSum);
  a.y -= ny * corr * (imA / invSum);
  b.x += nx * corr * (imB / invSum);
  b.y += ny * corr * (imB / invSum);

  const rax = px - a.x;
  const ray = py - a.y;
  const rbx = px - b.x;
  const rby = py - b.y;
  const rvx = a.vx - a.omega * ray - (b.vx - b.omega * rby);
  const rvy = a.vy + a.omega * rax - (b.vy + b.omega * rbx);
  // The normal points from a to b, so a positive normal speed is the pair closing.
  const vn = rvx * nx + rvy * ny;
  if (vn <= 0) return depth;
  const rnA = rax * ny - ray * nx;
  const rnB = rbx * ny - rby * nx;
  const denom = Math.max(1e-5, invSum + rnA * rnA * invInertia(a) + rnB * rnB * invInertia(b));
  const jn = clamp(((1 + DEBRIS.rest) * vn) / denom, 0, 4.5);
  // a's slide along its own tangent (ny, -nx); friction opposes it on a and drags b along.
  const slide = ny * rvx - nx * rvy;
  const mu = Math.min(a.friction, b.friction);
  const jt = -clamp(slide / denom, -jn * mu, jn * mu);
  // Equal and opposite: a is pushed back along the normal, b forward.
  applyImpulse(a, -nx, -ny, px, py, jn, jt);
  applyImpulse(b, nx, ny, px, py, jn, jt);
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
  /** The blade is being driven into the pile: throttle forward, or still rolling forward. */
  digging?: boolean;
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
    if (!obbOverlap(bladeObb.x, bladeObb.y, bladeObb.heading, bladeObb.hl, bladeObb.hw, r.x, r.y, r.heading, r.w * 0.5, r.d * 0.5)) return 0;
    const depth = overlap.depth;
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
    return finishVehicleHit(v, r, nnx, nny, onDebris.x, onDebris.y, depth, across, v.blade.hw, events, particles);
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

function integrateBody(town: Town, r: Rubble, particles: ParticlePool, dt: number): void {
  const support = supportHeight(town, r);
  if (r.sleeping && staysAsleep(r, support, dt)) return;
  const airborne = r.elev > support + 0.015 || r.vz > 0;
  const impact = settleVertically(r, support, dt);
  if (impact > 0) land(town, r, impact, particles);
  slideBody(town, r, airborne && impact === 0, dt);
  updateSleep(r, support, dt);
}

/** A sleeper wakes once lifted off its support; otherwise it stays frozen. */
function staysAsleep(r: Rubble, support: number, dt: number): boolean {
  if (r.elev > support + 0.035) {
    wake(r);
    return false;
  }
  r.sleepT += dt;
  r.vx = 0;
  r.vy = 0;
  r.omega = 0;
  r.vz = 0;
  return true;
}

/** Fall under gravity onto the support, or ride it within a small clearance. Returns the landing speed on touchdown. */
function settleVertically(r: Rubble, support: number, dt: number): number {
  const maxRide = r.layer === "fragment" ? 0.4 : 0.12;
  if (r.elev > MAX_AIR) {
    r.elev = MAX_AIR;
    if (r.elev > support + 0.04) wake(r);
  }
  if (r.elev > support + 0.015 || r.vz > 0) {
    r.vz -= DEBRIS.gravity * dt;
    r.elev += r.vz * dt;
    if (r.elev >= support) return 0;
    const impact = -r.vz;
    r.elev = support;
    r.vz *= -BOUNCE[r.material];
    if (Math.abs(r.vz) < 0.6) r.vz = 0;
    return impact;
  }
  r.vz *= Math.max(0, 1 - 8 * dt);
  if (r.elev < support) r.elev = approachElev(r.elev, support, 2.8 * dt);
  if (r.elev > support + maxRide) r.elev = support + maxRide;
  return 0;
}

/** How much of its landing speed a piece keeps on the bounce: steel rings and hops, masonry thuds. */
const BOUNCE: Record<Material, number> = { wood: 0.22, brick: 0.12, concrete: 0.08, metal: 0.32, glass: 0.05 };

/** Dust puffs from hard landings this step, so a whole wall coming down is a few puffs, not hundreds. */
let landingPuffs = 0;

/** Touchdown: the ground grips the piece by its friction and scrubs its spin; a hard hit throws dust. */
function land(town: Town, r: Rubble, impact: number, particles: ParticlePool): void {
  const grip = Math.min(0.85, r.friction * clamp(impact / 4, 0.3, 1));
  r.vx *= 1 - grip;
  r.vy *= 1 - grip;
  r.omega *= 0.5;
  if (impact < 2.4 || r.layer !== "remnant" || landingPuffs >= 3) return;
  landingPuffs++;
  particles.spawn("dust", r.x, r.y, r.elev + 0.05, 3, 1.3, 0.9, r.yardOwner);
  town.pile.compactPoint(r.x, r.y, Math.min(0.12, impact * r.mass * 0.004));
}

/**
 * In the air a piece keeps its throw. On the ground it drags by its material's friction, loose
 * fragments slide down soft pile slopes, and a piece nearly stopped is held by static friction.
 */
function slideBody(town: Town, r: Rubble, airborne: boolean, dt: number): void {
  if (airborne) {
    r.vx *= 1 - 0.3 * dt;
    r.vy *= 1 - 0.3 * dt;
    r.omega *= 1 - 0.6 * dt;
  } else {
    if (r.layer === "fragment" && town.pile.compactAt(r.x, r.y) < 0.72) {
      // Below the angle of repose a fragment stays where it lies.
      const sx = town.pile.slopeX(r.x, r.y), sy = town.pile.slopeY(r.x, r.y);
      if (sx * sx + sy * sy > 0.05) {
        r.vx -= sx * 2.4 * dt;
        r.vy -= sy * 2.4 * dt;
      }
    }
    const grip = 0.55 + r.friction;
    let drag = (r.layer === "fragment" ? 2.2 : 1.8) * grip;
    if (r.vx * r.vx + r.vy * r.vy < 0.09) drag += 5;
    const keep = Math.max(0, 1 - drag * dt);
    r.vx *= keep;
    r.vy *= keep;
    r.omega *= Math.max(0, 1 - 2.9 * grip * dt);
  }
  r.x += r.vx * dt;
  r.y += r.vy * dt;
  r.heading += r.omega * dt;
  r.x = clamp(r.x, town.minX + 0.2, town.maxX - 0.2);
  r.y = clamp(r.y, town.minY + 0.2, town.maxY - 0.2);
}

/** Bodies resting slowly on their support long enough fall asleep. */
function updateSleep(r: Rubble, support: number, dt: number): void {
  const speed = Math.hypot(r.vx, r.vy);
  if (!(speed < DEBRIS.sleepSpeed && Math.abs(r.omega) < DEBRIS.sleepOmega && Math.abs(r.vz) < 0.15 && Math.abs(r.elev - support) < 0.04)) {
    r.sleepT = 0;
    return;
  }
  r.sleepT += dt;
  if (r.sleepT > DEBRIS.sleepTime) {
    r.sleeping = true;
    r.vx = 0;
    r.vy = 0;
    r.omega = 0;
    r.vz = 0;
  }
}

function approachElev(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

interface SupportMemo { pile: Town['pile']; tile: number; remnants: number; x: number; y: number; elev: number; height: number }
const supportCache = new WeakMap<Rubble, SupportMemo>();

/**
 * Height a body rests on. A sleeper reuses its last answer until the pile tile under it, the
 * remnants around it, or its own pose change; fragments churning nearby do not disturb it.
 */
function supportHeight(town: Town, r: Rubble): number {
  const old = supportCache.get(r);
  const tile = town.pile.tileRevisionAt(r.x, r.y);
  if (r.sleeping && old && old.pile === town.pile && old.tile === tile && old.remnants === remnantRevision && old.x === r.x && old.y === r.y && old.elev === r.elev) return old.height;
  const height = calculateSupportHeight(town, r);
  const memo = old ?? ({} as SupportMemo);
  memo.pile = town.pile; memo.tile = tile; memo.remnants = remnantRevision; memo.x = r.x; memo.y = r.y; memo.elev = r.elev; memo.height = height;
  if (!old) supportCache.set(r, memo);
  return height;
}
function calculateSupportHeight(town: Town, r: Rubble): number {
  let support = Math.min(0.7, town.pile.heightAt(r.x, r.y));
  if (r.layer === "remnant") return support;
  const ext = rubbleExtent(r);
  remnantHash.query(r.x - ext, r.y - ext, ext * 2, ext * 2, nearbyBodies);
  for (const other of nearbyBodies) {
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
/** Remnants only: what loose fragments can ride on. Rebuilt when a remnant moves, joins or leaves. */
const remnantHash = new SpatialHash<Rubble>(1.6);
let remnantRevision = 0;
let remnantCount = -1;
/** Bodies and poses the hash was built from: six numbers per body. */
let bodySnapshot: Rubble[] = [];
let poseSnapshot = new Float64Array(0);
const POSE = 6;

function poseMatches(r: Rubble, i: number): boolean {
  const j = i * POSE;
  return bodySnapshot[i] === r && poseSnapshot[j] === r.x && poseSnapshot[j + 1] === r.y && poseSnapshot[j + 2] === r.w && poseSnapshot[j + 3] === r.d
    && poseSnapshot[j + 4] === r.heading && poseSnapshot[j + 5] === r.elev;
}

function hashMatchesBodies(town: Town): boolean {
  const bodies = town.rubble;
  if (bodyHashTown !== town || bodySnapshot.length !== bodies.length) return false;
  for (let i = 0; i < bodies.length; i++) if (!poseMatches(bodies[i]!, i)) return false;
  return true;
}

function rebuildBodyHash(town: Town): void {
  if (hashMatchesBodies(town)) return;
  const bodies = town.rubble;
  let remnants = 0;
  let remnantsMoved = bodyHashTown !== town;
  bodyHashTown = town;
  if (poseSnapshot.length < bodies.length * POSE) poseSnapshot = new Float64Array(Math.max(256, bodies.length * 2) * POSE);
  const known = bodySnapshot.length;
  bodySnapshot.length = bodies.length;
  bodyHash.clear();
  for (let i = 0, j = 0; i < bodies.length; i++, j += POSE) {
    const r = bodies[i]!;
    if (r.layer === "remnant") {
      remnants++;
      if (i >= known || !poseMatches(r, i)) remnantsMoved = true;
    }
    bodySnapshot[i] = r;
    poseSnapshot[j] = r.x; poseSnapshot[j + 1] = r.y; poseSnapshot[j + 2] = r.w; poseSnapshot[j + 3] = r.d;
    poseSnapshot[j + 4] = r.heading; poseSnapshot[j + 5] = r.elev;
    const ext = rubbleExtent(r);
    bodyHash.insert(r.x - ext, r.y - ext, ext * 2, ext * 2, r);
  }
  if (!remnantsMoved && remnants === remnantCount) return;
  remnantCount = remnants;
  remnantRevision++;
  remnantHash.clear();
  for (const r of bodies) {
    if (r.layer !== "remnant") continue;
    const ext = rubbleExtent(r);
    remnantHash.insert(r.x - ext, r.y - ext, ext * 2, ext * 2, r);
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
      // Scooped pieces leave with most of the blade's speed, so they roll ahead of it rather than under it.
      vx: vx * 0.6 + Math.cos(heading) * playRng.range(0.35, 1.4),
      vy: vy * 0.6 + Math.sin(heading) * playRng.range(0.35, 1.4),
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
  // A lowered blade that is not being pushed forward only rests on the pile; it must not keep
  // lifting mass into live debris around a parked dozer.
  const scooping = bladeDown && !!v.blade && !!v.digging;
  const px = scooping ? v.blade!.cx : v.x;
  const py = scooping ? v.blade!.cy : v.y;
  const sample = town.pile.sample(px, py);
  const under = town.pile.sample(v.x, v.y);
  const use = sample.mass + sample.height >= under.mass + under.height ? sample : under;
  if (use.height < 0.035 && use.mass < 0.06) return 0;
  let load = pileResistance(use.height, use.compact, use.mass) * 0.3 * v.profile.resistanceMul;
  if (scooping && (use.mass > 0.08 || use.height > 0.05)) {
    load += bladeScoop(town, v, px, py, use.mass, events, particles, dt);
  } else {
    town.pile.compactPoint(v.x, v.y, 0.18 * dt);
  }
  const site = siteContaining(town, v.x, v.y);
  if (site) load += siteFeel(site, v.x, v.y) * 0.35 * v.profile.resistanceMul;
  return load;
}

/** Berm height ahead of the blade above which pushed material starts rolling off its ends. */
const SPILL_HEIGHT = 0.3;

/**
 * The blade lifts pile mass: about half is pushed ahead as a berm and the rest becomes live
 * debris. Once the berm stands tall, a growing share rolls off the blade ends into windrows,
 * and the mound itself pushes back. Returns the added load.
 */
function bladeScoop(town: Town, v: VehicleContact, px: number, py: number, available: number, events: WorldEvent[], particles: ParticlePool, dt: number): number {
  const take = Math.min(available, (0.62 + v.profile.pushForce * 0.035) * dt * 7.2);
  if (take <= 0.012) return 0;
  const extracted = town.pile.extractDisk(px, py, 0.78, take);
  if (extracted.mass <= 0.012) return 0;
  const fx = Math.cos(v.heading);
  const fy = Math.sin(v.heading);
  const pushed = extracted.mass * 0.52;
  const spawned = extracted.mass - pushed;
  const berm = town.pile.heightAt(px + fx * 0.9, py + fy * 0.9);
  if (pushed > 0.008) {
    const spill = pushed * clamp((berm - SPILL_HEIGHT) / 0.5, 0, 0.6);
    town.pile.addMass(px + fx * 0.9, py + fy * 0.9, pushed - spill, extracted.material, extracted.owners);
    const reach = v.blade!.hw + 0.3;
    for (const side of BLADE_ENDS) {
      town.pile.addMass(px + fx * 0.15 - fy * reach * side, py + fy * 0.15 + fx * reach * side, spill * 0.5, extracted.material, extracted.owners);
    }
  }
  reactivateScooped(town, v, px + fx * .32, py + fy * .32, spawned, extracted);
  town.pile.compactPoint(px, py, 0.28 * dt);
  if (playRng.chance(0.14 + Math.min(0.2, berm * 0.4))) {
    // The cut throws dust and chips of whatever the heap is made of, more as the berm builds.
    particles.spawn("dust", px, py, 0.1, 2, 0.8, 0.4);
    particles.spawn(extracted.material, px + fx * 0.5, py + fy * 0.5, 0.2 + berm, 1, 1.6, 2.2);
    events.push({ kind: "scrape", x: px, y: py, z: 0.08, mag: 0.35 + Math.min(0.3, berm * 0.4), material: extracted.material });
  }
  return (extracted.mass * 1.05 + berm * 0.9) * v.profile.resistanceMul;
}

const BLADE_ENDS = [-1, 1] as const;

/** Scooped mass returns as bodies, split by its yard owners and any unowned share. */
function reactivateScooped(town: Town, v: VehicleContact, x: number, y: number, spawned: number, extracted: ReturnType<Town['pile']['extractDisk']>): void {
  let owned = 0;
  for (const [owner, fraction] of Object.entries(extracted.owners ?? {})) {
    owned += fraction;
    reactivatePileMass(town, x, y, spawned * fraction, extracted.material, v.heading, v.vx, v.vy, owner);
  }
  if (owned < 1 - 1e-6) reactivatePileMass(town, x, y, spawned * (1 - owned), extracted.material, v.heading, v.vx, v.vy);
}

function trimActive(town: Town, focusX: number, focusY: number): void {
  let awakeCount = 0;
  for (const r of town.rubble) if (!r.sleeping) awakeCount++;
  if (awakeCount <= DEBRIS.activeCap) return;
  const awake = town.rubble.filter((r) => !r.sleeping);
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
  contacted.clear();
  const contactPairs = solveBodyContacts(town);

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
    digging: (dozer.throttle ?? 0) > 0 || dozer.vx * Math.cos(dozer.heading) + dozer.vy * Math.sin(dozer.heading) > 0.1,
  };

  let load = dozerBodyLoad(town, dozer, v, events, particles, dt);
  load += interactWithPile(town, v, dozer.bladeDown, events, particles, dt);
  applyVehicleResistance(dozer, dozer.heading, load, profile);
  if (load > 0.35) dozer.lastImpact = Math.max(dozer.lastImpact, 0.05);
  rebuildBodyHash(town);

  for (const car of town.vehicles) if (car.alive && (car.autonomous || Math.hypot(car.vx, car.vy) > .01)) carDebrisContact(town, car, events, particles, dt);

  landingPuffs = 0;
  for (const r of town.rubble) integrateBody(town, r, particles, dt);
  enforceDistanceCleanup(town, dozer.x, dozer.y, contacted);
  trimActive(town, dozer.x, dozer.y);
  recordDebrisStats(town, contactPairs);
  return { load };
}

const activeIds = new Set<number>();
/** This step's candidate pairs, flattened as [a0, b0, a1, b1, ...]; `a` is always awake at collection. */
const pairBodies: Rubble[] = [];
const contactBodies: Rubble[] = [];
/** Bodies shift a few centimetres per solver pass; pairs within this gap are kept for the later passes. */
const PAIR_MARGIN = 0.3;

/**
 * Pairwise body contacts. The broad phase runs once from the awake bodies (sleepers stay in the
 * hash as targets), then a few solver passes relax that pair list. Returns the pairs collected.
 */
function solveBodyContacts(town: Town): number {
  activeIds.clear();
  for (const r of town.rubble) if (!r.sleeping) activeIds.add(r.id);
  if (!activeIds.size) return 0;
  pairBodies.length = 0;
  for (const r of town.rubble) if (!r.sleeping) collectPairs(r);
  for (let iter = 0; iter < DEBRIS.solverIters; iter++) {
    let touching = false;
    for (let i = 0; i < pairBodies.length; i += 2) {
      if (resolveBodies(pairBodies[i]!, pairBodies[i + 1]!) > 0) touching = true;
    }
    if (!touching) break;
  }
  const pairs = pairBodies.length / 2;
  pairBodies.length = 0;
  return pairs;
}

/** Queue each neighbour close enough to touch `r` this step; a pair of awake bodies is queued once, by the lower id. */
function collectPairs(r: Rubble): void {
  const ext = rubbleExtent(r) + PAIR_MARGIN * 0.5;
  bodyHash.query(r.x - ext, r.y - ext, ext * 2, ext * 2, contactBodies);
  const radius = Math.hypot(r.w, r.d) * 0.5 + PAIR_MARGIN;
  for (let i = 0; i < contactBodies.length; i++) {
    const other = contactBodies[i]!;
    if (other.id === r.id || (other.id < r.id && activeIds.has(other.id))) continue;
    const dx = other.x - r.x, dy = other.y - r.y, reach = radius + Math.hypot(other.w, other.d) * 0.5;
    if (dx * dx + dy * dy <= reach * reach) pairBodies.push(r, other);
  }
}

/** Blade, then hull contact with nearby bodies, plus crushing small pieces under the tracks. */
function dozerBodyLoad(town: Town, dozer: Dozer, v: VehicleContact, events: WorldEvent[], particles: ParticlePool, dt: number): number {
  let load = 0;
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
    crushUnderTracks(town, dozer, r, events, particles, dt);
  }
  return load;
}

function crushUnderTracks(town: Town, dozer: Dozer, r: Rubble, events: WorldEvent[], particles: ParticlePool, dt: number): void {
  const dist = Math.hypot(r.x - dozer.x, r.y - dozer.y);
  if (!(dist < DOZER.radius * 0.78 && r.elev + r.thickness * 0.5 < 0.4)) return;
  r.damage += r.crushability * (0.55 + dozerSpeed(dozer) * 0.12) * dt;
  town.pile.compactPoint(r.x, r.y, 0.7 * dt);
  if (r.damage >= 1 && r.crushability > 0.2) {
    events.push({ kind: "crush", x: r.x, y: r.y, z: r.elev, mag: 0.55 + r.mass * 0.2, material: r.material });
    crushBody(town, r, particles);
  }
}

/** A moving road vehicle shoves bodies and drags through pile like a heavy, low-power pusher. */
function carDebrisContact(town: Town, car: Town['vehicles'][number], events: WorldEvent[], particles: ParticlePool, dt: number): void {
  const def=vehicleDefinition(car.definitionId);
  const rp: VehicleProfile = {mass:def.mass,radius:def.width*.5,pushForce:def.drive.push,traction:def.drive.traction,clearance:def.drive.clearance,resistanceMul:2.55};
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

function recordDebrisStats(town: Town, contactPairs: number): void {
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
    pileMass: town.pile.massEstimate(),
  };
}

export function depositSettledParticles(town: Town, particles: ParticlePool): void {
  for (const p of particles.items) {
    if (!p.alive || !p.settled || p.kind === "dust" || p.kind === "crop" || p.kind === "spark") continue;
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
