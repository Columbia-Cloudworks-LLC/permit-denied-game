import { TITLE } from '../game/constants';
import { PermitIntro, permitDocument, type PermitSound } from './permitIntro';
import { playableDistrict, type DistrictId, type SessionKind } from '../game/session';
import { MENU_LABELS as L, MODE_LABELS, MODE_DESCRIPTIONS, SITE_LABELS } from '../game/menuLabels';
import { labeledMenuButton, MENU_ICONS, soundButtonContent } from './menuIcons';
import { version } from '../../package.json';
import notices from './thirdPartyNotices.txt?raw';

type Page = 'home' | 'dispatch' | 'controls' | 'about' | 'equipment';
export interface MenuActions {
  page?(page: Page | null, host?: HTMLElement): void;
  resume(): void;
  start(kind: SessionKind, district: DistrictId): void;
  restart(): void;
  debug?(): void;
  title(): void;
  mute(): void;
  click(): void;
  unlockSound(): Promise<void>;
  titleSound(kind: PermitSound, index: number): void;
  pwaUpdate?(): void;
}

const publisher = '<a class="publisher-brand" href="https://columbiacloudworks.com/" target="_blank" rel="noopener noreferrer"><img src="/brand/Columbia-Cloudworks-Icon-Small.png" width="28" height="28" alt="" /><span>Columbia Cloudworks LLC</span></a>';
const facebookUrl = import.meta.env.VITE_FACEBOOK_PAGE_URL;
const facebookLink = facebookUrl ? '<a class="menu-social" data-facebook-link target="_blank" rel="noopener noreferrer" aria-label="PERMIT DENIED on Facebook (opens in a new tab)"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1877f2"/><path d="M13.6 22v-8h2.7l.4-3h-3.1V9.1c0-.9.3-1.5 1.6-1.5H17V4.9c-.3 0-1.4-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.4V11H7.5v3h2.8v8z" fill="#fff"/></svg><span>Facebook</span></a>' : '';
const copyright = '<span>© 2026</span>' + publisher + '<span>All rights reserved.</span>';

/** One navigation and focus owner for keyboard, mouse and touch menus. */
export class OperatorMenu {
  readonly root = document.createElement('section');
  private body: HTMLElement;
  private heading: HTMLElement;
  private mode: 'title' | 'pause' | null = null;
  private page: Page = 'home';
  private session: SessionKind = 'sandbox';
  private district: DistrictId = 'd10';
  private muted = false;
  private updateAvailable = false;
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
    this.root.innerHTML = `<div class="console-panel"><div class="menu-heading"><div><h1 id="operator-heading" tabindex="-1"></h1></div><button data-nav="back" aria-label="Back">← Back</button></div><div class="menu-body"></div><footer class="nameplate"><div class="copyright">${copyright}</div><nav class="legal-links" aria-label="Legal and privacy"><a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a><a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Use</a><a href="/privacy#settings" data-privacy-settings>Privacy Settings</a></nav></footer></div>`;
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
      if (action === 'debug') this.actions.debug?.();
      if (action === 'title') this.actions.title();
      if (action === 'mute') this.actions.mute();
      if (action === 'pwa-update') this.actions.pwaUpdate?.();
      if (action === 'start') {
        this.actions.start(this.session, this.district);
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
    }
    if (mode === 'title') { this.session = 'sandbox'; this.district = 'd10'; }
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

  back(): void {
    if (this.page !== 'home') this.navigate('home');
    else if (this.mode === 'pause') this.actions.resume();
  }

  syncMuted(muted: boolean): void {
    this.muted = muted;
    const button = this.root.querySelector<HTMLButtonElement>('[data-menu-action="mute"]');
    if (button) {
      button.innerHTML = soundButtonContent(muted);
      button.setAttribute('aria-pressed', String(!muted));
      button.setAttribute('aria-label', muted ? L.soundOff : L.soundOn);
    }
  }

  setUpdateAvailable(pending: boolean): void {
    if (this.updateAvailable === pending) return;
    this.updateAvailable = pending;
    this.syncUpdatePrompt();
  }

  private syncSetup(): void {
    this.body.querySelector<HTMLSelectElement>('#dispatch-mode')!.value = this.session;
    const sizes = this.body.querySelector<HTMLSelectElement>('#dispatch-lot')!;
    sizes.innerHTML = Object.entries(SITE_LABELS)
      .map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
    sizes.value = this.district;
    this.body.querySelector('#mode-description')!.textContent = MODE_DESCRIPTIONS[this.session];
    const lotField = this.body.querySelector<HTMLElement>('#dispatch-lot-field');
    if (lotField) lotField.hidden = this.session === 'challenge';
  }

