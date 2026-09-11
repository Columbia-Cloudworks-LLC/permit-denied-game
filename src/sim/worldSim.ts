import { retireStructures } from './retirement';
import { DOZER } from "../game/constants";
import { clamp, len } from "../game/math";
import { ParticlePool } from "../fx/particles";
import {
  applyCellDamage,
  buildingBonus,
  footprintSolid,
  stepStructures,
  type StructureStepStats,
} from "../structure/building";
import { applyFixtureDamage, fixtureSolid, fixtureWorldBox, interiorFloorCoverage, type FixtureFrag } from "../structure/interior";
import { cellPresent, cellWorldBox, type Building, type Cell, type InteriorFixture, type Prop, type WorldEvent } from "../structure/types";
import { bladePoints, clampDozer, dozerSpeed, resolveCircleSolid, type Dozer } from "../vehicle/dozer";
import { clampRoadVehicle, resolveRoadSolid, stepRoadVehicle } from "../vehicle/roadVehicle";
import type { Town } from "../world/town";
import { applyAssetHit, destroyProp, trackFromAsset } from "./assets";
import { addDebrisBody, depositSettledParticles, spawnCollapseDebris, stepDebris } from "./debris";
import { SpatialHash } from "./spatial";
import { ensureCollapsedSite, siteContaining, siteFeel } from "../structure/site";
import { getAsset } from "../world/catalog";
import { roadSurfaceAt, terrainHeightAt } from "../world/roads";

export interface Upgrades {
  blade: number;
  engine: number;
  push: number;
}

export interface SimMetrics {
  buildingsStepped: number;
  buildingsSkipped: number;
  collisionRebuilds: number;
}

