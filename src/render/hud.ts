import { COPY, CASH_TARGET, MATCH_SECONDS } from "../game/constants";
import { PermitLogo } from './permitLogo';
import { OperatorMenu } from './operatorMenu';
import type { PermitSound } from './permitIntro';
import { DEBUG_GROUPS, type DebugView, type DebugToggle } from "../debug/view";
import { DISTRICT_LABELS, type DistrictId, type SessionKind, type DemoAsset } from "../game/session";

export type OverlayMode = "none" | "title" | "pause" | "upgrade" | "results";

export interface HudState {
  hasYard: boolean;
  pileResistance?: number;
  tower?: { phase: string; capacity: number };
  job?: { progress: number; remaining: number; instruction: string; paid: boolean; payout: number };
  cash: number;
  resubmitted: boolean;
  score: number;
  timeLeft: number;
  elapsed: number;
  session: SessionKind;
  district: DistrictId;
  bladeDown: boolean;
  muted: boolean;
  heat: number;
  track: number;
  overlay: OverlayMode;
  death: string | null;
  won: boolean;
}

export class Hud {
  readonly root: HTMLElement;
  readonly assetsHost: HTMLElement;
  readonly permitLogo: PermitLogo;
  onResubmit?: () => number | null;
  private debugOrigin: 'hud' | 'menu' | null = null;
  private debugTab: 'inspector' | 'sites' | 'assets' = 'inspector';
  private lastOverlay: OverlayMode | null = null;
  private lastDeath: string | null = null;
  private lastWon = false;
  private readonly cashEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly bladeEl: HTMLElement;
  readonly menu: OperatorMenu;
  private readonly overlay: HTMLElement;
  private readonly panel: HTMLElement;
  onMute?: () => void;
  onMenu?: () => void;
  onTitle?: () => void;
  onStart?: (kind: SessionKind, district: DistrictId) => void;
  onClick?: () => void;
  onUnlockSound?: () => Promise<void>;
  onTitleSound?: (kind: PermitSound, index: number) => void;
  onChoice?: (id: "blade" | "engine" | "push") => void;
  onResume?: () => void;
  onRestart?: () => void;
  onNewSeed?: () => void;
  onSession?: (kind: SessionKind) => void;
  onDistrict?: (id: DistrictId) => void;
  onDemo?: (id: DemoAsset) => void;
  onTower?: () => void;
  onTowerAction?: (action: string) => void;
  onJob?: () => void;
  onDebugToggle?: (key: DebugToggle, value: boolean) => void;
  onDebugFloor?: (floor: number) => void;
  onDebugReset?: () => void;
  onDebugStep?: () => void;
  onDebugOpen?: () => void;
  onTestYard?: () => void;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="top">
        <div id="hud-permit"></div>
        <div class="stat"><span class="instrument-label">CASH</span><strong id="hud-cash"></strong></div>
        <div class="stat"><span class="instrument-label" id="hud-clock-label">COUNTY CLOCK</span><strong id="hud-time"></strong></div>
        <div class="stat"><span class="instrument-label">SCORE</span><strong id="hud-score"></strong></div>
        <div class="hud-actions"><button type="button" id="debug-toggle" aria-expanded="false" aria-controls="debug-panel">DEBUG</button><button type="button" id="hud-menu">MENU</button></div>
      </div>
      <div class="session" id="hud-session"></div>
      <details id="hud-tower" class="tower-test" aria-label="Skyscraper test controls" open hidden>
        <summary>SKYSCRAPER TEST</summary> <span id="tower-status"></span>
        <p>W/S drive · A/D steer · SPACE powered blade. Break the facade, then reach the central supports.</p>
        <button data-tower="view">Tower / dozer view</button><button data-tower="core-view">Inspect ground floor</button>
        <button data-tower="facade">Breach facade</button><button data-tower="core">Fail core</button><button data-tower="reset">Reset tower</button>
      </details>
      <div id="hud-job" class="job" hidden></div>
      <div class="debug-menu">
        <section id="debug-panel" aria-label="Debug" tabindex="-1" hidden>
          <div class="debug-heading"><strong>Debug</strong><button type="button" id="debug-close" aria-label="Close debug menu">×</button></div>
          <div class="debug-toolbar"><label><input type="checkbox" data-debug="freeze"> Freeze</label><button type="button" id="debug-step" disabled>STEP</button></div>
          <div class="debug-tabs" role="tablist" aria-label="Debug tools">
            ${(['inspector', 'sites', 'assets'] as const).map(tab => `<button type="button" role="tab" id="debug-tab-${tab}" aria-controls="debug-${tab}" aria-selected="${tab === 'inspector'}" tabindex="${tab === 'inspector' ? 0 : -1}" data-debug-tab="${tab}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join('')}
          </div>
          <div class="debug-pages">
          <section id="debug-inspector" role="tabpanel" aria-labelledby="debug-tab-inspector">
          <p>Hidden objects still collide and simulate.</p>
          <label class="debug-floor">Show floors <select id="debug-floor" aria-label="Show floors">
            <option value="99">All floors</option><option value="0">Ground floor only</option>
            <option value="1">Through second floor</option><option value="2">Through third floor</option>
          </select></label>
          ${DEBUG_GROUPS.map(group => `<fieldset><legend>${group.label}</legend>${group.options.filter(([key]) => key !== 'freeze').map(([key, label, checked]) =>
            `<label><input type="checkbox" data-debug="${key}" ${checked ? "checked" : ""}> ${label}</label>`).join("")}</fieldset>`).join("")}
          <button type="button" id="debug-reset">RESET OPTIONS</button>
          <p class="debug-legend">Paths: blue · route: yellow · lots: green · buildable: purple · rooms: gold<br>Collision: pink walls, orange props/contents, white dozer · supports: green live / pink failing</p>
          </section>
          <section id="debug-sites" role="tabpanel" aria-labelledby="debug-tab-sites" hidden></section>
          <section id="debug-assets" role="tabpanel" aria-labelledby="debug-tab-assets" hidden><button type="button" id="debug-open-yard">OPEN TEST YARD</button><div id="debug-asset-host"></div></section>
          </div>
        </section>
      </div>
      <div class="instrument-deck">
        ${gauge('heat', 'ENGINE HEAT')}
        ${gauge('track', 'TRACK STRESS')}
        <div class="blade-module"><div class="blade" id="hud-blade"></div><p id="hud-advisory" role="status"></p></div>
      </div>
      <div class="overlay" id="hud-overlay" role="dialog" aria-modal="true" aria-labelledby="result-heading"><div class="panel" id="hud-panel" tabindex="-1"></div></div>
    `;
    this.cashEl = root.querySelector("#hud-cash")!;
    this.timeEl = root.querySelector("#hud-time")!;
    this.scoreEl = root.querySelector("#hud-score")!;
    this.bladeEl = root.querySelector("#hud-blade")!;
    this.overlay = root.querySelector("#hud-overlay")!;
    this.panel = root.querySelector("#hud-panel")!;
    this.assetsHost = root.querySelector('#debug-asset-host')!;
    this.permitLogo = new PermitLogo(() => this.onResubmit?.() ?? null,
      (kind, index) => this.onTitleSound?.(kind, index),
      () => this.onUnlockSound?.() ?? Promise.resolve());
    root.querySelector('#hud-permit')!.append(this.permitLogo.root);

    root.querySelector('#hud-menu')!.addEventListener('click', () => { this.onClick?.(); this.onMenu?.(); });
    this.menu = new OperatorMenu(root, {
      resume: () => this.onResume?.(), start: (kind, district) => this.onStart?.(kind, district),
      job: () => this.onJob?.(), restart: () => this.onRestart?.(), newLot: () => this.onNewSeed?.(),
      title: () => this.onTitle?.(), mute: () => this.onMute?.(), click: () => this.onClick?.(),
      unlockSound: () => this.onUnlockSound?.() ?? Promise.resolve(),
      titleSound: (kind, index) => this.onTitleSound?.(kind, index),
      debug: () => this.openDebug('menu'),
    });
    for (const selector of ['#hud-session', '#hud-tower']) root.querySelector('#debug-sites')!.append(root.querySelector(selector)!);
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
    root.querySelectorAll<HTMLButtonElement>('[data-tower]').forEach(button => button.addEventListener('click', () => this.onTowerAction?.(button.dataset.tower!)));
    this.bindSessionBar();
    this.bindDebugMenu();
  }

  private bindDebugMenu(): void {
    const panel = this.root.querySelector<HTMLElement>("#debug-panel")!;
    const toggle = this.root.querySelector<HTMLButtonElement>("#debug-toggle")!;
    toggle.addEventListener('click', () => { if (panel.hidden) this.openDebug('hud'); else this.closeDebug(true); });
    this.root.querySelector('#debug-close')!.addEventListener('click', () => this.closeDebug(true));
    this.root.querySelector('.debug-menu')!.addEventListener('keydown', event => {
      const e = event as KeyboardEvent;
      if (e.key === 'Escape' && !panel.hidden) { e.preventDefault(); e.stopPropagation(); this.closeDebug(true); return; }
      if (e.key === 'Tab' && this.debugOrigin === 'menu') {
        const items = [...panel.querySelectorAll<HTMLElement>('button, input, select, summary, [tabindex="0"]')]
          .filter(el => !el.closest('[hidden]') && !el.matches(':disabled') && el.tabIndex >= 0 && el.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel)) { e.preventDefault(); first?.focus(); }
      }
    }, true);
    const tabs = [...panel.querySelectorAll<HTMLButtonElement>('[data-debug-tab]')];
    tabs.forEach((button, index) => {
      button.addEventListener('click', () => this.selectDebugTab(button.dataset.debugTab as typeof this.debugTab));
      button.addEventListener('keydown', e => {
        let next = index;
        if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        else return;
        e.preventDefault(); e.stopPropagation();
        this.selectDebugTab(tabs[next].dataset.debugTab as typeof this.debugTab);
        tabs[next].focus();
      });
    });
    this.root.querySelector('#debug-open-yard')!.addEventListener('click', () => this.onTestYard?.());
    panel.querySelectorAll<HTMLInputElement>("[data-debug]").forEach(input => {
      input.addEventListener("change", () => this.onDebugToggle?.(input.dataset.debug as DebugToggle, input.checked));
    });
    this.root.querySelector<HTMLSelectElement>("#debug-floor")!.addEventListener("change", event => {
      this.onDebugFloor?.(Number((event.target as HTMLSelectElement).value));
    });
    this.root.querySelector("#debug-reset")!.addEventListener("click", () => this.onDebugReset?.());
    this.root.querySelector("#debug-step")!.addEventListener("click", () => this.onDebugStep?.());
  }

