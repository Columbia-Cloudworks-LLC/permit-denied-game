import type { ParticlePool } from '../fx/particles';
import type { WorldEvent } from '../structure/types';
import type { CityPlanFerry } from '../world/cityPlan';
import { traversalAt, type SurfaceGrid } from '../world/terrain';
import { vehicleDefinition } from './definitions';
import { createVehicle, FERRY } from './runtime';
import type { VehicleState } from './types';

/**
 * Ferries moored on a city plan's water. A moored hull holds its berth against a slow push. Shoved
 * far enough off it the lines part: it is cast loose the way it was pushed and drifts on across
 * the water until it runs onto a shore, where it breaks whatever stands at the water's edge
 * (`sim/railImpact.ts`) and throws up a line of spray. It never comes ashore.
 */
export const FERRY_ID = 'state-ferry';

/** Float a ferry at every berth, lying along its axis. */
export function placeFerries(berths: readonly CityPlanFerry[]): VehicleState[] {
  return berths.map(berth => {
    const heading = berth.axis === 'x' ? 0 : Math.PI / 2;
    const hull = createVehicle(FERRY_ID, berth.x, berth.y, heading, 0);
    hull.afloat = { x: berth.x, y: berth.y, heading, moored: true };
    return hull;
  });
}

/** Hold every moored hull to its berth, cast loose the ones shoved off it, and let old spray settle. Ice holds a hull fast. */
export function stepFerries(town: { vehicles: VehicleState[]; frozen?: boolean }, dt: number, particles: ParticlePool, events: WorldEvent[]): void {
  for (const v of town.vehicles) {
    const seat = v.afloat;
    if (!seat) continue;
    if (seat.splash && (seat.splash.t += dt) >= FERRY.splash) seat.splash = undefined;
    if (!seat.moored) continue;
    const dx = v.x - seat.x, dy = v.y - seat.y, off = Math.hypot(dx, dy);
    if (off > FERRY.cast && !town.frozen) {
      seat.moored = false;
      const speed = Math.max(FERRY.kick, Math.hypot(v.vx, v.vy));
      v.vx = dx / off * speed;
      v.vy = dy / off * speed;
      v.sleeping = false;
      v.rest = 0;
      v.revision++;
      v.pendingCash += FERRY.bonus;
      particles.burst('steam', v.x, v.y, 0.4, 1.2, v.yardOwner);
      events.push({ kind: 'snap', x: v.x, y: v.y, z: 0.6, mag: 1.8, material: 'metal' });
      continue;
    }
    // The lines give a little and haul the hull back.
    const eased = Math.exp(-FERRY.grip * dt);
    v.x = seat.x + dx * eased;
    v.y = seat.y + dy * eased;
    v.vx = 0;
    v.vy = 0;
    v.heading = seat.heading;
    v.omega = 0;
  }
}

/** Points round the hull's rail, as shares of its half length and half width. */
const RAIL_POINTS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [0.5, 1], [0.5, -1], [-0.5, 1], [-0.5, -1]] as const;

/**
 * Keep a drifting hull on the water. When the side it is moving toward touches the shore it is put
 * back where it was, the grounding is noted for the world to turn into damage, and it rebounds a
 * little. The side it is moving away from is ignored, so a hull can leave the pier it lay against.
 */
export function ferryShore(surface: SurfaceGrid, v: VehicleState, prevX: number, prevY: number): void {
  const speed = Math.hypot(v.vx, v.vy);
  if (speed < 1e-3) return;
  const d = vehicleDefinition(v.definitionId), f = Math.cos(v.heading), g = Math.sin(v.heading), hl = d.length / 2, hw = d.width / 2;
  for (const [a, c] of RAIL_POINTS) {
    const ox = f * a * hl - g * c * hw, oy = g * a * hl + f * c * hw;
    if (ox * v.vx + oy * v.vy <= 0 || traversalAt(surface, v.x + ox, v.y + oy) === 'water') continue;
    v.x = prevX;
    v.y = prevY;
    if (speed > FERRY.strike) noteFerryHit(v, v.vx / speed, v.vy / speed, speed);
    v.vx *= -FERRY.bounce;
    v.vy *= -FERRY.bounce;
    v.omega *= 0.5;
    return;
  }
}

/** Remember the hardest grounding or wall strike of a drifting hull this step. */
export function noteFerryHit(v: VehicleState, nx: number, ny: number, impulse: number): void {
  const seat = v.afloat!;
  if (!seat.hit || impulse > seat.hit.impulse) seat.hit = { nx, ny, impulse };
}

/** The side of the hull facing (`nx`, `ny`): the line its rail lies along, pushed `out` beyond the plating. */
export function ferryLeadingSide(v: VehicleState, nx: number, ny: number, out = 0): { x0: number; y0: number; x1: number; y1: number } {
  const d = vehicleDefinition(v.definitionId), f = Math.cos(v.heading), g = Math.sin(v.heading), hl = d.length / 2, hw = d.width / 2;
  // Broadside on, the leading side is a long rail; end on, it is the bow or the stern.
  const along = f * nx + g * ny, across = -g * nx + f * ny;
  if (Math.abs(across) >= Math.abs(along)) {
    const side = Math.sign(across) || 1, cx = v.x - g * side * (hw + out), cy = v.y + f * side * (hw + out);
    return { x0: cx - f * hl, y0: cy - g * hl, x1: cx + f * hl, y1: cy + g * hl };
  }
  const end = Math.sign(along) || 1, cx = v.x + f * end * (hl + out), cy = v.y + g * end * (hl + out);
  return { x0: cx + g * hw, y0: cy - f * hw, x1: cx - g * hw, y1: cy + f * hw };
}
