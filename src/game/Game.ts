import { ensureTerms, privacyOpen, termsAccepted, setAnalyticsTestSession, RunAnalytics } from '../privacy/privacy';
import { testMapSearch, type TestMapRequest } from '../world/testMapRequest';
import { boxBounds, vehicleBoxes } from '../vehicle/world';
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
import { advanceSimulation, sweepSubsteps } from "./fixedStep";
import { Application } from "pixi.js";
import { AudioBus } from "../audio/synth";
import { emptyPerfSnapshot, formatPerfOverlay, PerfCollector } from "../debug/perf";
import { CameraShake } from "../fx/cameraShake";
import { ParticlePool } from "../fx/particles";
import { Hud, type CampaignHud, type HudState } from "../render/hud";
import { WorldRenderer } from "../render/WorldRenderer";
import { cashAnchor } from "../render/cashPopups";
import { lastDebrisStats, obstructionAt } from "../sim/debris";
import { stepWorld } from "../sim/worldSim";
import type { Bird, WorldEvent } from "../structure/types";
import { createDozer, dozerForward, dozerSpeed, stepDozer } from "../vehicle/dozer";
import { createRoadVehicle, replaceRoadVehicle } from "../vehicle/roadVehicle";
import { createTraffic, requestPolice, trafficConfigFor } from "../vehicle/traffic";
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
  CELL,
  COPY,
  DOZER,
  MATCH_SECONDS,
  SIM_DT,
  SIM_MAX_STEPS,
  SIM_STEP_BUDGET_MS,
  TITLE,
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
import { SIGNATURE_BONUS, type RegionalPlacement } from "../world/regionalPlacement";
import { loadOverworld, type OverworldModule } from "./overworldLoader";
import type { CountyProgress } from "./countyProgress";
import type { CountyDeployment } from "./session";
import { homeYardRules, type HomeYardLayoutInputs } from "./session";
import { sharedCareer, settleRun, SalvageCombo, STOCK_LOADOUT, type DozerLoadout, type Settlement, type SettlementOutcome } from "./career";
import type { AttachmentRig } from "../vehicle/attachments";
import type { CareerStrip, CareerStripState } from "../render/careerStrip";
import type { HomeHost, HomeYardController } from "./homeController";

