import { ensureTerms, privacyOpen, termsAccepted, setAnalyticsTestSession, RunAnalytics } from '../privacy/privacy';
import { testMapSearch, type TestMapRequest } from '../world/testMapRequest';
import { boxBounds, vehicleBoxes } from '../vehicle/world';
import { upgradeModifiers } from './upgrades';
import { Resubmission } from './resubmission';
import { bayBuildings, type YardBay } from '../world/yardCatalog';
import type { YardPanel } from '../render/yardPanel';
import { defaultDebugView } from "../debug/view";
import {
  createDebugBridge,
  exposeDebugBridge,
  serializeTownFeature,
  shouldInstallDebugBridge,
  carryDebugQuery,
  type DebugHost,
  type GameSnapshot,
} from "../debug/bridge";
import { cameraFocus } from "./camera";
import { TouchControls } from '../render/touchControls';
import { DemolitionJob } from "./job";
import { advanceSimulation } from "./fixedStep";
import { canPickUpgrade } from "./session";
import { Application } from "pixi.js";
import { AudioBus } from "../audio/synth";
import { emptyPerfSnapshot, formatPerfOverlay, PerfCollector } from "../debug/perf";
import { CameraShake } from "../fx/cameraShake";
import { ParticlePool } from "../fx/particles";
import { Hud, type CampaignHud, type HudState } from "../render/hud";
import { WorldRenderer } from "../render/WorldRenderer";
import { cashAnchor } from "../render/cashPopups";
import { lastDebrisStats, obstructionAt } from "../sim/debris";
import { stepWorld, type Upgrades } from "../sim/worldSim";
import type { Bird, WorldEvent } from "../structure/types";
import { createDozer, dozerForward, dozerSpeed, stepDozer } from "../vehicle/dozer";
import { createRoadVehicle, replaceRoadVehicle } from "../vehicle/roadVehicle";
import { pickVerificationRoute } from "../world/routing";
import { worldBoundsToScreen, worldToScreen } from "../world/iso";
import { createTown, type Town } from "../world/town";
import { biomeById } from "../world/biomes";
import { resolveSeason } from "../world/season";
import {
  FIELD_CLEARED_SECONDS,
  FIELD_NOTICE_SECONDS,
  fieldDamagedCount,
  fieldNoticeText,
} from "../world/fields";
import type { FieldFeature } from "../world/terrainFeatures";
import {
  applyCampaignOutcome,
  advanceCampaignLevel,
  campaignBriefingText,
  creditCampaignEarnings,
  currentLevel,
  dollarsReady,
  evaluateCampaignStep,
  landmarkDemolitionStatus,
  retryCampaignLevel,
  spendCampaignCash,
  startCampaign,
  type CampaignRun,
} from "./campaignRun";
import { CAMPAIGN_LEVELS, type CampaignLevelId } from "./campaign";
import { frameTownOverview } from "./overviewFrame";
import { generationLevel, rulesForTestMap, showCampaignHud } from "./sessionTransition";
import { urbanDebugDump } from "../world/urbanGeography";
import { ARCHETYPES } from "../world/archetypes";
import {
  CASH_TARGET,
  COPY,
  DOZER,
  MATCH_SECONDS,
  SIM_DT,
  SIM_MAX_STEPS,
  TITLE,
  UPGRADE_MILESTONES,
} from "./constants";
import { Input } from "./input";
import { lerp } from "./math";
import {
  DEFAULT_DISTRICT_SEEDS,
  gameSetupRules,
  playableDistrict,
  nextSeed,
  parseSessionFromSearch,
  sessionFailsOn,
  sessionForcesUpgrade,
  type DistrictId,
  type DemoAsset,
  type PlayMode,
  type SessionKind,
  type SessionRules,
} from "./session";
import { bindHudSession } from "./hudBindings";
import { startRuntimeTicker } from "./runtime";
import { bootOpenedSession } from "./sessionBoot";
import { PlaythroughRun, playthroughDigest } from "./playthroughRun";
import type { Playthrough, PlaythroughAction } from "../debug/playthrough";
import { downloadPlaythrough, PlaythroughPanel } from "../render/playthroughPanel";
import { version as buildVersion } from "../../package.json";

class Game {
  private readonly analytics = new RunAnalytics();
  private app!: Application;
  private readonly input = new Input();
  private touch?: TouchControls;

  private releaseControls(): void {
    this.input.reset();
    this.touch?.reset();
  }
  private readonly audio = new AudioBus();
  private readonly particles = new ParticlePool();
  private readonly shake = new CameraShake();
  private readonly renderer = new WorldRenderer();
  private readonly perf = new PerfCollector();
  private hud!: Hud;
  private hudRoot!: HTMLElement;
  private yardPanel?: YardPanel;
  private yardPanelInit?: Promise<void>;
  private followRoadCamera = true;
  private followZoom = 1.15;
  private towerOverview = true;
  private yardFocus?: YardBay;
  private perfEl: HTMLElement | null = null;
  private perfExportAt = 0;
  private rules: SessionRules = parseSessionFromSearch(
    typeof window === "undefined" ? "" : window.location.search,
  );
  private town = createTown({ towerTest: this.rules.towerTest, district: this.rules.district, seed: this.rules.seed, showcase: !!this.rules.demo, testMap: this.rules.testMap, topology: this.rules.topology, season: this.rules.season, biome: biomeById(this.rules.biomeId), weatherDetail: this.rules.weatherDetail });
  private dozer = createDozer(this.town.spawnX, this.town.spawnY, this.town.spawnHeading);
  private birds: Bird[] = [];
  private cash = 0;
  private campaign: CampaignRun | null = null;
  private resubmission = new Resubmission();
  private timeLeft = MATCH_SECONDS;
  private elapsed = 0;
  private hint = 1;
  private mode: PlayMode = "play";
  private death: string | null = null;
  private upgrades: Upgrades = { blade: 0, engine: 0, push: 0 };
  private nextUpgrade = 0;
  private earnedChoice = false;
  private job: DemolitionJob | undefined;
  private acc = 0;
  private grindAud = 0;
  private scrapeCd = 0;
  private groanCd = 0;
  private droppedSimSec = 0;
  private detachInput: (() => void) | null = null;
  private fieldNotice = "";
  private fieldNoticeUntil = 0;
  private readonly playthrough = new PlaythroughRun();
  private playthroughPanel?: PlaythroughPanel;

  async start(root: HTMLElement, hudRoot: HTMLElement): Promise<void> {
    document.title = TITLE;
    this.app = new Application();
    await this.app.init({
      resizeTo: root,
      background: 0x3e522c,
      antialias: false,
      roundPixels: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: "webgl",
    });
    root.appendChild(this.app.canvas);
    this.app.canvas.tabIndex = 0;
    this.app.canvas.setAttribute('aria-label', 'Demolition site. W and S drive, A and D steer, Space powers the blade, Escape opens the menu.');
    this.app.stage.addChild(this.renderer.root, this.renderer.hudOverlay);
    this.hudRoot = hudRoot;
    this.hud = new Hud(hudRoot);
    this.bindHud();
    this.playthroughPanel = new PlaythroughPanel(hudRoot, {
      record: () => this.startRecording(),
      stop: () => { this.stopPlaythrough(); },
      replayLast: () => this.playthroughControl("replay"),
      load: (text) => this.loadReplay(text),
      save: () => { if (this.playthrough.last) downloadPlaythrough(this.playthrough.last); },
      togglePause: () => this.playthrough.togglePause(),
      restart: () => this.playthroughControl("restart"),
      perf: () => { this.renderer.debug.perf = !this.renderer.debug.perf; this.syncDebug(); },
    });
    if (this.rules.testMap) await this.ensureYardPanel();
    this.detachInput = this.input.attach();
    this.touch = new TouchControls(hudRoot, {
      change: state => this.input.setTouch(state),
      release: () => this.input.reset(),
      interact: () => { void this.audio.unlock(); },
      resize: () => this.app.resize(),
    });
    this.perf.enabled = new URLSearchParams(window.location.search).get("perf") === "1";
    if (this.perf.enabled) this.ensurePerfOverlay();
    const params = new URLSearchParams(window.location.search);
    const graph = params.get("nhood") === "1";
    this.renderer.showNhood = graph;
    this.renderer.debug.graph = graph;
    this.renderer.debug.perf = this.perf.enabled;
    this.syncDebug();
    bootOpenedSession({
      rules: this.rules,
      applyCampaign: (run) => { this.campaign = run; },
      applyMode: (mode) => { this.mode = mode; },
      openDebug: () => this.hud.openDebug(),
      reset: (kind) => this.reset(kind),
    }, window.location.search);
    this.attachDebugBridge();
    startRuntimeTicker(this.app, (dt) => this.frame(dt));
  }

