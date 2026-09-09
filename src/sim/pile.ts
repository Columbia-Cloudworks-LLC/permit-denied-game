import { clamp } from "../game/math";
import type { Obstruction, Rubble } from "../structure/types";

export class PileField {
  readonly cell: number;
  readonly ox: number;
  readonly oy: number;
  readonly cols: number;
  readonly rows: number;
  readonly height: Float32Array;
  readonly mass: Float32Array;
  readonly compact: Float32Array;

  constructor(ox: number, oy: number, w: number, d: number, cell = 0.5) {
    this.cell = cell;
    this.ox = ox;
    this.oy = oy;
    this.cols = Math.max(1, Math.ceil(w / cell));
    this.rows = Math.max(1, Math.ceil(d / cell));
    const n = this.cols * this.rows;
    this.height = new Float32Array(n);
    this.mass = new Float32Array(n);
    this.compact = new Float32Array(n);
  }

  clear(): void {
    this.height.fill(0);
    this.mass.fill(0);
    this.compact.fill(0);
  }

  private index(ix: number, iy: number): number {
    if (ix < 0 || iy < 0 || ix >= this.cols || iy >= this.rows) return -1;
    return iy * this.cols + ix;
  }

  private cellOf(x: number, y: number): { ix: number; iy: number } {
    return {
      ix: Math.floor((x - this.ox) / this.cell),
      iy: Math.floor((y - this.oy) / this.cell),
    };
  }

  addMass(x: number, y: number, mass: number): void {
    if (mass <= 1e-6) return;
    const { ix, iy } = this.cellOf(x, y);
    const weights = [0.06, 0.12, 0.06, 0.12, 0.28, 0.12, 0.06, 0.12, 0.06];
    const hits: { i: number; w: number }[] = [];
    let wsum = 0;
    let wi = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const i = this.index(ix + dx, iy + dy);
        const w = weights[wi++]!;
        if (i < 0) continue;
        hits.push({ i, w });
        wsum += w;
      }
    }
    if (wsum <= 0) return;
    for (const hit of hits) {
      const w = hit.w / wsum;
      this.mass[hit.i] += mass * w;
      const compact = this.compact[hit.i]!;
      this.height[hit.i] += mass * w * 0.1 * (1 - 0.38 * compact);
    }
  }

  compactPoint(x: number, y: number, amount: number): void {
    if (amount <= 0) return;
    const { ix, iy } = this.cellOf(x, y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const i = this.index(ix + dx, iy + dy);
        if (i < 0) continue;
        const next = clamp(this.compact[i]! + amount * (dx === 0 && dy === 0 ? 1 : 0.45), 0, 1);
        const shrink = 1 - (next - this.compact[i]!) * 0.22;
        this.compact[i] = next;
        this.height[i] *= shrink;
      }
    }
  }

  sample(x: number, y: number): { height: number; mass: number; compact: number } {
    const fx = (x - this.ox) / this.cell - 0.5;
    const fy = (y - this.oy) / this.cell - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const h00 = this.heightAtCell(x0, y0);
    const h10 = this.heightAtCell(x0 + 1, y0);
    const h01 = this.heightAtCell(x0, y0 + 1);
    const h11 = this.heightAtCell(x0 + 1, y0 + 1);
    const m00 = this.massAtCell(x0, y0);
    const m10 = this.massAtCell(x0 + 1, y0);
    const m01 = this.massAtCell(x0, y0 + 1);
    const m11 = this.massAtCell(x0 + 1, y0 + 1);
    const c00 = this.compactAtCell(x0, y0);
    const c10 = this.compactAtCell(x0 + 1, y0);
    const c01 = this.compactAtCell(x0, y0 + 1);
    const c11 = this.compactAtCell(x0 + 1, y0 + 1);
    return {
      height: bilerp(h00, h10, h01, h11, tx, ty),
      mass: bilerp(m00, m10, m01, m11, tx, ty),
      compact: bilerp(c00, c10, c01, c11, tx, ty),
    };
  }

  heightAt(x: number, y: number): number {
    return this.sample(x, y).height;
  }

  slope(x: number, y: number): { dx: number; dy: number } {
    const e = this.cell * 0.85;
    const dx = (this.heightAt(x + e, y) - this.heightAt(x - e, y)) / (e * 2);
    const dy = (this.heightAt(x, y + e) - this.heightAt(x, y - e)) / (e * 2);
    return { dx, dy };
  }

  totalMass(): number {
    let sum = 0;
    for (let i = 0; i < this.mass.length; i++) sum += this.mass[i]!;
    return sum;
  }

  private heightAtCell(ix: number, iy: number): number {
    const i = this.index(ix, iy);
    return i < 0 ? 0 : this.height[i]!;
  }

  private massAtCell(ix: number, iy: number): number {
    const i = this.index(ix, iy);
    return i < 0 ? 0 : this.mass[i]!;
  }

  private compactAtCell(ix: number, iy: number): number {
    const i = this.index(ix, iy);
    return i < 0 ? 0 : this.compact[i]!;
  }
}

function bilerp(a: number, b: number, c: number, d: number, tx: number, ty: number): number {
  const u = a + (b - a) * tx;
  const v = c + (d - c) * tx;
  return u + (v - u) * ty;
}

export function queryObstruction(
  pile: PileField,
  rubble: readonly Rubble[],
  x: number,
  y: number,
  radius = 0.7,
): Obstruction {
  const sample = pile.sample(x, y);
  let bodyH = 0;
  let bodyMass = 0;
  const r2 = radius * radius;
  for (const r of rubble) {
    const dx = r.x - x;
    const dy = r.y - y;
    const reach = radius + Math.max(r.w, r.d) * 0.5;
    if (dx * dx + dy * dy > reach * reach) continue;
    if (dx * dx + dy * dy > r2 * 4 && Math.hypot(dx, dy) > reach) continue;
    bodyH = Math.max(bodyH, r.elev + r.thickness);
    bodyMass += r.mass;
  }
  const height = Math.max(sample.height, bodyH);
  const compaction = sample.compact;
  const resistance = height * 2.35 + compaction * 1.45 + bodyMass * 0.82 + sample.mass * 0.55;
  return {
    height,
    compaction,
    resistance,
    blocked: resistance > 2.15 || (height > 0.18 && bodyMass > 1.35),
  };
}
