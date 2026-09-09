export class SpatialHash<T> {
  private readonly cells = new Map<number, T[]>();

  constructor(private readonly cellSize: number) {}

  clear(): void {
    this.cells.clear();
  }

  private key(ix: number, iy: number): number {
    return (ix + 512) * 1024 + (iy + 512);
  }

  insert(x: number, y: number, w: number, d: number, item: T): void {
    const x0 = Math.floor(x / this.cellSize);
    const y0 = Math.floor(y / this.cellSize);
    const x1 = Math.floor((x + w) / this.cellSize);
    const y1 = Math.floor((y + d) / this.cellSize);
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        const k = this.key(ix, iy);
        let bucket = this.cells.get(k);
        if (!bucket) {
          bucket = [];
          this.cells.set(k, bucket);
        }
        bucket.push(item);
      }
    }
  }

  query(x: number, y: number, w: number, d: number, out: T[]): T[] {
    out.length = 0;
    const seen = new Set<T>();
    const x0 = Math.floor(x / this.cellSize);
    const y0 = Math.floor(y / this.cellSize);
    const x1 = Math.floor((x + w) / this.cellSize);
    const y1 = Math.floor((y + d) / this.cellSize);
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        const bucket = this.cells.get(this.key(ix, iy));
        if (!bucket) continue;
        for (const item of bucket) {
          if (seen.has(item)) continue;
          seen.add(item);
          out.push(item);
        }
      }
    }
    return out;
  }
}