  snapshot(): GameSnapshot {
    return {
      cash: this.cash,
      timeLeft: this.timeLeft,
      elapsed: this.elapsed,
      mode: this.mode,
      session: this.rules.kind,
      district: this.rules.district,
      seed: this.rules.seed,
      dozer: { x: this.dozer.x, y: this.dozer.y, heading: this.dozer.heading },
      rubble: this.town.rubble.length,
      marks: this.town.marks.length,
      roadCar: this.town.roadCar
        ? { x: this.town.roadCar.x, y: this.town.roadCar.y }
        : null,
      buildings: this.town.buildings.map((b) => {
        const states: Record<string, number> = {};
        for (const c of b.cells) states[c.state] = (states[c.state] ?? 0) + 1;
        return { name: b.name, states };
      }),
    };
  }

  setSession(kind: SessionKind): void {
    this.rules.testMap = undefined;
    this.rules.towerTest = false;
    this.rules.job = false;
    this.rules.demo = undefined;
    this.rules.kind = kind;
    this.rules.district = playableDistrict(kind, this.rules.district);
    this.rules.level ??= "county";
    this.rules.ranchFocus = false;
    this.campaign = kind === 'challenge' ? startCampaign(this.rules.seed) : null;
    if (this.campaign && this.rules.level) {
      this.campaign.levelIndex = CAMPAIGN_LEVELS.findIndex((level) => level.id === this.rules.level);
    }
    if (this.campaign) {
      if (this.rules.seasonExplicit) this.campaign.season = this.rules.season;
      if (this.rules.biomeId) this.campaign.biomeId = this.rules.biomeId;
      this.rules.season = this.campaign.season;
      this.rules.biomeId = this.campaign.biomeId;
    }
    this.reset("same");
    this.syncSessionUrl();
  }

  setDistrict(district: DistrictId): void {
    this.rules.testMap = undefined;
    this.rules.towerTest = false;
    this.rules.job = false;
    this.rules.demo = undefined;
    this.rules.district = playableDistrict(this.rules.kind, district);
    this.rules.ranchFocus = false;
    this.rules.seed = DEFAULT_DISTRICT_SEEDS[this.rules.district];
    this.reset("same");
    this.syncSessionUrl();
  }

  reset(kind: "same" | "new" = "same"): void {
    this.stopPlaythrough();
    setAnalyticsTestSession(!!this.rules.testMap || !!this.rules.towerTest || this.perf.enabled);
    this.analytics.reset(this.elapsed > 0);
    this.towerOverview = true;
    const keepSetup = !!this.rules.testMap;
    const frameKey = this.yardFocus?.key;
    const followKey = this.followRoadCamera ? this.town.roadCar?.yardOwner : undefined;
    this.releaseControls();
    this.followRoadCamera = true;
    this.followZoom = 1.15;
    this.resolveResetSetup(kind, keepSetup);
    const ranch = this.rebuildTown();
    this.hud.preserveBinderScroll(() => this.yardPanel?.reset());
    this.yardFocus = this.town.yard?.bays.find(b => b.key === frameKey);
    const followed = this.town.yard?.bays.find(b => b.key === followKey)?.vehicle;
    this.town.roadCar = followed ?? null;
    this.followRoadCamera = !!followed;
    this.shake.reset();
    this.renderer.bowlingStrikes.clear();
    this.renderer.cashPopups.clear();
    this.renderer.invalidate();
    this.birds = [];
    this.resetRun(keepSetup, ranch);
    this.perf.reset();
    const spawn = cameraFocus(this.dozer.x, this.dozer.y, 0.4, this.renderer.zoom);
    this.renderer.camX = spawn.x;
    this.renderer.camY = spawn.y;
    if (kind === 'new') this.syncSessionUrl();
  }

  /** A new layout reseeds a free map, or retries the campaign level; a campaign fixes seed, season and biome. */
  private resolveResetSetup(kind: "same" | "new", keepSetup: boolean): void {
    if (!showCampaignHud(this.rules, this.campaign)) this.campaign = null;
    if (kind === "new" && !keepSetup && !this.campaign) {
      this.rules.seed = nextSeed(this.rules.seed);
      if (this.rules.seasonSelection === "random") this.rules.season = resolveSeason(this.rules.seed);
    }
    if (this.campaign && kind === "new") this.campaign = retryCampaignLevel(this.campaign);
    if (this.campaign) {
      this.rules.seed = this.campaign.levelSeed;
      this.rules.season = this.campaign.season;
      this.rules.biomeId = this.campaign.biomeId;
    }
  }

  /** Generate the town for the current rules and place the dozer; returns the focused ranch, if any. */
  private rebuildTown(): Town["buildings"][number] | undefined {
    const level = generationLevel(this.rules, this.campaign);
    this.town = createTown({
      towerTest: this.rules.towerTest,
      district: this.rules.district,
      seed: this.rules.seed,
      showcase: !!this.rules.demo,
      testMap: this.rules.testMap,
      topology: this.rules.topology,
      campaign: level,
      season: this.rules.season,
      biome: biomeById(this.rules.biomeId),
      weatherDetail: this.rules.weatherDetail,
    });
    const ranch = this.rules.demo || this.rules.ranchFocus
      ? this.town.buildings.find((b) => b.archetypeId === (this.rules.demo ?? "ranch"))
      : undefined;
    this.dozer = ranch
      ? createDozer(
          ranch.x + ranch.w * ranch.cellSize * 0.5,
          ranch.y + ranch.d * ranch.cellSize + 3.5,
          -Math.PI / 2,
        )
      : createDozer(this.town.spawnX, this.town.spawnY, this.town.spawnHeading);
    this.particles.reseed(this.rules.seed ^ 0x51f00d);
    this.particles.ownerAt = this.town.debrisOwnerAt;
    return ranch;
  }

  /** Cash, clock, upgrades, job and landmark for a fresh run; a campaign carries its upgrades. */
  private resetRun(keepSetup: boolean, ranch: Town["buildings"][number] | undefined): void {
    const campaign = this.campaign;
    this.cash = campaign?.spendable ?? 0;
    this.resubmission = new Resubmission();
    this.hud.permitLogo.reset();
    this.hud.resetCash();
    this.timeLeft = campaign ? currentLevel(campaign).timeLimit : MATCH_SECONDS;
    this.elapsed = 0;
    this.hint = 1;
    this.fieldNotice = "";
    this.fieldNoticeUntil = 0;
    this.mode = campaign?.briefing ? "briefing" : "play";
    this.death = null;
    if (campaign) {
      this.upgrades = { ...campaign.upgrades };
      this.nextUpgrade = campaign.nextUpgrade;
    } else {
      if (!keepSetup) this.upgrades = { blade: 0, engine: 0, push: 0 };
      this.nextUpgrade = 0;
    }
    this.earnedChoice = false;
    this.job = this.rules.job && ranch ? new DemolitionJob(ranch) : undefined;
    this.renderer.jobTarget = this.job?.target;
    this.renderer.landmarkTarget = campaign
      ? this.town.buildings.find(building => building.campaignLandmark)
      : undefined;
    this.acc = 0;
    this.grindAud = 0;
    this.scrapeCd = 0;
    this.groanCd = 0;
    this.droppedSimSec = 0;
  }

