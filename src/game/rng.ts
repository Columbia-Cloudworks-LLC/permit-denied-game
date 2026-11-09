export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  reset(seed: number): void {
    this.s = seed >>> 0;
  }

  next(): number {
    this.s = (1664525 * this.s + 1013904223) >>> 0;
    return this.s / 0x100000000;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1 - 1e-9));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick called with no items");
    return items[this.int(0, items.length - 1)]!;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** FNV-1a over a stable text key, then one LCG step so short keys still spread. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (Math.imul(h >>> 0, 1664525) + 1013904223) >>> 0;
}

/** Murmur3 finalizer: spreads nearby seeds before an Rng's first draw, which barely moves for them. */
export function mixSeed(seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
