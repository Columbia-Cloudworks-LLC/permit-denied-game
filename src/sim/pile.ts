import { clamp } from "../game/math";
import type { Material, Obstruction, Rubble } from "../structure/types";

const PILE_MATERIALS: readonly Material[] = ["wood", "brick", "concrete", "metal", "glass"];

function materialIndex(material: Material): number {
  switch (material) {
    case "wood":
      return 0;
    case "brick":
      return 1;
    case "concrete":
      return 2;
    case "metal":
      return 3;
    case "glass":
      return 4;
    default: {
      const _never: never = material;
      return _never;
    }
  }
}

export interface ExtractedPile {
  mass: number;
  material: Material;
  height: number;
  compact: number;
  composition: number[];
}

export function pileResistance(height: number, compact: number, pileMass: number, bodyMass = 0): number {
  return height * 2.35 + compact * 1.45 + bodyMass * 0.82 + pileMass * 0.55;
}

export function pileBlocked(height: number, resistance: number, bodyMass: number, pileMass: number): boolean {
  return resistance > 2.15 || (height > 0.18 && bodyMass + pileMass > 1.35);
}

export class PileField {
  readonly cell: number;
  readonly ox: number;
  readonly oy: number;
  readonly cols: number;
  readonly rows: number;
  readonly height: Float32Array;
  readonly mass: Float32Array;
  readonly compact: Float32Array;
  readonly mats: Float32Array[];
  revision = 1;

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
    this.mats = PILE_MATERIALS.map(() => new Float32Array(n));
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

  addMass(x: number, y: number, mass: number, material: Material = "concrete"): void {
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
    const mi = materialIndex(material);
    for (const hit of hits) {
      const w = hit.w / wsum;
      const add = mass * w;
      this.mass[hit.i] += add;
      this.mats[mi]![hit.i] += add;
      const compact = this.compact[hit.i]!;
      this.height[hit.i] += add * 0.16 * (1 - 0.38 * compact);
    }
    this.revision++;
  }

  compactPoint(x: number, y: number, amount: number): void {
    if (amount <= 0) return;
    const { ix, iy } = this.cellOf(x, y);
    let changed = false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const i = this.index(ix + dx, iy + dy);
        if (i < 0) continue;
        const prev = this.compact[i]!;
        const next = clamp(prev + amount * (dx === 0 && dy === 0 ? 1 : 0.45), 0, 1);
        if (next === prev) continue;
        this.compact[i] = next;
        this.height[i] *= 1 - (next - prev) * 0.22;
        changed = true;
      }
    }
    if (changed) this.revision++;
  }

  extractDisk(x: number, y: number, radius: number, maxMass: number): ExtractedPile {
    const empty: ExtractedPile = {
      mass: 0,
      material: "concrete",
      height: 0,
      compact: 0,
      composition: [0, 0, 0, 0, 0],
    };
    if (maxMass <= 1e-6 || radius <= 0) return empty;
    const { ix, iy } = this.cellOf(x, y);
    const reach = Math.ceil(radius / this.cell) + 1;
    const hits: { i: number; mass: number }[] = [];
    let available = 0;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const i = this.index(ix + dx, iy + dy);
        if (i < 0) continue;
        const cx = this.ox + (ix + dx + 0.5) * this.cell;
        const cy = this.oy + (iy + dy + 0.5) * this.cell;
        if (Math.hypot(cx - x, cy - y) > radius + this.cell * 0.35) continue;
        const m = this.mass[i]!;
        if (m <= 1e-6) continue;
        hits.push({ i, mass: m });
        available += m;
      }
    }
    if (available <= 1e-6) return empty;
    const take = Math.min(maxMass, available);
    const composition = [0, 0, 0, 0, 0];
    let extracted = 0;
    let height = 0;
    let compact = 0;
    for (const hit of hits) {
      const share = (hit.mass / available) * take;
      if (share <= 1e-8) continue;
      const ratio = share / hit.mass;
      this.mass[hit.i] = Math.max(0, this.mass[hit.i]! - share);
      this.height[hit.i] = Math.max(0, this.height[hit.i]! * (1 - ratio));
      for (let mi = 0; mi < this.mats.length; mi++) {
        const part = this.mats[mi]![hit.i]! * ratio;
        this.mats[mi]![hit.i] = Math.max(0, this.mats[mi]![hit.i]! - part);
        composition[mi] += part;
      }
      extracted += share;
      height = Math.max(height, this.height[hit.i]!);
      compact = Math.max(compact, this.compact[hit.i]!);
    }
    this.revision++;
    return {
      mass: extracted,
      material: dominantMaterial(composition),
      height,
      compact,
      composition,
    };
  }

  sample(x: number, y: number): { height: number; mass: number; compact: number; material: Material } {
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
      material: this.materialAt(x, y),
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

  materialAt(x: number, y: number): Material {
    const { ix, iy } = this.cellOf(x, y);
    const i = this.index(ix, iy);
    if (i < 0) return "concrete";
    const composition = this.mats.map((m) => m[i]!);
    return dominantMaterial(composition);
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

function dominantMaterial(composition: readonly number[]): Material {
  let best = 0;
  let idx = 2;
  for (let i = 0; i < composition.length; i++) {
    if (composition[i]! > best) {
      best = composition[i]!;
      idx = i;
    }
  }
  return PILE_MATERIALS[idx] ?? "concrete";
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
  const resistance = pileResistance(height, compaction, sample.mass, bodyMass);
  return {
    height,
    compaction,
    resistance,
    blocked: pileBlocked(height, resistance, bodyMass, sample.mass),
  };
}
