import { TITLE } from '../game/constants';
import { PermitIntro, permitDocument, type PermitSound } from './permitIntro';
import { type CountyDeployment, type SessionKind } from '../game/session';
import type { CountyProgress } from '../game/countyProgress';
import { loadOverworld, type OverworldModule } from '../game/overworldLoader';
import { isWeatherCondition, isWeatherDetail, seasonLabel, SEASONS, WEATHER_CONDITIONS, type SeasonId, type WeatherConditionId, type WeatherDetail } from '../world/season';
import type { CountyViewState } from './overworldMap';
import type { AtlasData } from '../world/atlas';
import type { AtlasState, AtlasView } from './atlasView';
import { MENU_LABELS as L, MODE_LABELS, MODE_DESCRIPTIONS } from '../game/menuLabels';
import { labeledMenuButton, MENU_ICONS, soundButtonContent } from './menuIcons';
import { version } from '../../package.json';

type Page = 'home' | 'dispatch' | 'overworld' | 'region' | 'controls' | 'about' | 'equipment';

/** The running game's setup, adopted when the pause menu opens. */
export interface MenuSetup {
  session: SessionKind;
  season?: SeasonId;
  effects?: WeatherDetail;
  regionId?: string;
  /** The county being played, so the paused map can mark it and offer Resume. */
  countyIndex?: number;
  weather?: WeatherConditionId;
  mapSeed?: number;
}

/** The county run the pause menu was opened over. Browsing the map never ends it. */
interface RunningCounty {
  regionId: string;
  countyIndex: number;
  weather: WeatherConditionId;
  mapSeed: number;
}
export interface MenuActions {
  page?(page: Page | null, host?: HTMLElement): void;
  resume(): void;
  start(deploy: CountyDeployment): void;
  /** Weather roll for one overworld visit; defaults to a random draw. */
  mapSeed?(): number;
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

const CONTROLS_HTML = `<dl class="control-list"><div><dt>W / S or ↑ / ↓</dt><dd>Drive forward / reverse</dd></div><div><dt>A / D or ← / →</dt><dd>Steer left / right</dd></div><div><dt>Hold SPACE</dt><dd>Power the blade</dd></div><div><dt>Esc / Pause</dt><dd>Pause / Resume</dd></div><div><dt>R</dt><dd>${L.restart}</dd></div><div><dt>N</dt><dd>${L.newLayout}</dd></div><div><dt>1 / 2 / 3</dt><dd>${L.blade} / ${L.engine} / ${L.push} upgrade</dd></div><div><dt>M</dt><dd>Toggle sound</dd></div></dl><div class="instruction-card"><strong>Touch Controls</strong><p>Drag the left stick to drive and steer. Hold the right POWER BLADE button while driving. Release the stick to coast. Release the blade to finish the current push.</p></div><p class="fine-print">Watch ENGINE HEAT and TRACK STRESS. Above 65%, release the blade or back off rubble. In sandbox these gauges remain advisory.</p>`;
const ABOUT_HTML = `<dl class="credits-list"><div><dt>Publisher</dt><dd>${publisher}</dd></div><div><dt>Website</dt><dd><a href="https://columbiacloudworks.com" target="_blank" rel="noopener noreferrer">columbiacloudworks.com ↗</a></dd></div><div><dt>Contact</dt><dd><a href="mailto:nicholas.king@columbiacloudworks.com">nicholas.king@columbiacloudworks.com</a></dd></div><div><dt>Game</dt><dd><a href="https://permitdenied.app" target="_blank" rel="noopener noreferrer">permitdenied.app ↗</a></dd></div><div><dt>GitHub</dt><dd><a href="https://github.com/Columbia-Cloudworks-LLC/permit-denied-game" target="_blank" rel="noopener noreferrer">permit-denied-game ↗</a></dd></div><div><dt>Version</dt><dd>${version}</dd></div></dl><details class="license-notices"><summary>Third-party software notices</summary><pre></pre></details>`;

/** Two clicks on the same map shape within this many milliseconds open it. */
const DOUBLE_MS = 450;

const SEASON_NOTE = 'The season stays locked for every county you play from this map. Weather is chosen per county.';

/** One navigation and focus owner for keyboard, mouse and touch menus. */
export class OperatorMenu {
  readonly root = document.createElement('section');
  private body: HTMLElement;
  private heading: HTMLElement;
  private mode: 'title' | 'pause' | null = null;
  private page: Page = 'home';
  private session: SessionKind = 'sandbox';
  private season: SeasonId = 'summer';
  private effects: WeatherDetail = 'on';
  /** One overworld visit: weather is rolled per county on map load; overrides live only here. */
  private mapSeed = 0;
  private readonly weatherOverrides = new Map<string, WeatherConditionId>();
  /** The overworld chunk: prefetched when setup opens, required before the map pages render. */
  private ow?: OverworldModule;
  private progress?: CountyProgress;
  private atlas?: AtlasData;
  /** The state or province picked on the continental atlas; none until the player picks one. */
  private regionId?: string;
  /** The county picked on the state sheet; none until the player picks one. */
  private countyIndex?: number;
  /** The atlas DOM, from the overworld chunk. */
  private atlasView?: AtlasView;
  /** Bumped by every map-open request, so a late load cannot clobber a newer one. */
  private mapRequest = 0;
  /** Last map pick, so a second click on the same shape within DOUBLE_MS opens it. */
  private lastPick?: { key: string; at: number };
  private running?: RunningCounty;
  /**
   * The paused game's mode, season and effects. New Game edits a draft in `session`/`season`/
   * `effects`; the run maps restore from this copy so a canceled draft never leaks into them.
   */
  private runningSetup?: { session: SessionKind; season: SeasonId; effects: WeatherDetail };
  /** Where Back leaves the world map: setup for a new game, the pause home for a run in progress. */
  private mapOrigin: 'dispatch' | 'home' = 'dispatch';
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
    this.root.addEventListener('click', e => this.onClick(e));
    this.body.addEventListener('change', e => {
      const input = e.target as HTMLSelectElement;
      this.setupFields[input.id]?.(input.value);
    });
    // Handle menu navigation before focused controls consume the key.
    this.root.addEventListener('keydown', e => this.onKey(e), true);
  }

