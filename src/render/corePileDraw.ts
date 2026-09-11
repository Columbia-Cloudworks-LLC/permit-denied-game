import type { Graphics } from 'pixi.js';
import type { Town } from '../world/town';
import { drawOrientedIsoBox, drawWorldPoly, PAL, shade } from './drawIso';

export function corePileAreas(town: Town): { x: number; y: number; w: number; d: number }[] {
  return town.buildings.filter(b => b.coreCollapse && ['falling', 'settled'].includes(b.coreCollapse.phase)).map(b => {
    const r = Math.max(b.w, b.d) * b.cellSize * .85 + 1;
    return { x: b.x + b.w * b.cellSize / 2 - r, y: b.y + b.d * b.cellSize / 2 - r, w: 2 * r, d: 2 * r };
  });
}

/** Coarse contiguous pile surface; still samples the editable simulation pile. */
export function drawCorePiles(g: Graphics, town: Town, areas: ReturnType<typeof corePileAreas>): void {
  const pile = town.pile, step = pile.cell * 2;
  const drawn = new Set<number>();
  const height = (ix: number, iy: number) => {
    let sum = 0;
    for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
      const x = Math.max(0, Math.min(pile.cols - 1, ix + dx)), y = Math.max(0, Math.min(pile.rows - 1, iy + dy));
      sum += pile.height[y * pile.cols + x]!;
    }
    return Math.min(3.5, sum / 4);
  };
  for (const a of areas) {
    const x0 = Math.max(0, Math.floor((a.x - pile.ox) / step) * 2), y0 = Math.max(0, Math.floor((a.y - pile.oy) / step) * 2);
    const x1 = Math.min(pile.cols - 1, Math.ceil((a.x + a.w - pile.ox) / step) * 2), y1 = Math.min(pile.rows - 1, Math.ceil((a.y + a.d - pile.oy) / step) * 2);
    for (let iy = y0; iy < y1; iy += 2) for (let ix = x0; ix < x1; ix += 2) {
      const i = iy * pile.cols + ix;
      if (drawn.has(i)) continue; drawn.add(i);
      const h = (pile.height[i]! + pile.height[i + 1]! + pile.height[i + pile.cols]! + pile.height[i + pile.cols + 1]!) / 4;
      if (h < .045) continue;
      const x = pile.ox + ix * pile.cell, y = pile.oy + iy * pile.cell;
      const seed = (ix * 17 + iy * 13) % 11;
      const vertices = [{ x, y, z: height(ix, iy) }, { x: x + step, y, z: height(ix + 2, iy) },
        { x: x + step, y: y + step, z: height(ix + 2, iy + 2) }, { x, y: y + step, z: height(ix, iy + 2) }];
      const color = shade(PAL.concrete, .94 + (vertices[0]!.z - vertices[2]!.z) * .12);
      drawWorldPoly(g, [vertices[0]!, vertices[1]!, vertices[2]!], color, 1);
      drawWorldPoly(g, [vertices[0]!, vertices[2]!, vertices[3]!], shade(color, .98), 1);
      // A few stationary chips make the surface read as rubble without bodies.
      if (seed < 4 && h > .2) {
        const z = vertices.reduce((n, v) => n + v.z, 0) / 4;
        drawOrientedIsoBox(g, x + step / 2, y + step / 2, seed * .8, .35 + seed * .08, .23, z, .09,
          shade(color, 1.1), PAL.concreteDark, shade(color, .86));
      }
    }
  }
}
