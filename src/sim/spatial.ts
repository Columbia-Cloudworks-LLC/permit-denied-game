export class SpatialHash<T> {
  private readonly cells = new Map<string, T[]>();

  constructor(private readonly cellSize: number) {}

  clear(): void {
    this.cells.clear();
  }

  private key(ix: number, iy: number): string {
    return `${ix},${iy}`;
  }

  /** Visit the key of every cell the box touches. */
  private forCells(x: number, y: number, w: number, d: number, visit: (key: string) => void): void {
    const x0 = Math.floor(x / this.cellSize);
    const y0 = Math.floor(y / this.cellSize);
    const x1 = Math.floor((x + w) / this.cellSize);
    const y1 = Math.floor((y + d) / this.cellSize);
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) visit(this.key(ix, iy));
    }
  }

  insert(x: number, y: number, w: number, d: number, item: T): void {
    this.forCells(x, y, w, d, (k) => {
      let bucket = this.cells.get(k);
      if (!bucket) {
        bucket = [];
        this.cells.set(k, bucket);
      }
      bucket.push(item);
    });
  }

  query(x: number, y: number, w: number, d: number, out: T[]): T[] {
    out.length = 0;
    const seen = new Set<T>();
    this.forCells(x, y, w, d, (k) => {
      for (const item of this.cells.get(k) ?? []) {
        if (seen.has(item)) continue;
        seen.add(item);
        out.push(item);
      }
    });
    return out;
  }
}
