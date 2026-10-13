import { stepVehicleWorld, migrateVehicles } from '../vehicle/world';
import { upgradeModifiers, type Upgrades } from '../game/upgrades';
export type { Upgrades } from '../game/upgrades';
import { applyCoreImpact } from './coreImpact';
import { resistCorePile } from './corePileResistance';
import { retireStructures } from './retirement';
import { DEBRIS, DOZER } from "../game/constants";
import { clamp, len } from "../game/math";
import { ParticlePool } from "../fx/particles";
import {
  applyCellDamage,
  buildingBonus,
  footprintSolid,
  stepStructures,
  type StructureStepResult,
  type StructureStepStats,
} from "../structure/building";
import { applyFixtureDamage, fixtureSolid, fixtureWorldBox, interiorFloorCoverage, type FixtureFrag } from "../structure/interior";
import { cellPresent, cellWorldBox, type Building, type Cell, type InteriorFixture, type Prop, type WorldEvent } from "../structure/types";
import { bladePoints, clampDozer, dozerForward, dozerSpeed, resolveCircleSolid, type Dozer } from "../vehicle/dozer";
import { stepRoadVehicle } from "../vehicle/roadVehicle";
import type { Town } from "../world/town";
import { applyAssetHit, destroyProp, trackFromAsset } from "./assets";
import { addDebrisBody, depositSettledParticles, spawnCollapseDebris, stepDebris } from "./debris";
import { SpatialHash } from "./spatial";
import { ensureCollapsedSite, siteContaining, siteFeel } from "../structure/site";
import { getAsset } from "../world/catalog";
import {
  CHURN_SWATH,
  CHURN_TRACK,
  FIELD_CROP_FRAGS_PER_TICK,
  FIELD_SOUNDS_PER_SEC,
  FIELD_SWATH_RADIUS,
  FIELD_TRACK_RADIUS,
  FIELD_TRACK_SEP,
  cropFragmentColor,
  payFieldDamage,
} from "../world/fields";
import { emitDozerCues } from "./dozerCues";
import { churnFieldAt, movementBlocked, resolveTraversal, terrainTraversalAt, type FieldFeature } from "../world/terrainFeatures";
import { standingCrop } from "../world/season";
import { leaveSeasonalTrack } from "../world/seasonTracks";



export interface SimMetrics {
  buildingsStepped: number;
  buildingsSkipped: number;
  collisionRebuilds: number;
}

export interface SimFrame {
  cash: number;
  events: WorldEvent[];
  birds: { x: number; y: number }[];
  debrisLoad: number;
  metrics: SimMetrics;
}

interface SolidRef {
  kind: "cell" | "prop" | "fixture";
  building?: Building;
  cell?: Cell;
  prop?: Prop;
  fixture?: InteriorFixture;
  x: number;
  y: number;
  w: number;
  d: number;
}

const nearby: SolidRef[] = [];
const hash = new SpatialHash<SolidRef>(2.4);
const buildingHash = new SpatialHash<Building>(8);
const nearbyBuildings: Building[] = [];
let hashedTown: Town | null = null;
let hashValid = false;
let propsBrokenStamp = -1;
let buildingHashTown: Town | null = null;
let cropSoundCredit = 0;

/** Editing changes membership as well as damage; invalidate both broad phases. */
export function invalidateWorldCollision(): void {
  hashValid = false;
  buildingHashTown = null;
  nearby.length = 0;
  nearbyBuildings.length = 0;
}

function collisionNeedsRebuild(town: Town): boolean {
  if (hashedTown !== town || !hashValid) return true;
  if (town.buildings.some((b) => b.collisionDirty)) return true;
  let broken = 0;
  for (const p of town.props) if (p.broken) broken++;
  return broken !== propsBrokenStamp;
}

function rebuildHash(town: Town): boolean {
  if (!collisionNeedsRebuild(town)) return false;
  hash.clear();
  for (const b of town.buildings) {
    if (!b.retired) hashBuilding(b);
    b.collisionDirty = false;
  }
  let broken = 0;
  for (const p of town.props) {
    if (p.broken) {
      broken++;
      continue;
    }
    const ref: SolidRef = { kind: "prop", prop: p, x: p.x, y: p.y, w: p.w, d: p.d };
    hash.insert(p.x, p.y, p.w, p.d, ref);
  }
  hashedTown = town;
  hashValid = true;
  propsBrokenStamp = broken;
  return true;
}

