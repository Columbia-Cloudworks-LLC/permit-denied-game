import { testVehicleImpact } from '../world/testYard';
import { ensureTerms, privacyOpen, termsAccepted, setAnalyticsTestSession, RunAnalytics } from '../privacy/privacy';
import { testMapSearch, type TestMapRequest } from '../world/testMapRequest';
import { boxBounds, vehicleBoxes } from '../vehicle/world';
import { upgradeModifiers } from './upgrades';
import { applyFixtureDamage } from '../structure/interior';
import { Resubmission } from './resubmission';
import { bayBuildings, bayProps, bayVehicles, type YardBay } from '../world/yardCatalog';
import { YardPanel } from '../render/yardPanel';
import { applyCellDamage } from '../structure/building';
import { destroyProp } from '../sim/assets';
import { defaultDebugView } from "../debug/view";
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
import { Hud } from "../render/hud";
import { WorldRenderer } from "../render/WorldRenderer";
import { lastDebrisStats, obstructionAt } from "../sim/debris";
import { spawnFixtureFrags, stepWorld, type Upgrades } from "../sim/worldSim";
import type { Bird, WorldEvent } from "../structure/types";
import { createDozer, dozerSpeed, stepDozer } from "../vehicle/dozer";
import { createRoadVehicle, replaceRoadVehicle } from "../vehicle/roadVehicle";
import { pickVerificationRoute } from "../world/routing";
import { worldBoundsToScreen, worldToScreen } from "../world/iso";
import { createTown } from "../world/town";
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
import {
  CASH_TARGET,
  COPY,
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
  startsAtTitle,
  sessionFailsOn,
  sessionForcesUpgrade,
  type DistrictId,
  type DemoAsset,
  type PlayMode,
  type SessionKind,
  type SessionRules,
} from "./session";

export type GameMode = PlayMode;

export class Game {
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
  private yardPanel?: YardPanel;
  private followRoadCamera = true;
  private towerOverview = true;
  private yardFocus?: YardBay;
  private perfEl: HTMLElement | null = null;
  private perfExportAt = 0;
  private rules: SessionRules = parseSessionFromSearch(
    typeof window === "undefined" ? "" : window.location.search,
  );
  private town = createTown({ towerTest: this.rules.towerTest, district: this.rules.district, seed: this.rules.seed, showcase: !!this.rules.demo, testMap: this.rules.testMap });
  private dozer = createDozer(this.town.spawnX, this.town.spawnY, this.town.spawnHeading);
  private birds: Bird[] = [];
  private cash = 0;
  private campaign: CampaignRun | null = null;
  private resubmission = new Resubmission();
  private timeLeft = MATCH_SECONDS;
  private elapsed = 0;
  private hint = 1;
  private mode: GameMode = "play";
  private death: string | null = null;
  private upgrades: Upgrades = { blade: 0, engine: 0, push: 0 };
  private nextUpgrade = 0;
  private earnedChoice = false;
  private job: DemolitionJob | undefined;
  private acc = 0;
  private grindAud = 0;
  private scrapeCd = 0;
  private droppedSimSec = 0;
  private detachInput: (() => void) | null = null;

