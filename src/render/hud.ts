import { clockValue } from './instrumentValues';
import { CashCounter } from './cashCounter';
import { EquipmentClock } from './equipmentClock';
import { upgradePercent, type UpgradeModifiers } from '../game/upgrades';
import { MENU_LABELS as L, MODE_LABELS, BRICK_DESCRIPTION } from '../game/menuLabels';
import { MENU_ICONS } from './menuIcons';
import { COPY, CASH_TARGET, MATCH_SECONDS } from "../game/constants";
import { type CampaignLevelId } from "../game/campaign";
import { campaignLevelButtons, debugMapLabel, debugSessionFacts, debugSessionPanels } from "../game/debugSession";
import { PermitLogo } from './permitLogo';
import { OperatorMenu } from './operatorMenu';
import type { PermitSound } from './permitIntro';
import { DEBUG_GROUPS, type DebugView, type DebugToggle } from "../debug/view";
import { type DistrictId, type SessionKind } from "../game/session";
import { createDebugBinderState, type BinderTab } from '../debug/binderState';
import { applyPwaUpdate, onPwaUpdate } from '../pwa/update';

export type OverlayMode = "none" | "title" | "pause" | "upgrade" | "results" | "briefing";

export interface CampaignHud {
  levelIndex: number;
  levelName: string;
  landmarkName: string;
  dollarTarget: number;
  levelEarned: number;
  campaignEarned: number;
  landmarkProgress: number;
  landmarkReady: boolean;
  dollarsReady: boolean;
  briefing: string;
  victory: boolean;
  complete: boolean;
  levelId?: CampaignLevelId;
  buildingCount?: number;
  timeLimit?: number;
}

export interface HudState {
  hasYard: boolean;
  testMapName?: string;
  focusedTest?: boolean;
  upgradeModifiers: UpgradeModifiers;
  developmentScenario?: boolean;
  pileResistance?: number;
  job?: { progress: number; remaining: number; instruction: string; paid: boolean; payout: number };
  cash: number;
  resubmitted: boolean;
  timeLeft: number;
  elapsed: number;
  session: SessionKind;
  district: DistrictId;
  seed?: number;
  levelId?: CampaignLevelId;
  levelCard?: {
    levelIndex: number;
    levelName: string;
    levelId: CampaignLevelId;
    buildingCount: number;
    landmarkName: string;
    dollarTarget: number;
    timeLimit: number;
  };
  bladeDown: boolean;
  muted: boolean;
  heat: number;
  track: number;
  overlay: OverlayMode;
  death: string | null;
  won: boolean;
  campaign?: CampaignHud;
  fieldNotice?: string;
}