/** Solid ground-floor cells and standing ground-floor fixtures. */
function hashBuilding(b: Building): void {
  for (let gx = 0; gx < b.w; gx++) {
    for (let gy = 0; gy < b.d; gy++) {
      if (!footprintSolid(b, gx, gy)) continue;
      const cell = b.grid[0]![gx]![gy]!;
      const box = cellWorldBox(b, cell);
      const ref: SolidRef = { kind: "cell", building: b, cell, ...box };
      hash.insert(box.x, box.y, box.w, box.d, ref);
    }
  }
  const coverage = b.fixtures.some(f => f.floor === 0 && !f.broken) ? interiorFloorCoverage(b) : undefined;
  for (const fixture of b.fixtures) {
    if (!fixtureSolid(b, fixture, coverage)) continue;
    const box = fixtureWorldBox(fixture);
    hash.insert(box.x, box.y, box.w, box.d, { kind: "fixture", building: b, fixture, ...box });
  }
}

export function spawnFixtureFrags(town: Town, frags: FixtureFrag[], bodyLimit = Infinity): void {
  for (const frag of frags) {
    if (frag.pileMass) town.pile.addMass(frag.x, frag.y, frag.pileMass, frag.material);
    if (town.rubble.length >= bodyLimit) {
      town.pile.addMass(frag.x, frag.y, frag.mass, frag.material);
      continue;
    }
    addDebrisBody(town, {
      x: frag.x,
      y: frag.y,
      w: frag.w,
      d: frag.d,
      material: frag.material,
      layer: frag.layer,
      shape: frag.shape,
      elev: frag.elev,
      mass: frag.mass,
      vx: frag.vx,
      vy: frag.vy,
    });
  }
}

function ensureBuildingHash(town: Town): void {
  if (buildingHashTown === town) return;
  buildingHash.clear();
  for (const b of town.buildings) {
    if (b.retired) continue;
    buildingHash.insert(b.x, b.y, b.w * b.cellSize, b.d * b.cellSize, b);
  }
  buildingHashTown = town;
}

/** Per-step dozer contact inputs shared by the contact passes. */
interface DozerContact {
  town: Town;
  dozer: Dozer;
  particles: ParticlePool;
  events: WorldEvent[];
  bladeMul: number;
  grind: number;
  speed: number;
  dt: number;
  damaged: Set<Cell>;
  dozerPins: Set<Prop>;
}

export function stepWorld(
  town: Town,
  dozer: Dozer,
  particles: ParticlePool,
  upgrades: Upgrades,
  dt: number,
): SimFrame {
  const events: WorldEvent[] = [];
  const birds: { x: number; y: number }[] = [];
  let cash = 0;

  resistCorePile(town, dozer, dt);

  migrateVehicles(town);
  const rebuilt = rebuildHash(town);
  hash.query(dozer.x - 3, dozer.y - 3, 6, 6, nearby);

  const { bladeMul, engineMul } = upgradeModifiers(upgrades);
  const contact = prepareContact(town, dozer, particles, events, bladeMul, dt);
  const pts = bladePoints(dozer);

  for (const ref of nearby) cash += bodyContact(contact, ref);
  for (const pt of pts) cash = bladePointContacts(contact, pt, cash);
  cash = clearDestroyedProps(contact, birds, cash);

  const structStats: StructureStepStats = { stepped: 0, skipped: 0 };
  cash = settleStructures(town, dozer, particles, events, dt, structStats, cash);

  if (retireStructures(town, dozer, dt) > 0) buildingHashTown = null;
  roughenOverCollapsedSite(town, dozer, dt);

  const debris = stepDebris(town, dozer, particles, events, engineMul, dt);

  const roadCar = town.roadCar;
  if(roadCar?.roadDemo && roadCar.autonomous && !roadCar.waypoints.length && roadCar.status==='operational') stepRoadVehicle(roadCar,town,0);
  cash += stepVehicleWorld(town,dozer,particles,events,dt,bladeMul);

  clampDozer(dozer, town.minX + 0.8, town.minY + 0.8, town.maxX - 0.8, town.maxY - 0.8);
  if (town.surface || town.features.length) cash = dozerOnTerrain(town, dozer, particles, events, dt, cash);
  emitDozerCues(town, dozer, particles, events, dt);
  particles.step(dt);
  depositSettledParticles(town, particles);

  return {
    cash,
    events,
    birds,
    debrisLoad: debris.load,
    metrics: {
      buildingsStepped: structStats.stepped,
      buildingsSkipped: structStats.skipped,
      collisionRebuilds: rebuilt ? 1 : 0,
    },
  };
}

