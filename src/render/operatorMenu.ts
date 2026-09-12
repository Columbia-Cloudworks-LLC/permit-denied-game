import { CASH_TARGET, MATCH_SECONDS, TITLE } from '../game/constants';
import { PermitIntro, permitDocument, type PermitSound } from './permitIntro';
import type { DistrictId, SessionKind } from '../game/session';
import { version } from '../../package.json';
import notices from './thirdPartyNotices.txt?raw';

type Page = 'home' | 'dispatch' | 'controls' | 'about';
export interface MenuActions {
  resume(): void;
  start(kind: SessionKind, district: DistrictId): void;
  job(): void;
  restart(): void;
  newLot(): void;
  title(): void;
  mute(): void;
  click(): void;
  debug(): void;
  unlockSound(): Promise<void>;
  titleSound(kind: PermitSound, index: number): void;
}

const copyright = '© 2026 Columbia Cloudworks LLC. All rights reserved.';

/** One navigation and focus owner for keyboard, mouse and touch menus. */
export class OperatorMenu {
  readonly root = document.createElement('section');
  private body: HTMLElement;
  private heading: HTMLElement;
  private mode: 'title' | 'pause' | null = null;
  private covered = false;
  private page: Page = 'home';
  private session: SessionKind = 'challenge';
  private district: DistrictId = 'classic';
  private readonly intro = new PermitIntro();
  private introVersion = 0;