  async start(root: HTMLElement, hudRoot: HTMLElement): Promise<void> {
    document.title = TITLE;
    this.app = new Application();
    await this.app.init({
      resizeTo: root,
      background: 0x3a4a24,
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
    this.hud = new Hud(hudRoot);
    this.hud.onMute = () => {
      void this.audio.unlock();
      this.audio.toggleMute();
    };
    this.hud.onClick = () => { void this.audio.unlock().then(() => this.audio.switchClick()); };
    this.hud.onUnlockSound = () => this.audio.unlock();
    this.hud.onResubmit = () => {
      if (this.mode !== 'play' && this.mode !== 'pause') return null;
      const fee = this.resubmission.charge(this.campaign?.spendable ?? this.cash);
      if (fee !== null) {
        if (this.campaign) spendCampaignCash(this.campaign, fee);
        this.cash -= fee;
        this.releaseControls();
      }
      return fee;
    };
    this.hud.onTitleSound = (kind, index) => {
      if (kind === 'stamp') this.audio.permitStamp();
      else this.audio.typewriterKey(index);
    };
    this.hud.onMenu = () => { this.releaseControls(); if (this.mode === 'play') this.mode = 'pause'; };
    this.hud.onTitle = () => { this.releaseControls(); this.campaign = null; this.mode = 'title'; };
    this.hud.onStart = (kind, district) => {
      this.rules = gameSetupRules(kind, district, this.rules.seed);
      this.campaign = kind === 'challenge' ? startCampaign(this.rules.seed) : null;
      this.reset('same');
      this.syncSessionUrl();
    };
    this.hud.onBeginLevel = () => {
      if (this.campaign) this.campaign.briefing = false;
      if (this.mode === 'briefing') this.mode = 'play';
    };
    this.hud.onNextLevel = () => {
      if (!this.campaign || !this.campaign.complete) return;
      this.campaign = advanceCampaignLevel(this.campaign, nextSeed(this.campaign.levelSeed));
      this.rules.seed = this.campaign.levelSeed;
      this.reset('same');
    };
    this.hud.onRetryLevel = () => {
      if (!this.campaign) return;
      this.campaign = retryCampaignLevel(this.campaign);
      this.rules.seed = this.campaign.levelSeed;
      this.reset('same');
    };
    this.hud.onNewCampaign = () => {
      this.rules = gameSetupRules('challenge', this.rules.district, this.rules.seed);
      this.campaign = startCampaign(this.rules.seed);
      this.reset('same');
      this.syncSessionUrl();
    };
    this.hud.onTestYard = () => this.loadTestMap({ kind: 'yard' });
    this.hud.onResetTest = () => this.reset('same');
    this.hud.onChoice = (id) => this.pickUpgrade(id);
    this.hud.onResume = () => {
      this.releaseControls();
      if (this.mode === "pause") this.mode = "play";
    };
    this.hud.onRestart = () => {
      if (this.campaign) {
        this.campaign = retryCampaignLevel(this.campaign);
        this.rules.seed = this.campaign.levelSeed;
      }
      this.reset("same");
    };
    this.hud.onNewSeed = () => this.reset("new");
    this.hud.onSession = (kind) => this.setSession(kind);
    this.hud.onDistrict = (id) => this.setDistrict(id);
    this.hud.onJob = () => this.startJob();
    this.hud.onDebugOpen = () => this.releaseControls();
    this.hud.onDebugToggle = (key, value) => { this.renderer.debug[key] = value; this.syncDebug(); };
    this.hud.onDebugFloor = floor => { this.renderer.debug.maxFloor = floor; this.syncDebug(); };
    this.hud.onDebugReset = () => { Object.assign(this.renderer.debug, defaultDebugView()); this.syncDebug(); };
    this.hud.onDebugStep = () => { if (this.renderer.debug.freeze && this.mode !== 'upgrade' && this.mode !== 'results') this.step(SIM_DT); };
    this.yardPanel = new YardPanel(hudRoot, {
      town: () => this.town, particles: this.particles, dozer: () => this.dozer,
      jump: (x, y) => { this.yardFocus = undefined; this.followRoadCamera = false; this.dozer = createDozer(x, y, -Math.PI / 2); this.renderer.showNhood = false; },
      frame: bay => { this.yardFocus = bay; this.followRoadCamera = false; this.renderer.showNhood = false; },
      followVehicle: bay => { if(bay.vehicle){this.town.roadCar=bay.vehicle;this.followRoadCamera=true;this.yardFocus=undefined;} },
      testAsset: (assetId, variant) => this.loadTestMap({ kind: 'asset', assetId, variant }),
      releaseInput: () => this.releaseControls(),
      preview: (bays, valid) => { this.renderer.yardPreview = bays; this.renderer.yardPreviewValid = valid; },
      changed: () => this.renderer.invalidate(),
      destroy: bay => {
        for (const vehicle of bayVehicles(bay)) for (let i = 0; i < 5; i++) testVehicleImpact(vehicle, 'overhead', 20);
        for (const prop of bayProps(bay)) if (!prop.broken) destroyProp(this.town, prop, this.particles, [], prop.x - 1, prop.y);
        if (bay.building && bay.asset.fixture) {
          for (const f of bay.building.fixtures) {
            const hit = applyFixtureDamage(bay.building, f, 10000, 1, 0, this.particles, []);
            spawnFixtureFrags(this.town, hit.frags);
          }
        } else for (const building of bayBuildings(bay)) for (const cell of building.cells) applyCellDamage(building, cell, 10000, 1, 0, this.particles, []);
      },
    }, this.hud.binder);
    this.hud.assetsHost.append(this.yardPanel.root);
    this.yardPanel.root.open = true;
    this.detachInput = this.input.attach();
    this.touch = new TouchControls(hudRoot, {
      change: state => this.input.setTouch(state),
      release: () => this.input.reset(),
      interact: () => { void this.audio.unlock(); },
      resize: () => this.app.resize(),
    });
    this.perf.enabled = new URLSearchParams(window.location.search).get("perf") === "1";
    if (this.perf.enabled) this.ensurePerfOverlay();
    this.renderer.showNhood = new URLSearchParams(window.location.search).get("nhood") === "1";
    this.renderer.debug.perf = this.perf.enabled;
    this.syncDebug();
    if (this.rules.kind === 'challenge' && !this.rules.job) this.campaign = startCampaign(this.rules.seed);
    this.reset("same");
    if (this.rules.testMap) this.hud.openDebug();
    if (startsAtTitle(window.location.search)) this.mode = "title";
    (window as unknown as { __pd: Game }).__pd = this;
    this.app.ticker.add((ticker) => {
      this.frame(Math.min(0.05, ticker.deltaMS / 1000));
    });
  }

  snapshot(): {
    cash: number;
    timeLeft: number;
    elapsed: number;
    mode: GameMode;
    session: SessionKind;
    district: DistrictId;
    seed: number;
    dozer: { x: number; y: number; heading: number };
    rubble: number;
    marks: number;
    roadCar: { x: number; y: number } | null;
    buildings: { name: string; states: Record<string, number> }[];
  } {
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
    this.rules.ranchFocus = false;
    this.campaign = kind === 'challenge' ? startCampaign(this.rules.seed) : null;
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
    setAnalyticsTestSession(!!this.rules.testMap || !!this.rules.towerTest || this.perf.enabled);
    this.analytics.reset(this.elapsed > 0);
    this.towerOverview = true;
    const keepSetup = !!this.rules.testMap;
    const frameKey = this.yardFocus?.key;
    const followKey = this.followRoadCamera ? this.town.roadCar?.yardOwner : undefined;
    this.releaseControls();
    this.followRoadCamera = true;
    if (kind === "new" && !keepSetup && !this.campaign) this.rules.seed = nextSeed(this.rules.seed);
    if (this.campaign && kind === "new") this.campaign = retryCampaignLevel(this.campaign);
    if (this.campaign) this.rules.seed = this.campaign.levelSeed;
    this.town = createTown({
      towerTest: this.rules.towerTest,
      district: this.rules.district,
      seed: this.rules.seed,
      showcase: !!this.rules.demo,
      testMap: this.rules.testMap,
      campaign: this.campaign ? currentLevel(this.campaign) : undefined,
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
    this.hud.preserveBinderScroll(() => this.yardPanel?.reset());
    this.yardFocus = this.town.yard?.bays.find(b => b.key === frameKey);
    const followed = this.town.yard?.bays.find(b => b.key === followKey)?.vehicle;
    this.town.roadCar = followed ?? null;
    this.followRoadCamera = !!followed;
    this.shake.reset();
    this.renderer.bowlingStrikes.clear();
    this.renderer.invalidate();
    this.birds = [];
    this.cash = this.campaign?.spendable ?? 0;
    this.resubmission = new Resubmission();
    this.hud.permitLogo.reset();
    this.hud.resetCash();
    this.timeLeft = this.campaign ? currentLevel(this.campaign).timeLimit : MATCH_SECONDS;
    this.elapsed = 0;
    this.hint = 1;
    this.mode = this.campaign?.briefing ? "briefing" : "play";
    this.death = null;
    if (this.campaign) {
      this.upgrades = { ...this.campaign.upgrades };
      this.nextUpgrade = this.campaign.nextUpgrade;
    } else if (!keepSetup) this.upgrades = { blade: 0, engine: 0, push: 0 };
    if (!this.campaign) this.nextUpgrade = 0;
    this.earnedChoice = false;
    this.job = this.rules.job && ranch ? new DemolitionJob(ranch) : undefined;
    this.renderer.jobTarget = this.job?.target;
    this.renderer.landmarkTarget = this.campaign
      ? this.town.buildings.find(building => building.campaignLandmark)
      : undefined;
    this.acc = 0;
    this.grindAud = 0;
    this.scrapeCd = 0;
    this.droppedSimSec = 0;
    this.perf.reset();
    const spawn = cameraFocus(this.dozer.x, this.dozer.y, 0.4, this.renderer.zoom);
    this.renderer.camX = spawn.x;
    this.renderer.camY = spawn.y;
    if (kind === 'new') this.syncSessionUrl();
  }

  setDemo(demo: DemoAsset): void {
    this.loadTestMap({ kind: 'asset', assetId: 'building:' + demo, variant: 0 });
  }

  loadTestMap(testMap: TestMapRequest): void {
    this.rules = { kind: 'sandbox', district: 'classic', seed: this.rules.seed, ranchFocus: false, testMap };
    this.reset('same');
    if (testMap.kind === 'asset' && !this.yardFocus && !this.town.roadCar) this.yardFocus = this.town.yard?.bays[0];
    this.syncSessionUrl();
  }

  private syncSessionUrl(): void {
    // Replace the map link without a reload; reload reconstructs this map with fresh UI defaults.
    const params = this.rules.testMap ? new URLSearchParams(testMapSearch(this.rules.testMap, this.rules.seed))
      : new URLSearchParams(this.rules.job ? { job: 'brick', seed: String(this.rules.seed) }
        : { mode: this.rules.kind, district: this.rules.district, seed: String(this.rules.seed) });
    const previous = new URLSearchParams(location.search);
    for (const key of ['controls', 'perf']) if (previous.has(key)) params.set(key, previous.get(key)!);
    history.replaceState(null, '', '?' + params);
  }

  startJob(): void {
    this.rules = { kind: "challenge", district: "classic", seed: DEFAULT_DISTRICT_SEEDS.classic,
      ranchFocus: false, demo: "rivertown", job: true };
    this.reset("same");
    this.syncSessionUrl();
  }

  private syncDebug(): void {
    this.perf.enabled = this.renderer.debug.perf;
    if (this.perf.enabled) this.ensurePerfOverlay(); else this.hidePerfOverlay();
    this.hud.syncDebug(this.renderer.debug);
  }

  private pickUpgrade(id: "blade" | "engine" | "push"): void {
    if (!canPickUpgrade(this.rules, this.mode, this.earnedChoice)) return;
    if (this.job && !this.job.takeChoice()) return;
    this.earnedChoice = false;
    this.upgrades[id] += 1;
    if (this.campaign) {
      this.campaign.upgrades[id] += 1;
    }
    if (this.mode === "upgrade") this.mode = this.campaign?.briefing ? "briefing" : "play";
  }

  private frame(realDt: number): void {
    if (!termsAccepted() && this.mode !== 'title' && !privacyOpen()) {
      void ensureTerms().then(yes => { if (!yes) this.mode = 'title'; });
    }
    if (privacyOpen() || (!termsAccepted() && this.mode !== 'title')) {
      this.releaseControls(); this.touch?.setBlocked(true); this.audio.hush(); this.acc = 0; this.draw(0); return;
    }
    this.touch?.setBlocked(this.mode !== 'play' || this.renderer.debug.freeze);
    const now = performance.now();
    const frameMs = this.perf.markFrameStart(now);
    if (this.input.consume("m") || this.input.consume("M")) {
      void this.audio.unlock();
      this.audio.toggleMute();
    }
    if (this.mode === "play" || this.mode === "results") {
      if (this.input.consume("r") || this.input.consume("R")) this.reset("same");
      if (this.input.consume("n") || this.input.consume("N")) this.reset("new");
      if ((this.input.consume("v") || this.input.consume("V")) && !this.rules.testMap) this.spawnRoadVehicle();
      if (this.input.consume("g") || this.input.consume("G")) { this.renderer.showNhood = !this.renderer.showNhood; this.syncDebug(); }
      if (this.input.consume("`")) {
        this.renderer.debug.perf = !this.renderer.debug.perf;
        this.syncDebug();
      }
    }
    if (this.mode === "play" || this.mode === "upgrade") {
      if (this.input.consume("1")) this.pickUpgrade("blade");
      if (this.input.consume("2")) this.pickUpgrade("engine");
      if (this.input.consume("3")) this.pickUpgrade("push");
    }
    if (this.input.consume("Escape")) {
      this.releaseControls();
      if (!this.hud.closeDebug(true)) {
        if (this.mode === "play") this.mode = "pause";
        else if (this.mode === "briefing") this.mode = "pause";
        else if (this.mode === "pause") this.mode = this.campaign?.briefing ? "briefing" : "play";
      }
    }
    if (this.input.down.size > 0) void this.audio.unlock();

    let simCpuMs = 0;
    this.touch?.setBlocked(this.mode !== 'play' || this.renderer.debug.freeze);
    if (this.mode === "play" && !this.renderer.debug.freeze) {
      this.acc += realDt;
      const simStart = performance.now();
      const advanced = advanceSimulation(this.acc, SIM_DT, SIM_MAX_STEPS,
        () => this.mode === "play", () => this.step(SIM_DT));
      this.acc = advanced.acc;
      this.droppedSimSec += advanced.dropped;
      simCpuMs = performance.now() - simStart;
    } else {
      this.acc = 0;
      this.input.flush();
      this.audio.hush();
    }

    const prepStart = performance.now();
    this.touch?.setBlocked(this.mode !== 'play' || this.renderer.debug.freeze);
    this.draw(realDt);
    const renderPrepMs = performance.now() - prepStart;
    const debris = lastDebrisStats();
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
      heapMB: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize !== undefined
        ? (performance as Performance & { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576 : null,
      runtimeObjects: this.perf.enabled ? this.town.buildings.reduce((n, b) => n + b.cells.length + b.fixtures.length + b.floorTiles.length + b.roofs.length, this.town.rubble.length + this.town.props.length) : 0,
      retiredBuildings: this.town.buildings.filter(b => b.retired).length,
      drawCached: this.renderer.stats.cached,
      drawRebuilt: this.renderer.stats.rebuilt,
    });
    this.paintPerf();
  }

  private lastMetrics = { buildingsStepped: 0, buildingsSkipped: 0, collisionRebuilds: 0 };

  private step(dt: number): void {
    if (!termsAccepted() || privacyOpen()) return;
    setAnalyticsTestSession(!!this.rules.testMap || !!this.rules.towerTest || this.perf.enabled || this.renderer.debug.freeze);
    this.analytics.step(dt, this.rules.job ? 'brick-job' : this.rules.kind, this.rules.district);
    const drive = this.input.axis();
    stepDozer(
      this.dozer,
      {
        throttle: drive.throttle,
        steer: drive.steer,
        blade: this.input.blade(),
        ...upgradeModifiers(this.upgrades),
      },
      dt,
    );

    const beforeHeat = this.dozer.heat;
    const out = stepWorld(this.town, this.dozer, this.particles, this.upgrades, dt);
    this.lastMetrics = out.metrics;
    if (this.campaign) {
      creditCampaignEarnings(this.campaign, out.cash);
      this.cash = this.campaign.spendable;
    } else this.cash += out.cash;
    this.react(out.events);
    for (const b of out.birds) {
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

    this.elapsed += dt;
    this.timeLeft -= dt;
    this.hint = Math.max(0, this.hint - dt * 0.12);
    this.scrapeCd = Math.max(0, this.scrapeCd - dt);
    const pushing = this.dozer.bladeDown && out.debrisLoad > 0.2;
    this.grindAud = lerp(
      this.grindAud,
      this.dozer.bladeDown && (this.dozer.heat > beforeHeat - 0.01 || pushing) ? 0.14 + Math.min(0.1, out.debrisLoad * 0.04) : 0,
      1 - Math.pow(0.001, dt),
    );
    this.audio.engineLevel(dozerSpeed(this.dozer), this.dozer.heat);
    this.audio.grindLevel(this.dozer.bladeDown ? 0.08 + this.grindAud : 0);

    const payout = this.job?.settle() ?? 0;
    if (payout) {
      if (this.campaign) {
        creditCampaignEarnings(this.campaign, payout);
        this.cash = this.campaign.spendable;
      } else this.cash += payout;
      this.audio.cash();
      this.earnedChoice = true;
      this.mode = "upgrade";
      return;
    }
    const milestoneCash = this.campaign?.campaignEarned ?? this.cash;
    if (
      sessionForcesUpgrade(this.rules) &&
      this.nextUpgrade < UPGRADE_MILESTONES.length &&
      milestoneCash >= UPGRADE_MILESTONES[this.nextUpgrade]!
    ) {
      this.nextUpgrade += 1;
      if (this.campaign) this.campaign.nextUpgrade = this.nextUpgrade;
      this.earnedChoice = true;
      this.mode = "upgrade";
      return;
    }

    if (this.campaign) {
      const level = currentLevel(this.campaign);
      const landmark = landmarkDemolitionStatus(this.town.buildings, level);
      const outcome = evaluateCampaignStep({
        timeLeft: this.timeLeft,
        heat: this.dozer.heat,
        track: this.dozer.track,
        landmarkReady: landmark.ready,
        dollarsReady: dollarsReady(this.campaign, level),
        expired: this.campaign.expired,
        alreadyComplete: this.campaign.complete,
      });
      const death = applyCampaignOutcome(this.campaign, outcome);
      if (outcome !== 'continue') this.finish(death ?? '', outcome === 'win');
      return;
    }

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

  private react(events: WorldEvent[]): void {
    for (const e of events) {
      if (e.kind === "bowling-strike") { this.renderer.bowlingStrikes.add(); this.audio.bowlingPins(); }
      if (e.kind === "impact" || e.kind === "breach") {
        this.shake.punch(e.mag);
        this.audio.impact(e.mag);
        if (e.kind === "breach") this.audio.breakMat(e.mag);
      }
      if (e.kind === "collapse") {
        this.shake.punch(e.mag * 1.4);
        this.audio.collapse(e.mag);
      }
      if (e.kind === "cash") this.audio.cash();
      if (e.kind === "chip" && e.mag > 0.5) this.audio.impact(0.3);
      if (e.kind === "scrape" && this.scrapeCd <= 0) {
        this.scrapeCd = 0.08;
        if (e.material === "metal" || e.material === "wood") this.audio.clatter(e.mag, e.material);
        else this.audio.scrape(e.mag, e.material);
      }
      if (e.kind === "crush") {
        this.audio.crunch(e.mag);
        if (e.mag > 0.9) this.shake.punch(e.mag * 0.45);
      }
      if (e.kind === "blast") {
        this.shake.punch(e.mag);
        this.audio.impact(e.mag);
      }
      if (e.kind === "spark") this.audio.clatter(e.mag * 0.6, "metal");
    }
  }

  spawnRoadVehicle(): void {
    if (this.rules.kind !== "sandbox") return;
    this.followRoadCamera = true;
    const route = pickVerificationRoute(this.town.network) ?? [];
    replaceRoadVehicle(this.town, createRoadVehicle(
      this.town.roadSpawnX,
      this.town.roadSpawnY,
      this.town.roadSpawnHeading,
      route,
    ));
  }

  obstructionAt(x: number, y: number, radius = 0.7) {
    return obstructionAt(this.town, x, y, radius);
  }

  perfSnapshot() {
    return this.perf.summary();
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
    const pad = 8;
    const buildings = this.town.buildings;
    const minX = buildings.length ? Math.min(...buildings.map(building => building.x)) - pad : this.town.minX - pad;
    const minY = buildings.length ? Math.min(...buildings.map(building => building.y)) - pad : this.town.minY - pad;
    const maxX = buildings.length
      ? Math.max(...buildings.map(building => building.x + building.w * building.cellSize)) + pad
      : this.town.maxX + pad;
    const maxY = buildings.length
      ? Math.max(...buildings.map(building => building.y + building.d * building.cellSize)) + pad
      : this.town.maxY + pad;
    const tallest = Math.max(2, ...buildings.map(building => building.floors * 0.45 + 1.5));
    const box = worldBoundsToScreen(
      minX,
      minY,
      Math.max(8, maxX - minX),
      Math.max(8, maxY - minY),
      0,
      tallest,
    );
    const spanX = Math.max(1, box.maxX - box.minX);
    const spanY = Math.max(1, box.maxY - box.minY);
    const viewW = this.app.renderer.width - this.hud.debugDockWidth;
    const viewH = this.app.renderer.height;
    const zoom = Math.min(0.95, Math.max(0.1, 0.86 * Math.min(viewW / spanX, viewH / spanY)));
    this.renderer.zoom = zoom;
    // layout() scales around the world origin, so the camera offset must include zoom.
    this.renderer.camX = ((box.minX + box.maxX) / 2) * zoom;
    this.renderer.camY = ((box.minY + box.maxY) / 2) * zoom;
  }

  private draw(dt: number): void {
    const dock = this.hud.debugDockWidth, viewW = Math.max(160, this.app.renderer.width - dock);
    if (this.input.axis().throttle || this.input.axis().steer || !this.town.yard?.bays.includes(this.yardFocus!)) this.yardFocus = undefined;
    if (this.rules.towerTest && (this.towerOverview || this.town.buildings[0]?.coreCollapse?.phase === 'falling')) {
      const b = this.town.buildings[0]!;
      const box = worldBoundsToScreen(b.x - 7, b.y - 7, b.w * b.cellSize + 14, b.d * b.cellSize + 14, 0, b.floors * 2.35 + 1);
      const zoom = Math.min(1.15, .72 * Math.min(this.app.renderer.width / (box.maxX - box.minX), this.app.renderer.height / (box.maxY - box.minY)));
      this.renderer.zoom = zoom; this.renderer.camX = (box.minX + box.maxX) / 2 * zoom; this.renderer.camY = (box.minY + box.maxY) / 2 * zoom;
    } else if (this.yardFocus) {
      const bay = this.yardFocus, asset = bay.asset;
      const height = Math.max(asset.vehicle?.height ?? 1, ...bayBuildings(bay).map(b => b.floors * 2.35 + .8));
      let x = bay.x + asset.clearance, y = bay.y + asset.clearance, w = asset.w, d = asset.d;
      if (bay.vehicle) {
        const bounds = vehicleBoxes(bay.vehicle).map(boxBounds);
        if (bounds.length) {
          x = Math.min(...bounds.map(b => b.x)); y = Math.min(...bounds.map(b => b.y));
          w = Math.max(...bounds.map(b => b.x + b.w)) - x; d = Math.max(...bounds.map(b => b.y + b.d)) - y;
        }
      }
      const box = worldBoundsToScreen(x - 2, y - 2, w + 4, d + 4, 0, height);
      const zoom = Math.min(1.15, .78 * Math.min(viewW / (box.maxX - box.minX), this.app.renderer.height / (box.maxY - box.minY)));
      this.renderer.zoom = zoom;
      this.renderer.camX = (box.minX + box.maxX) / 2 * zoom;
      this.renderer.camY = (box.minY + box.maxY) / 2 * zoom;
    } else if (this.town.roadCar && this.followRoadCamera) {
      const car = this.town.roadCar;
      const focus = worldToScreen(car.x, car.y, 0.3);
      const zoom = 0.62;
      this.renderer.zoom = zoom;
      const k = 1 - Math.exp(-8 * dt);
      this.renderer.camX += (focus.x * zoom - this.renderer.camX) * k;
      this.renderer.camY += (focus.y * zoom - this.renderer.camY) * k;
    } else if (this.renderer.showNhood) this.frameNhood(dt);
    else {
      this.renderer.zoom = 1.15;
      const focus = cameraFocus(this.dozer.x, this.dozer.y, 0.4, this.renderer.zoom);
      this.renderer.camX += (focus.x - this.renderer.camX) * (1 - Math.exp(-6 * dt));
      this.renderer.camY += (focus.y - this.renderer.camY) * (1 - Math.exp(-6 * dt));
    }
    const shake = this.mode === "play" ? this.shake.step(dt) : { x: 0, y: 0 };
    // Use the same shifted camera for projection and offscreen culling, without
    // feeding the temporary dock offset back into camera-follow interpolation.
    this.renderer.camX += dock / 2;
    this.renderer.layout(this.app.renderer.width, this.app.renderer.height, shake.x, shake.y);
    this.renderer.draw(this.town, this.dozer, this.particles, this.birds, dt);
    this.renderer.camX -= dock / 2;
    this.yardPanel?.tick(dt);
    this.hud.render({
      resubmitted: this.resubmission.used,
      upgradeModifiers: upgradeModifiers(this.upgrades),
      hasYard: !!this.town.yard,
      focusedTest: this.rules.testMap?.kind === 'asset',
      testMapName: this.rules.testMap ? this.rules.testMap.kind === 'yard' ? 'All Assets Sandbox' : this.town.yard?.bays[0]?.asset.name ?? 'Asset link needs attention' : undefined,
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
      campaign: this.campaign ? (() => {
        const level = currentLevel(this.campaign);
        const landmark = landmarkDemolitionStatus(this.town.buildings, level);
        return {
          levelIndex: level.index,
          levelName: level.name,
          landmarkName: level.landmark.label,
          dollarTarget: level.dollarTarget,
          levelEarned: this.campaign.levelEarned,
          campaignEarned: this.campaign.campaignEarned,
          landmarkProgress: landmark.progress,
          landmarkReady: landmark.ready,
          dollarsReady: dollarsReady(this.campaign, level),
          briefing: campaignBriefingText(level),
          victory: this.campaign.victory,
          complete: this.campaign.complete,
        };
      })() : undefined,
    });
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
}

export async function boot(): Promise<Game> {
  const root = document.querySelector<HTMLElement>("#game-root");
  const hud = document.querySelector<HTMLElement>("#hud-root");
  if (!root || !hud) throw new Error("Missing #game-root or #hud-root");
  const game = new Game();
  await game.start(root, hud);
  return game;
}
