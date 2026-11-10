import type { Graphics } from 'pixi.js';
import type { Town } from '../world/town';
import { drawOrientedIsoBox, drawWorldPoly, PAL } from './drawIso';
import { shade } from './palette';

export interface PileArea { x: number; y: number; w: number; d: number }

export function corePileAreas(town: Town): PileArea[] {
  return town.buildings.filter(b => b.coreCollapse && ['falling', 'settled'].includes(b.coreCollapse.phase)).map(b => {
    const r = Math.max(b.w, b.d) * b.cellSize * .85 + 1;
    return { x: b.x + b.w * b.cellSize / 2 - r, y: b.y + b.d * b.cellSize / 2 - r, w: 2 * r, d: 2 * r };
  });
}

/**
 * Coarse contiguous pile surface; still samples the editable simulation pile.
 * `clip` limits drawing to pile cells [ix0, ix1) x [iy0, iy1) (even origin). Returns quads drawn.
 */
export function drawCorePiles(g: Graphics, town: Town, areas: readonly PileArea[], clip?: { ix0: number; iy0: number; ix1: number; iy1: number }): number {
  const pile = town.pile;
  // Areas overlap where wrecks stand close; each quad is drawn once.
  const drawn = new Set<number>();
  const bounds = clip ?? { ix0: 0, iy0: 0, ix1: pile.cols, iy1: pile.rows };
  let quads = 0;
  for (const a of areas) {
    const { x0, y0, x1, y1 } = areaCells(pile, a, bounds);
    for (let iy = y0; iy < y1; iy += 2) for (let ix = x0; ix < x1; ix += 2) {
      const i = iy * pile.cols + ix;
      if (drawn.has(i)) continue;
      drawn.add(i);
      if (drawPileQuad(g, pile, ix, iy)) quads++;
    }
  }
  return quads;
}

type Pile = Town['pile'];

/** Heap colour per pile material, in the pile's own order: wood, brick, concrete, metal, glass. */
const HEAP = [0xa9743f, 0x93463a, PAL.concrete, 0x646b6e, 0xb4d2da];

/** What a cell's heap is made of, as one colour: its materials mixed by mass. */
export function pileTint(pile: Pile, i: number): number {
  let r = 0, g = 0, b = 0, sum = 0;
  for (let m = 0; m < HEAP.length; m++) {
    const mass = pile.mats[m]![i]!;
    if (mass <= 0) continue;
    const c = HEAP[m]!;
    r += (c >> 16) * mass; g += ((c >> 8) & 255) * mass; b += (c & 255) * mass; sum += mass;
  }
  return sum > 0 ? (Math.round(r / sum) << 16) | (Math.round(g / sum) << 8) | Math.round(b / sum) : PAL.concrete;
}

/** The material with the most mass in a cell, as an index into the pile's order. */
export function pileLead(pile: Pile, i: number): number {
  let lead = 2;
  for (let m = 0, best = 0; m < HEAP.length; m++) if (pile.mats[m]![i]! > best) { best = pile.mats[m]![i]!; lead = m; }
  return lead;
}

/** Even-aligned pile cells covering an area, within the clip and the pile. */
function areaCells(pile: Pile, a: PileArea, clip: { ix0: number; iy0: number; ix1: number; iy1: number }): { x0: number; y0: number; x1: number; y1: number } {
  const step = pile.cell * 2;
  return {
    x0: Math.max(clip.ix0, Math.floor((a.x - pile.ox) / step) * 2),
    y0: Math.max(clip.iy0, Math.floor((a.y - pile.oy) / step) * 2),
    x1: Math.min(pile.cols - 1, clip.ix1, Math.ceil((a.x + a.w - pile.ox) / step) * 2),
    y1: Math.min(pile.rows - 1, clip.iy1, Math.ceil((a.y + a.d - pile.oy) / step) * 2),
  };
}

/** Corner height shared by the four cells around a grid point, capped at the pile's draw height. */
function cornerHeight(pile: Pile, ix: number, iy: number): number {
  let sum = 0;
  for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
    const x = Math.max(0, Math.min(pile.cols - 1, ix + dx)), y = Math.max(0, Math.min(pile.rows - 1, iy + dy));
    sum += pile.height[y * pile.cols + x]!;
  }
  return Math.min(3.5, sum / 4);
}

/** One 2x2-cell quad as two shaded triangles, with a chip on some taller ones. False when too low to draw. */
function drawPileQuad(g: Graphics, pile: Pile, ix: number, iy: number): boolean {
  const i = iy * pile.cols + ix, step = pile.cell * 2;
  const h = (pile.height[i]! + pile.height[i + 1]! + pile.height[i + pile.cols]! + pile.height[i + pile.cols + 1]!) / 4;
  if (h < .045) return false;
  const x = pile.ox + ix * pile.cell, y = pile.oy + iy * pile.cell;
  const seed = (ix * 17 + iy * 13) % 11;
  const vertices = [{ x, y, z: cornerHeight(pile, ix, iy) }, { x: x + step, y, z: cornerHeight(pile, ix + 2, iy) },
    { x: x + step, y: y + step, z: cornerHeight(pile, ix + 2, iy + 2) }, { x, y: y + step, z: cornerHeight(pile, ix, iy + 2) }];
  // Darker than the lot, with each facet lit by its slope and a little of its own tone, so the
  // mound reads as broken rubble rather than a tinted patch of ground.
  const lit = .82 + (vertices[0]!.z - vertices[2]!.z) * .3 + (seed % 5 - 2) * .022;
  const color = shade(pileTint(pile, i), Math.max(.6, Math.min(1.1, lit)));
  drawWorldPoly(g, [vertices[0]!, vertices[1]!, vertices[2]!], color, 1);
  drawWorldPoly(g, [vertices[0]!, vertices[2]!, vertices[3]!], shade(color, .93), 1);
  // A few stationary chips make the surface read as rubble without bodies.
  if (seed < 4 && h > .2) {
    const z = vertices.reduce((n, v) => n + v.z, 0) / 4;
    drawOrientedIsoBox(g, x + step / 2, y + step / 2, seed * .8, .35 + seed * .08, .23, z, .09,
      shade(color, 1.1), shade(color, .62), shade(color, .86));
  }
  return true;
}