/** Blade point contact with every solid it sits inside. */
function bladePointContacts(c: DozerContact, pt: { x: number; y: number }, cash: number): number {
  hash.query(pt.x - 0.2, pt.y - 0.2, 0.4, 0.4, nearby);
  for (const ref of nearby) {
    if (pt.x < ref.x || pt.y < ref.y || pt.x > ref.x + ref.w || pt.y > ref.y + ref.d) continue;
    cash += bladeContact(c, ref);
  }
  return cash;
}

/** Props worn to zero hp break apart, pay out, wear the tracks, and may scare up birds. */
function clearDestroyedProps(c: DozerContact, birds: { x: number; y: number }[], cash: number): number {
  const { town, dozer, particles, events } = c;
  for (const p of town.props) {
    if (p.broken || p.hp > 0) continue;
    const def = getAsset(p.assetId);
    cash += destroyProp(town, p, particles, events, dozer.x, dozer.y);
    if (c.dozerPins.has(p)) events.push({ kind: 'bowling-strike', x: p.x, y: p.y, z: .5, mag: 1 });
    dozer.track += trackFromAsset(p, c.speed);
    if (def.birdGag) birds.push({ x: p.x, y: p.y });
  }
  return cash;
}

/** Step every structure, hand their rubble to debris, lean falling cells into neighbours, and pay bonuses. */
function settleStructures(town: Town, dozer: Dozer, particles: ParticlePool, events: WorldEvent[], dt: number, structStats: StructureStepStats, cash: number): number {
  const struct = stepStructures(town.buildings, dt, particles, events, structStats);
  cash += struct.cash;
  for (const impact of struct.coreImpacts) applyCoreImpact(town, dozer, particles, impact, events);
  const bodyLimit = struct.rubbleSpawns.length + struct.fixtureFrags.length > 32 ? DEBRIS.activeCap : Infinity;
  for (const spawn of struct.rubbleSpawns) {
    spawnCollapseDebris(town, spawn, spawn.aggregate ? DEBRIS.activeCap : bodyLimit);
  }
  spawnFixtureFrags(town, struct.fixtureFrags, bodyLimit);

  ensureBuildingHash(town);
  for (const lean of struct.leans) {
    buildingHash.query(lean.x - 3.2, lean.y - 3.2, 6.4, 6.4, nearbyBuildings);
    for (const other of nearbyBuildings) cash = leanInto(other, lean, particles, events, cash);
  }
  return payCollapseBonuses(town, events, cash);
}

/** Driving fast over a collapsed site's rough ground wears the tracks. */
function roughenOverCollapsedSite(town: Town, dozer: Dozer, dt: number): void {
  const overSite = siteContaining(town, dozer.x, dozer.y);
  if (!overSite) return;
  const feel = siteFeel(overSite, dozer.x, dozer.y);
  if (feel > 0.1 && dozerSpeed(dozer) > 1.6) dozer.track += feel * 1.1 * dt;
}

/** Reused every step so the contact passes allocate nothing beyond the original hit sets. */
const contactScratch = { bladeMul: 0, grind: 0, speed: 0, dt: 0 } as DozerContact;

function prepareContact(town: Town, dozer: Dozer, particles: ParticlePool, events: WorldEvent[], bladeMul: number, dt: number): DozerContact {
  const c = contactScratch;
  c.town = town;
  c.dozer = dozer;
  c.particles = particles;
  c.events = events;
  c.bladeMul = bladeMul;
  c.dt = dt;
  c.grind = (dozer.bladeDown ? DOZER.grindDps * (0.65 + (dozer.pushT > 0 ? DOZER.pushGrind : 1)) : DOZER.grindDps * 0.45) * bladeMul;
  c.speed = dozerSpeed(dozer);
  c.damaged = new Set<Cell>();
  c.dozerPins = new Set<Prop>();
  return c;
}