  private selectDebugTab(tab: typeof this.debugTab): void {
    this.debugTab = tab;
    this.root.querySelectorAll<HTMLButtonElement>('[data-debug-tab]').forEach(button => {
      const selected = button.dataset.debugTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      this.root.querySelector<HTMLElement>('#debug-' + button.dataset.debugTab)!.hidden = !selected;
    });
    this.onDebugOpen?.();
  }

  private openDebug(origin: 'hud' | 'menu'): void {
    this.debugOrigin = origin;
    this.menu.setCovered(origin === 'menu');
    const panel = this.root.querySelector<HTMLElement>('#debug-panel')!;
    panel.hidden = false;
    panel.setAttribute('role', origin === 'menu' ? 'dialog' : 'region');
    if (origin === 'menu') panel.setAttribute('aria-modal', 'true'); else panel.removeAttribute('aria-modal');
    this.root.classList.toggle('debug-from-menu', origin === 'menu');
    this.root.querySelector('#debug-toggle')!.setAttribute('aria-expanded', 'true');
    this.onDebugOpen?.();
    this.onClick?.();
    panel.focus();
  }

  closeDebug(restoreFocus = false): boolean {
    const panel = this.root.querySelector<HTMLElement>('#debug-panel')!;
    if (panel.hidden) return false;
    panel.hidden = true;
    const toggle = this.root.querySelector<HTMLButtonElement>('#debug-toggle')!;
    toggle.setAttribute('aria-expanded', 'false');
    const fromMenu = this.debugOrigin === 'menu';
    this.debugOrigin = null;
    this.menu.setCovered(false);
    this.root.classList.remove('debug-from-menu');
    if (restoreFocus && !fromMenu) toggle.focus();
    return true;
  }

