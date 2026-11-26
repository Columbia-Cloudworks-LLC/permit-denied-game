import type { ParticlePool } from '../fx/particles';
import { applyCellDamage } from '../structure/building';
import { cellPresent, type WorldEvent } from '../structure/types';
import { vehicleDefinition } from '../vehicle/definitions';
import { RAIL } from '../vehicle/runtime';
import type { Town } from '../world/town';

/**
 * A derailed rail car that slid into a wall breaks the ground-floor cells round the spot it
 * struck, harder the heavier and faster it was. Returns the cash that damage pays.
 */
export function applyRailHits(town: Town, particles: ParticlePool, events: WorldEvent[]): number {
  let cash = 0;
  for (const v of town.vehicles) {
    const hit = v.rail?.hit;
    if (!hit) continue;
    v.rail!.hit = undefined;
    const amount = hit.impulse * vehicleDefinition(v.definitionId).mass * RAIL.wall;
    for (const b of town.buildings) {
      if (b.retired) continue;
      const w = b.w * b.cellSize, d = b.d * b.cellSize;
      if (hit.x < b.x - RAIL.reach || hit.y < b.y - RAIL.reach || hit.x > b.x + w + RAIL.reach || hit.y > b.y + d + RAIL.reach) continue;
      for (const cell of b.cells) {
        if (cell.floor !== 0 || !cellPresent(cell)) continue;
        const cx = b.x + (cell.gx + 0.5) * b.cellSize, cy = b.y + (cell.gy + 0.5) * b.cellSize;
        if (Math.hypot(cx - hit.x, cy - hit.y) > RAIL.reach) continue;
        cash += applyCellDamage(b, cell, amount, hit.nx, hit.ny, particles, events);
      }
    }
    events.push({ kind: 'impact', x: hit.x, y: hit.y, z: 0.6, mag: Math.min(2, hit.impulse * 0.3) });
  }
  return cash;
}
