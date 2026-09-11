import type { Graphics } from 'pixi.js';
import { FLOOR_Z } from '../game/constants';
import type { Building } from '../structure/types';
import { drawIsoBox, drawWorldPoly, PAL } from './drawIso';

/** A floor shell stays coherent while its base is swallowed by the pile. */
export function drawCoreFloor(g: Graphics, b: Building, rect: NonNullable<Building['coreCollapse']>['floors'][number], burial = 0): void {
  const drop = b.coreCollapse!.drop, cs = b.cellSize;
  const bottom = rect.floor * FLOOR_Z - drop, top = bottom + FLOOR_Z;
  if (top <= burial) return;
  const x = b.x + rect.x * cs, y = b.y + rect.y * cs, w = rect.w * cs, d = rect.d * cs;
  drawIsoBox(g, x, y, w, d, Math.max(burial, bottom), top - Math.max(burial, bottom), PAL.concrete, PAL.concreteDark, PAL.concrete);
  const z0 = Math.max(burial, bottom + .55), z1 = bottom + 1.85;
  if (z1 <= z0) return;
  for (let u = .25; u < w - .3; u += cs) drawWorldPoly(g, [
    { x: x + u, y: y + d + .01, z: z0 }, { x: x + u + cs * .55, y: y + d + .01, z: z0 },
    { x: x + u + cs * .55, y: y + d + .01, z: z1 }, { x: x + u, y: y + d + .01, z: z1 },
  ], 0x526c72, .9);
  for (let u = .25; u < d - .3; u += cs) drawWorldPoly(g, [
    { x: x + w + .01, y: y + u, z: z0 }, { x: x + w + .01, y: y + u + cs * .55, z: z0 },
    { x: x + w + .01, y: y + u + cs * .55, z: z1 }, { x: x + w + .01, y: y + u, z: z1 },
  ], 0x435961, .9);
}