  private onClick(e: MouseEvent): void {
    if ((e.target as Element).closest('[data-replay-permit]')) { this.replayIntro(); return; }
    if (this.pickMapTarget(e.target as Element, 'click')) { this.actions.click(); return; }
    const button = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    this.actions.click();
    const nav = button.dataset.nav;
    if (nav === 'back') this.back();
    else if (nav) this.navigate(nav as Page);
    const action = button.dataset.menuAction;
    if (action) this.menuActs[action]?.();
  }

  private readonly menuActs: Record<string, () => void> = {
    resume: () => this.actions.resume(),
    restart: () => this.actions.restart(),
    debug: () => this.actions.debug?.(),
    title: () => this.actions.title(),
    mute: () => this.actions.mute(),
    'pwa-update': () => this.actions.pwaUpdate?.(),
    'open-map': () => this.openMap(),
    'world-map': () => this.openRunMap('overworld'),
    'state-map': () => this.openRunMap('region'),
    'open-region': () => this.openRegion(),
    'cycle-weather': () => this.cycleWeather(),
    deploy: () => this.deploy(),
  };

  /**
   * Region and county shapes are SVG paths, so clicks and Enter route here, not through buttons.
   * A second click on the same shape within DOUBLE_MS (or Enter on the selected one) opens it:
   * a region opens its state sheet, an unlocked county deploys.
   */
  private pickMapTarget(target: Element, via: 'click' | 'key'): boolean {
    const region = target.closest<SVGElement>('[data-region-id]');
    const county = target.closest<SVGElement>('[data-county-index]');
    const key = this.page === 'overworld' && region?.dataset.regionId ? `r:${region.dataset.regionId}`
      : this.page === 'region' && county?.dataset.countyIndex ? `c:${county.dataset.countyIndex}` : '';
    if (!key) return false;
    const now = performance.now();
    const selected = key === (this.page === 'overworld' ? `r:${this.regionId}` : `c:${this.countyIndex}`);
    const double = via === 'key' ? selected : !!this.lastPick && this.lastPick.key === key && now - this.lastPick.at < DOUBLE_MS;
    this.lastPick = double ? undefined : { key, at: now };
    if (this.page === 'overworld') {
      if (!this.world.regionById(region!.dataset.regionId)) return false;
      this.selectRegion(region!.dataset.regionId!);
      if (double) this.openRegion();
    } else {
      this.selectCounty(Number(county!.dataset.countyIndex));
      if (double) this.isRunningCounty(this.countyIndex) ? this.actions.resume() : this.deploy();
    }
    return true;
  }