/** The dozer body shoves into a nearby solid; returns cash earned. */
function bodyContact(c: DozerContact, ref: SolidRef): number {
  if (ref.kind === "cell") return ramCell(c, ref);
  if (ref.kind === "prop") {
    bumpProp(c, ref.prop);
    return 0;
  }
  const fixture = ref.fixture;
  const host = ref.building;
  if (!fixture || !host || fixture.broken) return 0;
  const impact = resolveCircleSolid(c.dozer, ref.x, ref.y, ref.w, ref.d, 0.04);
  if (impact <= 0.2) return 0;
  const hit = applyFixtureDamage(host, fixture, impact * 7, c.dozer.x - (ref.x + ref.w / 2), c.dozer.y - (ref.y + ref.d / 2), c.particles, c.events, true);
  spawnFixtureFrags(c.town, hit.frags);
  return hit.cash;
}

/** Ramming a wall cell: heat, track wear, a thump on hard hits, and damage scaled by impact. */
function ramCell(c: DozerContact, ref: SolidRef): number {
  const { dozer } = c;
  if (!ref.building || !ref.cell) return 0;
  const impact = resolveCircleSolid(dozer, ref.x, ref.y, ref.w, ref.d, 0.08);
  if (impact <= 0.4) return 0;
  dozer.heat += impact * DOZER.heatImpact * 0.08;
  dozer.track += impact * 0.35;
  if (impact > 1.6) {
    c.events.push({
      kind: "impact",
      x: dozer.x,
      y: dozer.y,
      z: 0.6,
      mag: Math.min(2.2, impact * 0.35),
    });
  }
  const amt = impact * DOZER.ramScale * 0.35 * c.bladeMul;
  const gained = applyCellDamage(ref.building, ref.cell, amt, dozer.x - (ref.x + ref.w / 2), dozer.y - (ref.y + ref.d / 2), c.particles, c.events);
  c.damaged.add(ref.cell);
  return gained;
}

function bumpProp(c: DozerContact, p: Prop | undefined): void {
  const { dozer } = c;
  if (!p || p.broken) return;
  const impact = resolveCircleSolid(dozer, p.x, p.y, p.w, p.d, 0.05);
  if (impact <= 0.25) return;
  if (p.assetId === 'interior-bowling-pins') c.dozerPins.add(p);
  applyAssetHit(p, impact * 6, dozer.x - (p.x + p.w / 2), dozer.y - (p.y + p.d / 2));
  dozer.track += trackFromAsset(p, c.speed) * 0.25;
  const def = getAsset(p.assetId);
  if (def.sparks && p.hp < p.maxHp * 0.7) {
    c.events.push({ kind: "spark", x: p.x + p.w / 2, y: p.y + p.d / 2, z: 0.8, mag: 0.35, material: p.material });
  }
}

/** The blade edge grinds whatever solid a blade point is inside; returns cash earned. */
function bladeContact(c: DozerContact, ref: SolidRef): number {
  if (ref.kind === "cell") return grindCell(c, ref);
  const { dozer, speed } = c;
  if (ref.kind === "prop") {
    grindProp(c, ref.prop);
    return 0;
  }
  const fixture = ref.fixture;
  const host = ref.building;
  if (!fixture || !host || fixture.broken) return 0;
  const hit = applyFixtureDamage(host, fixture, (7 + speed * 3) * c.bladeMul * c.dt, Math.cos(dozer.heading), Math.sin(dozer.heading), c.particles, c.events, true);
  spawnFixtureFrags(c.town, hit.frags);
  return hit.cash;
}