export class Hud {
  readonly root: HTMLElement;
  readonly assetsHost: HTMLElement;
  readonly permitLogo: PermitLogo;
  onResubmit?: () => number | null;
  readonly binder = createDebugBinderState();
  private binderBlocked = false;
  private binderWidth = 0;
  private binderVisible = false;
  private binderWasCollapsed = false;
  private lastOverlay: OverlayMode | null = null;
  private lastDeath: string | null = null;
  private lastWon = false;
  private modifierValues = new Map<string, number>();
  private modifierElements: HTMLElement[];
  private readonly cashCounter: CashCounter;
  private readonly cashTarget: HTMLElement;
  private readonly clock: EquipmentClock;
  private readonly bladeEl: HTMLElement;
  readonly menu: OperatorMenu;
  private readonly overlay: HTMLElement;
  private readonly panel: HTMLElement;
  onMute?: () => void;
  onMenu?: () => void;
  onTitle?: () => void;
  onStart?: (kind: SessionKind, level: CampaignLevelId) => void;
  onBeginLevel?: () => void;
  onNextLevel?: () => void;
  onRetryLevel?: () => void;
  onNewCampaign?: () => void;
  onClick?: () => void;
  onUnlockSound?: () => Promise<void>;
  onTitleSound?: (kind: PermitSound, index: number) => void;
  onChoice?: (id: "blade" | "engine" | "push") => void;
  onResume?: () => void;
  onRestart?: () => void;
  onNewSeed?: () => void;
  onSession?: (kind: SessionKind) => void;
  onDistrict?: (id: DistrictId) => void;
  onCampaignLevel?: (id: CampaignLevelId) => void;
  onJob?: () => void;
  onDebugToggle?: (key: DebugToggle, value: boolean) => void;
  onDebugFloor?: (floor: number) => void;
  onDebugReset?: () => void;
  onDebugStep?: () => void;
  onDebugOpen?: () => void;
  onTestYard?: () => void;
  onResetTest?: () => void;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="top">
        <div id="hud-permit"></div>
        <div class="stat cash-stat"><span class="instrument-label">Cash</span><div id="hud-cash"></div><span id="cash-target" class="cash-target">Target $${CASH_TARGET.toLocaleString('en-US')}</span></div>
        <div class="stat campaign-stat" id="hud-campaign" hidden>
          <span class="instrument-label" id="hud-level-name">Level</span>
          <strong id="hud-campaign-dollars"></strong>
          <span id="hud-landmark" class="cash-target"></span>
        </div>
        <div class="stat clock-stat"><span class="instrument-label" id="hud-clock-label">County Clock</span><div id="hud-time"></div></div>
        <div class="hud-actions"><button type="button" id="debug-toggle" aria-expanded="false" aria-controls="debug-panel">${L.debug}</button><button type="button" id="hud-menu">${L.pause}</button></div>
      </div>
      <div class="mobile-hud"><div class="mobile-readouts"><div><strong id="mobile-cash"></strong><small id="mobile-target"></small></div><div><strong id="mobile-clock"></strong><small id="mobile-clock-label"></small></div><button type="button" id="mobile-debug" aria-label="Debug" aria-expanded="false" aria-controls="debug-panel">Debug</button><button type="button" id="mobile-pause" aria-label="Pause">Ⅱ</button></div><div class="mobile-meters">${['heat', 'track'].map(id => `<div id="mobile-${id}" role="meter" aria-label="${id === 'heat' ? 'Engine heat' : 'Track stress'}" aria-valuemin="0" aria-valuemax="100"><span>${id === 'heat' ? 'Heat' : 'Track'} <output>0%</output></span><i></i></div>`).join('')}</div><div class="mobile-notices"><div id="mobile-warning" role="status" hidden></div><div id="mobile-job" hidden></div></div></div>
      <div class="session" id="hud-session"></div>
      <div id="hud-job" class="job" hidden></div>
      <div class="debug-menu">
        <section id="debug-panel" aria-label="${L.debug}" tabindex="-1" hidden>
          <div class="debug-heading"><div><small>COUNTY FIELD OPERATIONS</small><strong>Test binder</strong></div><button type="button" id="debug-collapse" aria-label="Collapse binder" aria-expanded="true">−</button><button type="button" id="debug-close" aria-label="Close Debug">×</button></div>
          <div class="debug-map"><span id="debug-map-name"></span><button type="button" id="debug-open-yard">All Assets Sandbox</button><button type="button" id="debug-reset-test" hidden>Reset Test</button></div>
          <div class="debug-toolbar"><label><input type="checkbox" data-debug="freeze"> Freeze Simulation</label><button type="button" id="debug-step" disabled>Step One Frame</button></div>
          <div class="debug-tabs" role="tablist" aria-label="Debug tools">
            ${(['assets', 'inspector', 'session'] as const).map(tab => `<button type="button" role="tab" id="debug-tab-${tab}" aria-controls="debug-${tab}" aria-selected="${tab === 'assets'}" tabindex="${tab === 'assets' ? 0 : -1}" data-debug-tab="${tab}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join('')}
          </div>
          <div class="debug-pages">
          <section id="debug-inspector" role="tabpanel" aria-labelledby="debug-tab-inspector" hidden>
          <p>Hidden objects still collide and simulate.</p>
          <label class="debug-floor">Show floors <select id="debug-floor" aria-label="Show floors">
            <option value="99">All floors</option><option value="0">Ground floor only</option>
            <option value="1">Through second floor</option><option value="2">Through third floor</option>
          </select></label>
          ${DEBUG_GROUPS.map(group => `<fieldset><legend>${group.label}</legend>${group.options.filter(([key]) => key !== 'freeze').map(([key, label, checked]) =>
            `<label><input type="checkbox" data-debug="${key}" ${checked ? "checked" : ""}> ${label}</label>`).join("")}</fieldset>`).join("")}
          <button type="button" id="debug-reset">Reset Debug Options</button>
          <p class="debug-legend">Paths: blue · route: yellow · lots: green · buildable: purple · rooms: gold<br>Collision: pink walls, orange props/contents, white dozer · supports: green live / pink failing</p>
          </section>
          <section id="debug-session" role="tabpanel" aria-labelledby="debug-tab-session" hidden></section>
          <section id="debug-assets" role="tabpanel" aria-labelledby="debug-tab-assets"><div id="debug-asset-host"></div></section>
          </div>
        </section>
      </div>
      <div class="instrument-deck">
        ${gauge('heat', 'ENGINE HEAT')}
        ${gauge('track', 'TRACK STRESS')}
        <div class="upgrade-bank" role="group" aria-label="Dozer Upgrades">${(['blade', 'engine', 'push'] as const).map(key => `<div class="upgrade-instrument"><span class="upgrade-label">${MENU_ICONS[key]}${L[key]}</span><span class="upgrade-value" data-modifier="${key}Mul" data-description="${key === 'push' ? 'Push duration' : key === 'blade' ? 'Blade damage' : 'Engine performance'}" aria-label="${L[key]} ${key === 'push' ? 'push duration' : key === 'blade' ? 'blade damage' : 'engine performance'}: 1.00 times">1.00<span class="multiplier-symbol">×</span></span></div>`).join('')}</div>
        <div class="blade-module"><div class="blade" id="hud-blade"></div><p id="hud-advisory" role="status"></p></div>
      </div>
      <div class="overlay" id="hud-overlay" role="dialog" aria-modal="true" aria-labelledby="result-heading"><div class="panel" id="hud-panel" tabindex="-1"></div></div>
    `;
    this.modifierElements = [...root.querySelectorAll<HTMLElement>('[data-modifier]')];
    this.cashCounter = new CashCounter(root.querySelector("#hud-cash")!);
    this.cashTarget = root.querySelector("#cash-target")!;
    this.clock = new EquipmentClock(root.querySelector("#hud-time")!);
    this.bladeEl = root.querySelector("#hud-blade")!;
    this.overlay = root.querySelector("#hud-overlay")!;
    this.panel = root.querySelector("#hud-panel")!;
    this.assetsHost = root.querySelector('#debug-asset-host')!;
    this.permitLogo = new PermitLogo(() => this.onResubmit?.() ?? null,
      (kind, index) => this.onTitleSound?.(kind, index),
      () => this.onUnlockSound?.() ?? Promise.resolve());
    root.querySelector('#hud-permit')!.append(this.permitLogo.root);
    this.permitLogo.root.addEventListener('click', () => {
      if (this.permitLogo.root.classList.contains('resubmitting')) {
        this.permitLogo.root.closest('.menu-permit-host')?.scrollIntoView({ block: 'start' });
      }
    });

    root.querySelector('#hud-menu')!.addEventListener('click', () => { this.onClick?.(); this.onMenu?.(); });
    root.querySelector('#mobile-pause')!.addEventListener('click', () => { this.onClick?.(); this.onMenu?.(); });
    this.menu = new OperatorMenu(root, {
      page: (page, host) => {
        if (!page && this.permitLogo.root.closest('.menu-permit-host')) this.permitLogo.reset();
        root.querySelector('#hud-permit')!.append(this.permitLogo.root);
        if (page === 'equipment') host!.querySelector('.menu-permit-host')!.append(this.permitLogo.root);
      },
      resume: () => this.onResume?.(), start: (kind, district) => this.onStart?.(kind, district),
      restart: () => this.onRestart?.(),
      debug: () => { this.onResume?.(); this.openDebug(); },
      title: () => this.onTitle?.(), mute: () => this.onMute?.(), click: () => this.onClick?.(),
      unlockSound: () => this.onUnlockSound?.() ?? Promise.resolve(),
      titleSound: (kind, index) => this.onTitleSound?.(kind, index),
      pwaUpdate: () => { void applyPwaUpdate(); },
    });
    onPwaUpdate(pending => this.menu.setUpdateAvailable(pending));
    root.querySelector('#debug-session')!.append(root.querySelector('#hud-session')!);
    this.overlay.addEventListener('keydown', e => {
      if (this.lastOverlay === 'upgrade' && ['1', '2', '3'].includes(e.key) && !e.repeat) {
        e.preventDefault();
        this.onChoice?.((['blade', 'engine', 'push'] as const)[Number(e.key) - 1]);
      }
      if (this.lastOverlay === 'results' && e.key.toLowerCase() === 'r' && !e.repeat) this.onRestart?.();
      if (e.key !== 'Tab') return;
      const buttons = [...this.panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const first = buttons[0], last = buttons.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === this.panel)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === this.panel)) { e.preventDefault(); first?.focus(); }
    });
    this.bindSessionBar();
    this.bindDebugMenu();
    const top = root.querySelector<HTMLElement>('.top')!;
    new ResizeObserver(() => {
      root.style.setProperty('--top-panel-height', top.offsetHeight + 'px');
    }).observe(top);
  }

  private renderMobile(s: HudState, elapsedClock: boolean, advisory: string): void {
    const text = (selector: string, value: string) => {
      const el = this.root.querySelector<HTMLElement>(selector);
      if (el && el.textContent !== value) el.textContent = value;
    };
    const cash = '$' + Math.max(0, Math.floor(s.cash)).toLocaleString('en-US');
    text('#mobile-cash', cash);
    this.root.querySelector('#mobile-cash')!.classList.toggle('long-value', cash.length > 10);
    text('#mobile-target', s.campaign
      ? `${s.campaign.levelIndex}/7 ${s.campaign.dollarsReady ? 'CASH DONE' : `of $${s.campaign.dollarTarget.toLocaleString('en-US')}`}`
      : elapsedClock ? 'Cash' : `of $${CASH_TARGET.toLocaleString('en-US')}`);
    const time = clockValue(elapsedClock ? s.elapsed : s.timeLeft, elapsedClock);
    text('#mobile-clock', time.display);
    this.root.querySelector('#mobile-clock')!.setAttribute('aria-label', time.accessible);
    text('#mobile-clock-label', elapsedClock ? 'Elapsed' : 'Remaining');
    for (const [id, value] of [['heat', s.heat], ['track', s.track]] as const) {
      const meter = this.root.querySelector<HTMLElement>('#mobile-' + id)!;
      const percent = Math.round(Math.max(0, Math.min(100, value)));
      meter.style.setProperty('--level', percent + '%');
      meter.setAttribute('aria-valuenow', String(percent));
      meter.classList.toggle('warning', value > 65);
      text(`#mobile-${id} output`, percent + '%');
    }
    text('#mobile-warning', advisory);
    this.root.querySelector<HTMLElement>('#mobile-warning')!.hidden = !advisory;
    const mobileJob = s.campaign
      ? `${s.campaign.landmarkName} ${Math.floor(s.campaign.landmarkProgress * 100)}%${s.campaign.landmarkReady ? ' DOWN' : ''}`
      : s.job ? s.job.paid ? `Demolition complete · +$${s.job.payout}` : `Demolition · ${Math.floor(s.job.progress * 100)}% / 90%` : '';
    text('#mobile-job', mobileJob);
    this.root.querySelector<HTMLElement>('#mobile-job')!.hidden = !mobileJob;
    const blade = this.root.querySelector<HTMLButtonElement>('.touch-blade');
    if (blade) {
      blade.classList.toggle('engaged', s.bladeDown);
      blade.setAttribute('aria-label', s.bladeDown ? 'Powered blade engaged; release to finish push' : 'Hold powered blade');
      text('.touch-blade', s.bladeDown ? 'BLADE DOWN' : 'POWER BLADE');
    }
    text('.equipment-details', `Blade ${s.upgradeModifiers.bladeMul.toFixed(2)}× · Engine ${s.upgradeModifiers.engineMul.toFixed(2)}× · Push ${s.upgradeModifiers.pushMul.toFixed(2)}×\n\n${s.job ? s.job.instruction + '\nRemove 90% of the structure.' : s.campaign ? `${s.campaign.levelName}: demolish ${s.campaign.landmarkName} and earn $${s.campaign.dollarTarget.toLocaleString('en-US')}.` : s.session === 'challenge' ? `Earn $${CASH_TARGET.toLocaleString('en-US')} before the county clock expires.` : 'Sandbox · demolish freely.'}`);
  }

  private bindDebugMenu(): void {
    const panel = this.root.querySelector<HTMLElement>("#debug-panel")!;
    for (const selector of ['#debug-toggle', '#mobile-debug']) this.root.querySelector(selector)!.addEventListener('click', () => {
      if (panel.hidden) this.openDebug(); else this.closeDebug(true);
    });
    this.root.querySelector('#debug-close')!.addEventListener('click', () => this.closeDebug(true));
    this.root.querySelector('#debug-collapse')!.addEventListener('click', () => {
      this.binder.collapsed = !this.binder.collapsed; this.syncBinder(); this.onDebugOpen?.();
    });
    for (const event of ['pointerdown', 'keydown', 'keyup', 'wheel']) panel.addEventListener(event, e => { e.stopPropagation(); this.onDebugOpen?.(); });
    const pages = this.root.querySelector<HTMLElement>('.debug-pages')!;
    const rememberScroll = (event: Event) => {
      const scroller = this.binderScroller;
      if (event.target === scroller && !panel.hidden && !this.binder.collapsed) this.binder.scroll[this.binder.tab] = scroller.scrollTop;
    };
    pages.addEventListener('scroll', rememberScroll);
    panel.addEventListener('scroll', rememberScroll);
    new ResizeObserver(() => { this.binderWidth = panel.offsetWidth; }).observe(panel);
    this.root.querySelector('.debug-menu')!.addEventListener('keydown', event => {
      const e = event as KeyboardEvent;
      if (e.key === 'Escape' && !panel.hidden) { e.preventDefault(); e.stopPropagation(); this.closeDebug(true); return; }
    }, true);
    const tabs = [...panel.querySelectorAll<HTMLButtonElement>('[data-debug-tab]')];
    tabs.forEach((button, index) => {
      button.addEventListener('click', () => this.selectDebugTab(button.dataset.debugTab as BinderTab));
      button.addEventListener('keydown', e => {
        let next = index;
        if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        else return;
        e.preventDefault(); e.stopPropagation();
        this.selectDebugTab(tabs[next].dataset.debugTab as BinderTab);
        tabs[next].focus();
      });
    });
    this.root.querySelector('#debug-open-yard')!.addEventListener('click', () => {
      this.onTestYard?.();
    });
    this.root.querySelector('#debug-reset-test')!.addEventListener('click', () => this.onResetTest?.());
    panel.querySelectorAll<HTMLInputElement>("[data-debug]").forEach(input => {
      input.addEventListener("change", () => this.onDebugToggle?.(input.dataset.debug as DebugToggle, input.checked));
    });
    this.root.querySelector<HTMLSelectElement>("#debug-floor")!.addEventListener("change", event => {
      this.onDebugFloor?.(Number((event.target as HTMLSelectElement).value));
    });
    this.root.querySelector("#debug-reset")!.addEventListener("click", () => this.onDebugReset?.());
    this.root.querySelector("#debug-step")!.addEventListener("click", () => this.onDebugStep?.());
  }

  private selectDebugTab(tab: BinderTab): void {
    const pages = this.binderScroller;
    this.binder.scroll[this.binder.tab] = pages.scrollTop;
    this.binder.tab = tab;
    this.root.querySelectorAll<HTMLButtonElement>('[data-debug-tab]').forEach(button => {
      const selected = button.dataset.debugTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      this.root.querySelector<HTMLElement>('#debug-' + button.dataset.debugTab)!.hidden = !selected;
    });
    pages.scrollTop = this.binder.scroll[tab];
    this.onDebugOpen?.();
  }

  openDebug(): void {
    const panel = this.root.querySelector<HTMLElement>('#debug-panel')!;
    this.binder.open = true;
    this.syncBinder();
    panel.setAttribute('role', 'region');
    this.onDebugOpen?.();
    this.onClick?.();
    panel.focus({ preventScroll: true });
  }

  closeDebug(restoreFocus = false): boolean {
    const panel = this.root.querySelector<HTMLElement>('#debug-panel')!;
    if (panel.hidden) return false;
    this.binder.open = false; this.syncBinder();
    const toggle = this.root.querySelector<HTMLButtonElement>(document.documentElement.classList.contains('touch-ui') ? '#mobile-debug' : '#debug-toggle')!;
    if (restoreFocus) toggle.focus();
    return true;
  }

  private syncBinder(): void {
    const panel = this.root.querySelector<HTMLElement>('#debug-panel')!;
    panel.hidden = !this.binder.open || this.binderBlocked;
    panel.classList.toggle('binder-collapsed', this.binder.collapsed);
    for (const id of ['#debug-toggle', '#mobile-debug']) this.root.querySelector(id)!.setAttribute('aria-expanded', String(!panel.hidden));
    const collapse = this.root.querySelector<HTMLButtonElement>('#debug-collapse')!;
    collapse.textContent = this.binder.collapsed ? '+' : '−';
    collapse.setAttribute('aria-label', this.binder.collapsed ? 'Expand binder' : 'Collapse binder');
    collapse.setAttribute('aria-expanded', String(!this.binder.collapsed));
    if (!panel.hidden && !this.binder.collapsed && (!this.binderVisible || this.binderWasCollapsed)) {
      this.binderScroller.scrollTop = this.binder.scroll[this.binder.tab];
    }
    this.binderVisible = !panel.hidden;
    this.binderWasCollapsed = this.binder.collapsed;
  }

  private get binderScroller(): HTMLElement {
    const pages = this.root.querySelector<HTMLElement>('.debug-pages')!;
    return getComputedStyle(pages).overflowY === 'visible' ? this.root.querySelector<HTMLElement>('#debug-panel')! : pages;
  }

  /** Keep camera targets in the unobscured desktop play area. */
  get debugDockWidth(): number {
    return this.binder.open && !this.binder.collapsed && !this.binderBlocked && !document.documentElement.classList.contains('touch-ui') ? this.binderWidth + 30 : 0;
  }

  preserveBinderScroll<T>(update: () => T): T {
    const pages = this.binderScroller;
    const scroll = this.binder.scroll[this.binder.tab];
    const result = update();
    pages.scrollTop = scroll;
    return result;
  }

  syncDebug(view: DebugView): void {
    this.root.querySelectorAll<HTMLInputElement>("[data-debug]").forEach(input => {
      input.checked = view[input.dataset.debug as DebugToggle];
    });
    this.root.querySelector<HTMLSelectElement>("#debug-floor")!.value = String(view.maxFloor);
    this.root.querySelector<HTMLButtonElement>("#debug-step")!.disabled = !view.freeze;
    this.root.querySelector<HTMLButtonElement>("#debug-toggle")!.textContent = L.debug;
  }

  private bindSessionBar(): void {
    const levels = campaignLevelButtons().map((level) =>
      `<button type="button" data-level="${level.id}">${level.label}</button>`,
    ).join("");
    const bar = this.root.querySelector("#hud-session")!;
    bar.innerHTML = `
      <h3>Mode</h3>
      <button type="button" data-session="sandbox">${MODE_LABELS.sandbox}</button>
      <button type="button" data-session="challenge">${MODE_LABELS.challenge}</button>
      <section data-panel="levels">
        <h3>Campaign Level</h3>
        ${levels}
        <p id="debug-campaign-facts" class="fine-print"></p>
      </section>
      <section data-panel="job">
        <h3>Demolition Objective</h3>
        <button type="button" data-act="job">${L.brick}</button><p class="fine-print">${BRICK_DESCRIPTION}</p>
      </section>
      <button type="button" data-act="restart">${L.restart}</button>
      <button type="button" data-act="newseed">${L.newLayout}</button>
      <h3 class="sandbox-upgrades">Sandbox Upgrades</h3>
      <button type="button" data-up="blade">${L.blade} ${upgradePercent('blade')}</button>
      <button type="button" data-up="engine">${L.engine} ${upgradePercent('engine')}</button>
      <button type="button" data-up="push">${L.push} ${upgradePercent('push')}</button>
    `;
    bar.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const session = (btn as HTMLButtonElement).dataset.session as SessionKind | undefined;
        const level = (btn as HTMLButtonElement).dataset.level as CampaignLevelId | undefined;
        const act = (btn as HTMLButtonElement).dataset.act;
        const up = (btn as HTMLButtonElement).dataset.up as "blade" | "engine" | "push" | undefined;
        if (session) this.onSession?.(session);
        if (level) this.onCampaignLevel?.(level);
        if (act === "newseed") this.onNewSeed?.();
        if (act === "restart") this.onRestart?.();
        if (act === "job") this.onJob?.();
        if (up) this.onChoice?.(up);
      });
    });
  }

  resetCash(): void { this.cashCounter.reset(); }

  render(s: HudState): void {
    for (const element of this.modifierElements) {
      const key = element.dataset.modifier as keyof UpgradeModifiers;
      const value = s.upgradeModifiers[key];
      const previous = this.modifierValues.get(key);
      if (previous === value) continue;
      element.innerHTML = `${value.toFixed(2)}<span class="multiplier-symbol">×</span>`;
      element.setAttribute('aria-label', `${element.dataset.description}: ${value.toFixed(2)} times`);
      element.getAnimations().forEach(animation => animation.cancel());
      if (previous !== undefined && value > previous && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        element.animate([{ color: '#fff4c4', textShadow: '0 0 12px #ffc863' }, { color: '#e8bf70', textShadow: '0 0 3px #e8bf7026' }], { duration: 650 });
      }
      this.modifierValues.set(key, value);
    }
    const permitInMenu = !!this.permitLogo.root.closest('.menu-permit-host');
    this.permitLogo.render(s.resubmitted, s.cash, s.overlay !== 'none' && !(s.overlay === 'pause' && permitInMenu));
    const job = this.root.querySelector<HTMLElement>("#hud-job")!;
    job.hidden = !s.job;
    if (s.job) job.textContent = s.job.paid
      ? `Demolition Complete · +$${s.job.payout}`
      : `${L.brick} · ${Math.floor(s.job.progress * 100)}%\n${s.job.instruction}\nRemove 90% of the structure.`;
    this.root.querySelectorAll<HTMLElement>("#hud-session [data-up], .sandbox-upgrades").forEach(el => {
      el.hidden = s.session !== "sandbox";
    });
    const elapsedClock = s.session === 'sandbox' || !!s.job;
    this.cashCounter.update(s.campaign ? Math.floor(s.campaign.levelEarned) : s.cash);
    this.cashTarget.hidden = elapsedClock && !s.campaign;
    const campaignEl = this.root.querySelector<HTMLElement>('#hud-campaign')!;
    campaignEl.hidden = !s.campaign;
    if (s.campaign) {
      this.cashTarget.textContent = `of $${s.campaign.dollarTarget.toLocaleString('en-US')} ${s.campaign.dollarsReady ? 'DONE' : ''}`;
      this.root.querySelector('#hud-level-name')!.textContent = `${s.campaign.levelIndex}/7 ${s.campaign.levelName}`;
      this.root.querySelector('#hud-campaign-dollars')!.textContent = `$${Math.floor(s.campaign.levelEarned).toLocaleString('en-US')}`;
      this.root.querySelector('#hud-landmark')!.textContent =
        `${s.campaign.landmarkName} ${Math.floor(s.campaign.landmarkProgress * 100)}%${s.campaign.landmarkReady ? ' DOWN' : ''}`;
    } else if (!elapsedClock) {
      this.cashTarget.textContent = `Target $${CASH_TARGET.toLocaleString('en-US')}`;
    }
    this.clock.update(elapsedClock ? s.elapsed : s.timeLeft, elapsedClock);
    this.paintSessionBar(s);
    this.bladeEl.textContent = s.bladeDown ? COPY.bladeDown : COPY.bladeUp;
    this.bladeEl.classList.toggle('engaged', s.bladeDown);
    for (const [id, value] of [['heat', s.heat], ['track', s.track]] as const) {
      const el = this.root.querySelector<HTMLElement>('#gauge-' + id)!;
      const clamped = Math.max(0, Math.min(100, value));
      el.style.setProperty('--needle', (clamped * 2.4 - 120) + 'deg');
      el.classList.toggle('warning', value > 65);
      el.setAttribute('aria-valuenow', String(Math.round(clamped)));
      el.querySelector('output')!.textContent = Math.round(clamped) + '%';
    }
    const advisory = s.heat > 65 ? 'HIGH HEAT · RELEASE BLADE' : s.track > 65 ? 'TRACK STRESS · BACK OFF' : (s.pileResistance ?? 0) > .4 ? 'DENSE RUBBLE · CLEAR A PATH' : (s.fieldNotice ?? '');
    const advisoryEl = this.root.querySelector('#hud-advisory')!;
    if (advisoryEl.textContent !== advisory) advisoryEl.textContent = advisory;
    (advisoryEl as HTMLElement).hidden = !advisory;
    this.root.querySelector('#hud-clock-label')!.textContent = s.session === 'sandbox' || s.job ? 'Elapsed' : 'County Clock';
    const modal = s.overlay !== 'none';
    this.binderBlocked = modal; this.syncBinder();
    const card = s.levelCard;
    const mapName = debugMapLabel({
      testMapName: s.testMapName,
      job: !!s.job,
      session: s.session,
      district: s.district,
      levelId: s.campaign?.levelId ?? card?.levelId ?? s.levelId,
      levelIndex: s.campaign?.levelIndex ?? card?.levelIndex,
      levelName: s.campaign?.levelName ?? card?.levelName,
    });
    const mapLabel = this.root.querySelector<HTMLElement>('#debug-map-name')!;
    if (mapLabel.textContent !== mapName) mapLabel.textContent = mapName;
    const resetTest = this.root.querySelector<HTMLButtonElement>('#debug-reset-test')!;
    resetTest.hidden = !s.hasYard;
    resetTest.textContent = s.focusedTest ? 'Reset Test' : 'Reset Entire Yard';
    this.root.querySelector<HTMLButtonElement>('[data-act="restart"]')!.textContent = s.hasYard ? resetTest.textContent : L.restart;
    this.root.querySelector<HTMLElement>('[data-act="newseed"]')!.hidden = s.hasYard || !!s.campaign;
    this.root.classList.toggle('modal-open', modal);
    document.querySelector<HTMLElement>('#game-root')!.inert = modal;
    for (const selector of ['.top', '.mobile-hud', '.instrument-deck', '#touch-controls']) {
      const el = this.root.querySelector<HTMLElement>(selector);
      if (el) el.inert = modal;
    }
    this.menu.show(s.overlay === 'title' || s.overlay === 'pause' ? s.overlay : null, s.session, s.district, s.developmentScenario, s.campaign?.levelId ?? s.levelId);
    this.menu.syncMuted(s.muted);
    this.renderMobile(s, elapsedClock, advisory);

    if (s.overlay === "none" || s.overlay === "pause" || s.overlay === "title") {
      this.overlay.classList.remove("show");
      if (s.overlay === 'none' && (this.lastOverlay === 'upgrade' || this.lastOverlay === 'results')) {
        document.querySelector<HTMLCanvasElement>('#game-root canvas')?.focus();
      }
      this.lastOverlay = "none";
      return;
    }
    this.overlay.classList.add("show");
    if (
      s.overlay === this.lastOverlay &&
      s.death === this.lastDeath &&
      s.won === this.lastWon &&
      this.panel.querySelector("button")
    ) {
      return;
    }
    this.lastOverlay = s.overlay;
    this.lastDeath = s.death;
    this.lastWon = s.won;
    if (s.overlay === "upgrade") {
      this.panel.innerHTML = `
        <h2 id="result-heading">${s.job ? "Demolition Complete" : "Upgrade"}</h2>
        <p>${s.job ? `+${s.job.payout}. Choose an upgrade.` : "Choose an upgrade."}</p>
        <div class="choices">
          <button type="button" data-up="blade" aria-label="1, ${L.blade}, blade damage ${upgradePercent('blade')}">${MENU_ICONS.blade}<span>1 · ${L.blade} ${upgradePercent('blade')}</span></button>
          <button type="button" data-up="engine" aria-label="2, ${L.engine}, engine performance ${upgradePercent('engine')}">${MENU_ICONS.engine}<span>2 · ${L.engine} ${upgradePercent('engine')}</span></button>
          <button type="button" data-up="push" aria-label="3, ${L.push}, push duration ${upgradePercent('push')}">${MENU_ICONS.push}<span>3 · ${L.push} ${upgradePercent('push')}</span></button>
        </div>`;
    } else if (s.overlay === "briefing" && s.campaign) {
      this.panel.innerHTML = `
        <h2 id="result-heading">${s.campaign.levelName}</h2>
        <p class="campaign-briefing">${s.campaign.briefing.replaceAll('\n', '<br>')}</p>
        <div class="choices">
          <button class="primary" type="button" data-act="begin">${L.beginLevel}</button>
        </div>`;
    } else {
      const campaign = s.campaign;
      const headline = campaign?.victory ? "COUNTY CLOSED" : s.won ? "LEVEL CLEARED" : (s.death ?? "COUNTY CLOCK");
      const body = campaign
        ? `${campaign.levelName} · $${Math.floor(campaign.levelEarned).toLocaleString('en-US')} / $${campaign.dollarTarget.toLocaleString('en-US')}<br>${campaign.landmarkName} ${campaign.landmarkReady ? 'DOWN' : `${Math.floor(campaign.landmarkProgress * 100)}%`}${campaign.victory ? `<br>Campaign total $${Math.floor(campaign.campaignEarned).toLocaleString('en-US')}` : ''}`
        : `CASH $${Math.floor(s.cash)} &nbsp; TIME ${formatTime(MATCH_SECONDS - s.timeLeft)}`;
      const actions = campaign?.victory
        ? `<button class="primary" type="button" data-act="new-campaign">${L.newCampaign}</button><button type="button" data-act="title">${L.mainMenu}</button>`
        : campaign && s.won
          ? `<button class="primary" type="button" data-act="next">${L.nextLevel}</button><button type="button" data-act="title">${L.mainMenu}</button>`
          : campaign
            ? `<button class="primary" type="button" data-act="retry">${L.retryLevel}</button><button type="button" data-act="title">${L.mainMenu}</button>`
            : `<button class="primary" type="button" data-act="restart">${L.restart}</button><button type="button" data-act="title">${L.mainMenu}</button>`;
      this.panel.innerHTML = `
        <h2 id="result-heading">${headline}</h2>
        <p>${body}</p>
        <div class="choices">${actions}</div>`;
    }
    this.panel.focus();
    this.panel.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const up = (btn as HTMLButtonElement).dataset.up as "blade" | "engine" | "push" | undefined;
        const act = (btn as HTMLButtonElement).dataset.act;
        if (up) this.onChoice?.(up);
        this.onClick?.();
        if (act === "title") this.onTitle?.();
        if (act === "resume") this.onResume?.();
        if (act === "restart") this.onRestart?.();
        if (act === "newseed") this.onNewSeed?.();
        if (act === "begin") this.onBeginLevel?.();
        if (act === "next") this.onNextLevel?.();
        if (act === "retry") this.onRetryLevel?.();
        if (act === "new-campaign") this.onNewCampaign?.();
      });
    });
  }

  private paintSessionBar(s: HudState): void {
    const bar = this.root.querySelector("#hud-session");
    if (!bar) return;
    const card = s.levelCard;
    const levelId = s.campaign?.levelId ?? card?.levelId ?? s.levelId;
    const panels = debugSessionPanels({
      testMapName: s.testMapName,
      job: !!s.job,
      session: s.session,
      district: s.district,
      levelId,
      levelName: s.campaign?.levelName ?? card?.levelName,
    });
    bar.querySelector<HTMLElement>('[data-panel="levels"]')!.hidden = !panels.levels;
    bar.querySelector<HTMLElement>('[data-panel="job"]')!.hidden = !panels.job;
    const facts = bar.querySelector<HTMLElement>("#debug-campaign-facts");
    if (facts) {
      facts.textContent = debugSessionFacts({
        testMapName: s.testMapName,
        session: s.session,
        district: s.district,
        levelName: s.campaign?.levelName ?? card?.levelName,
        levelIndex: s.campaign?.levelIndex ?? card?.levelIndex,
        seed: s.seed,
        buildingCount: s.campaign?.buildingCount ?? card?.buildingCount,
        landmarkName: s.campaign?.landmarkName ?? card?.landmarkName,
        dollarTarget: s.campaign?.dollarTarget ?? card?.dollarTarget,
        timeLimit: s.campaign?.timeLimit ?? card?.timeLimit,
      });
    }
    bar.querySelectorAll("button").forEach((btn) => {
      const el = btn as HTMLButtonElement;
      const pressed = el.dataset.session === s.session || (!!levelId && el.dataset.level === levelId);
      el.classList.toggle("on", pressed);
      if (el.dataset.session || el.dataset.level) el.setAttribute("aria-pressed", String(pressed));
    });
  }
}

function formatTime(used: number): string {
  const t = Math.max(0, used);
  return `${Math.floor(t / 60)}:${Math.floor(t % 60)
    .toString()
    .padStart(2, "0")}`;
}

function gauge(id: string, label: string): string {
  return `<div class="gauge-module"><div class="gauge" id="gauge-${id}" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="gauge-ticks"></div><span class="gauge-min">0</span><span class="gauge-max">100</span><span class="gauge-needle"></span><span class="gauge-pin"></span><output>0%</output></div><span class="instrument-label">${label}</span></div>`;
}
