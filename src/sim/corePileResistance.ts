import { DOZER } from '../game/constants';
import { clamp } from '../game/math';
import type { Town } from '../world/town';
import type { Dozer } from '../vehicle/dozer';

const STOP_PRESSURE = .72;

/** Radial influence locates the heap; actual remaining material determines access. */
export function corePilePressure(town: Town, x: number, y: number): number {
  let pressure = 0;
  for (const b of town.buildings) {
    if (b.coreCollapse?.phase !== 'settled') continue;
    const cx = b.x + b.w * b.cellSize / 2, cy = b.y + b.d * b.cellSize / 2;
    const radius = Math.max(b.w, b.d) * b.cellSize * .85;
    if (Math.hypot(x - cx, y - cy) > radius + DOZER.radius) continue;
    // Sample the chassis footprint, so a narrow slot under its center is insufficient.
    for (const [dx, dy] of [[0, 0], [.7, 0], [-.7, 0], [0, .7], [0, -.7]]) {
      const px = x + dx!, py = y + dy!;
      const radial = clamp((radius - Math.hypot(px - cx, py - cy)) / (radius * .4), 0, 1);
      if (radial === 0) continue;
      const pile = town.pile.sample(px, py);
      const density = clamp((pile.mass - .5) / 3, 0, 1) * clamp((pile.height - .08) / .55, 0, 1);
      pressure = Math.max(pressure, radial * density);
    }
  }
  return pressure;
}

/** Constrain the just-integrated movement before collision queries and blade work. */
export function resistCorePile(town: Town, dozer: Dozer, dt: number): void {
  const x0 = dozer.motionStartX ?? dozer.x, y0 = dozer.motionStartY ?? dozer.y;
  dozer.motionStartX = undefined; dozer.motionStartY = undefined;
  const startPressure = corePilePressure(town, x0, y0);
  const endPressure = corePilePressure(town, dozer.x, dozer.y);
  dozer.pileResistance = Math.max(startPressure, endPressure);
  if (dozer.pileResistance === 0) return;
  const dx = dozer.x - x0, dy = dozer.y - y0;
  if (Math.hypot(dx, dy) < 1e-8) return;
  const leaving = endPressure < startPressure - 1e-6;
  const drag = Math.exp(-dozer.pileResistance * (leaving ? 2 : 18) * dt);
  dozer.vx *= drag; dozer.vy *= drag;
  const mx = dx * drag, my = dy * drag;
  const steps = Math.min(64, Math.max(1, Math.ceil(Math.hypot(mx, my) / .15)));
  dozer.x = x0; dozer.y = y0;
  for (let i = 1; i <= steps; i++) {
    const x = x0 + mx * i / steps, y = y0 + my * i / steps;
    const pressure = corePilePressure(town, x, y);
    // A dozer caught inside during settling may escape along equal/lower pressure.
    const escaping = startPressure >= STOP_PRESSURE && pressure <= startPressure + 1e-6;
    if (pressure >= STOP_PRESSURE && !escaping) {
      dozer.vx = 0; dozer.vy = 0;
      dozer.lastImpact = Math.max(dozer.lastImpact, .08);
      break;
    }
    dozer.x = x; dozer.y = y;
  }
  dozer.track = Math.min(100, dozer.track + dozer.pileResistance * 16 * dt);
}
