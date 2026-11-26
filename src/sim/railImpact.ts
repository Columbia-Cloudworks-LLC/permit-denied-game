import type { ParticlePool } from '../fx/particles';
import { distToSegment } from '../game/math';
import { applyCellDamage } from '../structure/building';
import { cellPresent, type WorldEvent } from '../structure/types';
import { vehicleDefinition } from '../vehicle/definitions';
import { ferryLeadingSide } from '../vehicle/ferry';
import { FERRY, RAIL } from '../vehicle/runtime';
import type { VehicleState } from '../vehicle/types';
import type { Town } from '../world/town';
import { destroyProp } from './assets';
import { MONORAIL } from './monorail';

/**
 * A derailed rail car that slid into a wall breaks the ground-floor cells round the spot it
 * struck, harder the heavier and faster it was. A drifting ferry that ran onto a shore does the
 * same along the whole side it grounded on. Returns the cash that damage pays.
 */
export function applyRailHits(town: Town, particles: ParticlePool, events: WorldEvent[]): number {
  let cash = 0;
  for (const v of town.vehicles) {
    if (v.afloat?.hit) cash += applyFerryHit(town, v, particles, events);
    const hit = v.rail?.hit;
    if (!hit) continue;
    v.rail!.hit = undefined;
    const amount = hit.impulse * vehicleDefinition(v.definitionId).mass * RAIL.wall;
    cash += breakGroundFloor(town, hit.x, hit.y, hit.x, hit.y, RAIL.reach, amount, hit.nx, hit.ny, particles, events);
    events.push({ kind: 'impact', x: hit.x, y: hit.y, z: 0.6, mag: Math.min(2, hit.impulse * 0.3) });
  }
  return cash;
}

/** Damage every standing ground-floor cell within `reach` of the line, pushed along (`nx`, `ny`). */
function breakGroundFloor(town: Town, x0: number, y0: number, x1: number, y1: number, reach: number, amount: number, nx: number, ny: number, particles: ParticlePool, events: WorldEvent[]): number {
  let cash = 0;
  const minX = Math.min(x0, x1) - reach, maxX = Math.max(x0, x1) + reach, minY = Math.min(y0, y1) - reach, maxY = Math.max(y0, y1) + reach;
  for (const b of town.buildings) {
    if (b.retired) continue;
    const w = b.w * b.cellSize, d = b.d * b.cellSize;
    if (maxX < b.x || maxY < b.y || minX > b.x + w || minY > b.y + d) continue;
    for (const cell of b.cells) {
      if (cell.floor !== 0 || !cellPresent(cell)) continue;
      const cx = b.x + (cell.gx + 0.5) * b.cellSize, cy = b.y + (cell.gy + 0.5) * b.cellSize;
      if (distToSegment(cx, cy, x0, y0, x1, y1) > reach) continue;
      cash += applyCellDamage(b, cell, amount, nx, ny, particles, events);
    }
  }
  return cash;
}

/** A grounding: the walls and props along the side that struck are broken, and spray goes up along it. */
function applyFerryHit(town: Town, v: VehicleState, particles: ParticlePool, events: WorldEvent[]): number {
  const seat = v.afloat!, hit = seat.hit!;
  seat.hit = undefined;
  const side = ferryLeadingSide(v, hit.nx, hit.ny, 0.4);
  const amount = hit.impulse * vehicleDefinition(v.definitionId).mass * FERRY.wall;
  let cash = breakGroundFloor(town, side.x0, side.y0, side.x1, side.y1, FERRY.reach, amount, hit.nx, hit.ny, particles, events);
  for (const prop of town.props) {
    // A pylon only falls to the dozer: its beam is the dozer's to drop.
    if (prop.broken || prop.assetId === MONORAIL.pylon) continue;
    if (distToSegment(prop.x + prop.w / 2, prop.y + prop.d / 2, side.x0, side.y0, side.x1, side.y1) > FERRY.reach * 0.6) continue;
    cash += destroyProp(town, prop, particles, events, v.x, v.y);
  }
  seat.splash = { ...side, t: 0 };
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    particles.burst('steam', side.x0 + (side.x1 - side.x0) * t, side.y0 + (side.y1 - side.y0) * t, 0.5, 1.4, v.yardOwner);
  }
  const mx = (side.x0 + side.x1) / 2, my = (side.y0 + side.y1) / 2;
  events.push({ kind: 'collapse', x: mx, y: my, z: 0, mag: Math.min(2.6, 1.2 + hit.impulse * 0.3) });
  events.push({ kind: 'impact', x: mx, y: my, z: 0.6, mag: Math.min(2, hit.impulse * 0.4), dirX: hit.nx, dirY: hit.ny });
  return cash;
}