/** Ram plus grind, weighted by how squarely the cell sits ahead; heavy work heats and slows the dozer. */
function grindCell(c: DozerContact, ref: SolidRef): number {
  const { dozer, speed, dt } = c;
  if (!ref.building || !ref.cell) return 0;
  if (c.damaged.has(ref.cell) && !dozer.bladeDown) return 0;
  const fx = Math.cos(dozer.heading);
  const fy = Math.sin(dozer.heading);
  const toCx = ref.x + ref.w / 2 - dozer.x;
  const toCy = ref.y + ref.d / 2 - dozer.y;
  const ang = Math.max(0.35, (fx * toCx + fy * toCy) / (len(toCx, toCy) || 1));
  const ram = speed * DOZER.ramScale * ang * c.bladeMul * dt;
  const g = c.grind * dt * ang;
  const amt = ram + g;
  const gained = applyCellDamage(ref.building, ref.cell, amt, fx, fy, c.particles, c.events);
  if (amt > 0.15) {
    dozer.heat += DOZER.heatGrind * dt * (dozer.bladeDown ? 1 : 0.35);
    if (speed > 3) {
      dozer.vx *= 1 - 0.55 * dt;
      dozer.vy *= 1 - 0.55 * dt;
    }
  }
  return gained;
}

function grindProp(c: DozerContact, p: Prop | undefined): void {
  const { dozer, speed } = c;
  if (!p || p.broken) return;
  if (p.assetId === 'interior-bowling-pins') c.dozerPins.add(p);
  applyAssetHit(p, (8 + speed * 4) * c.bladeMul * c.dt, Math.cos(dozer.heading), Math.sin(dozer.heading));
  const def = getAsset(p.assetId);
  if (def.sparks && p.hp < p.maxHp * 0.75) {
    c.events.push({ kind: "spark", x: p.x + p.w / 2, y: p.y + p.d / 2, z: 0.8, mag: 0.3, material: p.material });
  }
}

const LEAN_SPLASH: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** A falling cell leans into a neighbouring building within 3.1 units, damaging the cells it lands on. */
function leanInto(other: Building, lean: StructureStepResult["leans"][number], particles: ParticlePool, events: WorldEvent[], cash: number): number {
  const right = other.x + other.w * other.cellSize;
  const bot = other.y + other.d * other.cellSize;
  const qx = clamp(lean.x, other.x, right);
  const qy = clamp(lean.y, other.y, bot);
  const dist = len(lean.x - qx, lean.y - qy);
  if (dist > 3.1) return cash;
  const toX = (other.x + right) / 2 - lean.x;
  const toY = (other.y + bot) / 2 - lean.y;
  const toward = lean.dx * toX + lean.dy * toY;
  if (toward < -0.4 && dist > 1.4) return cash;
  const gx = Math.floor((qx - other.x) / other.cellSize);
  const gy = Math.floor((qy - other.y) / other.cellSize);
  for (const [ox, oy] of LEAN_SPLASH) {
    const cell = other.grid[0]?.[gx + ox]?.[gy + oy];
    if (!cell || !cellPresent(cell)) continue;
    cash += applyCellDamage(other, cell, Math.max(24, lean.mag * 0.85), lean.dx, lean.dy, particles, events);
    const above = other.grid[1]?.[gx + ox]?.[gy + oy];
    if (above && cellPresent(above)) {
      cash += applyCellDamage(other, above, Math.max(16, lean.mag * 0.5), lean.dx, lean.dy, particles, events);
    }
  }
  return cash;
}

/** Each fully-down building leaves a collapsed site and pays its bonus once. */
function payCollapseBonuses(town: Town, events: WorldEvent[], cash: number): number {
  for (const b of town.buildings) {
    if (!b.fullyDown) continue;
    ensureCollapsedSite(town, b);
    if (b.collapseBonusPaid) continue;
    b.collapseBonusPaid = true;
    const bonus = buildingBonus(b);
    cash += bonus;
    events.push({
      kind: "cash",
      x: b.x + (b.w * b.cellSize) / 2,
      y: b.y + (b.d * b.cellSize) / 2,
      z: 2,
      mag: 2.2,
      cash: bonus,
    });
  }
  return cash;
}

