import { Container, Graphics } from 'pixi.js';

export interface CachedDraw {
  key?: string;
  version?: string | number;
  run: (g: Graphics) => void;
}

/** Keep GPU geometry only for currently submitted objects, in painter order. */
export class DrawCache {
  readonly root = new Container();
  private entries = new Map<string, { graphic: Graphics; version?: string | number }>();
  rebuilt = 0;
  get size(): number { return this.entries.size; }
  draw(commands: readonly CachedDraw[]): void {
    this.rebuilt = 0;
    const used = new Set<string>();
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
      this.root.addChild(entry.graphic);
    });
    for (const [key, entry] of this.entries) if (!used.has(key)) {
      entry.graphic.destroy({ context: true });
      this.entries.delete(key);
    }
  }
  clear(): void {
    for (const entry of this.entries.values()) entry.graphic.destroy({ context: true });
    this.entries.clear();
  }
}
