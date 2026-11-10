import type { RigReadout } from '../vehicle/attachments';

export interface CareerStripState {
  /** Home Yard: the banked wallet and the zone hint. */
  home?: { wallet: number; hint: string };
  /** County run: escrow, live multiplier, and the combo chain. */
  run?: { escrow: number; multiplier: number; comboCells: number; comboFill: number };
  rig: RigReadout;
  /** Settlement shown on the results card. */
  banked?: { payout: number; label: string; wallet: number };
  bladeFlash: boolean;
}

const money = (n: number) => '$' + Math.floor(n).toLocaleString('en-US');
const HOT = new Set(['READY', 'ARMED', 'BURN', 'TAUT', 'DOWN']);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.innerHTML = html;
  return node;
}

/** One attachment gauge. The button node is built once and only its text and meter change. */
class RigButton {
  readonly root = el('button', 'career-rig');
  private readonly label = el('span', 'instrument-label');
  private readonly meter = el('i', '');
  private readonly status = el('strong', '');
  private readonly key: string;

  constructor(slot: 'blade' | 'aux') {
    this.root.type = 'button';
    this.root.dataset.rig = slot;
    this.key = slot === 'blade' ? 'Q' : 'SHIFT';
    const track = el('span', 'career-meter');
    track.append(this.meter);
    this.root.append(this.label, track, this.status);
    this.root.hidden = true;
  }

  update(r: { label: string; fill: number; status: string } | undefined, flash: boolean): void {
    this.root.hidden = !r;
    if (!r) return;
    setText(this.label, `${r.label} · ${this.key}`);
    setText(this.status, flash ? `${r.status} · BLADE DOWN!` : r.status);
    this.meter.style.width = `${Math.round(Math.max(0, Math.min(1, r.fill)) * 100)}%`;
    this.root.classList.toggle('hot', HOT.has(r.status));
    this.root.classList.toggle('career-flash', flash);
    this.root.setAttribute('aria-label', `${r.label} ${r.status}`);
  }
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/**
 * A small career readout under the top bar: wallet and zone hints in the yard; escrow, Salvage
 * combo and attachment charge during a run. The attachment gauges double as touch buttons, so
 * every node is built once and updated in place: a refresh between pointer-down and pointer-up
 * must not swap the button out from under the press, or drop keyboard focus.
 */
export class CareerStrip {
  readonly root = el('div', 'career-strip');
  private readonly banked = el('div', 'career-banked');
  private readonly wallet = el('div', 'career-cell', '<span class="instrument-label">BANKED</span><strong></strong>');
  private readonly hint = el('div', 'career-hint');
  private readonly escrow = el('div', 'career-cell', '<span class="instrument-label">ESCROW</span><strong></strong>');
  private readonly salvage = el('div', 'career-cell', '<span class="instrument-label">SALVAGE</span><strong></strong><span class="career-combo"><i></i></span><small></small>');
  private readonly blade = new RigButton('blade');
  private readonly aux = new RigButton('aux');
  onBlade?: () => void;
  onAux?: () => void;

  constructor(host: HTMLElement) {
    this.root.setAttribute('aria-live', 'polite');
    this.banked.hidden = true;
    this.root.append(this.wallet, this.hint, this.escrow, this.salvage, this.blade.root, this.aux.root);
    host.append(this.root, this.banked);
    this.root.addEventListener('click', e => {
      const slot = (e.target as Element).closest<HTMLElement>('[data-rig]')?.dataset.rig;
      if (slot === 'blade') this.onBlade?.();
      if (slot === 'aux') this.onAux?.();
    });
  }

  update(s: CareerStripState | null): void {
    this.root.hidden = !s;
    this.banked.hidden = !s?.banked;
    if (!s) return;
    this.wallet.hidden = this.hint.hidden = !s.home;
    if (s.home) {
      setText(this.wallet.querySelector('strong')!, money(s.home.wallet));
      setText(this.hint, s.home.hint);
    }
    this.escrow.hidden = this.salvage.hidden = !s.run;
    if (s.run) {
      setText(this.escrow.querySelector('strong')!, money(s.run.escrow));
      setText(this.salvage.querySelector('strong')!, `${s.run.multiplier.toFixed(2)}×`);
      const chained = s.run.comboCells > 0;
      const combo = this.salvage.querySelector<HTMLElement>('.career-combo')!;
      combo.hidden = !chained;
      combo.querySelector('i')!.style.width = `${Math.round(s.run.comboFill * 100)}%`;
      setText(this.salvage.querySelector('small')!, chained ? `${s.run.comboCells} CHAIN` : '');
    }
    this.blade.update(s.rig.blade, s.bladeFlash);
    this.aux.update(s.rig.aux, false);
    if (s.banked) {
      const html = `<span class="instrument-label">${s.banked.label}</span><strong>+${money(s.banked.payout)}</strong><small>Wallet ${money(s.banked.wallet)}</small>`;
      if (this.banked.innerHTML !== html) this.banked.innerHTML = html;
    }
  }
}