/** Keep the dozer out of water and forest cores, leave seasonal tracks, and flatten crops. */
function dozerOnTerrain(town: Town, dozer: Dozer, particles: ParticlePool, events: WorldEvent[], dt: number, cash: number): number {
  const pins = [
    { x: dozer.x, y: dozer.y },
    { x: dozer.x + Math.cos(dozer.heading) * DOZER.radius, y: dozer.y + Math.sin(dozer.heading) * DOZER.radius },
    { x: dozer.x - Math.cos(dozer.heading) * DOZER.radius * 0.6, y: dozer.y - Math.sin(dozer.heading) * DOZER.radius * 0.6 },
  ];
  if (pins.some((pin) => movementBlocked(terrainTraversalAt(town.features, pin.x, pin.y, town.surface), town.season))) {
    const startX = dozer.motionStartX ?? dozer.x;
    const startY = dozer.motionStartY ?? dozer.y;
    const resolved = resolveTraversal(dozer.x, dozer.y, startX, startY, town.features, town.surface, town.season);
    dozer.x = resolved.x;
    dozer.y = resolved.y;
    if (resolved.blocked) {
      dozer.vx *= 0.28;
      dozer.vy *= 0.28;
    }
  }
  if (dozerSpeed(dozer) > 1.15) leaveSeasonalTrack(town, dozer.x, dozer.y, dozer.heading);
  if (town.features.some((feature) => feature.kind === "field")) {
    cash += flattenCrops(town, dozer, particles, events, dt);
  }
  return cash;
}

function cropTrackPoints(dozer: Dozer): { x: number; y: number }[] {
  const f = dozerForward(dozer);
  const rx = -f.y;
  const ry = f.x;
  return [
    { x: dozer.x + rx * FIELD_TRACK_SEP, y: dozer.y + ry * FIELD_TRACK_SEP },
    { x: dozer.x - rx * FIELD_TRACK_SEP, y: dozer.y - ry * FIELD_TRACK_SEP },
  ];
}

function flattenCrops(
  town: Town,
  dozer: Dozer,
  particles: ParticlePool,
  events: WorldEvent[],
  dt: number,
): number {
  const bladeDown = dozer.bladeDown;
  const points = bladeDown ? bladePoints(dozer) : cropTrackPoints(dozer);
  const radius = bladeDown ? FIELD_SWATH_RADIUS : FIELD_TRACK_RADIUS;
  const mark = bladeDown ? CHURN_SWATH : CHURN_TRACK;
  cropSoundCredit = Math.min(FIELD_SOUNDS_PER_SEC, cropSoundCredit + FIELD_SOUNDS_PER_SEC * dt);
  let cash = 0;
  let frags = 0;
  let flattened = 0;
  for (const feature of town.features) {
    if (feature.kind !== "field") continue;
    const newly = churnPoints(feature, points, radius, mark);
    if (newly <= 0) continue;
    flattened += newly;
    const wasCleared = !!feature.cleared;
    cash += payFieldDamage(feature, newly);
    frags += cropFragments(feature, newly, frags, dozer, particles);
    cropFeedback(feature, wasCleared, dozer, events);
  }
  if (flattened > 0) {
    town.featureRevision += 1;
    particles.burst("dust", dozer.x, dozer.y, 0.22, 0.28 + Math.min(0.2, flattened * 0.01));
  }
  return cash;
}

function churnPoints(feature: FieldFeature, points: readonly { x: number; y: number }[], radius: number, mark: number): number {
  let newly = 0;
  for (const point of points) newly += churnFieldAt(feature, point.x, point.y, radius, mark);
  return newly;
}

/** Crop bits thrown from a standing field, capped per tick; returns how many were thrown. */
function cropFragments(feature: FieldFeature, newly: number, frags: number, dozer: Dozer, particles: ParticlePool): number {
  const take = Math.min(FIELD_CROP_FRAGS_PER_TICK - frags, Math.min(4, 1 + Math.floor(newly / 6)));
  if (take <= 0 || !standingCrop(feature.state)) return 0;
  particles.cropFrags(dozer.x, dozer.y, 0.32, take, cropFragmentColor(feature.crop));
  return take;
}

/** A rate-limited crush sound, and a cash pop when this pass clears a standing field. */
function cropFeedback(feature: FieldFeature, wasCleared: boolean, dozer: Dozer, events: WorldEvent[]): void {
  if (cropSoundCredit >= 1) {
    cropSoundCredit -= 1;
    events.push({ kind: "crush", x: dozer.x, y: dozer.y, z: 0.2, mag: dozer.bladeDown ? 0.38 : 0.22 });
  }
  if (!wasCleared && feature.cleared && standingCrop(feature.state)) {
    events.push({ kind: "cash", x: dozer.x, y: dozer.y, z: 0.4, mag: 1.2, cash: Math.max(1, Math.floor((feature.value ?? 0) * 0.2)) });
  }
}
