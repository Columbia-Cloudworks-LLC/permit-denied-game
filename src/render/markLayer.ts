import { Container, Graphics } from 'pixi.js';
import type { GroundMark } from '../structure/types';
import type { SeasonId } from '../world/season';
import { drawGroundMark } from './groundDraw';

/** Marks per Graphics. Matches the batch `addSurfaceMark` drops at the cap, so trimming shifts whole buckets. */
const BUCKET = 24;

interface Bucket { graphic: Graphics; first?: GroundMark; stamp: number; x0: number; y0: number; x1: number; y1: number }

/**
 * Ground marks in fixed-size buckets by age. A new chip or scrape repaints only the newest
 * bucket instead of every mark on the lot, which is what a collapse does every tick.
 */
export class MarkLayer {
  readonly root = new Container();
  private buckets: Bucket[] = [];
  private season = '';
  rebuilt = 0;

  invalidate(): void {
    for (const b of this.buckets) b.graphic.destroy({ context: true });
    this.buckets = [];
  }

  /** `season` is the paint season (`Town.look`). Returns how many marks sit in buckets that are on screen. */
  update(marks: readonly GroundMark[], season: SeasonId, visible: (x: number, y: number, w: number, d: number) => boolean): number {
    this.rebuilt = 0;
    if (season !== this.season) this.invalidate();
    this.season = season;
    const count = Math.ceil(marks.length / BUCKET);
    while (this.buckets.length > count) this.buckets.pop()!.graphic.destroy({ context: true });
    let shown = 0;
    for (let k = 0; k < count; k++) {
      const from = k * BUCKET, to = Math.min(marks.length, from + BUCKET);
      let b = this.buckets[k];
      if (!b) {
        b = this.buckets[k] = { graphic: new Graphics(), stamp: NaN, x0: 0, y0: 0, x1: 0, y1: 0 };
        this.root.addChild(b.graphic);
      }
      // Marks fade and retint in place, so the stamp covers what a repaint would read.
      let stamp = to - from;
      for (let i = from; i < to; i++) {
        const m = marks[i]!;
        stamp = stamp * 1.000003 + m.x * 7 + m.y * 13 + m.alpha * 101 + m.w + (m.tint ?? 0) * 1e-3;
      }
      if (b.first !== marks[from] || b.stamp !== stamp) {
        b.first = marks[from];
        b.stamp = stamp;
        this.paint(b, marks, from, to, season);
      }
      const on = visible(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      b.graphic.visible = on;
      if (on) shown += to - from;
    }
    return shown;
  }

  private paint(b: Bucket, marks: readonly GroundMark[], from: number, to: number, season: SeasonId): void {
    this.rebuilt++;
    b.graphic.clear();
    b.x0 = b.y0 = Infinity;
    b.x1 = b.y1 = -Infinity;
    for (let i = from; i < to; i++) {
      const m = marks[i]!;
      b.x0 = Math.min(b.x0, m.x - m.w); b.y0 = Math.min(b.y0, m.y - m.w);
      b.x1 = Math.max(b.x1, m.x + m.w); b.y1 = Math.max(b.y1, m.y + m.w);
      drawGroundMark(b.graphic, m, season);
    }
  }
}
