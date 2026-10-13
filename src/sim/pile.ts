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
  owners?: Record<string, number>;
}

export function pileResistance(height: number, compact: number, pileMass: number, bodyMass = 0): number {
  return height * 2.35 + compact * 1.45 + bodyMass * 0.82 + pileMass * 0.55;
}

export function pileBlocked(height: number, resistance: number, bodyMass: number, pileMass: number): boolean {
  return resistance > 2.15 || (height > 0.18 && bodyMass + pileMass > 1.35);
}

/** Pile cells per side of one change-tracking tile. */
export const PILE_TILE = 16;
/** Views sample up to two cells past a changed one, so a change dirties tiles within this apron. */
const TILE_APRON = 2;

/** Spread of added mass over the 3x3 cells around the drop point. */
const ADD_WEIGHTS = [0.06, 0.12, 0.06, 0.12, 0.28, 0.12, 0.06, 0.12, 0.06] as const;

export class PileField {
  ownerAt?: (x: number, y: number) => string | undefined;
  private owners = new Map<string, Map<number, number>>();
  private ownerMaterials = new Map<string, Map<number, number[]>>();
  grow(w: number, d: number): PileField {
    const next = new PileField(this.ox, this.oy, w, d, this.cell);
    next.ownerAt = this.ownerAt;
    for (let iy = 0; iy < this.rows; iy++) for (let ix = 0; ix < this.cols; ix++) {
      const i = iy * this.cols + ix, j = iy * next.cols + ix;
      next.mass[j] = this.mass[i]!; next.height[j] = this.height[i]!; next.compact[j] = this.compact[i]!;
      for (let m = 0; m < this.mats.length; m++) next.mats[m]![j] = this.mats[m]![i]!;
    }
    for (const [key, cells] of this.owners) next.owners.set(key, new Map([...cells].map(([i, mass]) => [Math.floor(i / this.cols) * next.cols + i % this.cols, mass])));
    for (const [key, cells] of this.ownerMaterials) next.ownerMaterials.set(key, new Map([...cells].map(([i, composition]) => [Math.floor(i / this.cols) * next.cols + i % this.cols, [...composition]])));
    next.revision = this.revision + 1;
    return next;
  }
  clearArea(x: number, y: number, w: number, d: number): void {
    const ix0 = Math.max(0, Math.floor((x - this.ox) / this.cell)), ix1 = Math.min(this.cols, Math.ceil((x + w - this.ox) / this.cell));
    const iy0 = Math.max(0, Math.floor((y - this.oy) / this.cell)), iy1 = Math.min(this.rows, Math.ceil((y + d - this.oy) / this.cell));
    for (let iy = iy0; iy < iy1; iy++) {
      for (let ix = ix0; ix < ix1; ix++) this.clearCell(iy * this.cols + ix);
    }
    this.touch(ix0, iy0, ix1 - 1, iy1 - 1);
  }
  private clearCell(i: number): void {
    this.mass[i] = 0; this.height[i] = 0; this.compact[i] = 0;
    for (const mat of this.mats) mat[i] = 0;
    for (const [key, cells] of this.owners) { cells.delete(i); if (!cells.size) this.owners.delete(key); }
    for (const [key, cells] of this.ownerMaterials) { cells.delete(i); if (!cells.size) this.ownerMaterials.delete(key); }
  }
  removeOwner(owner: string): void {
    const cells = this.owners.get(owner);
    if (!cells) return;
    let ix0 = this.cols, iy0 = this.rows, ix1 = -1, iy1 = -1;
    for (const [i, amount] of cells) {
      const ix = i % this.cols, iy = Math.floor(i / this.cols);
      ix0 = Math.min(ix0, ix); ix1 = Math.max(ix1, ix); iy0 = Math.min(iy0, iy); iy1 = Math.max(iy1, iy);
      const ratio = Math.max(0, 1 - amount / Math.max(1e-9, this.mass[i]!));
      this.mass[i] *= ratio; this.height[i] *= ratio;
      if (this.mass[i]! < 1e-6) { this.mass[i] = 0; this.height[i] = 0; this.compact[i] = 0; }
      const composition = this.ownerMaterials.get(owner)?.get(i);
      for (let m = 0; m < this.mats.length; m++) this.mats[m]![i] = Math.max(0, this.mats[m]![i]! - (composition?.[m] ?? 0));
    }
    this.owners.delete(owner); this.ownerMaterials.delete(owner);
    if (ix1 >= 0) this.touch(ix0, iy0, ix1, iy1); else this.revision++;
  }

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
  readonly tilesX: number;
  readonly tilesY: number;
  /** Per-tile change counters (apron included) so views can redraw only touched tiles. */
  readonly tileRevision: Uint32Array;

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
    this.tilesX = Math.ceil(this.cols / PILE_TILE);
    this.tilesY = Math.ceil(this.rows / PILE_TILE);
    this.tileRevision = new Uint32Array(this.tilesX * this.tilesY);
  }

  /** Bump the global revision and every tile whose drawing reads cells in [ix0..ix1] x [iy0..iy1]. */
  private touch(ix0: number, iy0: number, ix1: number, iy1: number): void {
    this.revision++;
    const tx0 = Math.max(0, Math.floor((ix0 - TILE_APRON) / PILE_TILE)), tx1 = Math.min(this.tilesX - 1, Math.floor((ix1 + TILE_APRON) / PILE_TILE));
    const ty0 = Math.max(0, Math.floor((iy0 - TILE_APRON) / PILE_TILE)), ty1 = Math.min(this.tilesY - 1, Math.floor((iy1 + TILE_APRON) / PILE_TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) this.tileRevision[ty * this.tilesX + tx]!++;
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

  addMass(x: number, y: number, mass: number, material: Material = "concrete", ownership?: string | Record<string, number>): void {
    if (mass <= 1e-6) return;
    const { ix, iy } = this.cellOf(x, y);
    const hits: { i: number; w: number }[] = [];
    let wsum = 0;
    let wi = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const i = this.index(ix + dx, iy + dy);
        const w = ADD_WEIGHTS[wi++]!;
        if (i < 0) continue;
        hits.push({ i, w });
        wsum += w;
      }
    }
    if (wsum <= 0) return;
    const owner = ownership ?? this.ownerAt?.(x, y);
    const weightsByOwner = typeof owner === "string" ? { [owner]: 1 } : owner;
    const mi = materialIndex(material);
    for (const hit of hits) {
      const add = mass * (hit.w / wsum);
      if (weightsByOwner) this.creditOwners(hit.i, add, mi, weightsByOwner);
      this.mass[hit.i] += add;
      this.mats[mi]![hit.i] += add;
      const compact = this.compact[hit.i]!;
      this.height[hit.i] += add * 0.16 * (1 - 0.38 * compact);
    }
    this.touch(ix - 1, iy - 1, ix + 1, iy + 1);
  }

  /** Record which yard owners put mass into cell i, and of which material. */
  private creditOwners(i: number, add: number, mi: number, weightsByOwner: Record<string, number>): void {
    for (const [key, fraction] of Object.entries(weightsByOwner)) {
      let cells = this.owners.get(key);
      if (!cells) { cells = new Map(); this.owners.set(key, cells); }
      cells.set(i, (cells.get(i) ?? 0) + add * fraction);
      let materials = this.ownerMaterials.get(key);
      if (!materials) { materials = new Map(); this.ownerMaterials.set(key, materials); }
      let composition = materials.get(i);
      if (!composition) { composition = [0, 0, 0, 0, 0]; materials.set(i, composition); }
      composition[mi] += add * fraction;
    }
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
    if (changed) this.touch(ix - 1, iy - 1, ix + 1, iy + 1);
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
    const available = this.diskCells(ix, iy, reach, x, y, radius, hits);
    if (available <= 1e-6) return empty;
    const take = Math.min(maxMass, available);
    const composition = [0, 0, 0, 0, 0];
    const owners: Record<string, number> = {};
    let extracted = 0;
    let height = 0;
    let compact = 0;
    for (const hit of hits) {
      const share = (hit.mass / available) * take;
      if (share <= 1e-8) continue;
      const ratio = share / hit.mass;
      this.releaseOwners(hit.i, ratio, take, owners);
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
    this.touch(ix - reach, iy - reach, ix + reach, iy + reach);
    return {
      owners,
      mass: extracted,
      material: dominantMaterial(composition),
      height,
      compact,
      composition,
    };
  }

  /** Cells with mass whose centres fall inside the disk (plus a little slack); returns their total mass. */
  private diskCells(ix: number, iy: number, reach: number, x: number, y: number, radius: number, hits: { i: number; mass: number }[]): number {
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
    return available;
  }

  /** Move each owner's `ratio` of cell i into `owners` (as a share of `take`) and shrink what stays. */
  private releaseOwners(i: number, ratio: number, take: number, owners: Record<string, number>): void {
    for (const [key, cells] of this.owners) {
      const owned = cells.get(i) ?? 0;
      if (!owned) continue;
      owners[key] = (owners[key] ?? 0) + owned * ratio / take;
      const remaining = owned * (1 - ratio);
      this.shrinkOwnerMaterials(key, i, ratio, remaining);
      if (remaining < 1e-8) cells.delete(i); else cells.set(i, remaining);
      if (!cells.size) this.owners.delete(key);
    }
  }

  private shrinkOwnerMaterials(key: string, i: number, ratio: number, remaining: number): void {
    const materials = this.ownerMaterials.get(key);
    const composition = materials?.get(i);
    if (remaining < 1e-8) materials?.delete(i);
    else if (composition) for (let m = 0; m < composition.length; m++) composition[m] *= 1 - ratio;
    if (materials && !materials.size) this.ownerMaterials.delete(key);
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

  private massRevision = -1;
  private cachedMass = 0;
  totalMass(): number {
    if (this.massRevision === this.revision) return this.cachedMass;
    let sum = 0;
    for (let i = 0; i < this.mass.length; i++) sum += this.mass[i]!;
    this.massRevision = this.revision;
    this.cachedMass = sum;
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
