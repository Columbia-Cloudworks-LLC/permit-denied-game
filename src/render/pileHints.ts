import { Container, Graphics } from 'pixi.js';
import { PILE_TILE, type PileField } from '../sim/pile';
import type { Town } from '../world/town';
import { corePileAreas, drawCorePiles, type PileArea } from './corePileDraw';
import { drawGroundPoly, drawIsoBox, PAL } from './drawIso';

/**
 * Loose-pile hints and core-collapse pile surfaces, one Graphics per pile tile.
 * A tile redraws only when its pile tile revision moves, so a dozer working one
 * spot no longer repaints the whole field every tick.
 */
export class PileHintLayer {
  readonly root = new Container();
  private pile?: PileField;
  private areasKey = '';
  private seen = new Uint32Array(0);
  private tiles: (Graphics | undefined)[] = [];
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
    const areas = corePileAreas(town);
    const areasKey = areas.map((a) => `${a.x}:${a.y}:${a.w}:${a.d}`).join('|');
    const full = pile !== this.pile || areasKey !== this.areasKey;
    if (full) {
      for (const g of this.tiles) g?.destroy({ context: true });
      this.tiles = new Array(pile.tilesX * pile.tilesY);
      this.seen = new Uint32Array(pile.tilesX * pile.tilesY);
      this.pile = pile;
      this.areasKey = areasKey;
    }
    const span = PILE_TILE * pile.cell;
    for (let ty = 0; ty < pile.tilesY; ty++) {
      for (let tx = 0; tx < pile.tilesX; tx++) {
        const t = ty * pile.tilesX + tx;
        if (full || pile.tileRevision[t] !== this.seen[t]) {
          this.seen[t] = pile.tileRevision[t]!;
          this.redrawTile(town, areas, t, tx, ty);
        }
        const g = this.tiles[t];
        if (g) g.visible = visible(pile.ox + tx * span, pile.oy + ty * span, span, span);
      }
    }
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
        drawGroundPoly(g, x, y, s, s, PAL.lotDark, Math.min(0.62, 0.16 + h * 0.85));
        if (h > 0.14) {
          drawIsoBox(g, x + 0.04, y + 0.04, s * 0.72, s * 0.72, 0, Math.min(.42, h * .55), PAL.concrete, PAL.concreteDark, PAL.concrete, Math.min(0.85, 0.35 + h));
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
