import { Container, Graphics } from 'pixi.js';
import { PILE_TILE, type PileField } from '../sim/pile';
import type { Town } from '../world/town';
import { corePileAreas, drawCorePiles, pileLead, pileTint, type PileArea } from './corePileDraw';
import { drawGroundPoly, drawIsoBox, drawOrientedIsoBox } from './drawIso';
import { shade } from './palette';

/** Tiles repainted per frame at most. A tower pulse dirties a whole mound; this spreads it over a few frames. */
const REDRAW_BUDGET = 8;
const DIRTY = 0xffffffff;

/**
 * Loose-pile hints and core-collapse pile surfaces, one Graphics per pile tile.
 * A tile redraws only when its pile tile revision moves and it is on screen, so a dozer
 * working one spot repaints a few small tiles, and a mound growing off screen costs nothing.
 */
export class PileHintLayer {
  readonly root = new Container();
  private pile?: PileField;
  private areas: PileArea[] = [];
  private areasKey = '';
  private seen = new Uint32Array(0);
  private tiles: (Graphics | undefined)[] = [];
  /** Where the last frame's budget ran out, so later tiles are not starved. */
  private cursor = 0;
  rebuilt = 0;

  constructor() {
    this.root.sortableChildren = true;
  }

  invalidate(): void {
    this.pile = undefined;
  }

  update(town: Town, enabled: boolean, visible: (x: number, y: number, w: number, d: number) => boolean): void {
    this.rebuilt = 0;
    this.root.visible = enabled;
    if (!enabled) return;
    const pile = town.pile;
    const count = pile.tilesX * pile.tilesY;
    if (pile !== this.pile) {
      for (const g of this.tiles) g?.destroy({ context: true });
      this.tiles = new Array(count);
      // Untouched tiles sit at revision 0 and have nothing to draw.
      this.seen = new Uint32Array(count);
      this.pile = pile;
      this.areas = [];
      this.areasKey = '';
    }
    const span = PILE_TILE * pile.cell;
    const areas = corePileAreas(town);
    const areasKey = areas.map((a) => `${a.x}:${a.y}:${a.w}:${a.d}`).join('|');
    if (areasKey !== this.areasKey) {
      // A mound starting or settling changes how its tiles draw, not the pile under them.
      for (const a of [...this.areas, ...areas]) this.dirtyArea(pile, a, span);
      this.areas = areas;
      this.areasKey = areasKey;
    }
    let budget = REDRAW_BUDGET;
    let resume = -1;
    const start = this.cursor < count ? this.cursor : 0;
    for (let n = 0; n < count; n++) {
      const t = (start + n) % count;
      const dirty = pile.tileRevision[t] !== this.seen[t];
      const g = this.tiles[t];
      if (!dirty && !g) continue;
      const tx = t % pile.tilesX, ty = (t - tx) / pile.tilesX;
      const on = visible(pile.ox + tx * span, pile.oy + ty * span, span, span);
      if (g) g.visible = on;
      if (!dirty || !on) continue;
      if (budget === 0) {
        if (resume < 0) resume = t;
        continue;
      }
      budget--;
      this.seen[t] = pile.tileRevision[t]!;
      this.redrawTile(town, areas, t, tx, ty);
    }
    this.cursor = Math.max(0, resume);
  }

  private dirtyArea(pile: PileField, a: PileArea, span: number): void {
    const tx0 = Math.max(0, Math.floor((a.x - pile.ox) / span)), tx1 = Math.min(pile.tilesX - 1, Math.floor((a.x + a.w - pile.ox) / span));
    const ty0 = Math.max(0, Math.floor((a.y - pile.oy) / span)), ty1 = Math.min(pile.tilesY - 1, Math.floor((a.y + a.d - pile.oy) / span));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) this.seen[ty * pile.tilesX + tx] = DIRTY;
  }

  private redrawTile(town: Town, areas: readonly PileArea[], t: number, tx: number, ty: number): void {
    this.rebuilt++;
    const g = this.tiles[t] ?? new Graphics();
    g.clear();
    const pile = town.pile;
    const ix0 = tx * PILE_TILE, iy0 = ty * PILE_TILE;
    const ix1 = Math.min(pile.cols, ix0 + PILE_TILE), iy1 = Math.min(pile.rows, iy0 + PILE_TILE);
    let drawn = drawCorePiles(g, town, areas, { ix0, iy0, ix1, iy1 });
    for (let iy = iy0; iy < iy1; iy++) {
      for (let ix = ix0; ix < ix1; ix++) {
        const h = pile.height[iy * pile.cols + ix]!;
        if (h < 0.05) continue;
        const x = pile.ox + (ix + 0.12) * pile.cell;
        const y = pile.oy + (iy + 0.12) * pile.cell;
        if (areas.some((a) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.d)) continue;
        const s = pile.cell * 0.76;
        const i = iy * pile.cols + ix;
        const tint = pileTint(pile, i);
        // A dark skirt of fines so the heap reads against any ground, then the heap in its own material.
        drawGroundPoly(g, x, y, s, s, shade(tint, 0.5), Math.min(0.62, 0.16 + h * 0.85));
        if (h > 0.14) {
          const hash = (ix * 73 + iy * 151) % 16;
          const lit = shade(tint, 0.92 + hash * 0.012);
          drawIsoBox(g, x + 0.04, y + 0.04, s * 0.72, s * 0.72, 0, Math.min(.42, h * .55), lit, shade(lit, 0.6), shade(lit, 0.8), Math.min(0.85, 0.35 + h));
          if (hash < 6) drawHeapAccent(g, pileLead(pile, i), x + s * 0.4, y + s * 0.4, Math.min(.42, h * .55), hash, lit);
        }
        drawn++;
      }
    }
    if (!drawn) {
      g.destroy({ context: true });
      this.tiles[t] = undefined;
      return;
    }
    if (!this.tiles[t]) {
      g.zIndex = t;
      this.tiles[t] = g;
      this.root.addChild(g);
    }
  }
}

/** One piece poking out of a heap cell, so its material shows: a board, a brick, a slab edge, a steel bar, a glass glint. */
const ACCENT: readonly (readonly [length: number, width: number, height: number, color: number])[] = [
  [0.46, 0.07, 0.05, 0xe2b877],
  [0.2, 0.1, 0.07, 0xa9523f],
  [0.3, 0.2, 0.08, 0xa3a08e],
  [0.5, 0.05, 0.05, 0x3e4240],
  [0.16, 0.1, 0.02, 0xe6f4f8],
];

function drawHeapAccent(g: Graphics, lead: number, x: number, y: number, z: number, hash: number, lit: number): void {
  const [length, width, height, color] = ACCENT[lead]!;
  drawOrientedIsoBox(g, x, y, hash * 1.1, length, width, z, height, color, shade(lit, 0.55), shade(color, 0.78));
}