  setDemo(demo: DemoAsset): void {
    this.loadTestMap({ kind: 'asset', assetId: 'building:' + demo, variant: 0 });
  }

  loadTestMap(testMap: TestMapRequest): void {
    this.campaign = null;
    this.rules = rulesForTestMap(this.rules.seed, testMap);
    this.reset('same');
    if (testMap.kind === 'asset' && !this.yardFocus && !this.town.roadCar) this.yardFocus = this.town.yard?.bays[0];
    this.syncSessionUrl();
  }

  private syncSessionUrl(): void {
    // Replace the map link without a reload; reload reconstructs this map with fresh UI defaults.
    const params = this.rules.testMap ? new URLSearchParams(testMapSearch(this.rules.testMap, this.rules.seed))
      : new URLSearchParams(this.rules.job ? { job: 'brick', seed: String(this.rules.seed) }
        : this.rules.level
          ? { mode: this.rules.kind, level: this.rules.level, seed: String(this.rules.seed) }
          : { mode: this.rules.kind, district: this.rules.district, seed: String(this.rules.seed) });
    if (this.rules.topology) params.set('topology', this.rules.topology);
    if (!this.rules.testMap && !this.rules.job) {
      params.set('season', this.rules.season);
      if (this.rules.biomeId) params.set('biome', this.rules.biomeId);
      if (this.rules.weatherDetail !== 'on') params.set('effects', this.rules.weatherDetail);
    }
    const previous = new URLSearchParams(location.search);
    carryDebugQuery(previous, params);
    history.replaceState(null, '', '?' + params);
  }

  startJob(): void {
    this.campaign = null;
    this.rules = { kind: "challenge", district: "classic", seed: DEFAULT_DISTRICT_SEEDS.classic,
      ranchFocus: false, demo: "rivertown", job: true, season: "summer", seasonExplicit: false, weatherDetail: "on" };
    this.reset("same");
    this.syncSessionUrl();
  }

  private syncDebug(): void {
    this.perf.enabled = this.renderer.debug.perf;
    if (this.perf.enabled) this.ensurePerfOverlay(); else this.hidePerfOverlay();
    this.hud.syncDebug(this.renderer.debug);
  }

  /** Live upgrade picks; a replay applies its recorded picks instead. */
  private pickUpgrade(id: "blade" | "engine" | "push"): void {
    if (!this.playthrough.replaying) this.applyUpgrade(id);
  }

  private applyUpgrade(id: "blade" | "engine" | "push"): void {
    if (!canPickUpgrade(this.rules, this.mode, this.earnedChoice)) return;
    if (this.job && !this.job.takeChoice()) return;
    this.earnedChoice = false;
    this.upgrades[id] += 1;
    if (this.campaign) {
      this.campaign.upgrades[id] += 1;
    }
    if (this.mode === "upgrade") this.mode = this.campaign?.briefing ? "briefing" : "play";
    this.playthrough.noteAction({ kind: "upgrade", id });
  }

  private frame(realDt: number): void {
    if (this.blockedByTerms()) return;
    this.touch?.setBlocked(this.mode !== 'play' || this.renderer.debug.freeze);
    const now = performance.now();
    const frameMs = this.perf.markFrameStart(now);
    this.handleFrameKeys();
    if (this.input.down.size > 0) void this.audio.unlock();
    this.touch?.setBlocked(this.mode !== 'play' || this.renderer.debug.freeze);
    const simCpuMs = this.advance(realDt);
    this.playthrough.settle(() => this.playthroughDigest());
    const prepStart = performance.now();
    this.touch?.setBlocked(this.mode !== 'play' || this.renderer.debug.freeze);
    this.draw(realDt);
    this.recordPerf(frameMs, simCpuMs, performance.now() - prepStart);
    this.paintPerf();
  }

  /** Until the terms are accepted, or while the privacy dialog is open, hold everything and only draw. */
  private blockedByTerms(): boolean {
    if (!termsAccepted() && this.mode !== 'title' && !privacyOpen()) {
      void ensureTerms().then(yes => { if (!yes) this.mode = 'title'; });
    }
    if (!privacyOpen() && (termsAccepted() || this.mode === 'title')) return false;
    this.releaseControls(); this.touch?.setBlocked(true); this.audio.hush(); this.acc = 0; this.draw(0);
    return true;
  }

  private consumeKey(key: string): boolean {
    return this.input.consume(key) || this.input.consume(key.toUpperCase());
  }

  private handleFrameKeys(): void {
    if (this.consumeKey("m")) {
      void this.audio.unlock();
      this.audio.toggleMute();
    }
    if (this.mode === "play" || this.mode === "results") this.handleRunKeys();
    if (this.mode === "play" || this.mode === "upgrade") {
      if (this.input.consume("1")) this.pickUpgrade("blade");
      if (this.input.consume("2")) this.pickUpgrade("engine");
      if (this.input.consume("3")) this.pickUpgrade("push");
    }
    if (this.input.consume("Escape")) this.escape();
  }

  /** Restart, new layout, road car, neighborhood overview and perf overlay. */
  private handleRunKeys(): void {
    if (this.consumeKey("r")) this.reset("same");
    if (this.consumeKey("n")) this.reset("new");
    if (this.consumeKey("v") && !this.rules.testMap) this.spawnRoadVehicle();
    if (this.consumeKey("g")) { this.renderer.showNhood = !this.renderer.showNhood; this.syncDebug(); }
    if (this.input.consume("`")) {
      this.renderer.debug.perf = !this.renderer.debug.perf;
      this.syncDebug();
    }
  }

  /** Escape closes the debug binder first, then toggles pause. */
  private escape(): void {
    this.releaseControls();
    if (this.hud.closeDebug(true)) return;
    if (this.mode === "play" || this.mode === "briefing") this.mode = "pause";
    else if (this.mode === "pause") this.mode = this.campaign?.briefing ? "briefing" : "play";
  }

  /** Run fixed steps for this frame's time while playing; returns the CPU time spent. */
  private advance(realDt: number): number {
    this.applyReplayActions();
    if (this.mode !== "play" || this.renderer.debug.freeze || this.playthrough.holds) {
      this.acc = 0;
      this.input.flush();
      this.audio.hush();
      return 0;
    }
    this.acc += realDt;
    const simStart = performance.now();
    const advanced = advanceSimulation(this.acc, SIM_DT, SIM_MAX_STEPS,
      () => this.mode === "play", () => this.step(SIM_DT));
    this.acc = advanced.acc;
    this.droppedSimSec += advanced.dropped;
    return performance.now() - simStart;
  }

  private recordPerf(frameMs: number, simCpuMs: number, renderPrepMs: number): void {
    const debris = lastDebrisStats();
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    this.perf.record({
      ...emptyPerfSnapshot(),
      frameMs,
      simCpuMs,
      renderPrepMs,
      droppedSimSec: this.droppedSimSec,
      budgetConversions: debris.conversions,
      distanceCleanups: debris.distanceCleanups,
      emergencyCleanups: debris.emergencyCleanups,
      debrisActive: debris.active,
      debrisSleeping: debris.sleeping,
      contactPairs: debris.contactPairs,
      buildingsStepped: this.lastMetrics.buildingsStepped,
      buildingsSkipped: this.lastMetrics.buildingsSkipped,
      collisionRebuilds: this.lastMetrics.collisionRebuilds,
      renderVisible: this.renderer.stats.visible,
      renderTotal: this.renderer.stats.total,
      bodyMass: debris.bodyMass,
      pileMass: debris.pileMass,
      heapMB: memory?.usedJSHeapSize !== undefined ? memory.usedJSHeapSize / 1048576 : null,
      runtimeObjects: this.perf.enabled ? this.runtimeObjectCount() : 0,
      retiredBuildings: this.town.buildings.filter(b => b.retired).length,
      drawCached: this.renderer.stats.cached,
      drawRebuilt: this.renderer.stats.rebuilt,
    });
  }