  /** The overworld chunk and the road atlas, which falls back to the schematic map offline. */
  private async loadMap(): Promise<OverworldModule> {
    const ow = this.ow ?? await loadOverworld();
    this.ow = ow;
    this.atlas = await ow.loadAtlas();
    return ow;
  }

  /** A fresh map visit forgets the previous view and picks. */
  private resetMapView(): void {
    this.atlasView?.reset();
    this.lastPick = undefined;
  }

  /** Opening the map rolls fresh county weather; the season chosen on setup is now fixed. */
  private openMap(): void {
    const request = ++this.mapRequest;
    void this.loadMap().then(() => {
      // A double click, or Back and back again while the atlas loads, leaves only the newest
      // request; and nothing changes unless setup is still showing.
      if (request !== this.mapRequest || !this.mode || this.page !== 'dispatch') return;
      this.mapSeed = (this.actions.mapSeed?.() ?? Math.floor(Math.random() * 0x100000000)) >>> 0;
      this.weatherOverrides.clear();
      this.resetMapView();
      this.regionId = undefined;
      this.countyIndex = undefined;
      this.mapOrigin = 'dispatch';
      this.navigate('overworld');
    });
  }

  /**
   * Pause → World Map or State Map. The run stays paused underneath; the map keeps the run's
   * mode, season and weather roll, and the running county shows its actual weather.
   */
  private openRunMap(target: 'overworld' | 'region'): void {
    const request = ++this.mapRequest;
    void this.loadMap().then(ow => {
      // Only if the pause menu's home page is still showing: a late load must not reset a New
      // Game draft the player moved on to.
      if (request !== this.mapRequest || this.mode !== 'pause' || this.page !== 'home') return;
      const run = this.running;
      if (this.runningSetup) ({ session: this.session, season: this.season, effects: this.effects } = this.runningSetup);
      this.weatherOverrides.clear();
      this.resetMapView();
      if (run) {
        this.mapSeed = run.mapSeed;
        this.regionId = run.regionId;
        this.countyIndex = run.countyIndex;
        this.weatherOverrides.set(ow.countyId(run.regionId, run.countyIndex), run.weather);
      } else {
        this.mapSeed = (this.actions.mapSeed?.() ?? Math.floor(Math.random() * 0x100000000)) >>> 0;
        this.regionId = undefined;
        this.countyIndex = undefined;
      }
      this.mapOrigin = 'home';
      this.navigate(run && target === 'region' ? 'region' : 'overworld');
    });
  }

  /**
   * The paused run's county, but only on the run's own maps (from the pause menu). A New Game
   * map is a fresh setup: its counties can only be deployed, never resumed.
   */
  private runCountyHere(): number | undefined {
    const run = this.running;
    return this.mode === 'pause' && this.mapOrigin === 'home' && run && run.regionId === this.regionId ? run.countyIndex : undefined;
  }

  private isRunningCounty(index: number | undefined): boolean {
    return index !== undefined && this.runCountyHere() === index;
  }

  /** Only the map pages read this; they render after the chunk has loaded. */
  private get world(): OverworldModule {
    if (!this.ow) throw new Error('Overworld map used before its chunk loaded');
    return this.ow;
  }

