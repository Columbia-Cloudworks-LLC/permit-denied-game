import { Container, Graphics } from 'pixi.js';

export interface CachedDraw {
  key?: string;
  version?: string | number;
  /** Screen-space shift applied without repainting, for geometry that only translates. */
  offsetY?: number;
  run: (g: Graphics) => void;
}

/** Keep GPU geometry only for currently submitted objects, in painter order. */
export class DrawCache {
  readonly root = new Container();
  private entries = new Map<string, { graphic: Graphics; version?: string | number }>();
  rebuilt = 0;
  get size(): number { return this.entries.size; }
  keys(): string[] { return [...this.entries.keys()].sort(); }
  draw(commands: readonly CachedDraw[]): void {
    this.rebuilt = 0;
    const used = new Set<string>();
    const order: Graphics[] = [];
    commands.forEach((cmd, i) => {
      const key = cmd.key ?? `dynamic:${i}`;
      used.add(key);
      let entry = this.entries.get(key);
      if (!entry) {
        entry = { graphic: new Graphics() };
        this.entries.set(key, entry);
      }
      if (cmd.version === undefined || entry.version !== cmd.version) {
        entry.graphic.clear(); cmd.run(entry.graphic);
        entry.version = cmd.version;
        this.rebuilt++;
      }
      entry.graphic.y = cmd.offsetY ?? 0;
      order.push(entry.graphic);
    });
    for (const [key, entry] of this.entries) if (!used.has(key)) {
      entry.graphic.destroy({ context: true });
      this.entries.delete(key);
    }
    // Re-parenting every child with addChild is an indexOf + splice each (O(n^2));
    // keep the matching prefix and rebuild only the tail that changed.
    const children = this.root.children;
    let same = 0;
    while (same < order.length && children[same] === order[same]) same++;
    if (same === order.length && children.length === order.length) return;
    if (same < children.length) this.root.removeChildren(same);
    for (let i = same; i < order.length; i++) this.root.addChild(order[i]!);
  }
  clear(): void {
    for (const entry of this.entries.values()) entry.graphic.destroy({ context: true });
    this.entries.clear();
  }
}
