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

/**
 * A small career readout under the top bar: wallet and zone hints in the yard; escrow, Salvage
 * combo and attachment charge during a run. The attachment gauges double as touch buttons.
 */
export class CareerStrip {
  readonly root = document.createElement('div');
  private readonly banked = document.createElement('div');
  private last = '';
  onBlade?: () => void;
  onAux?: () => void;

  constructor(host: HTMLElement) {
    this.root.className = 'career-strip';
    this.root.setAttribute('aria-live', 'polite');
    this.banked.className = 'career-banked';
    this.banked.hidden = true;
    host.append(this.root, this.banked);
    this.root.addEventListener('click', e => {
      const slot = (e.target as Element).closest<HTMLElement>('[data-rig]')?.dataset.rig;
      if (slot === 'blade') this.onBlade?.();
      if (slot === 'aux') this.onAux?.();
    });
  }

  update(s: CareerStripState | null): void {
    const key = s ? JSON.stringify([s.home, s.run && [Math.floor(s.run.escrow), s.run.multiplier.toFixed(2), s.run.comboCells, Math.round(s.run.comboFill * 20)],
      s.rig.blade && [s.rig.blade.status, Math.round(s.rig.blade.fill * 30)], s.rig.aux && [s.rig.aux.status, Math.round(s.rig.aux.fill * 30)], s.banked, s.bladeFlash]) : '';
    if (key === this.last) return;
    this.last = key;
    this.root.hidden = !s;
    this.banked.hidden = !s?.banked;
    if (!s) return;
    const parts: string[] = [];
    if (s.home) parts.push(`<div class="career-cell"><span class="instrument-label">BANKED</span><strong>${money(s.home.wallet)}</strong></div><div class="career-hint">${s.home.hint}</div>`);
    if (s.run) {
      const combo = s.run.comboCells > 0 ? `<span class="career-combo"><i style="width:${Math.round(s.run.comboFill * 100)}%"></i></span><small>${s.run.comboCells} CHAIN</small>` : '';
      parts.push(`<div class="career-cell"><span class="instrument-label">ESCROW</span><strong>${money(s.run.escrow)}</strong></div><div class="career-cell"><span class="instrument-label">SALVAGE</span><strong>${s.run.multiplier.toFixed(2)}×</strong>${combo}</div>`);
    }
    for (const slot of ['blade', 'aux'] as const) {
      const r = s.rig[slot];
      if (!r) continue;
      const hot = r.status === 'READY' || r.status === 'ARMED' || r.status === 'BURN' || r.status === 'TAUT' || r.status === 'DOWN';
      const flash = slot === 'blade' && s.bladeFlash ? ' career-flash' : '';
      parts.push(`<button type="button" class="career-rig${hot ? ' hot' : ''}${flash}" data-rig="${slot}" aria-label="${r.label} ${r.status}"><span class="instrument-label">${r.label} · ${slot === 'blade' ? 'Q' : 'SHIFT'}</span><span class="career-meter"><i style="width:${Math.round(Math.max(0, Math.min(1, r.fill)) * 100)}%"></i></span><strong>${r.status}${flash ? ' · BLADE DOWN!' : ''}</strong></button>`);
    }
    this.root.innerHTML = parts.join('');
    if (s.banked) this.banked.innerHTML = `<span class="instrument-label">${s.banked.label}</span><strong>+${money(s.banked.payout)}</strong><small>Wallet ${money(s.banked.wallet)}</small>`;
  }
}
