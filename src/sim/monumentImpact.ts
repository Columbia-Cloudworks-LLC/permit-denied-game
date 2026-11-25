import type { ParticlePool } from '../fx/particles';
import { distToSegment } from '../game/math';
import { applyCellDamage } from '../structure/building';
import type { MonumentImpact } from '../structure/monument';
import { cellPresent, type WorldEvent } from '../structure/types';
import type { Dozer } from '../vehicle/dozer';
import { vehicleLoad } from '../vehicle/world';
import type { Town } from '../world/town';
import { destroyProp } from './assets';

/** Engine heat and track stress for standing under a statue when it comes down. */
export const MONUMENT_STRIKE = { heat: 22, track: 26, shove: 3.2 } as const;
/** Damage a rolling figure does to each wall cell under it, per step, on the ground floor and the one above. */
export const MONUMENT_ROLL = { ground: 220, upper: 120 } as const;

/**
 * A fallen statue strikes everything along the line it lands on. The dozer takes heat and track
 * stress, full under the middle of the figure and fading to nothing at the edge of the strike,
 * and is shoved clear sideways. A figure that came down on one spot shoves straight outward.
 */
export function applyMonumentImpact(dozer: Dozer, impact: MonumentImpact, events: WorldEvent[]): boolean {
  const distance = distToSegment(dozer.x, dozer.y, impact.x0, impact.y0, impact.x1, impact.y1);
  const reach = impact.radius + 1.2;
  if (distance >= reach) return false;
  const strength = 0.4 + 0.6 * (1 - distance / reach);
  dozer.heat = Math.min(100, dozer.heat + MONUMENT_STRIKE.heat * strength);
  dozer.track = Math.min(100, dozer.track + MONUMENT_STRIKE.track * strength);
  const ax = impact.x1 - impact.x0, ay = impact.y1 - impact.y0, length = Math.hypot(ax, ay);
  if (length > 0.5) {
    // Shove across the fallen figure, away from its centre line.
    const side = (dozer.x - impact.x0) * -ay + (dozer.y - impact.y0) * ax >= 0 ? 1 : -1;
    dozer.vx += (-ay / length) * side * MONUMENT_STRIKE.shove * strength;
    dozer.vy += (ax / length) * side * MONUMENT_STRIKE.shove * strength;
  } else {
    const ox = dozer.x - impact.x1, oy = dozer.y - impact.y1, away = Math.hypot(ox, oy);
    dozer.vx += (away > 0.01 ? ox / away : 0) * MONUMENT_STRIKE.shove * strength;
    dozer.vy += (away > 0.01 ? oy / away : 1) * MONUMENT_STRIKE.shove * strength;
  }
  dozer.lastImpact = 0.4;
  events.push({ kind: 'collapse', x: dozer.x, y: dozer.y, z: 0, mag: 1.2 + strength });
  return true;
}

/**
 * One step of a rolling figure: it flattens the props under it, pushes through the walls of any
 * other building in its way, loads the traffic it rolls over, and runs the dozer down once.
 * Returns the cash those wrecks pay.
 */
export function applyMonumentRoll(town: Town, dozer: Dozer, impact: MonumentImpact, particles: ParticlePool, events: WorldEvent[]): number {
  const { x1: x, y1: y, radius } = impact, source = impact.building;
  const ax = impact.x1 - impact.x0, ay = impact.y1 - impact.y0, length = Math.hypot(ax, ay) || 1;
  const nx = ax / length, ny = ay / length;
  let cash = 0;
  for (const prop of town.props) {
    if (prop.broken || Math.hypot(prop.x + prop.w / 2 - x, prop.y + prop.d / 2 - y) > radius) continue;
    cash += destroyProp(town, prop, particles, events, x, y);
  }
  for (const other of town.buildings) {
    if (other === source || other.retired) continue;
    const w = other.w * other.cellSize, d = other.d * other.cellSize;
    if (x < other.x - radius || y < other.y - radius || x > other.x + w + radius || y > other.y + d + radius) continue;
    for (const cell of other.cells) {
      if (cell.floor > 1 || !cellPresent(cell)) continue;
      const cx = other.x + (cell.gx + 0.5) * other.cellSize, cy = other.y + (cell.gy + 0.5) * other.cellSize;
      if (Math.hypot(cx - x, cy - y) > radius) continue;
      cash += applyCellDamage(other, cell, cell.floor ? MONUMENT_ROLL.upper : MONUMENT_ROLL.ground, nx, ny, particles, events);
    }
  }
  vehicleLoad(town, x, y, 100, radius, 5, `roll:${source.id}`);
  const state = source.monument;
  if (state && !state.struck && applyMonumentImpact(dozer, impact, events)) state.struck = true;
  return cash;
}
