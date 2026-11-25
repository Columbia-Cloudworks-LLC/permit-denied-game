import { distToSegment } from '../game/math';
import type { MonumentImpact } from '../structure/monument';
import type { WorldEvent } from '../structure/types';
import type { Dozer } from '../vehicle/dozer';

/** Engine heat and track stress for standing under a statue when it comes down. */
export const MONUMENT_STRIKE = { heat: 22, track: 26, shove: 3.2 } as const;

/**
 * A fallen statue strikes everything along the line it lands on. The dozer takes heat and track
 * stress, full under the middle of the figure and fading to nothing at the edge of the strike,
 * and is shoved clear sideways.
 */
export function applyMonumentImpact(dozer: Dozer, impact: MonumentImpact, events: WorldEvent[]): boolean {
  const distance = distToSegment(dozer.x, dozer.y, impact.x0, impact.y0, impact.x1, impact.y1);
  const reach = impact.radius + 1.2;
  if (distance >= reach) return false;
  const strength = 0.4 + 0.6 * (1 - distance / reach);
  dozer.heat = Math.min(100, dozer.heat + MONUMENT_STRIKE.heat * strength);
  dozer.track = Math.min(100, dozer.track + MONUMENT_STRIKE.track * strength);
  // Shove across the fallen figure, away from its centre line.
  const ax = impact.x1 - impact.x0, ay = impact.y1 - impact.y0, length = Math.hypot(ax, ay) || 1;
  const side = (dozer.x - impact.x0) * -ay + (dozer.y - impact.y0) * ax >= 0 ? 1 : -1;
  dozer.vx += (-ay / length) * side * MONUMENT_STRIKE.shove * strength;
  dozer.vy += (ax / length) * side * MONUMENT_STRIKE.shove * strength;
  dozer.lastImpact = 0.4;
  events.push({ kind: 'collapse', x: dozer.x, y: dozer.y, z: 0, mag: 1.2 + strength });
  return true;
}