type HomeBaseModule = typeof import("./homeBase");
type AttachmentKit = typeof import("./attachmentKit");
/** County 7 of every region is its capitol. */
const CAPITOL_INDEX = 7;

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
  /** Lazily loaded overworld: present once the map opened, a county deployed, or a county link booted. */
  private overworld?: OverworldModule;
  private countyProgress?: CountyProgress;
  private resubmission = new Resubmission();
  private timeLeft = MATCH_SECONDS;
  private elapsed = 0;
  private hint = 1;
  private mode: PlayMode = "play";
  private death: string | null = null;
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
  /** Career: the persistent wallet and Heavy Shop purchases, this run's loadout, and its escrow. */
  private readonly career = sharedCareer();
  private loadout: DozerLoadout = STOCK_LOADOUT;
  /** A replay's recorded loadout, used by the next run reset instead of the live career. */
  private pendingLoadout?: DozerLoadout;
  /** Present only when the loadout carries an attachment and the Skunkworks chunk has loaded. */
  private rig: AttachmentRig | null = null;
  private kit?: AttachmentKit;
  private readonly combo = new SalvageCombo();
  private cashCarry = 0;
  private escrow = 0;
  private runCells = 0;
  private runCountyCleared = false;
  private settled = false;
  /** This run was rebuilt from a recording; it stays non-paying for its whole life. */
  private replayRun = false;
  /** Real play (not the yard, a test map, a demo, the tower test, or the brick job), fixed at run start. */
  private runEligible = false;
  private settlement: Settlement | null = null;
  private bankedUntil = 0;
  /** Step-level presses: attachment slots, and the yard's T range reset. */
  private abilityQueue: ("blade" | "aux" | "range")[] = [];
  private bladeFlash = 0;
  private homeBase?: HomeBaseModule;
  private homeYard?: HomeYardController;
  /** Loaded beside the boot; presentation only, so a frame without it changes nothing. */
  private careerStrip?: CareerStrip;

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
    void import("../render/careerStrip").then(({ CareerStrip }) => {
      this.careerStrip = new CareerStrip(hudRoot);
      this.careerStrip.onBlade = () => this.queueAbility("blade");
      this.careerStrip.onAux = () => this.queueAbility("aux");
    });
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
    // A county link needs the overworld manifest before the first town is built.
    if (this.rules.regionId) (await this.ensureOverworld()).resolveCountyLink(this.rules, window.location.search);
    if (this.rules.home) await this.ensureHomeBase();
    const startLoadout = this.career.loadout();
    if (startLoadout.blade || startLoadout.aux) await this.ensureKit();
    bootOpenedSession({
      rules: this.rules,
      applyCampaign: (run) => {
        const { regionId, countyIndex } = this.rules;
        if (run && regionId && countyIndex) run.county = { regionId, index: countyIndex, weather: this.rules.weather ?? "clear", mapSeed: this.rules.seed };
        if (run?.county) this.rules.weather = run.county.weather;
        this.campaign = run;
      },
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
    this.settleOpenRun("bailout");
    this.rules.home = false;
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
      this.carryCounty(this.campaign);
    }
    this.reset("same");
    this.syncSessionUrl();
  }

  /**
   * A Debug → Mode switch keeps an overworld county a county: the new campaign takes its identity,
   * current weather and map roll, and plays the county's own seed (Sandbox's New Layout may have
   * rerolled it), so a win records the county being played and Next Level stays in the region.
   */
  private carryCounty(campaign: CampaignRun): void {
    const { regionId, countyIndex } = this.rules;
    const county = regionId && countyIndex ? this.overworld?.countyAt(regionId, countyIndex) : undefined;
    if (!regionId || !countyIndex || !county) return;
    const weather = this.rules.weather ?? this.town.weather.condition;
    const mapSeed = this.rules.mapSeed ?? county.seed;
    Object.assign(this.rules, { seed: county.seed, weather, mapSeed });
    campaign.levelSeed = county.seed;
    campaign.county = { regionId, index: countyIndex, weather, mapSeed };
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
    this.settleOpenRun("bailout");
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
    this.resetRun(ranch);
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
      const county = this.campaign.county;
      if (county) {
        this.rules.regionId = county.regionId;
        this.rules.countyIndex = county.index;
        this.rules.weather = county.weather;
        this.rules.level = currentLevel(this.campaign).id;
      }
    }
  }

  /** Generate the town for the current rules and place the dozer; returns the focused ranch, if any. */
  private rebuildTown(): Town["buildings"][number] | undefined {
    const level = generationLevel(this.rules, this.campaign);
    const homeBase = this.homeBase;
    if (this.rules.home && !homeBase) throw new Error("Home Yard built before its chunk loaded");
    if (this.rules.home) this.rules.homeYard ??= this.liveHomeOptions();
    this.town = this.rules.home && homeBase ? createTown({ seed: this.rules.seed, populate: town => homeBase.populateHomeYard(town, this.homeOptions()) }) : createTown({
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
      weather: this.rules.weather,
      regional: this.regionalPlacement(),
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
    this.attachTraffic();
    return ranch;
  }

  /**
   * Regional flavor for an overworld county; legacy level links have none. A county town must
   * never be built without it: the bias and signature tags change the layout, so skipping them
   * would quietly build a different town (and drift any replay). Every path that sets county
   * rules loads the overworld first.
   */
  private regionalPlacement(): RegionalPlacement | undefined {
    if (!this.rules.regionId || !this.rules.countyIndex) return undefined;
    if (!this.overworld) throw new Error(`County ${this.rules.regionId}#${this.rules.countyIndex} built before the overworld loaded`);
    return this.overworld.placementForRules(this.rules);
  }

  private async ensureOverworld(): Promise<OverworldModule> {
    this.overworld ??= await loadOverworld();
    this.countyProgress ??= this.overworld.sharedCountyProgress();
    return this.overworld;
  }

  /**
   * County N always runs level N, so a level jump in an overworld run moves to that level's county
   * in the same region: its index, seed and rolled weather. Progress, Next Level and the pause map
   * then follow the county actually being played. Legacy level runs have no county to move.
   */
  private retargetCounty(id: CampaignLevelId): void {
    const regionId = this.rules.regionId;
    const overworld = this.overworld;
    if (!regionId || !overworld) return;
    const index = CAMPAIGN_LEVELS.findIndex(level => level.id === id) + 1;
    const county = overworld.countyAt(regionId, index);
    if (!county) return;
    const mapSeed = this.campaign?.county?.mapSeed ?? this.rules.mapSeed ?? this.rules.seed;
    const weather = overworld.countyWeather(mapSeed, this.rules.season, regionId, index);
    Object.assign(this.rules, { countyIndex: index, seed: county.seed, weather, mapSeed });
    if (!this.campaign) return;
    this.campaign.levelSeed = county.seed;
    this.campaign.county = { regionId, index, weather, mapSeed };
  }

  /** Start the county the map's detail card deployed, in Sandbox or as a Time Challenge run. */
  private async deployCounty(deploy: CountyDeployment): Promise<void> {
    this.settleOpenRun("bailout");
    const { countyAt, regionById, regionBiome } = await this.ensureOverworld();
    const county = countyAt(deploy.regionId, deploy.countyIndex);
    const region = regionById(deploy.regionId);
    if (!county || !region) return;
    this.rules = gameSetupRules(deploy.kind, "d10", this.rules.seed, county.level.id);
    Object.assign(this.rules, {
      seed: county.seed, season: deploy.season, seasonSelection: deploy.season, seasonExplicit: true,
      weatherDetail: deploy.effects, weather: deploy.weather, mapSeed: deploy.mapSeed,
      regionId: region.id, countyIndex: county.index, biomeId: regionBiome(region),
    });
    this.campaign = null;
    if (deploy.kind === "challenge") {
      const run = startCampaign(county.seed);
      run.levelIndex = county.level.index - 1;
      run.season = deploy.season;
      run.biomeId = regionBiome(region);
      run.county = { regionId: region.id, index: county.index, weather: deploy.weather, mapSeed: deploy.mapSeed };
      this.campaign = run;
    }
    this.reset("same");
    this.syncSessionUrl();
  }

  /** Next Level on an overworld run: the next open county in the region. */
  private advanceCounty(campaign: CampaignRun): CampaignRun {
    const county = campaign.county;
    const overworld = this.overworld;
    if (!county || !overworld || !this.countyProgress) return advanceCampaignLevel(campaign, nextSeed(campaign.levelSeed));
    const nextIndex = this.countyProgress.nextChallengeCounty(county.regionId, county.index);
    const next = nextIndex ? overworld.countyAt(county.regionId, nextIndex) : undefined;
    if (!next) return advanceCampaignLevel(campaign, nextSeed(campaign.levelSeed));
    const weather = overworld.countyWeather(county.mapSeed, campaign.season, county.regionId, next.index);
    return advanceCampaignLevel(campaign, next.seed, { levelIndex: next.level.index - 1, county: { ...county, index: next.index, weather } });
  }

  /** Through traffic on real maps; police dispatch only when the county clock is running. */
  private attachTraffic(): void {
    if (this.rules.testMap || this.rules.towerTest || this.rules.demo || this.rules.job || this.rules.home) return;
    this.town.traffic = createTraffic(this.town, trafficConfigFor(this.town, this.rules.kind === "challenge"));
  }

  /** Cash, clock, job and landmark for a fresh run. */
  private resetRun(ranch: Town["buildings"][number] | undefined): void {
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
    this.loadout = this.pendingLoadout ?? this.career.loadout();
    this.pendingLoadout = undefined;
    this.applyLoadout();
    this.combo.reset();
    this.cashCarry = 0;
    this.escrow = 0;
    this.runCells = 0;
    this.settled = false;
    this.replayRun = false;
    this.runEligible = !this.rules.home && !this.rules.testMap && !this.rules.job && !this.rules.towerTest && !this.rules.demo;
    this.abilityQueue = [];
    this.bladeFlash = 0;
    this.homeYard?.reset();
    const county = campaign?.county;
    this.runCountyCleared = !!county && !!this.countyProgress?.isCleared(county.regionId, county.index);
  }

  /** Put this run's career stats and attachments on the machine. */
  private applyLoadout(): void {
    const loadout = this.loadout;
    this.dozer.bladeWidthMul = loadout.bladeWidthMul;
    this.dozer.resistanceCut = loadout.resistanceCut;
    const armed = !!(loadout.blade || loadout.aux);
    this.rig = armed && this.kit ? this.kit.createRig(loadout) : null;
    // A first attachment bought in the shop loads its chunk; the rig fits on as soon as it lands.
    if (armed && !this.kit) void this.ensureKit().then(kit => { if (this.loadout === loadout) this.rig = kit.createRig(loadout); });
    this.syncLook();
  }

  private async ensureKit(): Promise<AttachmentKit> {
    this.kit ??= await import("./attachmentKit");
    return this.kit;
  }

  private syncLook(): void {
    const aux = this.rig?.aux;
    const tether = aux?.tether;
    this.dozer.look = {
      livery: this.loadout.livery,
      wear: this.rules.home ? this.career.profile.wearLevel : Math.min(1, this.runCells / 600),
      blade: this.rig?.blade?.state,
      aux: aux?.id,
      auxActive: !!aux && (aux.burn > 0 || aux.deployed || !!tether),
      cable: tether ? { x: tether.x, y: tether.y, z: tether.z } : undefined,
      flicker: Math.floor(this.elapsed * 12) % 2 === 0,
    };
  }

  /** A run pays into the career only when it is real play: not the yard, a test map, or a replay. */
  /**
   * Whether this run pays is fixed when it starts. Settlement can run after the next session's
   * rules are already in place (setSession, deployCounty, a replay), so it must never re-read them.
   */
  private runPays(): boolean {
    return this.runEligible && !this.replayRun;
  }

  /** Settle escrow into the wallet once per run, whichever way the run ends. */
  private settleOpenRun(outcome: SettlementOutcome): void {
    if (this.settled || !this.runPays()) return;
    this.settled = true;
    if (this.escrow <= 0 && outcome !== "win") return;
    const challenge = !!this.campaign && showCampaignHud(this.rules, this.campaign);
    const county = this.campaign?.county;
    const settlement = settleRun({
      mode: challenge ? "challenge" : "sandbox",
      outcome,
      escrow: this.escrow,
      timeRemaining: this.timeLeft,
      replay: this.runCountyCleared,
      capitolFirstClear: outcome === "win" && !!county && county.index === CAPITOL_INDEX && !this.runCountyCleared,
    });
    this.settlement = settlement;
    this.bankedUntil = performance.now() + 6000;
    this.career.bank(settlement.payout, this.runCells, Math.min(1, this.runCells / 600));
  }

  /** The yard's layout inputs: the snapshot taken on entry (and recorded with it), else the live career. */
  private homeOptions(): HomeYardLayoutInputs {
    return this.rules.homeYard ?? this.liveHomeOptions();
  }

  private liveHomeOptions(): HomeYardLayoutInputs {
    const profile = this.career.profile;
    return { yardTier: profile.cosmetics.yardTier, countiesCleared: this.countyProgress?.totalCleared() ?? 0, lifetimeEarned: profile.lifetimeEarnedCash };
  }

  private async ensureHomeBase(): Promise<HomeBaseModule> {
    const [module] = await Promise.all([import("./homeBase"), this.ensureOverworld()]);
    this.homeBase = module;
    this.homeYard ??= new module.HomeYardController(this.homeHost());
    return module;
  }

  /** Title, results, or a bailout: bank what the run is owed and roll into the Home Yard. */
  private async goHome(): Promise<void> {
    this.releaseControls();
    this.settleOpenRun("bailout");
    await this.ensureHomeBase();
    this.campaign = null;
    this.rules = homeYardRules(this.rules.seed, this.liveHomeOptions());
    this.reset("same");
    this.syncSessionUrl();
  }

  private queueAbility(slot: "blade" | "aux" | "range"): void {
    if (this.mode === "play" && !this.playthrough.replaying) this.abilityQueue.push(slot);
  }

  /** Ability presses and range resets land at the start of a fixed step, so a recording replays them exactly. */
  private useAbilities(): void {
    for (const slot of this.abilityQueue.splice(0)) {
      if (slot === "range") {
        if (!this.rules.home) continue;
        this.homeYard?.resetRange();
        this.playthrough.noteAction({ kind: "range-reset" });
        continue;
      }
      this.applyAbility(slot);
      this.playthrough.noteAction({ kind: "ability", slot });
    }
  }

  private applyAbility(slot: "blade" | "aux"): void {
    const { rig, kit } = this;
    if (!rig || !kit) return;
    if (slot === "blade") {
      kit.pressBladeAbility(rig, this.dozer.bladeDown);
      return;
    }
    if (kit.pressAuxAbility(rig) === "harpoon-fire") kit.fireHarpoon(this.town, this.dozer, rig);
  }

  /** One-shot attachment cues become sound and HUD flashes. */
  private consumeRigCues(): void {
    for (const cue of this.rig?.cues.splice(0) ?? []) {
      if (cue === "blade-ready") this.audio.permitStamp();
      else if (cue === "blade-armed") this.audio.bladeThud(1.2);
      else if (cue === "blade-rejected") { this.bladeFlash = 0.8; this.audio.trackBind(0.7); }
      else if (cue === "aux-fired") this.audio.impact(0.9);
      else if (cue === "aux-rejected") this.audio.switchClick();
      else if (cue === "harpoon-hit") this.audio.clatter(1, "metal");
      else if (cue === "harpoon-snap") this.audio.breakMat(1);
    }
  }

  private wreckCount(): number {
    let n = 0;
    for (const v of this.town.vehicles) if (v.status === "wreck") n++;
    return n;
  }

  private homeHost(): HomeHost {
    return {
      town: () => this.town,
      dozer: () => this.dozer,
      career: this.career,
      hudRoot: this.hudRoot,
      particles: this.particles,
      options: () => this.homeOptions(),
      // The shop and dispatch change the run outside recorded input: they end a recording, and a
      // replay never opens them.
      interactive: () => !this.playthrough.replaying,
      enterShop: () => {
        this.stopPlaythrough();
        this.dozer.vx = 0;
        this.dozer.vy = 0;
        this.releaseControls();
        this.mode = "shop";
      },
      leaveShop: (exit) => {
        if (exit) this.dozer = createDozer(exit.x, exit.y, exit.heading);
        this.loadout = this.career.loadout();
        this.applyLoadout();
        this.mode = "play";
        this.releaseControls();
        document.querySelector<HTMLCanvasElement>("#game-root canvas")?.focus();
      },
      dispatch: () => {
        this.stopPlaythrough();
        this.dozer.vx = 0;
        this.dozer.vy = 0;
        this.releaseControls();
        this.mode = "pause";
        this.hud.openDispatch();
      },
      sound: (kind) => {
        if (kind === "click") void this.audio.unlock().then(() => this.audio.switchClick());
        else if (kind === "cash") this.audio.cash();
        else this.audio.collapse(0.5);
      },
      invalidate: () => this.renderer.invalidate(),
    };
  }

  private careerStripState(): CareerStripState | null {
    if (this.mode === "title" || this.mode === "shop" || this.rules.testMap || this.rules.job || this.rules.towerTest) return null;
    const rig = this.rig && this.kit ? this.kit.rigReadout(this.rig) : {};
    const s = this.settlement;
    const banked = s && (this.mode === "results" || performance.now() < this.bankedUntil)
      ? { payout: s.payout, label: s.label, wallet: this.career.profile.walletBalance } : undefined;
    if (this.rules.home) return { home: { wallet: this.career.profile.walletBalance, hint: this.homeYard?.hint() ?? "" }, rig, banked, bladeFlash: this.bladeFlash > 0 };
    const window = this.loadout.comboWindow;
    return {
      run: { escrow: this.escrow, multiplier: this.combo.multiplier(this.loadout.salvageMul), comboCells: this.combo.cells, comboFill: window ? this.combo.timer / window : 0 },
      rig, banked, bladeFlash: this.bladeFlash > 0,
    };
  }

  setDemo(demo: DemoAsset): void {
    this.loadTestMap({ kind: 'asset', assetId: 'building:' + demo, variant: 0 });
  }

  loadTestMap(testMap: TestMapRequest): void {
    this.settleOpenRun("bailout");
    this.campaign = null;
    this.rules = rulesForTestMap(this.rules.seed, testMap);
    this.reset('same');
    if (testMap.kind === 'asset' && !this.yardFocus && !this.town.roadCar) this.yardFocus = this.town.yard?.bays[0];
    this.syncSessionUrl();
  }

  private syncSessionUrl(): void {
    if (this.rules.home) {
      const params = new URLSearchParams({ home: "1" });
      carryDebugQuery(new URLSearchParams(location.search), params);
      history.replaceState(null, "", "?" + params);
      return;
    }
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
      if (this.rules.weather) params.set('weather', this.rules.weather);
      if (this.rules.regionId && this.rules.countyIndex) {
        params.set('region', this.rules.regionId);
        params.set('county', String(this.rules.countyIndex));
      }
    }
    const previous = new URLSearchParams(location.search);
    carryDebugQuery(previous, params);
    history.replaceState(null, '', '?' + params);
  }

  startJob(): void {
    this.settleOpenRun("bailout");
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
    if (this.mode === "play") {
      if (this.consumeKey("q")) this.queueAbility("blade");
      if (this.input.consume("Shift")) this.queueAbility("aux");
      if (this.rules.home && this.consumeKey("t")) this.queueAbility("range");
    }
    if (this.input.consume("Escape")) this.escape();
  }

  /** Restart, new layout, road car, neighborhood overview and perf overlay. */
  private handleRunKeys(): void {
    if (this.consumeKey("r")) this.reset("same");
    if (this.consumeKey("n")) this.reset("new");
    if (this.consumeKey("v") && !this.rules.testMap && !this.rules.home) this.spawnRoadVehicle();
    if (this.consumeKey("p") && !this.rules.home) this.spawnPolice();
    if (this.consumeKey("g")) { this.renderer.showNhood = !this.renderer.showNhood; this.syncDebug(); }
    if (this.input.consume("`")) {
      this.renderer.debug.perf = !this.renderer.debug.perf;
      this.syncDebug();
    }
  }

  /** Escape closes the debug binder first, then toggles pause. */
  private escape(): void {
    this.releaseControls();
    if (this.mode === "shop") { this.homeYard?.closeShop(); return; }
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
      () => this.mode === "play", () => this.step(SIM_DT), SIM_STEP_BUDGET_MS);
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
    this.useAbilities();
    const drive = this.playthrough.control({ ...this.input.axis(), blade: this.input.blade() });
    const { rig, kit } = this;
    const aux = rig?.aux;
    const burning = !!kit && aux?.id === "jato_thrusters" && aux.burn > 0;
    const slow = kit && aux?.id === "seismic_ripper" && aux.deployed ? kit.RIPPER_TIERS[aux.tier].slow : 0;
    const driveInput = {
      throttle: drive.throttle,
      steer: drive.steer,
      blade: drive.blade,
      topSpeed: this.loadout.topSpeed * (1 - slow),
      accel: this.loadout.accel,
      turnMul: this.loadout.turnMul,
      boost: burning && aux && kit ? { speed: kit.JATO_TIERS[aux.tier].speed, turn: kit.JATO_TURN } : undefined,
    };

    const beforeHeat = this.dozer.heat;
    const wrecksBefore = this.wreckCount();
    // Anti-tunneling: a step that would carry the hull more than 0.45 of a cell is split, so the
    // blade sweep never skips a thin wall at Drivetrain or rocket speed.
    const pace = Math.max(dozerSpeed(this.dozer), driveInput.boost?.speed ?? 0) + this.loadout.accel * dt;
    const subSteps = sweepSubsteps(pace, dt, CELL);
    const h = dt / subSteps;
    let cash = 0, debrisLoad = 0;
    const events: WorldEvent[] = [], birds: { x: number; y: number }[] = [];
    for (let i = 0; i < subSteps; i++) {
      stepDozer(this.dozer, driveInput, h);
      const out = stepWorld(this.town, this.dozer, this.particles, h, { hitMul: burning && kit ? kit.JATO_HIT_MUL : 1 });
      cash += out.cash;
      debrisLoad = Math.max(debrisLoad, out.debrisLoad);
      for (const e of out.events) events.push(e);
      for (const b of out.birds) birds.push(b);
      this.lastMetrics = out.metrics;
    }
    if (rig && kit) cash += kit.stepAttachmentEffects(this.town, this.dozer, this.particles, events, rig, dt);
    let cells = 0;
    for (const e of events) if (e.kind === "breach") cells++;
    if (rig && kit) kit.stepRig(rig, dt, { cellsDestroyed: cells, vehiclesWrecked: Math.max(0, this.wreckCount() - wrecksBefore) });
    this.combo.hit(cells, this.loadout.comboWindow);
    this.combo.step(dt);
    this.runCells += cells;
    const credited = this.earn(cash);
    this.popCash(credited, events);
    this.react(events);
    this.consumeRigCues();
    this.syncFieldNotice(dt);
    this.stepBirds(birds, dt);
    this.elapsed += dt;
    this.timeLeft -= dt;
    this.hint = Math.max(0, this.hint - dt * 0.12);
    this.scrapeCd = Math.max(0, this.scrapeCd - dt);
    this.groanCd = Math.max(0, this.groanCd - dt);
    this.syncMachineAudio(debrisLoad, beforeHeat, dt);
    this.bladeFlash = Math.max(0, this.bladeFlash - dt);
    this.syncLook();
    if (this.rules.home) {
      this.homeYard?.step();
      return;
    }
    if (this.settleJob()) return;
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

  /**
   * Credit demolition cash to this run's escrow, multiplied live by Salvage Magnetics and the
   * combo chain. Whole dollars only; the fraction carries to the next credit. The yard pays $0.
   */
  private earn(amount: number): number {
    if (!(amount > 0) || this.rules.home) return 0;
    if (this.campaign && (this.campaign.expired || this.campaign.complete)) return 0;
    const total = amount * this.combo.multiplier(this.loadout.salvageMul) + this.cashCarry;
    const credited = Math.floor(total);
    this.cashCarry = total - credited;
    if (credited <= 0) return 0;
    this.escrow += credited;
    if (this.campaign) {
      creditCampaignEarnings(this.campaign, credited);
      this.cash = this.campaign.spendable;
    } else this.cash += credited;
    return credited;
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

  /** The brick job pays once its building is down, and that clears the job. True when it did. */
  private settleJob(): boolean {
    const payout = this.job?.settle() ?? 0;
    if (!payout) return false;
    this.earn(payout);
    this.audio.cash();
    this.finish("", true);
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
    if (outcome === 'win' && campaign.county) this.countyProgress?.markCleared(campaign.county.regionId, campaign.county.index);
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
    if (this.campaign) this.settleOpenRun(won ? "win" : "fail");
    this.analytics.finish(won);
    this.mode = "results";
    this.death = won ? null : death;
    if (won) this.death = null;
  }

  private syncFieldNotice(dt: number): void {
    this.fieldNoticeUntil = Math.max(0, this.fieldNoticeUntil - dt);
    for (const feature of this.town.features) if (feature.kind === "field") this.noticeField(feature as FieldFeature);
    for (const building of this.town.buildings) if (building.regionalSignature) this.noticeSignature(building);
    if (this.fieldNoticeUntil <= 0) this.fieldNotice = "";
  }

  /** Call out a regional signature on its first hit, and its bonus when it comes down. */
  private noticeSignature(building: Town["buildings"][number]): void {
    const label = building.regionalSignature!;
    const bonus = `$${SIGNATURE_BONUS.toLocaleString("en-US")}`;
    if (building.collapseBonusPaid && building.signatureNoticed !== "down") {
      building.signatureNoticed = "down";
      this.fieldNotice = `${label.toUpperCase()} DOWN · SIGNATURE BONUS +${bonus}`;
      this.fieldNoticeUntil = FIELD_CLEARED_SECONDS;
      return;
    }
    if (!building.signatureNoticed && building.cells.some(cell => cell.state !== "intact")) {
      building.signatureNoticed = "hit";
      this.fieldNotice = `REGIONAL SIGNATURE · ${label} · +${bonus} when it falls`;
      this.fieldNoticeUntil = FIELD_NOTICE_SECONDS;
    }
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
    blast: (e) => {
      this.shake.punch(e.mag);
      this.audio.impact(e.mag);
      // Shaped charges carry a collapse-weight boom on top of the impact.
      if (e.mag >= 2) this.audio.collapse(e.mag * 0.55);
    },
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

  /** Sandbox: send one police car in from an edge. */
  spawnPolice(): void {
    if (this.playthrough.replaying || !this.placePolice()) return;
    this.playthrough.noteAction({ kind: "police" });
  }

  private placePolice(): boolean {
    if (this.rules.kind !== "sandbox" || !this.town.traffic) return false;
    requestPolice(this.town.traffic);
    return true;
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
    if (action.kind === "resubmit") this.spendResubmission(action.fee);
    else if (action.kind === "police") this.placePolice();
    else if (action.kind === "ability") this.applyAbility(action.slot);
    else if (action.kind === "range-reset") this.homeYard?.resetRange();
    else this.placeRoadVehicle();
  }

  private spendResubmission(fee: number): void {
    this.resubmission.used = true;
    if (this.campaign) spendCampaignCash(this.campaign, fee);
    this.cash -= fee;
    this.escrow = Math.max(0, this.escrow - fee);
  }

  /** Restart the current site and capture every fixed step from its first frame. */
  startRecording(): void {
    if (this.mode === "title") return;
    this.prepareCleanRun();
    if (this.campaign) {
      this.campaign = { ...retryCampaignLevel(this.campaign), briefing: false };
      this.rules.seed = this.campaign.levelSeed;
    }
    const setup = structuredClone({ rules: this.rules, campaign: this.campaign, loadout: this.career.loadout() });
    this.reset("same");
    this.playthrough.record(setup, buildVersion);
  }

  /** Rebuild a recording's site and drive it from the recorded steps; no live input reaches the dozer. */
  /**
   * A county recording needs the overworld's regional placement to rebuild the recorded town,
   * so it waits for that chunk first. Other recordings start at once, as before.
   */
  startReplay(playthrough: Playthrough): Promise<void> | void {
    // Rebuilding the recorded site may need lazy chunks: the attachment kit for its loadout, the
    // Home Yard for a yard recording, the overworld for a county's regional placement.
    const loads: Promise<unknown>[] = [];
    if ((playthrough.loadout?.blade || playthrough.loadout?.aux) && !this.kit) loads.push(this.ensureKit());
    if (playthrough.rules.home && !this.homeBase) loads.push(this.ensureHomeBase());
    else if (playthrough.rules.regionId && !this.overworld) loads.push(this.ensureOverworld());
    if (!loads.length) return this.beginReplay(playthrough);
    this.playthrough.note = "Loading map data for the replay…";
    return Promise.all(loads).then(
      () => { this.playthrough.note = ""; this.beginReplay(playthrough); },
      (error: unknown) => { this.playthrough.note = `Could not load replay: ${error instanceof Error ? error.message : String(error)}`; },
    );
  }

  private beginReplay(playthrough: Playthrough): void {
    this.settleOpenRun("bailout");
    this.prepareCleanRun();
    const setup = structuredClone({ rules: playthrough.rules, campaign: playthrough.campaign });
    this.rules = setup.rules;
    this.campaign = setup.campaign;
    this.pendingLoadout = playthrough.loadout ?? STOCK_LOADOUT;
    this.reset("same");
    this.syncSessionUrl();
    this.playthrough.replay(playthrough);
    // Replay earnings never reach the wallet, even after playback is stopped mid-run.
    this.replayRun = true;
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
      void this.startReplay(this.playthrough.load(text));
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
    else if (command === "replay" || command === "restart") { if (target) void this.startReplay(target); }
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
    this.retargetCounty(id);
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
    this.retargetCounty(id);
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
    this.careerStrip?.update(this.careerStripState());
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
      overlay: this.mode === "play" || this.mode === "shop" ? "none" : this.mode,
      home: !!this.rules.home,
      death: this.death,
      won: this.mode === "results" && (this.campaign ? this.campaign.complete : this.cash >= CASH_TARGET && !this.death),
      fieldNotice: this.fieldNotice,
      season: this.town.season,
      weatherDetail: this.town.weatherDetail,
      regionId: this.rules.regionId,
      countyIndex: this.rules.countyIndex,
      weather: this.town.weather.condition,
      mapSeed: this.campaign?.county?.mapSeed ?? this.rules.mapSeed ?? this.rules.seed,
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
    const county = campaign.county ? this.overworld?.countyAt(campaign.county.regionId, campaign.county.index) : undefined;
    const briefingCounty = county && campaign.county ? { name: county.name, weather: campaign.county.weather } : undefined;
    const signatures = this.town.buildings.filter(building => building.regionalSignature).map(building => building.regionalSignature!);
    const signatureLine = signatures.length
      ? `\nRegional signatures: ${signatures.join(", ")} (+$${SIGNATURE_BONUS.toLocaleString("en-US")} each).`
      : "";
    return {
      levelIndex: level.index,
      levelName: county?.shortName ?? level.name,
      levelId: level.id,
      landmarkName: level.landmark.label,
      dollarTarget: level.dollarTarget,
      levelEarned: campaign.levelEarned,
      campaignEarned: campaign.campaignEarned,
      landmarkProgress: landmark.progress,
      landmarkReady: landmark.ready,
      dollarsReady: dollarsReady(campaign, level),
      briefing: campaignBriefingText(level, campaign.season, briefingCounty) + signatureLine,
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
    const hasProgress = this.elapsed > 0 || this.cash > 0 || this.campaign !== null || !!this.rules.testMap;
    return !hasProgress || window.confirm(`${action}? This replaces your current run, including its demolition and escrow. You cannot undo this. Cancel to keep playing.`);
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
      onTitle: () => { this.releaseControls(); this.settleOpenRun("bailout"); this.campaign = null; this.mode = "title"; },
      onHomeYard: () => { void this.goHome(); },
      onStart: (deploy) => this.deployCounty(deploy),
      onBeginLevel: () => {
        if (this.campaign) this.campaign.briefing = false;
        if (this.mode === "briefing") this.mode = "play";
      },
      onNextLevel: () => {
        if (!this.campaign || !this.campaign.complete) return;
        this.campaign = this.advanceCounty(this.campaign);
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
        // An overworld run starts its region over from County 1.
        const county = this.campaign?.county;
        if (county && this.campaign && this.overworld) {
          const season = this.campaign.season;
          void this.deployCounty({ kind: "challenge", season, regionId: county.regionId, countyIndex: 1,
            weather: this.overworld.countyWeather(county.mapSeed, season, county.regionId, 1), effects: this.rules.weatherDetail, mapSeed: county.mapSeed });
          return;
        }
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
        if (this.renderer.debug.freeze && this.mode !== "results" && !this.playthrough.exhausted) this.step(SIM_DT);
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
      spawnPolice: () => this.spawnPolice(),
      trafficSnapshot: () => ({
        exits: this.town.traffic?.exits.map(e => ({ x: e.x, y: e.y })) ?? [],
        vehicles: this.town.vehicles.filter(v => v.traffic).map(v => ({
          id: v.id, definitionId: v.definitionId, role: v.traffic!.role, mode: v.traffic!.mode, status: v.status,
          x: v.x, y: v.y, heading: v.heading, speed: Math.hypot(v.vx, v.vy), hits: v.hits ?? 0,
        })),
      }),
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
      home: this.town.home,
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