  private countyWeather(index: number): WeatherConditionId {
    const regionId = this.regionId ?? '';
    return this.weatherOverrides.get(this.world.countyId(regionId, index))
      ?? this.world.countyWeather(this.mapSeed, this.season, regionId, index);
  }

  private countyView(): CountyViewState {
    const current = this.runCountyHere();
    return { kind: this.session, season: this.season, selected: this.countyIndex, current, weather: index => this.countyWeather(index) };
  }

  private deploy(): void {
    if (!this.regionId || !this.countyIndex || !this.progress?.isUnlocked(this.session, this.regionId, this.countyIndex)) return;
    this.actions.start({
      kind: this.session, season: this.season, regionId: this.regionId, countyIndex: this.countyIndex,
      weather: this.countyWeather(this.countyIndex), effects: this.effects, mapSeed: this.mapSeed,
    });
  }

  /** New-game fields by select id; the mode also reshapes the season fields. */
  private readonly setupFields: Record<string, (value: string) => void> = {
    'dispatch-mode': value => { this.session = value as SessionKind; this.syncSetup(); },
    'dispatch-season': value => { this.season = value as SeasonId; },
    'county-weather': value => {
      if (isWeatherCondition(value) && this.regionId && this.countyIndex) this.weatherOverrides.set(this.world.countyId(this.regionId, this.countyIndex), value);
      this.refreshSheet('#county-weather');
    },
    'county-effects': value => { if (isWeatherDetail(value)) this.effects = value; },
  };

  private onKey(e: KeyboardEvent): void {
    const target = e.target as Element;
    if (['Enter', ' '].includes(e.key) && target.closest('[data-replay-permit]')) {
      e.preventDefault();
      if (!e.repeat) this.replayIntro();
      return;
    }
    if (['Enter', ' '].includes(e.key) && target.matches('[data-region-id], [data-county-index]')) {
      e.preventDefault();
      if (!e.repeat && this.pickMapTarget(target, 'key')) this.actions.click();
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.back(); }
    if (e.key.toLowerCase() === 'm' && !e.repeat && !target.closest('input, select, textarea')) this.actions.mute();
    if (e.key === 'Tab') this.trapFocus(e);
  }

  /** Tab wraps within the visible, enabled controls; with none, focus stays on the heading. */
  private trapFocus(e: KeyboardEvent): void {
    const nodes = [...this.root.querySelectorAll<HTMLElement>('button, a[href], input, select, summary, [tabindex="0"]')]
      .filter(el => !el.closest('[hidden], [inert]') && !el.matches(':disabled') && el.getClientRects().length);
    const first = nodes[0], last = nodes.at(-1);
    if (!first) { e.preventDefault(); this.heading.focus(); return; }
    const from = document.activeElement;
    const edge = e.shiftKey ? first : last;
    if (from !== edge && from !== this.heading) return;
    e.preventDefault();
    (e.shiftKey ? last : first)?.focus();
  }

  show(mode: 'title' | 'pause' | null, setup: MenuSetup = { session: 'sandbox' }): void {
    if (this.mode === mode) return;
    // Pause opens on the running game's setup; the title menu starts from the defaults.
    if (mode === 'pause') this.adoptSetup(setup, true);
    if (mode === 'title') this.adoptSetup({ session: 'sandbox', season: 'summer', effects: 'on' }, false);
    this.mapOrigin = 'dispatch';
    this.mode = mode;
    this.root.hidden = !mode;
    if (mode) this.navigate('home');
    else this.close();
  }

  private adoptSetup(setup: MenuSetup, running: boolean): void {
    this.session = setup.session;
    if (setup.season) this.season = setup.season;
    if (setup.effects) this.effects = setup.effects;
    if (setup.regionId) this.regionId = setup.regionId;
    this.runningSetup = running ? { session: this.session, season: this.season, effects: this.effects } : undefined;
    this.running = running && setup.regionId && setup.countyIndex && setup.weather
      ? { regionId: setup.regionId, countyIndex: setup.countyIndex, weather: setup.weather, mapSeed: setup.mapSeed ?? 0 }
      : undefined;
  }