export interface SimFrame {
  cash: number;
  score: number;
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
    if (b.retired) { b.collisionDirty = false; continue; }
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

export function spawnFixtureFrags(town: Town, frags: FixtureFrag[]): void {
  for (const frag of frags) {
    if (frag.pileMass) town.pile.addMass(frag.x, frag.y, frag.pileMass, frag.material);
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
  let score = 0;

  const rebuilt = rebuildHash(town);
  hash.query(dozer.x - 3, dozer.y - 3, 6, 6, nearby);

  const bladeMul = 1 + upgrades.blade * 0.42;
  const grind = (dozer.bladeDown ? DOZER.grindDps * (0.65 + (dozer.pushT > 0 ? DOZER.pushGrind : 1)) : DOZER.grindDps * 0.45) * bladeMul;
  const speed = dozerSpeed(dozer);
  const pts = bladePoints(dozer);

  const damaged = new Set<Cell>();

  for (const ref of nearby) {
    if (ref.kind === "cell" && ref.building && ref.cell) {
      const impact = resolveCircleSolid(dozer, ref.x, ref.y, ref.w, ref.d, 0.08);
      if (impact > 0.4) {
        dozer.heat += impact * DOZER.heatImpact * 0.08;
        dozer.track += impact * 0.35;
        if (impact > 1.6) {
          events.push({
            kind: "impact",
            x: dozer.x,
            y: dozer.y,
            z: 0.6,
            mag: Math.min(2.2, impact * 0.35),
          });
        }
        const amt = impact * DOZER.ramScale * 0.35 * bladeMul;
        cash += applyCellDamage(ref.building, ref.cell, amt, dozer.x - (ref.x + ref.w / 2), dozer.y - (ref.y + ref.d / 2), particles, events);
        damaged.add(ref.cell);
      }
    } else if (ref.kind === "prop") {
      const p = ref.prop;
      if (!p || p.broken) continue;
      const impact = resolveCircleSolid(dozer, p.x, p.y, p.w, p.d, 0.05);
      if (impact > 0.25) {
        applyAssetHit(p, impact * 6, dozer.x - (p.x + p.w / 2), dozer.y - (p.y + p.d / 2));
        dozer.track += trackFromAsset(p, speed) * 0.25;
        const def = getAsset(p.assetId);
        if (def.sparks && p.hp < p.maxHp * 0.7) {
          events.push({ kind: "spark", x: p.x + p.w / 2, y: p.y + p.d / 2, z: 0.8, mag: 0.35, material: p.material });
        }
      }
    } else if (ref.kind === "fixture") {
      const fixture = ref.fixture;
      const host = ref.building;
      if (!fixture || !host || fixture.broken) continue;
      const impact = resolveCircleSolid(dozer, ref.x, ref.y, ref.w, ref.d, 0.04);
      if (impact > 0.2) {
        const hit = applyFixtureDamage(
          host,
          fixture,
          impact * 7,
          dozer.x - (ref.x + ref.w / 2),
          dozer.y - (ref.y + ref.d / 2),
          particles,
          events,
        );
        cash += hit.cash;
        spawnFixtureFrags(town, hit.frags);
      }
    }
  }

  for (const pt of pts) {
    hash.query(pt.x - 0.2, pt.y - 0.2, 0.4, 0.4, nearby);
    for (const ref of nearby) {
      if (pt.x < ref.x || pt.y < ref.y || pt.x > ref.x + ref.w || pt.y > ref.y + ref.d) continue;
      if (ref.kind === "cell" && ref.building && ref.cell) {
        if (damaged.has(ref.cell) && !dozer.bladeDown) continue;
        const fx = Math.cos(dozer.heading);
        const fy = Math.sin(dozer.heading);
        const toCx = ref.x + ref.w / 2 - dozer.x;
        const toCy = ref.y + ref.d / 2 - dozer.y;
        const ang = Math.max(0.35, (fx * toCx + fy * toCy) / (len(toCx, toCy) || 1));
        const ram = speed * DOZER.ramScale * ang * bladeMul * dt;
        const g = grind * dt * ang;
        const amt = ram + g;
        const gained = applyCellDamage(ref.building, ref.cell, amt, fx, fy, particles, events);
        cash += gained;
        if (amt > 0.15) {
          dozer.heat += DOZER.heatGrind * dt * (dozer.bladeDown ? 1 : 0.35);
          if (speed > 3) {
            dozer.vx *= 1 - 0.55 * dt;
            dozer.vy *= 1 - 0.55 * dt;
          }
        }
      } else if (ref.kind === "prop") {
        const p = ref.prop;
        if (!p || p.broken) continue;
        applyAssetHit(p, (8 + speed * 4) * bladeMul * dt, Math.cos(dozer.heading), Math.sin(dozer.heading));
        const def = getAsset(p.assetId);
        if (def.sparks && p.hp < p.maxHp * 0.75) {
          events.push({ kind: "spark", x: p.x + p.w / 2, y: p.y + p.d / 2, z: 0.8, mag: 0.3, material: p.material });
        }
      } else if (ref.kind === "fixture") {
        const fixture = ref.fixture;
        const host = ref.building;
        if (!fixture || !host || fixture.broken) continue;
        const hit = applyFixtureDamage(
          host,
          fixture,
          (7 + speed * 3) * bladeMul * dt,
          Math.cos(dozer.heading),
          Math.sin(dozer.heading),
          particles,
          events,
        );
        cash += hit.cash;
        spawnFixtureFrags(town, hit.frags);
      }
    }
  }

  for (const p of town.props) {
    if (p.broken || p.hp > 0) continue;
    const def = getAsset(p.assetId);
    cash += destroyProp(town, p, particles, events, dozer.x, dozer.y);
    dozer.track += trackFromAsset(p, speed);
    if (def.birdGag) birds.push({ x: p.x, y: p.y });
  }

  const structStats: StructureStepStats = { stepped: 0, skipped: 0 };
  const struct = stepStructures(town.buildings, dt, particles, events, structStats);
  cash += struct.cash;
  for (const spawn of struct.rubbleSpawns) {
    spawnCollapseDebris(town, spawn);
  }
  spawnFixtureFrags(town, struct.fixtureFrags);

  ensureBuildingHash(town);
  for (const lean of struct.leans) {
    buildingHash.query(lean.x - 3.2, lean.y - 3.2, 6.4, 6.4, nearbyBuildings);
    for (const other of nearbyBuildings) {
      const right = other.x + other.w * other.cellSize;
      const bot = other.y + other.d * other.cellSize;
      const qx = clamp(lean.x, other.x, right);
      const qy = clamp(lean.y, other.y, bot);
      const dist = len(lean.x - qx, lean.y - qy);
      if (dist > 3.1) continue;
      const toX = (other.x + right) / 2 - lean.x;
      const toY = (other.y + bot) / 2 - lean.y;
      const toward = lean.dx * toX + lean.dy * toY;
      if (toward < -0.4 && dist > 1.4) continue;
      const gx = Math.floor((qx - other.x) / other.cellSize);
      const gy = Math.floor((qy - other.y) / other.cellSize);
      for (const [ox, oy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const cell = other.grid[0]?.[gx + ox]?.[gy + oy];
        if (!cell || !cellPresent(cell)) continue;
        cash += applyCellDamage(other, cell, Math.max(24, lean.mag * 0.85), lean.dx, lean.dy, particles, events);
        const above = other.grid[1]?.[gx + ox]?.[gy + oy];
        if (above && cellPresent(above)) {
          cash += applyCellDamage(other, above, Math.max(16, lean.mag * 0.5), lean.dx, lean.dy, particles, events);
        }
      }
    }
  }

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

  if (retireStructures(town, dozer, dt) > 0) buildingHashTown = null;

  const overSite = siteContaining(town, dozer.x, dozer.y);
  if (overSite) {
    const feel = siteFeel(overSite, dozer.x, dozer.y);
    if (feel > 0.1 && dozerSpeed(dozer) > 1.6) dozer.track += feel * 1.1 * dt;
  }

  const engineMul = 1 + upgrades.engine * 0.28;
  const debris = stepDebris(town, dozer, particles, events, engineMul, dt);

  if (town.roadCar?.alive) {
    stepRoadVehicle(town.roadCar, town, dt);
    hash.query(town.roadCar.x - 2.2, town.roadCar.y - 2.2, 4.4, 4.4, nearby);
    let blocked = false;
    for (const ref of nearby) {
      if (resolveRoadSolid(town.roadCar, ref.x, ref.y, ref.w, ref.d, 0.06) > 0.2) blocked = true;
    }
    if (blocked) town.roadCar.waitT += dt;
    else town.roadCar.waitT = 0;
    clampRoadVehicle(town.roadCar, town.minX + 0.6, town.minY + 0.6, town.maxX - 0.6, town.maxY - 0.6);
    const surf = roadSurfaceAt(town.network, town.roadCar.x, town.roadCar.y, town.roadCar.layer);
    town.roadCar.elev = surf.on ? surf.elev : terrainHeightAt(town.terrain, town.roadCar.x, town.roadCar.y);
  }

  clampDozer(dozer, town.minX + 0.8, town.minY + 0.8, town.maxX - 0.8, town.maxY - 0.8);
  particles.step(dt);
  depositSettledParticles(town, particles);

  for (const e of events) {
    score += e.cash ?? 0;
  }

  return {
    cash,
    score,
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