  private runtimeObjectCount(): number {
    return this.town.buildings.reduce((n, b) => n + b.cells.length + b.fixtures.length + b.floorTiles.length + b.roofs.length, this.town.rubble.length + this.town.props.length);
  }

  private lastMetrics = { buildingsStepped: 0, buildingsSkipped: 0, collisionRebuilds: 0 };

  private step(dt: number): void {
    if (!termsAccepted() || privacyOpen()) return;
    setAnalyticsTestSession(!!this.rules.testMap || !!this.rules.towerTest || this.perf.enabled || this.renderer.debug.freeze || this.playthrough.replaying);
    this.analytics.step(dt, this.rules.job ? 'brick-job' : this.rules.kind, this.rules.district);
    this.applyReplayActions();
    const drive = this.playthrough.control({ ...this.input.axis(), blade: this.input.blade() });
    stepDozer(
      this.dozer,
      {
        throttle: drive.throttle,
        steer: drive.steer,
        blade: drive.blade,
        ...upgradeModifiers(this.upgrades),
      },
      dt,
    );

    const beforeHeat = this.dozer.heat;
    const out = stepWorld(this.town, this.dozer, this.particles, this.upgrades, dt);
    this.lastMetrics = out.metrics;
    this.earn(out.cash);
    this.popCash(out.cash, out.events);
    this.react(out.events);
    this.syncFieldNotice(dt);
    this.stepBirds(out.birds, dt);
    this.elapsed += dt;
    this.timeLeft -= dt;
    this.hint = Math.max(0, this.hint - dt * 0.12);
    this.scrapeCd = Math.max(0, this.scrapeCd - dt);
    this.groanCd = Math.max(0, this.groanCd - dt);
    this.syncMachineAudio(out.debrisLoad, beforeHeat, dt);
    if (this.offerUpgrade()) return;
    if (this.campaign) this.judgeCampaign(this.campaign);
    else this.judgeSession();
  }

  /** Float the step's earnings over the damage that paid them, or the blade when nothing says where. */
  private popCash(amount: number, events: WorldEvent[]): void {
    if (!(amount > 0)) return;
    const at = cashAnchor(events);
    if (at) this.renderer.cashPopups.credit(amount, at.x, at.y, at.z);
    else {
      const f = dozerForward(this.dozer);
      this.renderer.cashPopups.credit(amount, this.dozer.x + f.x * DOZER.bladeReach, this.dozer.y + f.y * DOZER.bladeReach, 1);
    }
  }

  private earn(amount: number): void {
    if (this.campaign) {
      creditCampaignEarnings(this.campaign, amount);
      this.cash = this.campaign.spendable;
    } else this.cash += amount;
  }

  /** Birds flushed by demolition fly off up and to the right, then expire. */
  private stepBirds(flushed: { x: number; y: number }[], dt: number): void {
    for (const b of flushed) {
      this.birds.push({
        x: b.x,
        y: b.y,
        z: 2.4,
        vx: 3.8,
        vy: -2.2,
        vz: 2.4,
        life: 2.8,
      });
    }
    for (const bird of this.birds) {
      bird.x += bird.vx * dt;
      bird.y += bird.vy * dt;
      bird.z += bird.vz * dt;
      bird.vz -= 1.2 * dt;
      bird.life -= dt;
    }
    this.birds = this.birds.filter((b) => b.life > 0);
  }

  /** Engine pitch follows speed and heat; the blade grinds while pushing or heating up. */
  private syncMachineAudio(debrisLoad: number, beforeHeat: number, dt: number): void {
    const pushing = this.dozer.bladeDown && debrisLoad > 0.2;
    const grinding = this.dozer.bladeDown && (this.dozer.heat > beforeHeat - 0.01 || pushing);
    this.grindAud = lerp(
      this.grindAud,
      grinding ? 0.14 + Math.min(0.1, debrisLoad * 0.04) : 0,
      1 - Math.pow(0.001, dt),
    );
    this.audio.engineLevel(dozerSpeed(this.dozer), this.dozer.heat);
    this.audio.grindLevel(this.dozer.bladeDown ? 0.08 + this.grindAud : 0);
    this.audio.syncAmbient(this.town.weather.kind, this.town.weatherDetail);
  }

  /** A paid job or a cash milestone pauses for an upgrade choice. True when it did. */
  private offerUpgrade(): boolean {
    const payout = this.job?.settle() ?? 0;
    if (payout) {
      this.earn(payout);
      this.audio.cash();
      this.earnedChoice = true;
      this.mode = "upgrade";
      return true;
    }
    const milestoneCash = this.campaign?.campaignEarned ?? this.cash;
    if (!sessionForcesUpgrade(this.rules) || this.nextUpgrade >= UPGRADE_MILESTONES.length || milestoneCash < UPGRADE_MILESTONES[this.nextUpgrade]!)
      return false;
    this.nextUpgrade += 1;
    if (this.campaign) this.campaign.nextUpgrade = this.nextUpgrade;
    this.earnedChoice = true;
    this.mode = "upgrade";
    return true;
  }

  private judgeCampaign(campaign: CampaignRun): void {
    const level = currentLevel(campaign);
    const landmark = landmarkDemolitionStatus(this.town.buildings, level);
    const outcome = evaluateCampaignStep({
      timeLeft: this.timeLeft,
      heat: this.dozer.heat,
      track: this.dozer.track,
      landmarkReady: landmark.ready,
      dollarsReady: dollarsReady(campaign, level),
      expired: campaign.expired,
      alreadyComplete: campaign.complete,
    });
    const death = applyCampaignOutcome(campaign, outcome);
    if (outcome !== 'continue') this.finish(death ?? '', outcome === 'win');
  }

  /** Free play ends on whichever failure the session enforces: heat, track, or the clock. */
  private judgeSession(): void {
    const fail = sessionFailsOn(this.rules);
    if (fail.heat && this.dozer.heat >= 100) this.finish(COPY.engineCooked, false);
    else if (fail.track && this.dozer.track >= 100) this.finish(COPY.trackThrown, false);
    else if (fail.clock && this.timeLeft <= 0) this.finish(COPY.countyClock, this.cash >= CASH_TARGET);
  }

  private finish(death: string, won: boolean): void {
    this.analytics.finish(won);
    this.mode = "results";
    this.death = won ? null : death;
    if (won) this.death = null;
  }

  private syncFieldNotice(dt: number): void {
    this.fieldNoticeUntil = Math.max(0, this.fieldNoticeUntil - dt);
    for (const feature of this.town.features) if (feature.kind === "field") this.noticeField(feature as FieldFeature);
    if (this.fieldNoticeUntil <= 0) this.fieldNotice = "";
  }

  /** Announce a field once when it is first damaged, and once more when it is cleared. */
  private noticeField(field: FieldFeature): void {
    if (field.cleared && !field.clearedAnnounced) {
      field.clearedAnnounced = true;
      field.noticed = true;
      this.fieldNotice = COPY.fieldCleared;
      this.fieldNoticeUntil = FIELD_CLEARED_SECONDS;
      return;
    }
    if (fieldDamagedCount(field) > 0 && !field.noticed) {
      field.noticed = true;
      this.fieldNotice = fieldNoticeText(field, true);
      this.fieldNoticeUntil = FIELD_NOTICE_SECONDS;
    }
  }

  private react(events: WorldEvent[]): void {
    for (const e of events) this.reactions[e.kind]?.(e);
  }

