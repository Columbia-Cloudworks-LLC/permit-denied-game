import { TITLE } from '../game/constants';
import { PermitIntro, permitDocument, type PermitSound } from './permitIntro';
import { playableDistrict, type DistrictId, type SessionKind, type LayoutChoice } from '../game/session';
import { MENU_LABELS as L, MODE_LABELS, MODE_DESCRIPTIONS, SITE_LABELS } from '../game/menuLabels';
import { version } from '../../package.json';
import notices from './thirdPartyNotices.txt?raw';

type Page = 'home' | 'dispatch' | 'controls' | 'about' | 'equipment' | 'debug';
export interface MenuActions {
  page?(page: Page | null, host?: HTMLElement): void;
  resume(): void;
  start(kind: SessionKind, district: DistrictId, layout: LayoutChoice): void;
  restart(): void;
  title(): void;
  mute(): void;
  click(): void;
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
  private page: Page = 'home';
  private session: SessionKind = 'challenge';
  private district: DistrictId = 'classic';
  private layout: LayoutChoice = 'standard';
  private muted = false;
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
    this.root.innerHTML = `<div class="console-panel"><div class="menu-heading"><div><h1 id="operator-heading" tabindex="-1"></h1></div><button data-nav="back" aria-label="Back">← Back</button></div><div class="menu-body"></div><footer class="nameplate"><span>${copyright}</span></footer></div>`;
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
      if (action === 'resume') this.actions.resume();
      if (action === 'restart') this.actions.restart();
      if (action === 'title') this.actions.title();
      if (action === 'mute') this.actions.mute();
      if (action === 'start') {
        this.actions.start(this.session, this.district, this.layout);
      }
    });
    this.body.addEventListener('change', e => {
      const input = e.target as HTMLSelectElement;
      if (input.id === 'dispatch-mode') {
        this.session = input.value as SessionKind;
        this.district = playableDistrict(this.session, this.district);
        this.syncSetup();
      }
      if (input.id === 'dispatch-lot') this.district = input.value as DistrictId;
      if (input.id === 'dispatch-layout') this.layout = input.value as LayoutChoice;
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

  show(mode: 'title' | 'pause' | null, session: SessionKind, district: DistrictId, developmentScenario = false): void {
    if (this.mode === mode) return;
    if (mode === 'pause') {
      this.session = session;
      this.district = developmentScenario ? 'd10' : playableDistrict(session, district);
      this.layout = 'standard';
    }
    this.mode = mode;
    this.root.hidden = !mode;
    if (mode) {
      this.navigate('home');
    } else {
      this.actions.page?.(null);
      this.introVersion++;
      this.intro.stop();
      document.querySelector<HTMLCanvasElement>('#game-root canvas')?.focus();
    }
  }

  get debugOpen(): boolean { return this.mode === 'pause' && this.page === 'debug'; }

  back(): void {
    if (this.page !== 'home') this.navigate('home');
    else if (this.mode === 'pause') this.actions.resume();
  }

  syncMuted(muted: boolean): void {
    this.muted = muted;
    const button = this.root.querySelector<HTMLButtonElement>('[data-menu-action="mute"]');
    if (button) { button.textContent = muted ? L.soundOff : L.soundOn; button.setAttribute('aria-pressed', String(!muted)); }
  }

  private syncSetup(): void {
    this.body.querySelector<HTMLSelectElement>('#dispatch-mode')!.value = this.session;
    const sizes = this.body.querySelector<HTMLSelectElement>('#dispatch-lot')!;
    sizes.innerHTML = Object.entries(SITE_LABELS).filter(([id]) => this.session !== 'sandbox' || id !== 'classic')
      .map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
    sizes.value = this.district;
    this.body.querySelector<HTMLSelectElement>('#dispatch-layout')!.value = this.layout;
    this.body.querySelector('#mode-description')!.textContent = MODE_DESCRIPTIONS[this.session];
  }

  private navigate(page: Page): void {
    this.introVersion++;
    this.intro.stop();
    this.actions.page?.(null);
    this.page = page;
    this.root.classList.toggle('title-open', this.mode === 'title' && page === 'home');
    this.root.querySelector<HTMLButtonElement>('[data-nav="back"]')!.hidden = page === 'home' || page === 'dispatch';
    const titles = { home: this.mode === 'title' ? TITLE : 'Paused', dispatch: L.newGame, controls: L.controls, about: L.about, equipment: 'Equipment & Objective', debug: L.debug };
    this.heading.textContent = titles[page];
    this.root.querySelector<HTMLElement>('.nameplate')!.hidden = !(this.mode === 'title' && page === 'home') && page !== 'about';
    if (page === 'home') this.body.innerHTML = `${this.mode === 'title'
      ? `${permitDocument()}<button class="ignition primary" data-nav="dispatch"><span class="ignition-symbol" aria-hidden="true">⏻</span><span>${L.play}</span><span aria-hidden="true">↗</span></button>`
      : `<button class="primary" data-menu-action="resume">${L.resume}</button><div class="mobile-menu-links menu-grid"><button data-nav="equipment">Equipment & Objective</button><button data-nav="debug">${L.debug}</button></div><div class="menu-grid"><button data-menu-action="restart" aria-describedby="restart-help">${L.restart}</button><button data-nav="dispatch">${L.newGame}</button></div><p class="fine-print" id="restart-help">Start this site over with the same layout. Resets cash, demolition, upgrades, and the permit application.</p>`}
      <nav class="menu-grid" aria-label="Game menu"><button data-nav="controls">${L.controls}</button><button data-menu-action="mute">${L.soundOn}</button><button data-nav="about">${L.about}</button>${this.mode === 'pause' ? `<button data-menu-action="title" aria-describedby="main-menu-help">${L.mainMenu}</button>` : ''}</nav>${this.mode === 'pause' ? '<p class="fine-print" id="main-menu-help">Returning to the main menu ends this game. You cannot resume it.</p>' : ''}`;
    if (page === 'equipment') this.body.innerHTML = '<div class="equipment-details"></div><h2>Permit Application</h2><p class="fine-print">Resubmitting spends cash on a county processing fee.</p><div class="menu-permit-host"></div>';
    if (page === 'debug') this.body.innerHTML = '<div class="menu-debug-host"></div>';
    this.root.classList.toggle('debug-page', page === 'debug');
    if (page === 'dispatch') {
      this.body.innerHTML = `<div class="dispatch-fields"><label>Mode<select id="dispatch-mode">${Object.entries(MODE_LABELS).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label><label>Site Size<select id="dispatch-lot"></select></label><label>Layout<select id="dispatch-layout"><option value="standard">Standard</option><option value="randomized">Randomized</option></select></label></div><p class="fine-print" id="mode-description"></p><p class="fine-print">Standard uses the site's original layout. Randomized generates a new layout.</p>${this.mode === 'pause' ? '<p class="caution">Starting a new game replaces your current progress and upgrades.</p>' : ''}<button class="primary" data-menu-action="start">${L.start}</button><button data-nav="back">Back</button>`;
      this.syncSetup();
    }
    if (page === 'controls') this.body.innerHTML = `<dl class="control-list"><div><dt>W / S or ↑ / ↓</dt><dd>Drive forward / reverse</dd></div><div><dt>A / D or ← / →</dt><dd>Steer left / right</dd></div><div><dt>Hold SPACE</dt><dd>Power the blade</dd></div><div><dt>Esc / Pause</dt><dd>Pause / Resume</dd></div><div><dt>R</dt><dd>${L.restart}</dd></div><div><dt>N</dt><dd>${L.newLayout}</dd></div><div><dt>1 / 2 / 3</dt><dd>${L.blade} / ${L.engine} / ${L.push} upgrade</dd></div><div><dt>M</dt><dd>Toggle sound</dd></div></dl><div class="instruction-card"><strong>Touch Controls</strong><p>Drag the left stick to drive and steer. Hold the right POWER BLADE button while driving. Release the stick to coast. Release the blade to finish the current push.</p></div><p class="fine-print">Watch ENGINE HEAT and TRACK STRESS. Above 65%, release the blade or back off rubble. In sandbox these gauges remain advisory.</p>`;
    if (page === 'about') {
      this.body.innerHTML = `<dl class="credits-list"><div><dt>Publisher</dt><dd>Columbia Cloudworks LLC</dd></div><div><dt>Website</dt><dd><a href="https://columbiacloudworks.com" target="_blank" rel="noopener noreferrer">columbiacloudworks.com ↗</a></dd></div><div><dt>Contact</dt><dd><a href="mailto:nicholas.king@columbiacloudworks.com">nicholas.king@columbiacloudworks.com</a></dd></div><div><dt>Game</dt><dd><a href="https://permitdenied.app" target="_blank" rel="noopener noreferrer">permitdenied.app ↗</a></dd></div><div><dt>GitHub</dt><dd><a href="https://github.com/Columbia-Cloudworks-LLC/permit-denied-game" target="_blank" rel="noopener noreferrer">permit-denied-game ↗</a></dd></div><div><dt>Version</dt><dd>${version}</dd></div></dl><details class="license-notices"><summary>Third-party software notices</summary><pre></pre></details>`;
      this.body.querySelector('pre')!.textContent = notices;
    }
    this.actions.page?.(page, this.body);
    this.syncMuted(this.muted);
    this.heading.focus();
    this.root.querySelector('.console-panel')!.scrollTop = 0;
    if (this.mode === 'title' && page === 'home') this.playIntro();
  }
}
