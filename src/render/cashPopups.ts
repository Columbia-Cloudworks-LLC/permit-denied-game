import { Container, Text } from 'pixi.js';
import { worldToScreen } from '../world/iso';
import type { SalvageKind, WorldEvent } from '../structure/types';

export const POPUP_SECONDS = 1.25;
/** Credits landing this close to a fresh popup add to it instead of stacking a new one. */
const MERGE_RADIUS = 3;
const MERGE_AGE = 0.55;
const MAX_POPUPS = 10;

interface Popup { node: Text; x: number; y: number; z: number; amount: number; shown: number; age: number; salvage?: SalvageKind }

/** Scrap pops up in its own metal: copper for coils and windings, steel grey for mixed mechanical scrap. */
const SALVAGE_STYLE: Record<SalvageKind, { label: string; fill: number }> = {
  copper: { label: 'COPPER', fill: 0xf0955a },
  mechanical: { label: 'SCRAP', fill: 0xc3d0d6 },
};

/** `+$120`, or `+$120 COPPER` for salvage. */
export function popupText(whole: number, salvage?: SalvageKind): string {
  const cash = '+$' + whole.toLocaleString('en-US');
  return salvage ? cash + ' ' + SALVAGE_STYLE[salvage].label : cash;
}

/** Floating `+$X` markers anchored to the world spot that paid, sized for the screen. */
export class CashPopups {
  readonly root = new Container();
  private popups: Popup[] = [];

  get count(): number { return this.popups.length; }
  amounts(): number[] { return this.popups.map(p => Math.floor(p.amount)); }

  /** Salvage credits keep their own labelled popup: they merge only with the same scrap, never with plain cash. */
  credit(amount: number, x: number, y: number, z: number, salvage?: SalvageKind): void {
    if (!(amount > 0)) return;
    const near = this.popups.find(p => p.salvage === salvage && p.age < MERGE_AGE && Math.hypot(p.x - x, p.y - y) < MERGE_RADIUS);
    if (near) {
      near.amount += amount;
      near.age = Math.min(near.age, 0.12);
      return;
    }
    if (this.popups.length === MAX_POPUPS) this.popups.shift()!.node.destroy();
    const node = new Text({ text: '', style: {
      fontFamily: 'Arial', fontSize: 17, fontWeight: '900', fill: salvage ? SALVAGE_STYLE[salvage].fill : 0xffd66f,
      stroke: { color: 0x1a140c, width: 4 }, dropShadow: { color: 0x000000, alpha: 0.5, distance: 2, blur: 1, angle: Math.PI / 2 },
    } });
    node.anchor.set(0.5, 1);
    this.root.addChild(node);
    this.popups.push({ node, x, y, z, amount, shown: -1, age: 0, salvage });
  }

  clear(): void {
    for (const p of this.popups) p.node.destroy();
    this.popups = [];
  }

  draw(dt: number, zoom: number): void {
    for (const p of this.popups) p.age += dt;
    for (const p of this.popups) if (p.age >= POPUP_SECONDS) p.node.destroy();
    this.popups = this.popups.filter(p => p.age < POPUP_SECONDS);
    for (const p of this.popups) {
      const whole = Math.floor(p.amount);
      p.node.visible = whole >= 1;
      if (whole !== p.shown) { p.node.text = popupText(whole, p.salvage); p.shown = whole; }
      const at = worldToScreen(p.x, p.y, p.z), t = p.age / POPUP_SECONDS;
      // Pop in, drift up at constant screen speed, and fade over the last third.
      const pop = 1 + 0.25 * Math.max(0, 1 - p.age / 0.16);
      p.node.position.set(at.x, at.y - (14 + (p.salvage ? 20 : 0) + t * 46) / zoom);
      p.node.scale.set(pop / zoom);
      p.node.alpha = Math.min(1, (1 - t) * 3);
    }
  }
}

const DAMAGE_KINDS = new Set<WorldEvent['kind']>(['breach', 'chip', 'impact', 'collapse', 'crush', 'snap', 'blast']);

/** Where a step's earnings came from: the last paying event, else the last damage, else unknown. */
export function cashAnchor(events: readonly WorldEvent[]): { x: number; y: number; z: number } | undefined {
  let damage: WorldEvent | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if ((e.cash ?? 0) > 0) return e;
    damage ??= DAMAGE_KINDS.has(e.kind) ? e : undefined;
  }
  return damage;
}