  /** Camera shake and sound for each kind of world event. */
  private readonly reactions: Partial<Record<WorldEvent["kind"], (e: WorldEvent) => void>> = {
    "bowling-strike": () => { this.renderer.bowlingStrikes.add(); this.audio.bowlingPins(); },
    impact: (e) => {
      // The screen lurches along the dozer's travel, projected into screen space.
      const dir = worldToScreen(e.dirX ?? 0, e.dirY ?? 0);
      this.shake.punch(e.mag, dir.x, dir.y, e.heft);
      this.audio.impact(e.mag);
    },
    // The blade landing is a small downward thud on the camera.
    "blade-drop": (e) => { this.shake.punch(e.mag, 0, 1, 1.45); this.audio.bladeThud(e.mag); },
    "track-bind": (e) => this.trackBindSound(e),
    breach: (e) => { this.shake.punch(e.mag); this.audio.impact(e.mag); this.audio.breakMat(e.mag); },
    collapse: (e) => { this.shake.punch(e.mag * 1.4); this.audio.collapse(e.mag); },
    cash: () => this.audio.cash(),
    chip: (e) => { if (e.mag > 0.5) this.audio.impact(0.3); },
    scrape: (e) => this.scrapeSound(e),
    crush: (e) => {
      this.audio.crunch(e.mag);
      if (e.mag > 0.9) this.shake.punch(e.mag * 0.45);
    },
    blast: (e) => { this.shake.punch(e.mag); this.audio.impact(e.mag); },
    spark: (e) => this.audio.clatter(e.mag * 0.6, "metal"),
  };

  /** A hard turn at speed groans as the tracks bind; rate-limited so it reads as one strain. */
  private trackBindSound(e: WorldEvent): void {
    if (this.groanCd > 0) return;
    this.groanCd = 0.55;
    this.audio.trackBind(e.mag);
  }

  /** Scrapes are rate-limited; metal and wood clatter, everything else scrapes. */
  private scrapeSound(e: WorldEvent): void {
    if (this.scrapeCd > 0) return;
    this.scrapeCd = 0.08;
    if (e.material === "metal" || e.material === "wood") this.audio.clatter(e.mag, e.material);
    else this.audio.scrape(e.mag, e.material);
  }

  spawnRoadVehicle(): void {
    if (this.playthrough.replaying || !this.placeRoadVehicle()) return;
    this.playthrough.noteAction({ kind: "road-vehicle" });
  }

  private placeRoadVehicle(): boolean {
    if (this.rules.kind !== "sandbox") return false;
    this.followRoadCamera = true;
    const route = pickVerificationRoute(this.town.network) ?? [];
    replaceRoadVehicle(this.town, createRoadVehicle(
      this.town.roadSpawnX,
      this.town.roadSpawnY,
      this.town.roadSpawnHeading,
      route,
    ));
    return true;
  }

  /** Recorded actions due before the next replayed step. */
  private applyReplayActions(): void {
    for (const action of this.playthrough.due()) this.replayAction(action);
  }

  private replayAction(action: PlaythroughAction): void {
    if (action.kind === "upgrade") this.applyUpgrade(action.id);
    else if (action.kind === "resubmit") this.spendResubmission(action.fee);
    else this.placeRoadVehicle();
  }

  private spendResubmission(fee: number): void {
    this.resubmission.used = true;
    if (this.campaign) spendCampaignCash(this.campaign, fee);
    this.cash -= fee;
  }

  /** Restart the current site and capture every fixed step from its first frame. */
  startRecording(): void {
    if (this.mode === "title") return;
    this.prepareCleanRun();
    if (this.campaign) {
      this.campaign = { ...retryCampaignLevel(this.campaign), briefing: false };
      this.rules.seed = this.campaign.levelSeed;
    }
    const setup = structuredClone({ rules: this.rules, campaign: this.campaign, upgrades: this.upgrades });
    this.reset("same");
    this.playthrough.record(setup, buildVersion);
  }

  /** Rebuild a recording's site and drive it from the recorded steps; no live input reaches the dozer. */
  startReplay(playthrough: Playthrough): void {
    this.prepareCleanRun();
    const setup = structuredClone({ rules: playthrough.rules, campaign: playthrough.campaign, upgrades: playthrough.upgrades });
    this.rules = setup.rules;
    this.campaign = setup.campaign;
    this.upgrades = setup.upgrades;
    this.reset("same");
    this.syncSessionUrl();
    this.playthrough.replay(playthrough);
  }

  /** Recording and replay start in active play: binder closed, simulation running. */
  private prepareCleanRun(): void {
    this.hud.closeDebug();
    this.renderer.debug.freeze = false;
    this.syncDebug();
  }

  /** Finish a recording (returned and kept as the last playthrough) or leave a replay. */
  stopPlaythrough(): Playthrough | null {
    return this.playthrough.stop(() => this.playthroughDigest());
  }