  /** Hand focus back to an open debug binder, else to the game canvas. */
  private close(): void {
    this.actions.page?.(null);
    this.atlasView?.reset();
    this.introVersion++;
    this.intro.stop();
    const debug = document.querySelector<HTMLElement>('#debug-panel:not([hidden])');
    (debug ?? document.querySelector<HTMLCanvasElement>('#game-root canvas'))?.focus();
  }

  back(): void {
    const parent: Partial<Record<Page, Page>> = { region: 'overworld', overworld: this.mapOrigin };
    if (this.page !== 'home') this.navigate(parent[this.page] ?? 'home');
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
    this.body.querySelector<HTMLSelectElement>('#dispatch-season')!.value = this.season;
    this.body.querySelector('#season-note')!.textContent = SEASON_NOTE;
    this.body.querySelector('#mode-description')!.textContent = MODE_DESCRIPTIONS[this.session];
  }

  private atlasState(): AtlasState {
    return {
      atlas: this.atlas!, progress: this.progress!, kind: this.session, chips: { mode: MODE_LABELS[this.session], season: this.season },
      effects: this.effects, regionId: this.regionId, view: this.countyView(),
      run: { current: this.isRunningCounty(this.countyIndex), replacing: this.mode === 'pause' },
    };
  }

  /** Mount the continental atlas (kept across sheet visits) and, for the region page, the sheet over it. */
  private showAtlas(sheet: boolean): void {
    this.atlasView ??= new this.world.AtlasView(this.body);
    this.atlasView.show(sheet, this.atlasState());
  }

  private selectRegion(id: string): void {
    if (this.regionId !== id) this.countyIndex = undefined;
    this.regionId = id;
    this.atlasView?.selectRegion(this.atlasState());
  }

  private openRegion(): void {
    if (this.page === 'overworld' && this.world.regionById(this.regionId)) this.navigate('region');
  }

  private selectCounty(index: number): void {
    this.countyIndex = index;
    this.atlasView?.selectCounty(this.atlasState());
  }

  private cycleWeather(): void {
    if (!this.regionId || !this.countyIndex) return;
    const next = WEATHER_CONDITIONS[(WEATHER_CONDITIONS.indexOf(this.countyWeather(this.countyIndex)) + 1) % WEATHER_CONDITIONS.length]!;
    this.weatherOverrides.set(this.world.countyId(this.regionId, this.countyIndex), next);
    this.refreshSheet('[data-weather-cycle]');
  }

  private refreshSheet(focusSelector?: string): void {
    if (this.page === 'region') this.atlasView?.refreshSheet(this.atlasState(), focusSelector);
  }

  private navigate(page: Page): void {
    this.introVersion++;
    this.intro.stop();
    this.actions.page?.(null);
    this.page = page;
    this.root.classList.toggle('title-open', this.mode === 'title' && page === 'home');
    const titlePage = this.mode === 'title' && page === 'home';
    const mapPage = page === 'overworld' || page === 'region';
    // Map pages carry their own Back in the bottom action bar.
    this.root.querySelector<HTMLButtonElement>('.menu-heading [data-nav="back"]')!.hidden = page === 'home' || page === 'dispatch' || mapPage;
    this.root.classList.toggle('map-open', mapPage);
    // Any other page replaces the body: let go of the detached map and its pan/zoom listeners.
    if (!mapPage) this.atlasView?.reset();
    if (mapPage) this.progress = this.world.sharedCountyProgress();
    // Prefetch the chunk and the atlas while the player picks a mode and season.
    if (page === 'dispatch') void this.loadMap().catch(() => undefined);
    const titles = { home: this.mode === 'title' ? TITLE : 'Paused', dispatch: L.newGame, overworld: 'North America', region: page === 'region' ? this.world.regionById(this.regionId)!.name : '', controls: L.controls, about: L.about, equipment: 'Equipment & Objective' };
    this.heading.textContent = titles[page];
    this.root.querySelector<HTMLElement>('.nameplate')!.hidden = !titlePage && page !== 'about';
    this.pages[page]();
    this.body.querySelector<HTMLAnchorElement>('[data-facebook-link]')?.setAttribute("href", facebookUrl);
    this.actions.page?.(page, this.body);
    this.syncMuted(this.muted);
    this.heading.focus();
    this.root.querySelector('.console-panel')!.scrollTop = 0;
    if (titlePage) this.playIntro();
  }

