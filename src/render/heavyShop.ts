import { ATTACHMENT_IDS, CORE_MAX_LEVEL, CORE_TRACKS, skunkworksUnlocked, type AttachmentId, type AttachmentTier, type CareerStore } from '../game/career';
import {
  ATTACHMENTS,
  CORE_TRACK_NAMES,
  LIVERY_NAMES,
  PRESTIGE,
  attachmentCost,
  buyAttachment,
  buyCore,
  buyPrestige,
  coreTrackCost,
  coreTrackStat,
  equip,
  setLivery,
  type PurchaseResult,
} from '../game/careerShop';

type Tab = 'core' | 'skunkworks' | 'prestige';
const TIER = ['—', 'Mk I', 'Mk II', 'Mk III'] as const;
const money = (n: number) => '$' + Math.floor(n).toLocaleString('en-US');

export interface HeavyShopActions {
  close(): void;
  resetRange(): void;
  click(): void;
  purchased(): void;
}

/**
 * The Heavy Shop: the Home Yard garage overlay. Core Tracks, Skunkworks attachments and the
 * Prestige / Yard tab, with the banked wallet and a current → next stat preview on every row.
 */
export class HeavyShop {
  readonly root = document.createElement('section');
  private tab: Tab = 'core';
  private message = '';

  constructor(host: HTMLElement, private readonly career: CareerStore, private readonly actions: HeavyShopActions) {
    this.root.className = 'overlay heavy-shop';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Heavy Shop');
    this.root.hidden = true;
    host.append(this.root);
    this.root.addEventListener('click', e => this.onClick(e));
    this.root.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.actions.close(); }
    });
    career.onChange(() => { if (!this.root.hidden) this.render(); });
  }

  show(): void {
    this.message = '';
    this.root.hidden = false;
    this.root.style.display = 'flex';
    this.render();
    this.root.querySelector<HTMLButtonElement>('[data-shop-close]')?.focus();
  }

  hide(): void {
    this.root.hidden = true;
    this.root.style.display = '';
  }

  private onClick(e: Event): void {
    const button = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    this.actions.click();
    const d = button.dataset;
    if (d.shopClose !== undefined) return this.actions.close();
    if (d.shopReset !== undefined) { this.actions.resetRange(); this.message = 'Range rebuilt.'; return this.render(); }
    if (d.shopTab) { this.tab = d.shopTab as Tab; this.message = ''; return this.render(); }
    let result: PurchaseResult | undefined;
    if (d.buyCore) result = buyCore(this.career, d.buyCore as (typeof CORE_TRACKS)[number]);
    else if (d.buyAttachment) result = buyAttachment(this.career, d.buyAttachment as AttachmentId);
    else if (d.equip) result = equip(this.career, d.equip === 'none' ? null : d.equip as AttachmentId, d.slot as 'blade' | 'aux');
    else if (d.buyPrestige) result = buyPrestige(this.career, d.buyPrestige);
    else if (d.livery) result = setLivery(this.career, d.livery);
    if (!result) return;
    this.message = result.ok ? 'Installed.' : result.reason;
    if (result.ok) this.actions.purchased();
    this.render();
  }

  private render(): void {
    const p = this.career.profile;
    const unlocked = skunkworksUnlocked(p);
    const tabs: [Tab, string, boolean][] = [['core', 'Core Tracks', true], ['skunkworks', unlocked ? 'Skunkworks' : 'Skunkworks 🔒', unlocked], ['prestige', 'Prestige & Yard', true]];
    const focus = (document.activeElement as HTMLElement | null)?.dataset;
    const focusKey = focus ? Object.entries(focus).map(([k, v]) => `${k}=${v}`).join(';') : '';
    this.root.innerHTML = `<div class="panel shop-panel">
      <header class="shop-head"><div><span class="instrument-label">HOME YARD · HEAVY SHOP</span><h2>Garage Bay</h2></div>
        <div class="shop-wallet"><span class="instrument-label">BANKED</span><strong>${money(p.walletBalance)}</strong></div></header>
      <nav class="shop-tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${this.tab === id}" class="${this.tab === id ? 'primary' : ''}" data-shop-tab="${id}">${label}</button>`).join('')}</nav>
      <p class="shop-message" role="status">${this.message}</p>
      <div class="shop-body">${this.tab === 'core' ? this.coreHtml() : this.tab === 'skunkworks' ? this.skunkHtml(unlocked) : this.prestigeHtml()}</div>
      <footer class="shop-foot"><span class="fine-print">Lifetime banked ${money(p.lifetimeEarnedCash)} · ${p.lifetimeCellsDestroyed.toLocaleString('en-US')} cells wrecked</span>
        <div class="shop-foot-actions"><button type="button" data-shop-reset>Reset Range</button><button type="button" class="primary" data-shop-close>Roll Out</button></div></footer>
    </div>`;
    if (focusKey) {
      const selector = Object.entries(focus!).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${v}"]`).join('');
      this.root.querySelector<HTMLElement>(selector)?.focus();
    }
  }

  private coreHtml(): string {
    const p = this.career.profile;
    return CORE_TRACKS.map(track => {
      const level = p.coreUpgrades[track];
      const cost = coreTrackCost(track, level + 1);
      const pips = Array.from({ length: CORE_MAX_LEVEL }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
      const next = cost === null ? '<em>MAXED</em>' : `→ ${coreTrackStat(track, level + 1)}`;
      return `<div class="shop-row"><div class="shop-row-main"><strong>${CORE_TRACK_NAMES[track]}</strong><span class="shop-level">LVL ${level}/${CORE_MAX_LEVEL}</span>
        <div class="shop-pips" aria-hidden="true">${pips}</div><span class="fine-print">${coreTrackStat(track, level)} ${next}</span></div>
        <button type="button" data-buy-core="${track}" ${cost === null || cost > p.walletBalance ? 'disabled' : ''}>${cost === null ? 'MAX' : money(cost)}</button></div>`;
    }).join('');
  }

  private skunkHtml(unlocked: boolean): string {
    if (!unlocked) return '<p class="caution">Skunkworks opens when any core track reaches level 3.</p>';
    const p = this.career.profile;
    const slot = (kind: 'blade' | 'aux') => {
      const equipped = kind === 'blade' ? p.attachments.equippedBladeSlot : p.attachments.equippedAuxSlot;
      return `<span class="instrument-label">${kind === 'blade' ? 'BLADE SLOT (Q)' : 'AUX SLOT (SHIFT)'}: ${equipped ? ATTACHMENTS[equipped].name : 'EMPTY'}</span>`;
    };
    const rows = ATTACHMENT_IDS.map(id => {
      const spec = ATTACHMENTS[id];
      const owned = p.attachments.unlockedTiers[id] ?? 0;
      const equipped = p.attachments.equippedBladeSlot === id || p.attachments.equippedAuxSlot === id;
      const nextCost = owned < 3 ? attachmentCost(id, (owned + 1) as AttachmentTier) : null;
      const equip = owned ? `<button type="button" data-equip="${equipped ? 'none' : id}" data-slot="${spec.slot}">${equipped ? 'Unequip' : 'Equip'}</button>` : '';
      return `<div class="shop-row"><div class="shop-row-main"><strong>${spec.name}</strong><span class="shop-level">${TIER[owned]}${equipped ? ' · EQUIPPED' : ''}</span>
        <span class="fine-print">${spec.blurb}</span></div><div class="shop-row-actions">${equip}
        <button type="button" data-buy-attachment="${id}" ${nextCost === null || nextCost > p.walletBalance ? 'disabled' : ''}>${nextCost === null ? 'MK III' : `${TIER[owned + 1]} ${money(nextCost)}`}</button></div></div>`;
    }).join('');
    return `<div class="shop-slots">${slot('blade')}${slot('aux')}</div>${rows}`;
  }

  private prestigeHtml(): string {
    const p = this.career.profile;
    const liveries = Object.entries(LIVERY_NAMES).map(([id, name]) => {
      const item = PRESTIGE.find(x => x.id === id);
      const owned = p.cosmetics.unlockedIds.includes(id);
      const active = p.cosmetics.activeLiveryId === id;
      const action = owned
        ? `<button type="button" data-livery="${id}" ${active ? 'disabled' : ''}>${active ? 'Painted' : 'Paint'}</button>`
        : `<button type="button" data-buy-prestige="${id}" ${item!.cost > p.walletBalance ? 'disabled' : ''}>${money(item!.cost)}</button>`;
      return `<div class="shop-row"><div class="shop-row-main"><strong>${name}</strong><span class="fine-print">${item?.blurb ?? 'Factory paint.'}</span></div>${action}</div>`;
    }).join('');
    const yard = PRESTIGE.filter(x => x.kind === 'yard').map(item => {
      const owned = p.cosmetics.yardTier >= item.yardTier!;
      const next = item.yardTier === p.cosmetics.yardTier + 1;
      return `<div class="shop-row"><div class="shop-row-main"><strong>${item.name}</strong><span class="fine-print">${item.blurb}</span></div>
        <button type="button" data-buy-prestige="${item.id}" ${owned || !next || item.cost > p.walletBalance ? 'disabled' : ''}>${owned ? 'Built' : money(item.cost)}</button></div>`;
    }).join('');
    return `<h3 class="instrument-label">INDUSTRIAL LIVERIES</h3>${liveries}<h3 class="instrument-label">PROVING GROUND</h3>${yard}<p class="fine-print">Range upgrades appear the next time you roll into the yard.</p>`;
  }
}