  private loadReplay(text: string): void {
    try {
      this.startReplay(this.playthrough.load(text));
    } catch (error) {
      this.playthrough.note = `Could not load replay: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private playthroughDigest() {
    return playthroughDigest(this.town, this.dozer, this.cash, this.elapsed, this.playthrough.status().step);
  }

  /** Replay the last recording again from its first step, or pause, resume or leave the current replay. */
  private playthroughControl(command: "replay" | "play" | "pause" | "restart" | "exit"): void {
    const target = command === "restart" ? this.playthrough.replayed ?? this.playthrough.last : this.playthrough.last;
    if (command === "exit") this.stopPlaythrough();
    else if (command === "replay" || command === "restart") { if (target) this.startReplay(target); }
    else if (this.playthrough.replaying && this.playthrough.status().paused !== (command === "pause")) this.playthrough.togglePause();
  }

  obstructionAt(x: number, y: number, radius = 0.7) {
    return obstructionAt(this.town, x, y, radius);
  }

  perfSnapshot() {
    return this.perf.summary();
  }

  jumpCampaignLevel(id: CampaignLevelId): void {
    this.rules.testMap = undefined;
    this.rules.job = false;
    this.rules.level = id;
    if (this.rules.kind === "sandbox") {
      this.campaign = null;
      this.reset("same");
      this.syncSessionUrl();
      return;
    }
    this.rules.kind = "challenge";
    if (!this.campaign) this.campaign = startCampaign(this.rules.seed);
    const index = CAMPAIGN_LEVELS.findIndex(level => level.id === id);
    if (index < 0) return;
    this.campaign.levelIndex = index;
    this.campaign.briefing = false;
    this.reset('same');
    this.syncSessionUrl();
  }

  urbanSnapshot(): Record<string, unknown> | undefined {
    if (!this.campaign) return undefined;
    const level = currentLevel(this.campaign);
    const geography = this.town.nhood.urban;
    if (!geography) return undefined;
    return urbanDebugDump(level, this.town.seed, this.town.buildings, this.town.lots, geography, ARCHETYPES);
  }

  lookAtWorld(x: number, y: number, heading = 0, zoom = 1.15): void {
    this.followRoadCamera = false;
    this.followZoom = zoom;
    this.yardFocus = undefined;
    this.renderer.showNhood = false;
    this.dozer = createDozer(x, y, heading);
    this.renderer.zoom = zoom;
    const focus = cameraFocus(x, y, 0.4, this.renderer.zoom);
    this.renderer.camX = focus.x;
    this.renderer.camY = focus.y;
  }

  frameDozer(zoom = this.followZoom): void {
    this.followRoadCamera = false;
    this.followZoom = zoom;
    this.yardFocus = undefined;
    this.renderer.showNhood = false;
    this.renderer.zoom = zoom;
    const focus = cameraFocus(this.dozer.x, this.dozer.y, 0.4, zoom);
    this.renderer.camX = focus.x;
    this.renderer.camY = focus.y;
  }

  lookAtTown(mode: 'overview' | 'street' | 'open' = 'overview'): void {
    this.followRoadCamera = false;
    this.yardFocus = undefined;
    if (mode === 'street') {
      this.renderer.showNhood = false;
      const target = [...this.town.buildings]
        .filter(building => !building.campaignLandmark)
        .sort((a, b) => b.floors - a.floors)[0] ?? this.town.buildings[0];
      if (!target) return;
      this.dozer = createDozer(
        target.x + target.w * target.cellSize * 0.55,
        target.y + 1.1,
        Math.PI / 2,
      );
      return;
    }
    if (mode === 'open') {
      this.renderer.showNhood = false;
      const buildings = this.town.buildings;
      if (!buildings.length) return;
      const maxX = Math.max(...buildings.map(building => building.x + building.w * building.cellSize));
      const maxY = Math.max(...buildings.map(building => building.y + building.d * building.cellSize));
      this.dozer = createDozer(maxX + 6, maxY + 6, -Math.PI / 2);
      return;
    }
    this.renderer.showNhood = true;
  }

  get dozerHidden(): boolean {
    return this.renderer.dozerHidden;
  }

  private frameNhood(dt: number): void {
    void dt;
    const framed = frameTownOverview(this.town, this.app.renderer.width - this.hud.debugDockWidth, this.app.renderer.height);
    this.renderer.zoom = framed.zoom;
    this.renderer.camX = framed.camX;
    this.renderer.camY = framed.camY;
  }

  /** Centre the camera on a screen-space box, zoomed so it fills `fill` of the view. */
  private frameScreenBox(box: { minX: number; minY: number; maxX: number; maxY: number }, fill: number, viewW: number): void {
    const zoom = Math.min(1.15, fill * Math.min(viewW / (box.maxX - box.minX), this.app.renderer.height / (box.maxY - box.minY)));
    this.renderer.zoom = zoom;
    this.renderer.camX = (box.minX + box.maxX) / 2 * zoom;
    this.renderer.camY = (box.minY + box.maxY) / 2 * zoom;
  }

  private draw(dt: number): void {
    const dock = this.hud.debugDockWidth, viewW = Math.max(160, this.app.renderer.width - dock);
    if (this.input.axis().throttle || this.input.axis().steer || !this.town.yard?.bays.includes(this.yardFocus!)) this.yardFocus = undefined;
    this.aimCamera(dt, viewW);
    const shake = this.mode === "play" ? this.shake.step(dt) : { x: 0, y: 0 };
    // Use the same shifted camera for projection and offscreen culling, without
    // feeding the temporary dock offset back into camera-follow interpolation.
    this.renderer.camX += dock / 2;
    this.renderer.layout(this.app.renderer.width, this.app.renderer.height, shake.x, shake.y);
    this.renderer.draw(this.town, this.dozer, this.particles, this.birds, dt);
    this.renderer.camX -= dock / 2;
    this.yardPanel?.tick(dt);
    this.hud.render(this.hudState());
    this.playthroughPanel?.render(this.playthrough.status());
  }

  /** Tower test overview, a framed yard bay, the followed road car, the town overview, or the dozer. */
  private aimCamera(dt: number, viewW: number): void {
    if (this.rules.towerTest && (this.towerOverview || this.town.buildings[0]?.coreCollapse?.phase === 'falling')) {
      const b = this.town.buildings[0]!;
      this.frameScreenBox(worldBoundsToScreen(b.x - 7, b.y - 7, b.w * b.cellSize + 14, b.d * b.cellSize + 14, 0, b.floors * 2.35 + 1), .72, this.app.renderer.width);
    } else if (this.yardFocus) this.frameYardBay(this.yardFocus, viewW);
    else if (this.town.roadCar && this.followRoadCamera) this.followCar(this.town.roadCar, dt);
    else if (this.renderer.showNhood) this.frameNhood(dt);
    else {
      this.renderer.zoom = this.followZoom;
      const focus = cameraFocus(this.dozer.x, this.dozer.y, 0.4, this.renderer.zoom);
      this.renderer.camX += (focus.x - this.renderer.camX) * (1 - Math.exp(-6 * dt));
      this.renderer.camY += (focus.y - this.renderer.camY) * (1 - Math.exp(-6 * dt));
    }
  }

  /** Frame a bay's asset; a vehicle is framed by its current boxes so a wreck stays in view. */
  private frameYardBay(bay: YardBay, viewW: number): void {
    const asset = bay.asset;
    const height = Math.max(asset.vehicle?.height ?? 1, ...bayBuildings(bay).map(b => b.floors * 2.35 + .8));
    let x = bay.x + asset.clearance, y = bay.y + asset.clearance, w = asset.w, d = asset.d;
    const bounds = bay.vehicle ? vehicleBoxes(bay.vehicle).map(boxBounds) : [];
    if (bounds.length) {
      x = Math.min(...bounds.map(b => b.x)); y = Math.min(...bounds.map(b => b.y));
      w = Math.max(...bounds.map(b => b.x + b.w)) - x; d = Math.max(...bounds.map(b => b.y + b.d)) - y;
    }
    this.frameScreenBox(worldBoundsToScreen(x - 2, y - 2, w + 4, d + 4, 0, height), .78, viewW);
  }

  private followCar(car: { x: number; y: number }, dt: number): void {
    const focus = worldToScreen(car.x, car.y, 0.3);
    const zoom = 0.62;
    this.renderer.zoom = zoom;
    const k = 1 - Math.exp(-8 * dt);
    this.renderer.camX += (focus.x * zoom - this.renderer.camX) * k;
    this.renderer.camY += (focus.y * zoom - this.renderer.camY) * k;
  }

  private hudState(): HudState {
    return {
      resubmitted: this.resubmission.used,
      upgradeModifiers: upgradeModifiers(this.upgrades),
      hasYard: !!this.town.yard,
      focusedTest: this.rules.testMap?.kind === 'asset',
      testMapName: this.testMapName(),
      developmentScenario: !!(this.rules.demo || this.rules.towerTest || this.rules.job || this.rules.ranchFocus || this.town.yard),
      pileResistance: this.dozer.pileResistance,
      job: this.job ? { ...this.job.status(), paid: this.job.paid, payout: this.job.payout } : undefined,
      cash: this.cash,
      timeLeft: this.timeLeft,
      elapsed: this.elapsed,
      session: this.rules.kind,
      district: this.rules.district,
      bladeDown: this.dozer.bladeDown,
      muted: this.audio.muted,
      heat: this.dozer.heat,
      track: this.dozer.track,
      overlay: this.mode === "play" ? "none" : this.mode,
      death: this.death,
      won: this.mode === "results" && (this.campaign ? this.campaign.complete : this.cash >= CASH_TARGET && !this.death),
      fieldNotice: this.fieldNotice,
      season: this.town.season,
      weatherDetail: this.town.weatherDetail,
      seed: this.rules.seed,
      levelId: this.rules.level,
      levelCard: this.levelCard(),
      campaign: showCampaignHud(this.rules, this.campaign) && this.campaign ? this.campaignHud(this.campaign) : undefined,
    };
  }

  private testMapName(): string | undefined {
    const testMap = this.rules.testMap;
    if (!testMap) return undefined;
    return testMap.kind === 'yard' ? 'All Assets Sandbox' : this.town.yard?.bays[0]?.asset.name ?? 'Asset link needs attention';
  }

  /** The level the menu would generate, for the debug session facts. */
  private levelCard(): HudState["levelCard"] {
    const level = generationLevel(this.rules, this.campaign);
    return level ? {
      levelIndex: level.index,
      levelName: level.name,
      levelId: level.id,
      buildingCount: level.generation.buildingCount,
      landmarkName: level.landmark.label,
      dollarTarget: level.dollarTarget,
      timeLimit: level.timeLimit,
    } : undefined;
  }

  private campaignHud(campaign: CampaignRun): CampaignHud {
    const level = currentLevel(campaign);
    const landmark = landmarkDemolitionStatus(this.town.buildings, level);
    return {
      levelIndex: level.index,
      levelName: level.name,
      levelId: level.id,
      landmarkName: level.landmark.label,
      dollarTarget: level.dollarTarget,
      levelEarned: campaign.levelEarned,
      campaignEarned: campaign.campaignEarned,
      landmarkProgress: landmark.progress,
      landmarkReady: landmark.ready,
      dollarsReady: dollarsReady(campaign, level),
      briefing: campaignBriefingText(level, campaign.season),
      victory: campaign.victory,
      complete: campaign.complete,
      buildingCount: level.generation.buildingCount,
      timeLimit: level.timeLimit,
    };
  }

  private ensurePerfOverlay(): void {
    if (this.perfEl) {
      this.perfEl.hidden = false;
      return;
    }
    const el = document.createElement("pre");
    el.id = "perf-root";
    document.body.appendChild(el);
    this.perfEl = el;
  }

  private hidePerfOverlay(): void {
    if (this.perfEl) this.perfEl.hidden = true;
  }

  private paintPerf(): void {
    if (!this.perf.enabled || !this.perfEl) return;
    const fps = this.perf.last.frameMs > 0 ? 1000 / this.perf.last.frameMs : 0;
    this.perfEl.textContent = formatPerfOverlay(this.perf.last, fps);
    // Read-only browser inspection bridge; export at 1 Hz, never scan/sort history every frame.
    if (performance.now() - this.perfExportAt > 1000) {
      this.perfEl.dataset.summary = JSON.stringify(this.perf.summary());
      this.perfExportAt = performance.now();
    }
  }

  destroy(): void {
    this.touch?.destroy();
    this.detachInput?.();
    this.app.destroy();
  }

  /** UI map changes must disclose that they replace the current run. */
  private confirmReplacement(action: string): boolean {
    this.releaseControls();
    const hasProgress = this.elapsed > 0 || this.cash > 0 || this.campaign !== null || Object.values(this.upgrades).some(value => value > 0) || !!this.rules.testMap;
    return !hasProgress || window.confirm(`${action}? This replaces your current run, including demolition and upgrades. You cannot undo this. Cancel to keep playing.`);
  }

  private bindHud(): void {
    bindHudSession(this.hud, {
      onMute: () => {
        void this.audio.unlock();
        this.audio.toggleMute();
      },
      onClick: () => { void this.audio.unlock().then(() => this.audio.switchClick()); },
      onUnlockSound: () => this.audio.unlock(),
      onResubmit: () => {
        if ((this.mode !== "play" && this.mode !== "pause") || this.playthrough.replaying) return null;
        const fee = this.resubmission.charge(this.campaign?.spendable ?? this.cash);
        if (fee !== null) {
          this.spendResubmission(fee);
          this.playthrough.noteAction({ kind: "resubmit", fee });
          this.releaseControls();
        }
        return fee;
      },
      onTitleSound: (kind, index) => {
        if (kind === "stamp") this.audio.permitStamp();
        else this.audio.typewriterKey(index);
      },
      onMenu: () => { this.releaseControls(); if (this.mode === "play") this.mode = "pause"; },
      onTitle: () => { this.releaseControls(); this.campaign = null; this.mode = "title"; },
      onStart: (kind, level, season, effects) => {
        this.rules = gameSetupRules(kind, "d10", this.rules.seed, level);
        this.rules.weatherDetail = effects;
        this.rules.seasonSelection = kind === "sandbox" ? season : undefined;
        this.rules.seasonExplicit = true;
        if (kind === "sandbox") {
          this.rules.season = season === "random" ? resolveSeason(this.rules.seed) : season;
          this.campaign = null;
        } else {
          this.campaign = startCampaign(this.rules.seed);
          this.campaign.levelIndex = CAMPAIGN_LEVELS.findIndex((entry) => entry.id === level);
          this.rules.season = this.campaign.season;
          this.rules.biomeId = this.campaign.biomeId;
        }
        this.reset("same");
        this.syncSessionUrl();
      },
      onBeginLevel: () => {
        if (this.campaign) this.campaign.briefing = false;
        if (this.mode === "briefing") this.mode = "play";
      },
      onNextLevel: () => {
        if (!this.campaign || !this.campaign.complete) return;
        this.campaign = advanceCampaignLevel(this.campaign, nextSeed(this.campaign.levelSeed));
        this.rules.seed = this.campaign.levelSeed;
        this.reset("same");
      },
      onRetryLevel: () => {
        if (!this.campaign) return;
        this.campaign = retryCampaignLevel(this.campaign);
        this.rules.seed = this.campaign.levelSeed;
        this.reset("same");
      },
      onNewCampaign: () => {
        this.rules = gameSetupRules("challenge", this.rules.district, this.rules.seed);
        this.campaign = startCampaign(this.rules.seed);
        this.rules.season = this.campaign.season;
        this.rules.biomeId = this.campaign.biomeId;
        this.rules.seasonExplicit = true;
        this.reset("same");
        this.syncSessionUrl();
      },
      onTestYard: () => { if (this.confirmReplacement("Open All-Assets Test Map")) void this.openTestYard(); },
      onResetTest: () => this.reset("same"),
      onChoice: (id) => this.pickUpgrade(id),
      onResume: () => {
        this.releaseControls();
        if (this.mode === "pause") this.mode = "play";
      },
      onRestart: () => {
        if (this.campaign) {
          this.campaign = retryCampaignLevel(this.campaign);
          this.rules.seed = this.campaign.levelSeed;
        }
        this.reset("same");
      },
      onNewSeed: () => this.reset("new"),
      onSession: (kind) => { if (this.confirmReplacement(`Start ${kind === "sandbox" ? "Sandbox" : "Time Challenge"}`)) this.setSession(kind); },
      onDistrict: (id) => this.setDistrict(id),
      onCampaignLevel: (id) => { if (this.confirmReplacement(`Start ${CAMPAIGN_LEVELS.find(level => level.id === id)!.name}`)) this.jumpCampaignLevel(id); },
      onJob: () => { if (this.confirmReplacement("Start Brick Building Demolition")) this.startJob(); },
      onDebugOpen: () => {
        this.releaseControls();
        void this.ensureYardPanel();
      },
      onDebugToggle: (key, value) => { this.renderer.debug[key] = value; this.syncDebug(); },
      onDebugFloor: (floor) => { this.renderer.debug.maxFloor = floor; this.syncDebug(); },
      onDebugReset: () => { Object.assign(this.renderer.debug, defaultDebugView()); this.syncDebug(); },
      onDebugStep: () => {
        if (this.renderer.debug.freeze && this.mode !== "upgrade" && this.mode !== "results" && !this.playthrough.exhausted) this.step(SIM_DT);
      },
    });
  }

  private async openTestYard(): Promise<void> {
    await this.ensureYardPanel();
    this.loadTestMap({ kind: "yard" });
  }

  private async ensureYardPanel(): Promise<void> {
    if (this.yardPanel) return;
    this.yardPanelInit ??= this.attachYardPanelOnce();
    await this.yardPanelInit;
  }

  private async attachYardPanelOnce(): Promise<void> {
    try {
      // Test-yard UI stays out of the ordinary player startup chunk.
      const { attachYardPanel } = await import("./yardBindings");
      if (this.yardPanel) return;
      this.yardPanel = attachYardPanel(this.hudRoot, {
        town: () => this.town,
        particles: this.particles,
        dozer: () => this.dozer,
        jump: (x, y) => {
          this.yardFocus = undefined;
          this.followRoadCamera = false;
          this.dozer = createDozer(x, y, -Math.PI / 2);
          this.renderer.showNhood = false;
        },
        frame: (bay) => { this.yardFocus = bay; this.followRoadCamera = false; this.renderer.showNhood = false; },
        followVehicle: (bay) => { if (bay.vehicle) { this.town.roadCar = bay.vehicle; this.followRoadCamera = true; this.yardFocus = undefined; } },
        testAsset: (assetId, variant) => { if (this.confirmReplacement("Open focused asset test map")) this.loadTestMap({ kind: "asset", assetId, variant }); },
        releaseInput: () => this.releaseControls(),
        preview: (bays, valid) => { this.renderer.yardPreview = bays; this.renderer.yardPreviewValid = valid; },
        changed: () => this.renderer.invalidate(),
      }, this.hud.binder);
      this.hud.assetsHost.append(this.yardPanel.root);
      this.yardPanel.root.open = true;
      this.yardPanel.reset();
    } catch (error) {
      this.yardPanelInit = undefined;
      throw error;
    }
  }

  private attachDebugBridge(): void {
    if (!shouldInstallDebugBridge(window.location.search, import.meta.env.DEV)) return;
    exposeDebugBridge(createDebugBridge(this.debugHost()));
  }

  private debugHost(): DebugHost {
    return {
      ready: () => !!this.town,
      snapshot: () => this.snapshot(),
      inspect: () => this.inspectSnapshot(),
      townSnapshot: () => this.townDebugSnapshot(),
      dozerSnapshot: () => ({
        x: this.dozer.x,
        y: this.dozer.y,
        heading: this.dozer.heading,
        bladeDown: this.dozer.bladeDown,
        vx: this.dozer.vx,
        motionStartX: this.dozer.motionStartX,
        motionStartY: this.dozer.motionStartY,
      }),
      cameraSnapshot: () => ({ x: this.renderer.camX, y: this.renderer.camY, zoom: this.renderer.zoom }),
      yardInspect: () => this.yardInspectSnapshot(),
      urbanSnapshot: () => this.urbanSnapshot(),
      obstructionAt: (x, y, radius) => this.obstructionAt(x, y, radius),
      lookAtWorld: (x, y, heading, zoom) => this.lookAtWorld(x, y, heading, zoom),
      frameDozer: (zoom) => this.frameDozer(zoom),
      lookAtTown: (mode) => this.lookAtTown(mode),
      step: (dt) => this.step(dt),
      reset: (kind) => this.reset(kind),
      setDozerPose: (pose) => {
        if (pose.x !== undefined) this.dozer.x = pose.x;
        if (pose.y !== undefined) this.dozer.y = pose.y;
        if (pose.heading !== undefined) this.dozer.heading = pose.heading;
        if (pose.bladeDown !== undefined) this.dozer.bladeDown = pose.bladeDown;
        if (pose.vx !== undefined) this.dozer.vx = pose.vx;
        if (pose.motionStartX !== undefined) this.dozer.motionStartX = pose.motionStartX;
        if (pose.motionStartY !== undefined) this.dozer.motionStartY = pose.motionStartY;
      },
      spawnRoadVehicle: () => this.spawnRoadVehicle(),
      jumpCampaignLevel: (id) => this.jumpCampaignLevel(id),
      analyticsStep: (seconds, mode, district) => this.analytics.step(seconds, mode, district),
      finish: (death, won) => this.finish(death, won),
      inputAxis: () => this.input.axis(),
      startRecording: () => this.startRecording(),
      stopRecording: () => this.stopPlaythrough(),
      lastPlaythrough: () => this.playthrough.last,
      replayPlaythrough: (input) => {
        if (input !== undefined) this.playthrough.load(input);
        else if (!this.playthrough.last) throw new Error("No playthrough recorded or loaded yet.");
        this.playthroughControl("replay");
      },
      playthroughStatus: () => this.playthrough.status(),
      playthroughControl: (command) => this.playthroughControl(command),
      runVehiclePerfHarness: () => this.runVehiclePerfHarness(),
    };
  }

  private inspectSnapshot() {
    const bay = this.town.yard?.bays[0];
    return {
      mode: this.mode,
      seed: this.rules.seed,
      request: this.rules.testMap,
      upgrades: { ...this.upgrades },
      binder: structuredClone(this.hud.binder),
      debug: { ...this.renderer.debug },
      dozer: { x: this.dozer.x, y: this.dozer.y },
      spawn: { x: this.town.spawnX, y: this.town.spawnY },
      elapsed: this.elapsed,
      bays: this.town.yard?.bays.length ?? 0,
      vehicles: this.town.vehicles.length,
      following: !!this.town.roadCar && this.town.vehicles.includes(this.town.roadCar),
      status: bay?.vehicle?.status,
      damage: bay?.vehicle?.parts.reduce((sum, part) => sum + part.damage, 0) ?? 0,
      rubble: this.town.rubble.length,
      job: !!this.job,
      yardIssues: this.town.yard?.issues.length ?? 0,
    };
  }

  private townDebugSnapshot() {
    return {
      groundCondition: this.town.groundCondition,
      biomeId: this.town.biome.id,
      season: this.town.season,
      weather: this.town.weather.kind,
      spawn: { x: this.town.spawnX, y: this.town.spawnY },
      lots: this.town.lots.map((lot) => ({
        id: lot.id,
        identity: lot.identity,
        x: lot.x,
        y: lot.y,
        w: lot.w,
        d: lot.d,
      })),
      features: this.town.features.map(serializeTownFeature),
      ground: this.town.ground.map((patch) => ({
        cover: patch.cover,
        x: patch.x,
        y: patch.y,
        w: patch.w,
        d: patch.d,
      })),
      props: this.town.props.map((prop) => ({
        assetId: prop.assetId,
        x: prop.x,
        y: prop.y,
        w: prop.w,
        d: prop.d,
        broken: !!prop.broken,
      })),
      rubble: this.town.rubble.length,
      yardIssues: this.town.yard?.issues.length ?? 0,
      bays: this.town.yard?.bays.length ?? 0,
      vehicles: this.town.vehicles.map((vehicle) => ({
        autonomous: vehicle.autonomous,
        status: vehicle.status,
        damage: vehicle.parts.reduce((sum, part) => sum + part.damage, 0),
      })),
      following: !!this.town.roadCar && this.town.vehicles.includes(this.town.roadCar),
    };
  }

  private yardInspectSnapshot() {
    const bays = this.town.yard?.bays ?? [];
    return {
      followRoadCamera: this.followRoadCamera,
      loads: this.town.yard?.loads?.length ?? 0,
      autonomousCount: bays.filter((bay) => bay.vehicle?.autonomous).length,
      vehicles: bays.flatMap((bay) => bay.vehicle ? [{
        definitionId: bay.vehicle.definitionId,
        autonomous: bay.vehicle.autonomous,
        status: bay.vehicle.status,
        damaged: bay.vehicle.parts.some((part) => part.damage > 0),
      }] : []),
    };
  }

  private async runVehiclePerfHarness() {
    const { createVehicle, stepDetached } = await import("../vehicle/runtime");
    const { VEHICLES } = await import("../vehicle/definitions");
    const { stepVehicleWorld, vehicleStats } = await import("../vehicle/world");
    const { testVehicleImpact, yardVehicleRoute } = await import("../world/testYard");
    this.mode = "pause";
    const town = this.town;
    town.yard = undefined;
    town.buildings = [];
    town.props = [];
    town.vehicles = [];
    town.roadCar = null;
    town.ground = [];
    town.roads = [];
    town.rubble = [];
    town.maxX = 160;
    town.maxY = 160;
    town.siteRevision++;
    for (let i = 0; i < 132; i++) {
      const vehicle = createVehicle(VEHICLES[i % 12]!.id, 10 + (i % 12) * 10, 10 + Math.floor(i / 12) * 12);
      if (i < 120) {
        for (let n = 0; n < 5; n++) testVehicleImpact(vehicle, "overhead", 40);
        stepDetached(vehicle, 0.02, { remaining: 0 }, () => 0);
        vehicle.sleeping = true;
      } else yardVehicleRoute(vehicle);
      town.vehicles.push(vehicle);
    }
    const sim: number[] = [];
    const render: number[] = [];
    this.renderer.camX = 0;
    this.renderer.camY = 400;
    this.renderer.zoom = 0.4;
    for (let i = 0; i < 180; i++) {
      let start = performance.now();
      stepVehicleWorld(town, this.dozer, this.particles, [], 1 / 60);
      if (i > 30) sim.push(performance.now() - start);
      start = performance.now();
      this.renderer.draw(town, this.dozer, this.particles, [], 1 / 60);
      this.app.render();
      if (i > 30) render.push(performance.now() - start);
    }
    const p95 = (values: number[]) => values.slice().sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? 0;
    return {
      vehicles: town.vehicles.length,
      simP95Ms: p95(sim),
      renderSubmitP95Ms: p95(render),
      stats: { ...vehicleStats },
      renderStats: { ...this.renderer.stats },
    };
  }
}

export async function boot(): Promise<Game> {
  const root = document.querySelector<HTMLElement>("#game-root");
  const hud = document.querySelector<HTMLElement>("#hud-root");
  if (!root || !hud) throw new Error("Missing #game-root or #hud-root");
  const game = new Game();
  await game.start(root, hud);
  return game;
}