  private readonly pages: Record<Page, () => void> = {
    home: () => { this.body.innerHTML = this.homeHtml(); },
    equipment: () => { this.body.innerHTML = '<div class="equipment-details"></div><h2>Permit Application</h2><p class="fine-print">Resubmitting spends cash on a county processing fee.</p><div class="menu-permit-host"></div>'; },
    dispatch: () => { this.body.innerHTML = this.dispatchHtml(); this.syncSetup(); },
    overworld: () => this.showAtlas(false),
    region: () => this.showAtlas(true),
    controls: () => { this.body.innerHTML = CONTROLS_HTML; },
    about: () => {
      this.body.innerHTML = ABOUT_HTML;
      // The notices are 16 kB of licence text behind a collapsed disclosure; they load with the page, not at startup.
      const pre = this.body.querySelector('pre')!;
      void import('./thirdPartyNotices.txt?raw').then((notices) => { pre.textContent = notices.default; });
    },
  };

  private homeHtml(): string {
    const pause = this.mode === 'pause';
    return `${this.mode === 'title'
      ? `${permitDocument()}<button class="ignition primary" data-nav="dispatch"><span class="ignition-symbol" aria-hidden="true">${MENU_ICONS.power}</span><span>${L.play}</span><span aria-hidden="true">↗</span></button>`
      : `<button class="primary" data-menu-action="resume">${L.resume}</button><div class="mobile-menu-links menu-grid"><button data-nav="equipment">Equipment & Objective</button><button data-menu-action="debug">${L.debug}</button></div><div class="menu-grid">${this.running ? `<button data-menu-action="state-map">${L.stateMap}</button>` : ''}<button data-menu-action="world-map">${L.worldMap}</button></div><div class="menu-grid"><button data-menu-action="restart" aria-describedby="restart-help">${L.restart}</button><button data-nav="dispatch">${L.newGame}</button></div><p class="fine-print" id="restart-help">Start this site over with the same layout. Resets cash, demolition, upgrades, and the permit application.</p>`}
      <nav class="menu-grid" aria-label="Game menu"><button data-nav="controls">${labeledMenuButton(MENU_ICONS.gamepad, L.controls)}</button><button data-menu-action="mute">${soundButtonContent(false)}</button><button data-nav="about">${labeledMenuButton(MENU_ICONS.about, L.about)}</button>${facebookLink}${pause ? `<button data-menu-action="title" aria-describedby="main-menu-help">${L.mainMenu}</button>` : ''}</nav>${pause ? '<p class="fine-print" id="main-menu-help">Returning to the main menu ends this game. You cannot resume it.</p>' : ''}${this.updatePromptHtml()}`;
  }

  private dispatchHtml(): string {
    const seasonOptions = SEASONS.map((id) => `<option value="${id}">${seasonLabel(id)}</option>`).join('');
    return `<div class="dispatch-fields"><label>Mode<select id="dispatch-mode">${Object.entries(MODE_LABELS).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select><span class="fine-print" id="mode-description"></span></label><label id="dispatch-season-field">Season<select id="dispatch-season">${seasonOptions}</select></label></div><p class="fine-print" id="season-note"></p>${this.mode === 'pause' ? '<p class="caution">Starting a new game replaces your current progress and upgrades.</p>' : ''}<button class="primary" data-menu-action="open-map">${L.openMap}</button><button data-nav="back">Back</button>`;
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
