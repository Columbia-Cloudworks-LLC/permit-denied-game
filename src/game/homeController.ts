import { HeavyShop } from '../render/heavyShop';
import type { ParticlePool } from '../fx/particles';
import { dozerSpeed, type Dozer } from '../vehicle/dozer';
import { resetRange, type HomeYardOptions } from '../world/homeYard';
import type { HomeZone, Town } from '../world/town';
import type { CareerStore } from './career';

/** What the yard needs from the running game. */
export interface HomeHost {
  town(): Town;
  dozer(): Dozer;
  readonly career: CareerStore;
  readonly hudRoot: HTMLElement;
  readonly particles: ParticlePool;
  options(): HomeYardOptions;
  /** False during a replay: the shop and dispatch stay shut, the range reset still runs. */
  interactive(): boolean;
  /** Freeze play under the shop overlay. */
  enterShop(): void;
  /** Put the dozer at the apron exit with the career's current loadout, and resume play. */
  leaveShop(exit: { x: number; y: number; heading: number } | undefined): void;
  /** Pause over the yard with the atlas open. */
  dispatch(): void;
  sound(kind: 'click' | 'cash' | 'rumble'): void;
  invalidate(): void;
}

/**
 * The Home Yard's zone triggers and Heavy Shop. Stop on the apron to shop, roll over the reset
 * pad to rebuild the range, halt on the lowboy ramp to dispatch. Each trigger fires once per
 * entry; leaving the zone re-arms it.
 */
export class HomeYardController {
  private readonly latch = { apron: false, reset: false, lowboy: false };
  private shop?: HeavyShop;

  constructor(private readonly host: HomeHost) {}

  reset(): void {
    Object.assign(this.latch, { apron: false, reset: false, lowboy: false });
  }

  step(): void {
    const home = this.host.town().home;
    if (!home) return;
    const d = this.host.dozer(), speed = dozerSpeed(d);
    const at = (z: HomeZone) => d.x >= z.x && d.x <= z.x + z.w && d.y >= z.y && d.y <= z.y + z.d;
    const interactive = this.host.interactive();
    if (!at(home.apron)) this.latch.apron = false;
    else if (interactive && !this.latch.apron && speed < 0.75) { this.latch.apron = true; this.openShop(); return; }
    if (!at(home.reset)) this.latch.reset = false;
    else if (!this.latch.reset) { this.latch.reset = true; this.resetRange(); }
    if (!at(home.lowboy)) this.latch.lowboy = false;
    else if (interactive && !this.latch.lowboy && speed < 1.5) { this.latch.lowboy = true; this.host.dispatch(); }
  }

  openShop(): void {
    const host = this.host;
    this.shop ??= new HeavyShop(host.hudRoot, host.career, {
      close: () => this.closeShop(),
      resetRange: () => this.resetRange(),
      click: () => host.sound('click'),
      purchased: () => host.sound('cash'),
    });
    host.career.wash();
    host.enterShop();
    this.shop.show();
  }

  /** Roll out onto the apron's exit facing the yard, with whatever was just bought installed. */
  closeShop(): void {
    this.shop?.hide();
    this.host.leaveShop(this.host.town().home?.exit);
  }

  resetRange(): void {
    const town = this.host.town();
    if (!town.home) return;
    resetRange(town, this.host.dozer(), this.host.options(), this.host.particles);
    this.host.invalidate();
    this.host.sound('rumble');
  }

  hint(): string {
    const home = this.host.town().home;
    if (!home) return '';
    const d = this.host.dozer();
    const near = (z: HomeZone) => Math.hypot(d.x - (z.x + z.w / 2), d.y - (z.y + z.d / 2));
    if (near(home.apron) < 9) return 'Stop on the yellow apron to open the Heavy Shop.';
    if (near(home.lowboy) < 9) return 'Halt on the orange lowboy ramp to dispatch to a county.';
    if (home.lanes.some(z => d.y >= z.y - 2)) return 'Proving ground: free test wrecks, no pay. Blue pad or T rebuilds the range.';
    return 'Yellow apron: Heavy Shop · Orange ramp: dispatch · Blue pad: reset range.';
  }
}