  syncDebug(view: DebugView): void {
    this.root.querySelectorAll<HTMLInputElement>("[data-debug]").forEach(input => {
      input.checked = view[input.dataset.debug as DebugToggle];
    });
    this.root.querySelector<HTMLSelectElement>("#debug-floor")!.value = String(view.maxFloor);
    this.root.querySelector<HTMLButtonElement>("#debug-step")!.disabled = !view.freeze;
    this.root.querySelector<HTMLButtonElement>("#debug-toggle")!.textContent = "DEBUG";
  }

  private bindSessionBar(): void {
    const bar = this.root.querySelector("#hud-session")!;
    bar.innerHTML = `
      <h3>OPERATING MODE</h3>
      <button type="button" data-session="challenge">CLOCK</button>
      <button type="button" data-session="sandbox">SANDBOX</button>
      <button type="button" data-act="job">BRICK JOB</button>
      <h3>SITE SIZE / REBUILD</h3>
      <button type="button" data-district="classic">${DISTRICT_LABELS.classic}</button>
      <button type="button" data-district="d10">${DISTRICT_LABELS.d10}</button>
      <button type="button" data-district="d30">${DISTRICT_LABELS.d30}</button>
      <button type="button" data-district="d100">${DISTRICT_LABELS.d100}</button>
      <button type="button" data-act="restart">RESTART</button>
      <button type="button" data-act="newseed">NEW LOT</button>
      <h3>TEST SCENARIOS</h3>
      <button type="button" data-demo="ranch">RANCH</button>
      <button type="button" data-demo="rivertown">BRICK</button>
      <button type="button" data-demo="steel-warehouse">STEEL</button>
      <button type="button" data-act="tower">SKYSCRAPER</button>
      <h3 class="sandbox-upgrades">SANDBOX EQUIPMENT</h3>
      <button type="button" data-up="blade">BLADE+</button>
      <button type="button" data-up="engine">ENGINE+</button>
      <button type="button" data-up="push">PUSH+</button>
    `;
    bar.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const session = (btn as HTMLButtonElement).dataset.session as SessionKind | undefined;
        const district = (btn as HTMLButtonElement).dataset.district as DistrictId | undefined;
        const act = (btn as HTMLButtonElement).dataset.act;
        const demo = (btn as HTMLButtonElement).dataset.demo as DemoAsset | undefined;
        const up = (btn as HTMLButtonElement).dataset.up as "blade" | "engine" | "push" | undefined;
        if (session) this.onSession?.(session);
        if (district) this.onDistrict?.(district);
        if (demo) this.onDemo?.(demo);
        if (act === "newseed") this.onNewSeed?.();
        if (act === "restart") this.onRestart?.();
        if (act === "tower") this.onTower?.();
        if (act === "job") this.onJob?.();
        if (up) this.onChoice?.(up);
      });
    });
  }

  render(s: HudState): void {
    this.permitLogo.render(s.resubmitted, s.cash, s.overlay !== 'none');
    const touch = document.documentElement.classList.contains('touch-ui');
    this.root.querySelector<HTMLElement>('#hud-tower p')!.textContent = touch
      ? 'Use the stick to drive and steer. Hold POWER BLADE. Break the facade, then reach the central supports.'
      : 'W/S drive · A/D steer · SPACE powered blade. Break the facade, then reach the central supports.';
    this.root.querySelector<HTMLElement>('#hud-tower')!.hidden = !s.tower;
    if (s.tower) {
      const text = s.tower.phase === 'warning' ? 'CORE FAILING — BACK AWAY' : s.tower.phase === 'falling' ? 'COLLAPSE — DEBRIS MOVING OUTWARD' : s.tower.phase === 'settled' ? 'SETTLED — CLEAR THE RUBBLE' : 'Support capacity ' + Math.round(s.tower.capacity * 100) + '%';
      this.root.querySelector<HTMLElement>('#tower-status')!.textContent = text;
      for (const action of ['facade', 'core']) this.root.querySelector<HTMLButtonElement>('[data-tower="' + action + '"]')!.disabled = s.tower.phase !== 'standing';
    }
    this.root.querySelector<HTMLElement>('[data-district="classic"]')!.textContent = s.session === "sandbox" ? "TEST YARD" : DISTRICT_LABELS.classic;
    const job = this.root.querySelector<HTMLElement>("#hud-job")!;
    job.hidden = !s.job;
    if (s.job) job.textContent = s.job.paid
      ? `CONTRACT COMPLETE · +$${s.job.payout}`
      : `BRICK CONTRACT · ${Math.floor(s.job.progress * 100)}%\n${s.job.instruction}\nRemove 90% of the structure.`;
    this.root.querySelectorAll<HTMLElement>("[data-demo], #hud-session [data-up], .sandbox-upgrades").forEach(el => {
      el.hidden = s.session !== "sandbox";
    });
    this.cashEl.textContent =
      s.session === "sandbox" || s.job ? `$${Math.floor(s.cash)}` : `$${Math.floor(s.cash)} / $${CASH_TARGET}`;
    if (s.session === "sandbox" || s.job) {
      this.timeEl.textContent = formatTime(s.elapsed);
    } else {
      this.timeEl.textContent = formatTime(Math.max(0, s.timeLeft));
    }
    this.paintSessionBar(s.session, s.district);
    this.scoreEl.textContent = String(Math.floor(s.score));
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
    const advisory = s.heat > 65 ? 'HIGH HEAT · RELEASE BLADE' : s.track > 65 ? 'TRACK STRESS · BACK OFF' : (s.pileResistance ?? 0) > .4 ? 'DENSE RUBBLE · CLEAR A PATH' : '';
    const advisoryEl = this.root.querySelector('#hud-advisory')!;
    if (advisoryEl.textContent !== advisory) advisoryEl.textContent = advisory;
    (advisoryEl as HTMLElement).hidden = !advisory;
    this.root.querySelector('#hud-clock-label')!.textContent = s.session === 'sandbox' || s.job ? 'ELAPSED' : 'COUNTY CLOCK';
    const modal = s.overlay !== 'none';
    if (s.overlay === 'results' || s.overlay === 'upgrade' || (modal && this.debugOrigin === 'hud')) this.closeDebug();
    if (s.overlay === 'none' && this.debugOrigin === 'menu') {
      this.debugOrigin = 'hud';
      this.root.classList.remove('debug-from-menu');
      const debug = this.root.querySelector<HTMLElement>('#debug-panel')!;
      debug.setAttribute('role', 'region');
      debug.removeAttribute('aria-modal');
    }
    this.root.querySelector<HTMLElement>('#debug-open-yard')!.hidden = s.hasYard;
    this.root.classList.toggle('modal-open', modal);
    document.querySelector<HTMLElement>('#game-root')!.inert = modal;
    for (const selector of ['.top', '.instrument-deck', '#touch-controls']) {
      const el = this.root.querySelector<HTMLElement>(selector);
      if (el) el.inert = modal;
    }
    this.menu.show(s.overlay === 'title' || s.overlay === 'pause' ? s.overlay : null, s.session, s.district);
    this.menu.setCovered(this.debugOrigin === 'menu');
    this.menu.syncMuted(s.muted);

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
        <h2 id="result-heading">${s.job ? "Contract Complete" : "Upgrade"}</h2>
        <p>${s.job ? `+${s.job.payout}. Choose an upgrade.` : "Choose an upgrade."}</p>
        <div class="choices">
          <button type="button" data-up="blade">1 · BLADE +42%</button>
          <button type="button" data-up="engine">2 · ENGINE +28%</button>
          <button type="button" data-up="push">3 · PUSH +35%</button>
        </div>`;
    } else {
      const headline = s.won ? "PERMIT DENIED" : (s.death ?? "COUNTY CLOCK");
      this.panel.innerHTML = `
        <h2 id="result-heading">${headline}</h2>
        <p>CASH $${Math.floor(s.cash)} &nbsp; SCORE ${Math.floor(s.score)} &nbsp; TIME ${formatTime(MATCH_SECONDS - s.timeLeft)}</p>
        <div class="choices">
          <button class="primary" type="button" data-act="restart">RESTART</button><button type="button" data-act="title">TITLE SCREEN</button>
        </div>`;
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
      });
    });
  }

  private paintSessionBar(session: SessionKind, district: DistrictId): void {
    const bar = this.root.querySelector("#hud-session");
    if (!bar) return;
    bar.querySelectorAll("button").forEach((btn) => {
      const el = btn as HTMLButtonElement;
      el.classList.toggle("on", el.dataset.session === session || el.dataset.district === district);
      if (el.dataset.session || el.dataset.district) el.setAttribute('aria-pressed', String(el.classList.contains('on')));
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