  private playIntro(): void {
    const paper = this.body.querySelector<HTMLElement>('.permit-paper');
    if (paper) this.intro.play(paper, (kind, index) => {
      if (!document.hidden) this.actions.titleSound(kind, index);
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  private replayIntro(): void {
    const version = ++this.introVersion;
    const play = () => { if (version === this.introVersion && this.mode === 'title' && this.page === 'home') this.playIntro(); };
    void this.actions.unlockSound().then(play, play);
  }

  constructor(parent: HTMLElement, private actions: MenuActions) {
    this.root.className = 'operator-menu';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'operator-heading');
    this.root.innerHTML = `<div class="console-panel"><div class="menu-heading"><div><h1 id="operator-heading" tabindex="-1"></h1></div><button data-nav="back" aria-label="Back">← BACK</button></div><div class="menu-body"></div><footer class="nameplate"><span>${copyright}</span></footer></div>`;
    this.body = this.root.querySelector('.menu-body')!;
    this.heading = this.root.querySelector('#operator-heading')!;
    parent.append(this.root);
    this.root.addEventListener('click', e => {
      if ((e.target as Element).closest('[data-replay-permit]')) { this.replayIntro(); return; }
      const button = (e.target as Element).closest<HTMLButtonElement>('button');
      if (!button || button.disabled) return;
      this.actions.click();
      const nav = button.dataset.nav;
      if (nav === 'back') this.back();
      else if (nav) this.navigate(nav as Page);
      const action = button.dataset.menuAction;
      if (action === 'debug') this.actions.debug();
      if (action === 'resume') this.actions.resume();
      if (action === 'restart') this.actions.restart();
      if (action === 'newlot') this.actions.newLot();
      if (action === 'title') this.actions.title();
      if (action === 'job') this.actions.job();
      if (action === 'mute') this.actions.mute();
      if (action === 'start') {
        const kind = this.body.querySelector<HTMLSelectElement>('#dispatch-mode')!.value as SessionKind;
        const district = this.body.querySelector<HTMLSelectElement>('#dispatch-lot')!.value as DistrictId;
        this.actions.start(kind, district);
      }
    });
    // Handle menu navigation before focused controls consume the key.
    this.root.addEventListener('keydown', e => {
      if (['Enter', ' '].includes(e.key) && (e.target as Element).closest('[data-replay-permit]')) {
        e.preventDefault();
        if (!e.repeat) this.replayIntro();
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.back(); }
      if (e.key.toLowerCase() === 'm' && !e.repeat && !(e.target as Element).closest('input, select, textarea')) this.actions.mute();
      if (e.key !== 'Tab') return;
      const nodes = [...this.root.querySelectorAll<HTMLElement>('button, a[href], input, select, summary, [tabindex="0"]')]
        .filter(el => !el.closest('[hidden]') && !el.matches(':disabled') && el.getClientRects().length);
      const first = nodes[0], last = nodes.at(-1);
      if (!first) { e.preventDefault(); this.heading.focus(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === this.heading)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === this.heading)) { e.preventDefault(); first.focus(); }
    }, true);
  }

  show(mode: 'title' | 'pause' | null, session: SessionKind, district: DistrictId): void {
    this.session = session;
    this.district = district;
    if (this.mode === mode) return;
    this.mode = mode;
    this.root.hidden = !mode || this.covered;
    if (mode) {
      this.navigate('home');
    } else {
      this.introVersion++;
      this.intro.stop();
      if (!this.covered) document.querySelector<HTMLCanvasElement>('#game-root canvas')?.focus();
    }
  }

  setCovered(covered: boolean): void {
    if (this.covered === covered) return;
    this.covered = covered;
    this.root.hidden = !this.mode || covered;
    if (covered) { this.introVersion++; this.intro.stop(); }
    else if (this.mode) {
      this.root.querySelector<HTMLButtonElement>('[data-menu-action="debug"]')?.focus();
      if (this.mode === 'title' && this.page === 'home') this.playIntro();
    }
  }

  back(): void {
    if (this.page !== 'home') this.navigate('home');
    else if (this.mode === 'pause') this.actions.resume();
  }

  syncMuted(muted: boolean): void {
    const button = this.root.querySelector<HTMLButtonElement>('[data-menu-action="mute"]');
    if (button) { button.textContent = muted ? 'SOUND OFF' : 'SOUND ON'; button.setAttribute('aria-pressed', String(!muted)); }
  }

  private navigate(page: Page): void {
    this.introVersion++;
    this.intro.stop();
    this.page = page;
    this.root.classList.toggle('title-open', this.mode === 'title' && page === 'home');
    this.root.querySelector<HTMLButtonElement>('[data-nav="back"]')!.hidden = page === 'home';
    const titles = { home: this.mode === 'title' ? TITLE : 'Paused', dispatch: 'Choose Site', controls: 'Controls', about: 'About' };
    this.heading.textContent = titles[page];
    this.root.querySelector<HTMLElement>('.nameplate')!.hidden = !(this.mode === 'title' && page === 'home') && page !== 'about';
    if (page === 'home') this.body.innerHTML = `${this.mode === 'title'
      ? `${permitDocument()}<button class="ignition primary" data-nav="dispatch"><span class="ignition-symbol">⏻</span><span>PLAY</span><span>↗</span></button>`
      : `<button class="primary" data-menu-action="resume">RESUME</button><div class="menu-grid"><button data-menu-action="restart">RESTART</button><button data-menu-action="newlot">NEW LOT</button></div>`}
      <nav class="menu-grid" aria-label="Operator menu">${this.mode === 'pause' ? '<button data-nav="dispatch">CHANGE SITE</button>' : ''}<button data-nav="controls">CONTROLS</button><button data-menu-action="mute">SOUND ON</button><button data-nav="about">ABOUT</button><button data-menu-action="debug">DEBUG</button>${this.mode === 'pause' ? '<button data-menu-action="title">TITLE SCREEN</button>' : ''}</nav>`;
    if (page === 'dispatch') this.body.innerHTML = `<div class="dispatch-fields"><label>MODE<select id="dispatch-mode"><option value="challenge">County Clock</option><option value="sandbox">Sandbox</option></select></label><label>SITE SIZE<select id="dispatch-lot"><option value="classic">Classic / test yard</option><option value="d10">10 buildings</option><option value="d30">30 buildings</option><option value="d100">100 buildings</option></select></label></div><p class="fine-print">County clock: earn $${CASH_TARGET.toLocaleString()} before ${MATCH_SECONDS / 60} minutes. Heat and track stress can end the run. Sandbox: no deadline or breakdowns; the classic site is an asset test yard.</p>${this.mode === 'pause' ? '<p class="caution">Starting a site replaces this run and its upgrades.</p>' : ''}<button class="primary" data-menu-action="start">START</button><button class="contract-choice" data-menu-action="job">BRICK CONTRACT</button>`;
    if (page === 'dispatch') {
      this.body.querySelector<HTMLSelectElement>('#dispatch-mode')!.value = this.session;
      this.body.querySelector<HTMLSelectElement>('#dispatch-lot')!.value = this.district;
    }
    if (page === 'controls') this.body.innerHTML = `<dl class="control-list"><div><dt>W / S or ↑ / ↓</dt><dd>Drive forward / reverse</dd></div><div><dt>A / D or ← / →</dt><dd>Steer left / right</dd></div><div><dt>Hold SPACE</dt><dd>Power the blade</dd></div><div><dt>ESC / MENU</dt><dd>Pause / resume</dd></div><div><dt>R / N</dt><dd>Restart site / new lot</dd></div><div><dt>1 / 2 / 3</dt><dd>Blade / engine / push upgrade</dd></div><div><dt>M</dt><dd>Toggle sound</dd></div></dl><div class="instruction-card"><strong>TOUCH OPERATION</strong><p>Drag the left stick to drive and steer. Hold the right POWER BLADE button while driving. Release the stick to coast. Release the blade to finish the current push.</p></div><p class="fine-print">Watch ENGINE HEAT and TRACK STRESS. Above 65%, release the blade or back off rubble. In sandbox these gauges remain advisory.</p>`;
    if (page === 'about') {
      this.body.innerHTML = `<dl class="credits-list"><div><dt>PUBLISHER</dt><dd>Columbia Cloudworks LLC</dd></div><div><dt>WEBSITE</dt><dd><a href="https://columbiacloudworks.com" target="_blank" rel="noopener noreferrer">columbiacloudworks.com ↗</a></dd></div><div><dt>CONTACT</dt><dd><a href="mailto:nicholas.king@columbiacloudworks.com">nicholas.king@columbiacloudworks.com</a></dd></div><div><dt>GAME</dt><dd><a href="https://permitdenied.app" target="_blank" rel="noopener noreferrer">permitdenied.app ↗</a></dd></div><div><dt>VERSION</dt><dd>${version}</dd></div></dl><details class="license-notices"><summary>Third-party software notices</summary><pre></pre></details>`;
      this.body.querySelector('pre')!.textContent = notices;
    }
    this.heading.focus();
    this.root.querySelector('.console-panel')!.scrollTop = 0;
    if (this.mode === 'title' && page === 'home') this.playIntro();
  }
}
