import { applyFixtureDamage } from '../structure/interior';
import { bayBuildings, bayProps, type YardBay } from '../world/yardCatalog';
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
import { createRoadVehicle } from "../vehicle/roadVehicle";
import { pickVerificationRoute } from "../world/routing";
import { worldBoundsToScreen, worldToScreen } from "../world/iso";
import { createTown } from "../world/town";
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

export type GameMode = PlayMode;

export class Game {
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
  private town = createTown({ towerTest: this.rules.towerTest, district: this.rules.district, seed: this.rules.seed, showcase: !!this.rules.demo, yard: this.rules.kind === "sandbox" && this.rules.district === "classic" && !this.rules.demo && !this.rules.ranchFocus });
  private dozer = createDozer(this.town.spawnX, this.town.spawnY, this.town.spawnHeading);
  private birds: Bird[] = [];
  private cash = 0;
  private score = 0;
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
    this.app.stage.addChild(this.renderer.root);
    this.hud = new Hud(hudRoot);
    this.hud.onMute = () => {
      void this.audio.unlock();
      this.audio.toggleMute();
    };
    this.hud.onChoice = (id) => this.pickUpgrade(id);
    this.hud.onResume = () => {
      if (this.mode === "pause") this.mode = "play";
    };
    this.hud.onRestart = () => this.reset("same");
    this.hud.onNewSeed = () => this.reset("new");
    this.hud.onSession = (kind) => this.setSession(kind);
    this.hud.onDistrict = (id) => this.setDistrict(id);
    this.hud.onTower = () => {
      this.rules = { kind: 'sandbox', district: 'classic', seed: this.rules.seed, ranchFocus: false, towerTest: true };
      this.reset('same');
    };
    this.hud.onTowerAction = action => {
      if (!this.rules.towerTest) return;
      const b = this.town.buildings[0]!;
      if (action === 'reset') { this.reset('same'); return; }
      if (action === 'view') { this.towerOverview = !this.towerOverview; if (this.towerOverview) { this.renderer.debug.maxFloor = 99; this.renderer.debug.reveal = false; this.syncDebug(); } return; }
      if (action === 'core-view') {
        this.towerOverview = false;
        this.renderer.debug.maxFloor = this.renderer.debug.maxFloor === 0 ? 99 : 0;
        this.renderer.debug.reveal = this.renderer.debug.maxFloor === 0;
        this.syncDebug(); return;
      }
      if (b.coreCollapse?.phase !== 'standing') return;
      for (const c of b.cells) if (c.floor === 0 && (action === 'core' ? c.coreSupport : c.exterior.south))
        applyCellDamage(b, c, 10000, 0, -1, this.particles, []);
      if (action === 'core') { this.towerOverview = true; this.renderer.debug.maxFloor = 99; this.renderer.debug.reveal = false; this.syncDebug(); }
    };
    this.hud.onDemo = (id) => this.setDemo(id);
    this.hud.onJob = () => this.startJob();
    this.hud.onDebugOpen = () => this.releaseControls();
    this.hud.onDebugToggle = (key, value) => { this.renderer.debug[key] = value; this.syncDebug(); };
    this.hud.onDebugFloor = floor => { this.renderer.debug.maxFloor = floor; this.syncDebug(); };
    this.hud.onDebugReset = () => { Object.assign(this.renderer.debug, defaultDebugView()); this.syncDebug(); };
    this.hud.onDebugStep = () => { if (this.renderer.debug.freeze && this.mode === "play") this.step(SIM_DT); };
    this.yardPanel = new YardPanel(hudRoot, {
      town: () => this.town, particles: this.particles, dozer: () => this.dozer,
      jump: (x, y) => { this.yardFocus = undefined; this.followRoadCamera = false; this.dozer = createDozer(x, y, -Math.PI / 2); this.renderer.showNhood = false; },
      frame: bay => { this.yardFocus = bay; this.followRoadCamera = false; this.renderer.showNhood = false; },
      followRoad: () => { this.followRoadCamera = true; },
      releaseInput: () => this.releaseControls(),
      preview: (bays, valid) => { this.renderer.yardPreview = bays; this.renderer.yardPreviewValid = valid; },
      changed: () => this.renderer.invalidate(),
      destroy: bay => {
        for (const prop of bayProps(bay)) if (!prop.broken) destroyProp(this.town, prop, this.particles, [], prop.x - 1, prop.y);
        if (bay.building && bay.asset.fixture) {
          for (const f of bay.building.fixtures) {
            const hit = applyFixtureDamage(bay.building, f, 10000, 1, 0, this.particles, []);
            spawnFixtureFrags(this.town, hit.frags);
          }
        } else for (const building of bayBuildings(bay)) for (const cell of building.cells) applyCellDamage(building, cell, 10000, 1, 0, this.particles, []);
      },
    });
    this.detachInput = this.input.attach();
    this.touch = new TouchControls(hudRoot, {
      change: state => this.input.setTouch(state),
      release: () => this.input.reset(),
      interact: () => { void this.audio.unlock(); },
      restart: () => this.reset('same'),
      resize: () => this.app.resize(),
    });
    this.perf.enabled = new URLSearchParams(window.location.search).get("perf") === "1";
    if (this.perf.enabled) this.ensurePerfOverlay();
    this.renderer.showNhood = new URLSearchParams(window.location.search).get("nhood") === "1";
    this.renderer.debug.perf = this.perf.enabled;
    this.syncDebug();
    this.reset("same");
    (window as unknown as { __pd: Game }).__pd = this;
    this.app.ticker.add((ticker) => {
      this.frame(Math.min(0.05, ticker.deltaMS / 1000));
    });
  }

  snapshot(): {
    cash: number;
    score: number;
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
      score: this.score,
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
    this.rules.towerTest = false;
    this.rules.job = false;
    this.rules.demo = undefined;
    this.rules.kind = kind;
    this.reset("same");
  }

  setDistrict(district: DistrictId): void {
    this.rules.towerTest = false;
    this.rules.job = false;
    this.rules.demo = undefined;
    this.rules.district = district;
    this.rules.seed = DEFAULT_DISTRICT_SEEDS[district];
    this.reset("same");
  }

  reset(kind: "same" | "new" = "same"): void {
    this.towerOverview = true;
    if (this.rules.towerTest) { this.renderer.debug.maxFloor = 99; this.renderer.debug.reveal = false; this.syncDebug(); }
    this.releaseControls();
    this.followRoadCamera = true;
    if (kind === "new") this.rules.seed = nextSeed(this.rules.seed);
    this.town = createTown({ towerTest: this.rules.towerTest, district: this.rules.district, seed: this.rules.seed, showcase: !!this.rules.demo, yard: this.rules.kind === "sandbox" && this.rules.district === "classic" && !this.rules.demo && !this.rules.ranchFocus });
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
    this.yardPanel?.reset();
    this.shake.reset();
    this.renderer.invalidate();
    this.birds = [];
    this.cash = 0;
    this.score = 0;
    this.timeLeft = MATCH_SECONDS;
    this.elapsed = 0;
    this.hint = 1;
    this.mode = "play";
    this.death = null;
    this.upgrades = { blade: 0, engine: 0, push: 0 };
    this.nextUpgrade = 0;
    this.earnedChoice = false;
    this.job = this.rules.job && ranch ? new DemolitionJob(ranch) : undefined;
    this.renderer.jobTarget = this.job?.target;
    this.acc = 0;
    this.grindAud = 0;
    this.scrapeCd = 0;
    this.droppedSimSec = 0;
    this.perf.reset();
    const spawn = cameraFocus(this.dozer.x, this.dozer.y, 0.4, this.renderer.zoom);
    this.renderer.camX = spawn.x;
    this.renderer.camY = spawn.y;
  }

  setDemo(demo: DemoAsset): void {
    this.rules.towerTest = false;
    this.rules.job = false;
    this.rules.demo = demo;
    this.rules.kind = "sandbox";
    this.rules.district = "classic";
    this.rules.ranchFocus = false;
    this.reset("same");
  }

  startJob(): void {
    this.rules = { kind: "challenge", district: "classic", seed: DEFAULT_DISTRICT_SEEDS.classic,
      ranchFocus: false, demo: "rivertown", job: true };
    this.reset("same");
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
    if (this.mode === "upgrade") this.mode = "play";
  }

  private frame(realDt: number): void {
    this.touch?.setBlocked(this.mode !== 'play' || this.renderer.debug.freeze);
    if (this.touch?.menuOpen) this.input.reset();
    const now = performance.now();
    const frameMs = this.perf.markFrameStart(now);
    if (this.input.consume("m") || this.input.consume("M")) {
      void this.audio.unlock();
      this.audio.toggleMute();
    }
    if (this.input.consume("r") || this.input.consume("R")) this.reset("same");
    if (this.input.consume("n") || this.input.consume("N")) this.reset("new");
    if (this.input.consume("v") || this.input.consume("V")) this.spawnRoadVehicle();
    if (this.input.consume("g") || this.input.consume("G")) { this.renderer.showNhood = !this.renderer.showNhood; this.syncDebug(); }
    if (this.input.consume("`")) {
      this.renderer.debug.perf = !this.renderer.debug.perf;
      this.syncDebug();
    }
    if (this.input.consume("1")) this.pickUpgrade("blade");
    if (this.input.consume("2")) this.pickUpgrade("engine");
    if (this.input.consume("3")) this.pickUpgrade("push");
    if (this.input.consume("Escape")) {
      if (this.touch?.enabled && this.mode === 'play') this.touch.toggleMenu();
      else if (this.mode === "play") this.mode = "pause";
      else if (this.mode === "pause") this.mode = "play";
    }
    if (this.input.down.size > 0) void this.audio.unlock();

    let simCpuMs = 0;
    this.touch?.setBlocked(this.mode !== 'play' || this.renderer.debug.freeze);
    if (this.mode === "play" && !this.renderer.debug.freeze && !this.touch?.menuOpen) {
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
    const drive = this.input.axis();
    stepDozer(
      this.dozer,
      {
        throttle: drive.throttle,
        steer: drive.steer,
        blade: this.input.blade(),
        engineMul: 1 + this.upgrades.engine * 0.28,
        bladeMul: 1 + this.upgrades.blade * 0.42,
        pushMul: 1 + this.upgrades.push * 0.35,
      },
      dt,
    );

    const beforeHeat = this.dozer.heat;
    const out = stepWorld(this.town, this.dozer, this.particles, this.upgrades, dt);
    this.lastMetrics = out.metrics;
    this.cash += out.cash;
    this.score += out.score;
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
      this.cash += payout;
      this.audio.cash();
      this.earnedChoice = true;
      this.mode = "upgrade";
      return;
    }
    if (
      sessionForcesUpgrade(this.rules) &&
      this.nextUpgrade < UPGRADE_MILESTONES.length &&
      this.cash >= UPGRADE_MILESTONES[this.nextUpgrade]!
    ) {
      this.nextUpgrade += 1;
      this.earnedChoice = true;
      this.mode = "upgrade";
      return;
    }

    const fail = sessionFailsOn(this.rules);
    if (fail.heat && this.dozer.heat >= 100) this.finish(COPY.engineCooked, false);
    else if (fail.track && this.dozer.track >= 100) this.finish(COPY.trackThrown, false);
    else if (fail.clock && this.timeLeft <= 0) this.finish(COPY.countyClock, this.cash >= CASH_TARGET);
  }

  private finish(death: string, won: boolean): void {
    this.mode = "results";
    this.death = won ? null : death;
    if (won) this.death = null;
  }

  private react(events: WorldEvent[]): void {
    for (const e of events) {
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
    this.town.roadCar = createRoadVehicle(
      this.town.roadSpawnX,
      this.town.roadSpawnY,
      this.town.roadSpawnHeading,
      route,
    );
  }

  obstructionAt(x: number, y: number, radius = 0.7) {
    return obstructionAt(this.town, x, y, radius);
  }

  perfSnapshot() {
    return this.perf.summary();
  }

  private frameNhood(dt: number): void {
    void dt;
    const pad = 10;
    const box = worldBoundsToScreen(
      this.town.minX - pad,
      this.town.minY - pad,
      this.town.maxX - this.town.minX + pad * 2,
      this.town.maxY - this.town.minY + pad * 2,
      0,
      2,
    );
    const spanX = Math.max(1, box.maxX - box.minX);
    const spanY = Math.max(1, box.maxY - box.minY);
    const viewW = this.app.renderer.width;
    const viewH = this.app.renderer.height;
    const zoom = Math.min(0.95, Math.max(0.1, 0.86 * Math.min(viewW / spanX, viewH / spanY)));
    this.renderer.zoom = zoom;
    // layout() scales around the world origin, so the camera offset must include zoom.
    this.renderer.camX = ((box.minX + box.maxX) / 2) * zoom;
    this.renderer.camY = ((box.minY + box.maxY) / 2) * zoom;
  }

  private draw(dt: number): void {
    if (this.input.axis().throttle || this.input.axis().steer || !this.town.yard?.bays.includes(this.yardFocus!)) this.yardFocus = undefined;
    if (this.rules.towerTest && (this.towerOverview || this.town.buildings[0]?.coreCollapse?.phase === 'falling')) {
      const b = this.town.buildings[0]!;
      const box = worldBoundsToScreen(b.x - 7, b.y - 7, b.w * b.cellSize + 14, b.d * b.cellSize + 14, 0, b.floors * 2.35 + 1);
      const zoom = Math.min(1.15, .72 * Math.min(this.app.renderer.width / (box.maxX - box.minX), this.app.renderer.height / (box.maxY - box.minY)));
      this.renderer.zoom = zoom; this.renderer.camX = (box.minX + box.maxX) / 2 * zoom; this.renderer.camY = (box.minY + box.maxY) / 2 * zoom;
    } else if (this.yardFocus) {
      const bay = this.yardFocus, asset = bay.asset;
      const height = Math.max(1, ...bayBuildings(bay).map(b => b.floors * 2.35 + .8));
      const box = worldBoundsToScreen(bay.x + asset.clearance - 2, bay.y + asset.clearance - 2, asset.w + 4, asset.d + 4, 0, height);
      const zoom = Math.min(1.15, .78 * Math.min(this.app.renderer.width / (box.maxX - box.minX), this.app.renderer.height / (box.maxY - box.minY)));
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
    this.renderer.layout(this.app.renderer.width, this.app.renderer.height, shake.x, shake.y);
    this.renderer.draw(this.town, this.dozer, this.particles, this.birds, dt);
    this.yardPanel?.tick(dt);
    this.hud.render({
      pileResistance: this.dozer.pileResistance,
      tower: this.rules.towerTest ? this.town.buildings[0]?.coreCollapse : undefined,
      job: this.job ? { ...this.job.status(), paid: this.job.paid, payout: this.job.payout } : undefined,
      cash: this.cash,
      score: this.score,
      timeLeft: this.timeLeft,
      elapsed: this.elapsed,
      session: this.rules.kind,
      district: this.rules.district,
      bladeDown: this.dozer.bladeDown,
      muted: this.audio.muted,
      heat: this.dozer.heat,
      track: this.dozer.track,
      hintAlpha: 1,
      overlay: this.mode === "play" ? "none" : this.mode,
      death: this.death,
      won: this.mode === "results" && this.cash >= CASH_TARGET && !this.death,
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