  private navigate(page: Page): void {
    this.introVersion++;
    this.intro.stop();
    this.actions.page?.(null);
    this.page = page;
    this.root.classList.toggle('title-open', this.mode === 'title' && page === 'home');
    this.root.querySelector<HTMLButtonElement>('[data-nav="back"]')!.hidden = page === 'home' || page === 'dispatch';
    const titles = { home: this.mode === 'title' ? TITLE : 'Paused', dispatch: L.newGame, controls: L.controls, about: L.about, equipment: 'Equipment & Objective' };
    this.heading.textContent = titles[page];
    this.root.querySelector<HTMLElement>('.nameplate')!.hidden = !(this.mode === 'title' && page === 'home') && page !== 'about';
    if (page === 'home') this.body.innerHTML = `${this.mode === 'title'
      ? `${permitDocument()}<button class="ignition primary" data-nav="dispatch"><span class="ignition-symbol" aria-hidden="true">${MENU_ICONS.power}</span><span>${L.play}</span><span aria-hidden="true">↗</span></button>`
      : `<button class="primary" data-menu-action="resume">${L.resume}</button><div class="mobile-menu-links menu-grid"><button data-nav="equipment">Equipment & Objective</button><button data-menu-action="debug">${L.debug}</button></div><div class="menu-grid"><button data-menu-action="restart" aria-describedby="restart-help">${L.restart}</button><button data-nav="dispatch">${L.newGame}</button></div><p class="fine-print" id="restart-help">Start this site over with the same layout. Resets cash, demolition, upgrades, and the permit application.</p>`}
      <nav class="menu-grid" aria-label="Game menu"><button data-nav="controls">${labeledMenuButton(MENU_ICONS.gamepad, L.controls)}</button><button data-menu-action="mute">${soundButtonContent(false)}</button><button data-nav="about">${labeledMenuButton(MENU_ICONS.about, L.about)}</button>${facebookLink}${this.mode === 'pause' ? `<button data-menu-action="title" aria-describedby="main-menu-help">${L.mainMenu}</button>` : ''}</nav>${this.mode === 'pause' ? '<p class="fine-print" id="main-menu-help">Returning to the main menu ends this game. You cannot resume it.</p>' : ''}${this.updatePromptHtml()}`;
    if (page === 'equipment') this.body.innerHTML = '<div class="equipment-details"></div><h2>Permit Application</h2><p class="fine-print">Resubmitting spends cash on a county processing fee.</p><div class="menu-permit-host"></div>';
    if (page === 'dispatch') {
      this.body.innerHTML = `<div class="dispatch-fields"><label>Mode<select id="dispatch-mode">${Object.entries(MODE_LABELS).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label><label id="dispatch-lot-field">Site Size<select id="dispatch-lot"></select></label></div><p class="fine-print" id="mode-description"></p>${this.mode === 'pause' ? '<p class="caution">Starting a new game replaces your current progress and upgrades.</p>' : ''}<button class="primary" data-menu-action="start">${L.start}</button><button data-nav="back">Back</button>`;
      this.syncSetup();
    }
    if (page === 'controls') this.body.innerHTML = `<dl class="control-list"><div><dt>W / S or ↑ / ↓</dt><dd>Drive forward / reverse</dd></div><div><dt>A / D or ← / →</dt><dd>Steer left / right</dd></div><div><dt>Hold SPACE</dt><dd>Power the blade</dd></div><div><dt>Esc / Pause</dt><dd>Pause / Resume</dd></div><div><dt>R</dt><dd>${L.restart}</dd></div><div><dt>N</dt><dd>${L.newLayout}</dd></div><div><dt>1 / 2 / 3</dt><dd>${L.blade} / ${L.engine} / ${L.push} upgrade</dd></div><div><dt>M</dt><dd>Toggle sound</dd></div></dl><div class="instruction-card"><strong>Touch Controls</strong><p>Drag the left stick to drive and steer. Hold the right POWER BLADE button while driving. Release the stick to coast. Release the blade to finish the current push.</p></div><p class="fine-print">Watch ENGINE HEAT and TRACK STRESS. Above 65%, release the blade or back off rubble. In sandbox these gauges remain advisory.</p>`;
    if (page === 'about') {
      this.body.innerHTML = `<dl class="credits-list"><div><dt>Publisher</dt><dd>${publisher}</dd></div><div><dt>Website</dt><dd><a href="https://columbiacloudworks.com" target="_blank" rel="noopener noreferrer">columbiacloudworks.com ↗</a></dd></div><div><dt>Contact</dt><dd><a href="mailto:nicholas.king@columbiacloudworks.com">nicholas.king@columbiacloudworks.com</a></dd></div><div><dt>Game</dt><dd><a href="https://permitdenied.app" target="_blank" rel="noopener noreferrer">permitdenied.app ↗</a></dd></div><div><dt>GitHub</dt><dd><a href="https://github.com/Columbia-Cloudworks-LLC/permit-denied-game" target="_blank" rel="noopener noreferrer">permit-denied-game ↗</a></dd></div><div><dt>Version</dt><dd>${version}</dd></div></dl><details class="license-notices"><summary>Third-party software notices</summary><pre></pre></details>`;
      this.body.querySelector('pre')!.textContent = notices;
    }
    this.body.querySelector<HTMLAnchorElement>('[data-facebook-link]')?.setAttribute("href", facebookUrl);
    this.actions.page?.(page, this.body);
    this.syncMuted(this.muted);
    this.heading.focus();
    this.root.querySelector('.console-panel')!.scrollTop = 0;
    if (this.mode === 'title' && page === 'home') this.playIntro();
  }

  private updatePromptHtml(): string {
    if (!this.updateAvailable) return '';
    return `<div class="pwa-update"><button type="button" data-menu-action="pwa-update">${L.reloadBuild}</button><p class="fine-print">${L.reloadBuildHelp}</p></div>`;
  }

  private syncUpdatePrompt(): void {
    if (this.page !== 'home' || !this.mode) return;
    this.body.querySelector('.pwa-update')?.remove();
    if (this.updateAvailable) this.body.insertAdjacentHTML('beforeend', this.updatePromptHtml());
  }
}
