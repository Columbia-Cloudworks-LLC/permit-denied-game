import { EXPLODE } from "../game/constants";
import { len, norm } from "../game/math";
import { ParticlePool, debrisKind } from "../fx/particles";
import type { Prop, WorldEvent } from "../structure/types";
import { getAsset, type AssetDef } from "../world/catalog";
import type { Town } from "../world/town";
import { addDebrisBody, spawnPropDebris } from "./debris";

export function applyAssetHit(prop: Prop, amount: number, nx: number, ny: number): void {
  const def = getAsset(prop.assetId);
  prop.hp -= amount * def.bladeMul;
  const dir = len(nx, ny) || 1;
  if (def.destruction === "bend-snap" || def.destruction === "topple") {
    prop.pose.lean = Math.min(1, prop.pose.lean + amount * 0.08);
    prop.pose.leanX = nx / dir;
    prop.pose.leanY = ny / dir;
  }
  if (def.destruction === "crush") {
    prop.pose.crush = Math.min(0.7, prop.pose.crush + amount * 0.05);
  }
}

export function destroyProp(
  town: Town,
  prop: Prop,
  particles: ParticlePool,
  events: WorldEvent[],
  impactX: number,
  impactY: number,
  generation = 0,
): number {
  if (prop.broken) return 0;
  const def = getAsset(prop.assetId);
  prop.broken = true;
  prop.hp = 0;
  const cx = prop.x + prop.w * 0.5;
  const cy = prop.y + prop.d * 0.5;
  const [nx, ny] = norm(cx - impactX, cy - impactY);
  particles.burst(debrisKind(def.material), cx, cy, 0.8 + def.footprint.h * 0.15, 0.7 + def.debris.particles * 0.08);
  if (def.sparks) {
    events.push({ kind: "spark", x: cx, y: cy, z: 0.9, mag: 0.55, material: def.material });
    particles.burst("metal", cx, cy, 1.1, 0.8);
  }
  let cash = def.cash;
  if (def.birdGag) {
    events.push({ kind: "bird", x: cx, y: cy, z: 2.2, mag: 0.4, cash });
  } else if (def.destruction === "explosive") {
    events.push({ kind: "blast", x: cx, y: cy, z: 0.9, mag: 1.4, cash, material: def.material });
  } else {
    events.push({ kind: "snap", x: cx, y: cy, z: 0.8, mag: 0.5, cash });
  }
  spawnFromRecipe(town, prop, def, nx, ny);
  if (def.destruction === "explosive" && generation <= EXPLODE.maxGeneration) {
    cash += applyExplosion(town, cx, cy, def, particles, events, generation);
  }
  return cash;
}

function spawnFromRecipe(town: Town, prop: Prop, def: AssetDef, nx: number, ny: number): void {
  const cx = prop.x + prop.w * 0.5;
  const cy = prop.y + prop.d * 0.5;
  if (def.destruction === "crush" && def.debris.pileMass > 0.2) {
    town.pile.addMass(cx, cy, def.debris.pileMass, def.material);
  }
  if (def.destruction === "brittle" && def.debris.remnants === 0) {
    spawnPropDebris(town, prop.x, prop.y, Math.max(0.25, prop.w * 0.5), Math.max(0.2, prop.d * 0.5), def.material);
    return;
  }
  const remnantW =
    def.destruction === "topple" || def.destruction === "panel-collapse"
      ? Math.max(0.55, def.footprint.h * def.debris.remnantScale * 0.55)
      : Math.max(0.28, prop.w * def.debris.remnantScale * 0.7);
  const remnantD =
    def.destruction === "topple" ? Math.max(0.28, prop.d * 0.7) : Math.max(0.2, prop.d * def.debris.remnantScale * 0.65);
  for (let i = 0; i < def.debris.remnants; i++) {
    const along = def.destruction === "topple" ? 0.6 + i * 0.35 : (i - 0.3) * 0.2;
    addDebrisBody(town, {
      x: cx + nx * along,
      y: cy + ny * along,
      w: remnantW,
      d: remnantD,
      material: def.material,
      layer: "remnant",
      heading: Math.atan2(ny, nx) + (def.destruction === "panel-collapse" ? 0.2 : 0),
      vx: nx * (def.destruction === "roll" ? 2.4 : 0.8),
      vy: ny * (def.destruction === "roll" ? 2.4 : 0.8),
      mass: Math.max(0.25, def.mass * 0.45),
      shape: def.debris.shape,
    });
  }
  for (let i = 0; i < def.debris.fragments; i++) {
    addDebrisBody(town, {
      x: cx + (i % 2 === 0 ? 0.15 : -0.15),
      y: cy + (i > 0 ? 0.12 : -0.1),
      w: 0.2,
      d: 0.14,
      material: def.material,
      layer: "fragment",
      vx: nx * 1.2 + (i - 0.5),
      vy: ny * 1.2,
      mass: 0.18,
    });
  }
}

export function applyExplosion(
  town: Town,
  x: number,
  y: number,
  source: AssetDef,
  particles: ParticlePool,
  events: WorldEvent[],
  generation: number,
): number {
  const radius = source.explodeRadius || EXPLODE.radius;
  const damage = source.explodeDamage || EXPLODE.damage;
  const impulse = source.explodeImpulse || EXPLODE.impulse;
  particles.burst("dust", x, y, 0.6, 1.4);
  particles.burst("metal", x, y, 0.8, 1.1);
  let cash = 0;
  for (const other of town.props) {
    if (other.broken) continue;
    const ox = other.x + other.w * 0.5;
    const oy = other.y + other.d * 0.5;
    const dist = len(ox - x, oy - y);
    if (dist > radius || dist < 1e-4) continue;
    const falloff = 1 - dist / radius;
    other.hp -= damage * falloff;
    other.vx += ((ox - x) / dist) * impulse * falloff;
    other.vy += ((oy - y) / dist) * impulse * falloff;
    if (other.hp <= 0) {
      const def = getAsset(other.assetId);
      if (def.destruction === "explosive" && generation >= EXPLODE.maxGeneration) {
        other.broken = true;
        other.hp = 0;
        cash += def.cash * 0.5;
        spawnFromRecipe(town, other, def, (ox - x) / dist, (oy - y) / dist);
        events.push({ kind: "snap", x: ox, y: oy, z: 0.7, mag: 0.4, cash: def.cash * 0.5 });
      } else {
        cash += destroyProp(town, other, particles, events, x, y, generation + 1);
      }
    }
  }
  for (const r of town.rubble) {
    const dist = len(r.x - x, r.y - y);
    if (dist > radius || dist < 1e-4) continue;
    const falloff = 1 - dist / radius;
    r.vx += ((r.x - x) / dist) * impulse * falloff * 1.4;
    r.vy += ((r.y - y) / dist) * impulse * falloff * 1.4;
    r.sleeping = false;
    r.touchedAt = 0;
  }
  return cash;
}

export function trackFromAsset(prop: Prop, speed: number): number {
  const def = getAsset(prop.assetId);
  if (def.trackHazard <= 0) return 0;
  return speed > 5.5 ? def.trackHazard * 34 : def.trackHazard * 10;
}
