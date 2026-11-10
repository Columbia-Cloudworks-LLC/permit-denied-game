/** Cell index bias, so negative cells pack into one non-negative integer key. */
const BIAS = 0x80000;
const SPAN = 0x100000;

export class SpatialHash<T> {
  private readonly cells = new Map<number, T[]>();
  /** Reused per query: items spanning several cells are reported once. */
  private readonly seen = new Set<T>();

  constructor(private readonly cellSize: number) {}

  /** Emptied buckets, reused so a hash rebuilt every step does not churn arrays. */
  private readonly spare: T[][] = [];

  clear(): void {
    for (const bucket of this.cells.values()) {
      bucket.length = 0;
      this.spare.push(bucket);
    }
    this.cells.clear();
  }

  insert(x: number, y: number, w: number, d: number, item: T): void {
    const size = this.cellSize;
    const x0 = Math.floor(x / size), x1 = Math.floor((x + w) / size);
    const y0 = Math.floor(y / size), y1 = Math.floor((y + d) / size);
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        const key = (ix + BIAS) * SPAN + (iy + BIAS);
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(item);
        else {
          const fresh = this.spare.pop() ?? [];
          fresh.push(item);
          this.cells.set(key, fresh);
        }
      }
    }
  }

  query(x: number, y: number, w: number, d: number, out: T[]): T[] {
    out.length = 0;
    const size = this.cellSize;
    const x0 = Math.floor(x / size), x1 = Math.floor((x + w) / size);
    const y0 = Math.floor(y / size), y1 = Math.floor((y + d) / size);
    if (x0 === x1 && y0 === y1) {
      const bucket = this.cells.get((x0 + BIAS) * SPAN + (y0 + BIAS));
      if (bucket) for (let i = 0; i < bucket.length; i++) out.push(bucket[i]!);
      return out;
    }
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) this.collect(this.cells.get((ix + BIAS) * SPAN + (iy + BIAS)), out);
    }
    this.seen.clear();
    return out;
  }

  /** Append a bucket's items not yet reported in this query. */
  private collect(bucket: T[] | undefined, out: T[]): void {
    if (!bucket) return;
    for (let i = 0; i < bucket.length; i++) {
      const item = bucket[i]!;
      if (this.seen.has(item)) continue;
      this.seen.add(item);
      out.push(item);
    }
  }
}
