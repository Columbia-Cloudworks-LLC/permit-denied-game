import { drawVehicleAssembly, vehicleRenderGroups } from './modularVehicle';
import { BowlingStrikes } from './bowlingStrikes';
import { CashPopups } from './cashPopups';
import { PileHintLayer } from './pileHints';
import { coreFloorClear, drawCoreFloor } from './coreCollapseDraw';
import { paintsFloorSlab } from '../structure/coreCollapse';
import { cellWorldBox, cellPresent } from '../structure/types';
import { DrawCache } from './drawCache';
import type { YardBay } from '../world/yardCatalog';
import { defaultDebugView } from "../debug/view";
import { drawDebugOverlay } from "./debugOverlay";
import { Container, Graphics, Text } from "pixi.js";
import { emptyGrassGrid, TERRAIN_GEN_VERSION } from "../world/terrain";
import { drawForestGarnish, drawForestMass, planForestGarnish, planForestMasses, type ForestGarnish, type ForestMass } from "./forestCanopy";
import { buildTerrainChunks, chunkCount, ensureTerrainAtlas, terrainAtlasRevision } from "./terrainTiles";
import { DOZER, FLOOR_Z, ISO_Z } from "../game/constants";
import { depthKey, screenAabbVisible, worldBoundsToScreen, worldToScreen } from "../world/iso";
import type { ParticlePool } from "../fx/particles";
import { displacedRoofVerts } from "../structure/roof";
import type { Bird, Building, CoverKind, GroundPatch, Particle, RoofSection, Rubble } from "../structure/types";
import type { Dozer } from "../vehicle/dozer";
import type { Town } from "../world/town";
import { getBuildingSurfaces, releaseBuildingSurfaces, type WallSpan } from "./buildingSurfaces";
import { wallPaintSpans } from "./wallPaint";
import { drawCatalogProp } from "./assets";
import { interiorCmds, roofCommandDepth } from "./interiorDraw";
import { drawGroundPoly, drawIsoBox, drawOrientedGround, drawOrientedIsoBox, drawShadow, drawWorldPoly, PAL } from "./drawIso";
import { presentationTint, SeasonWeather } from "../fx/seasonWeather";
import {
  drawBuildingFootprintShadow,
  drawFallingCell,
  drawWallSpan,
} from "./facadeDraw";
import { drawDozer } from "./vehicles";
import { facadeDetailCommand } from './facadeDetails';
import { elevatedTankCommands } from './elevatedTank';
import { siloCommands } from './silos';
import { clearNhoodOverlay, drawNhoodOverlay } from "./nhoodOverlay";
import { buildingHidesDozer, objectOcclusionFade, pieceHidesDozer, VisibilityFades, wallSpanFadeRuns } from "./occlusion";
import {
  buildingAnimating,
  buildingIsLive,
  buildingLod,
  buildingNeedsDetails,
  buildingNeedsInterior,
  ChunkSplitMemory,
  coalesceStaticChunks,
  debugViewSignature,
  type BuildingLod,
} from "./buildingLod";
import type { RenderFrame } from "./renderFrame";
import { drawCollapsedSite, drawCover, drawGroundMark, drawTerrainFeatures } from "./groundDraw";
import { chimneyWorld, drawChimney, drawRoofBay } from "./roofDraw";
import {
  debrisVersion,
  drawBird,
  drawDebris,
  drawParticle,
  drawParticleSpeck,
  drawWeatherFlake,
  particleBelowSpeck,
  settledParticleVersion,
} from "./effectsDraw";

interface CullBox {
  x: number;
  y: number;
  w: number;
  d: number;
  z0: number;
  z1: number;
}

/** Painter-order batch for airborne particles, weather flakes, and birds. */
const FX_CHUNK = "fx";

interface NearBuildingDraw {
  key: string;
  cmds: Cmd[];
  /** Fade keys the build sampled, kept alive on reuse. */
  fades: string[];
  occluded: boolean;
  visible: number;
}

interface Cmd {
  floor?: number;
  key?: string;
  version?: string | number;
  offsetY?: number;
  mobile?: boolean;
  chunk?: string;
  depth: number;
  run: (g: Graphics) => void;
  cull?: CullBox;
}

export class WorldRenderer {
  readonly root = new Container();
  readonly bowlingStrikes = new BowlingStrikes();
  readonly cashPopups = new CashPopups();
  yardPreview: YardBay[] = [];
  yardPreviewValid = true;
  private yardLabels: Text[] = [];
  private yardLabelKey = "";
  private readonly terrainLayer = new Container();
  private readonly ground = new Graphics();
  private readonly sites = new Graphics();
  private readonly overlay = new Graphics();
  private readonly nhood = new Container();
  private readonly nhoodGfx = new Graphics();
  private readonly world = new Graphics();
  private readonly groundOverlays = new Graphics();
  private readonly drawing = new DrawCache();
  private chunkSplits = new ChunkSplitMemory();
  /** Debris pose versions submitted last frame, to tell resting fragments from moving ones. */
  private debrisPoses = new Map<number, string>();
  private readonly cmds: Cmd[] = [];
  private readonly staticBuildingCmds = new WeakMap<Building, { key: string; cmds: Cmd[] }>();
  /** A near building's last build, reused while the dozer and camera hold still and its fades have landed. */
  private readonly nearBuildingCmds = new WeakMap<Building, NearBuildingDraw>();
  readonly debug = defaultDebugView();
  jobTarget?: Building;
  landmarkTarget?: Building;
  readonly hudOverlay = new Container();
  private readonly landmarkPin = new Graphics();
  private readonly landmarkArrow = new Graphics();
  private readonly fades = new VisibilityFades();
  private readonly debugOverlay = new Graphics();
  get showNhood(): boolean { return this.debug.overview; }
  set showNhood(value: boolean) { this.debug.overview = value; }
  camX = 0;
  camY = 0;
  zoom = 1.15;
  private viewW = 1;
  private viewH = 1;
  private readonly weather = new SeasonWeather();
  private groundKey = "";
  private terrainKey = "";
  private garnishKey = "";
  private garnish: ForestGarnish[] = [];
  private forestMasses: ForestMass[] = [];
  private overlayKey = "";
  private readonly pileHints = new PileHintLayer();
  private siteKey = "";
  stats = {
    total: 0,
    visible: 0,
    commands: 0,
    surfaceGeometry: 0,
    cached: 0,
    rebuilt: 0,
    terrainChunks: 0,
    terrainCells: 0,
    groundRebuilds: 0,
    pileTilesRebuilt: 0,
  };
  dozerHidden = false;

  constructor() {
    this.nhood.addChild(this.nhoodGfx);
    this.root.addChild(this.terrainLayer, this.ground, this.sites, this.overlay, this.pileHints.root, this.groundOverlays, this.drawing.root, this.world, this.nhood, this.debugOverlay);
    this.root.addChild(this.cashPopups.root, this.bowlingStrikes.root, this.landmarkPin);
    this.hudOverlay.addChild(this.landmarkArrow);
    this.root.sortableChildren = false;
  }

  invalidate(): void {
    this.drawing.clear();
    this.groundKey = "";
    this.terrainKey = "";
    this.garnishKey = "";
    this.garnish = [];
    this.forestMasses = [];
    this.overlayKey = "";
    this.pileHints.invalidate();
    this.siteKey = "";
    // Frame-to-frame memory goes too, so a reloaded scene paints exactly as it did fresh.
    this.chunkSplits = new ChunkSplitMemory();
    this.debrisPoses = new Map();
  }

  layout(viewW: number, viewH: number, shakeX: number, shakeY: number): void {
    this.viewW = viewW;
    this.viewH = viewH;
    this.root.position.set(viewW / 2 - this.camX + shakeX, viewH / 2 - this.camY + shakeY);
    this.root.scale.set(this.zoom);
  }

  private visibleBox(x: number, y: number, w: number, d: number, z0: number, z1: number): boolean {
    return screenAabbVisible(
      worldBoundsToScreen(x, y, w, d, z0, z1),
      this.viewW,
      this.viewH,
      this.camX,
      this.camY,
      this.zoom,
    );
  }

  private cmdOnScreen(cmd: Cmd): boolean {
    const box = cmd.cull;
    if (!box) return true;
    return this.visibleBox(box.x, box.y, box.w, box.d, box.z0, box.z1);
  }

  /** Filter cached geometry against the current camera, then keep open-deck painter order. */
  private takeStaticBuildingCmds(built: Cmd[], openDecks: boolean): Cmd[] {
    const shown = built.filter((cmd) => this.cmdOnScreen(cmd));
    if (!openDecks || shown.length === 0) return shown;
    const decks = shown.slice().sort((a, c) => (a.floor ?? -1) - (c.floor ?? -1) || a.depth - c.depth);
    const head = decks[0]!;
    const last = decks[decks.length - 1]!;
    return [{
      key: `chunk:${head.chunk ?? "deck"}:${head.depth}:${last.depth}:${decks.length}`,
      version: head.version,
      chunk: head.chunk,
      depth: Math.max(...decks.map((cmd) => cmd.depth)),
      run: (g) => {
        for (const cmd of decks) cmd.run(g);
      },
    }];
  }

  submittedKeys(): string[] {
    return this.drawing.keys();
  }

  draw(town: Town, dozer: Dozer, particles: ParticlePool, birds: Bird[], dt = 1 / 60, showPlayer = true): void {
    const frame = this.beginDraw(town, dozer, particles, birds, dt, showPlayer);
    this.passYard(frame);
    this.passTerrain(frame);
    this.passGround(frame);
    this.passSites(frame);
    this.passMarks(frame);
    this.passNhood(frame);
    this.passBuildings(frame);
    this.passProps(frame);
    this.passGarnish(frame);
    this.passDynamics(frame);
    this.passEffects(frame);
    this.submitDraw(frame);
  }

  /** Shared draw-frame state: camera caches, counters, and the current debug view. */
  private weatherTown?: Town;

  private beginDraw(town: Town, dozer: Dozer, particles: ParticlePool, birds: Bird[], dt: number, showPlayer: boolean): RenderFrame {
    if (this.weatherTown !== town) { this.weather.reset(""); this.weatherTown = town; }
    const strikeAt = worldToScreen(dozer.x, dozer.y);
    this.bowlingStrikes.draw(dt, strikeAt.x, strikeAt.y, this.zoom);
    this.cashPopups.draw(dt, this.zoom);
    this.root.setChildIndex(this.cashPopups.root, this.root.children.length - 1);
    this.root.setChildIndex(this.bowlingStrikes.root, this.root.children.length - 1);
    this.root.tint = presentationTint(town.weather.light, town.weatherDetail);
    this.fades.begin();
    const view = this.debug;
    this.sites.visible = view.sites;
    this.nhood.visible = view.graph;
    this.world.clear();
    this.groundOverlays.clear();
    this.cmds.length = 0;
    const surface = town.surface ?? emptyGrassGrid(town.minX, town.minY, town.maxX, town.maxY);
    return {
      town, dozer, particles, birds, dt, showPlayer, view,
      total: 0, visible: 0, occluded: false, groundRebuilds: 0, surfaceGeometry: 0,
      hideDressing: view.overview || this.zoom < 0.55,
      viewSig: debugViewSignature(view),
      condition: town.groundCondition,
      surface,
      terrainCounts: chunkCount(surface),
    };
  }

  /** Yard bay labels and placement preview. */
  private passYard(frame: RenderFrame): void {
    const { town } = frame;
    const yardKey = town.yard ? `${town.seed}:${town.yard.bays.map(b => b.key).join(',')}` : '';
    if (yardKey !== this.yardLabelKey) {
      for (const label of this.yardLabels) label.destroy();
      this.yardLabels = [];
      for (const bay of town.yard?.bays ?? []) {
        const label = new Text({ text: `${bay.asset.category} / ${bay.asset.name}`, style: { fontSize: 10, fill: 0xffe7a0, fontFamily: 'monospace' } });
        const p = worldToScreen(bay.x, bay.y); label.position.set(p.x, p.y); this.root.addChild(label); this.yardLabels.push(label);
      }
      this.yardLabelKey = yardKey;
    }
    for (const b of this.yardPreview) drawOrientedGround(this.groundOverlays, b.x + b.w / 2, b.y + b.d / 2, 0, b.w, b.d, this.yardPreviewValid ? 0x55ff99 : 0xff5555, .3, .03);
  }

  /** Terrain atlas chunks and forest garnish plan. */
  private passTerrain(frame: RenderFrame): void {
    const { town, view } = frame;
    void ensureTerrainAtlas();
    const tKey = `${view.terrain}:${TERRAIN_GEN_VERSION}:${frame.surface.cols}x${frame.surface.rows}:${frame.surface.ox}:${frame.surface.oy}:${frame.surface.stampRevision}:${terrainAtlasRevision()}:${frame.condition}:${town.season}`;
    if (tKey !== this.terrainKey) {
      this.terrainLayer.visible = view.terrain;
      if (view.terrain) buildTerrainChunks(this.terrainLayer, frame.surface, undefined, frame.condition, town.season);
      else this.terrainLayer.removeChildren();
      this.terrainKey = tKey;
      frame.groundRebuilds++;
    }
    this.terrainLayer.visible = view.terrain;
    const garnishKey = `${town.season}:${town.seed}:${town.biome.id}:${frame.surface.ox}:${frame.surface.oy}:${frame.surface.cols}x${frame.surface.rows}:${frame.surface.stampRevision}`;
    if (garnishKey !== this.garnishKey) {
      this.garnish = planForestGarnish(frame.surface, town.biome, town.seed, town.season);
      this.forestMasses = planForestMasses(frame.surface, town.biome, town.seed);
      this.garnishKey = garnishKey;
    }
  }

  /** Lot covers, terrain features, and road mesh on the ground layer. */
  private passGround(frame: RenderFrame): void {
    const { town, view } = frame;
    const gKey = groundKey(frame);
    if (gKey === this.groundKey) return;
    this.ground.clear();
    frame.groundRebuilds++;
    if (view.terrain) {
      for (const patch of groundCovers(town)) {
        if (patch.w !== 6.2 && patch.z !== -0.02) drawCover(this.ground, patch, frame.condition, town.season);
      }
      drawTerrainFeatures(this.ground, town.features ?? [], frame.condition, town.season);
    }
    if (view.roads) this.drawRoads(town);
    this.groundKey = gKey;
  }

  private drawRoads(town: Town): void {
    const mesh = town.network.mesh;
    if (!mesh.length) {
      for (const road of town.roads) drawGroundPoly(this.ground, road.x, road.y, road.w, road.d, PAL.asphalt);
      return;
    }
    // RoadMeshQuad x/y are world centers; drawOrientedGround uses the same convention.
    for (const q of mesh) {
      const alpha = q.kind === "mark" ? 0.72 : 1;
      if (q.poly && q.poly.length >= 3) {
        drawWorldPoly(
          this.ground,
          q.poly.map((p) => ({ x: p.x, y: p.y, z: q.z })),
          q.color,
          alpha,
        );
      } else {
        drawOrientedGround(this.ground, q.x, q.y, q.heading, q.w, q.d, q.color, alpha, q.z);
      }
    }
  }

  /** Persistent collapsed-site footprints. */
  private passSites(frame: RenderFrame): void {
    const { town } = frame;
    const sKey = `${town.siteRevision}:${town.collapsedSites.length}`;
    if (sKey !== this.siteKey) {
      this.sites.clear();
      for (const site of town.collapsedSites) drawCollapsedSite(this.sites, site);
      this.siteKey = sKey;
    }
  }

  /** Ground marks and pile hints on the overlay layer. */
  private passMarks(frame: RenderFrame): void {
    const { town, view } = frame;
    const camCell = `${Math.round(this.camX / 28)}:${Math.round(this.camY / 28)}`;
    const oKey = `${view.effects}:${town.visualRevision}:${camCell}:${town.marks.length}:${town.season}`;
    if (oKey !== this.overlayKey) {
      this.overlay.clear();
      for (const mark of view.effects ? town.marks : []) {
        frame.total++;
        if (!this.visibleBox(mark.x - mark.w, mark.y - mark.d, mark.w * 2, mark.d * 2, 0, 0.02)) continue;
        frame.visible++;
        drawGroundMark(this.overlay, mark, town.season);
      }
      this.overlayKey = oKey;
    }
    this.pileHints.update(town, view.debris, (x, y, w, d) => this.visibleBox(x, y, w, d, 0, 3.5));
  }

  /** Neighborhood band overlay. */
  private passNhood(frame: RenderFrame): void {
    const { town } = frame;
    if (frame.view.graph) drawNhoodOverlay(this.nhoodGfx, this.nhood, town);
    else clearNhoodOverlay(this.nhoodGfx, this.nhood);
  }

  /** Building shells, interiors, roofs, and static command cache. */
  private passBuildings(frame: RenderFrame): void {
    for (const b of frame.town.buildings) {
      if (b.retired) releaseBuildingSurfaces(b);
      else this.drawBuilding(frame, b);
    }
  }

  private drawBuilding(frame: RenderFrame, b: Building): void {
    const { dozer, view } = frame;
    const commandStart = this.cmds.length;
    const bw = b.w * b.cellSize;
    const bd = b.d * b.cellSize;
    const z1 = b.floors * FLOOR_Z + (b.elevatedTank ? b.elevatedTank.definition.height + .5 : .8);
    const fall = 1.4;
    frame.total += b.cells.length;
    if (!this.visibleBox(b.x - fall, b.y - fall, bw + fall * 2, bd + fall * 2, -0.4, z1)) return;
    if (buildingHidesDozer(dozer, b)) frame.occluded = true;
    if (b.elevatedTank) {
      this.pushShown(frame, elevatedTankCommands(b, view));
      return;
    }
    if (b.silos) this.pushShown(frame, siloCommands(b, view));
    // The aggregate mound owns the finished visual; a ground slab must not paint over it.
    if (b.coreCollapse?.phase === 'settled') return;
    if (b.coreCollapse?.phase === 'falling') this.pushCoreCollapse(frame, b, bw, bd);
    else this.drawStandingBuilding(frame, b, bw, bd, commandStart);
  }

  private pushShown(frame: RenderFrame, commands: Cmd[]): void {
    frame.visible += commands.length;
    this.cmds.push(...commands);
  }

  private pushCoreCollapse(frame: RenderFrame, b: Building, bw: number, bd: number): void {
    const core = b.coreCollapse!;
    const { drop } = core;
    const burial = Math.min(3.5, frame.town.pile.sample(b.x + bw / 2, b.y + bd / 2).height);
    for (const rect of core.floors) {
      const z = rect.floor * FLOOR_Z - drop;
      if (z + FLOOR_Z <= 0) continue;
      frame.visible++;
      const depth = depthKey(b.x + (rect.x + rect.w / 2) * b.cellSize, b.y + (rect.y + rect.d / 2) * b.cellSize, Math.max(0, z));
      const key = `core:${b.id}:${rect.floor}:${rect.x}:${rect.y}`;
      // Above the pile a shell keeps its standing geometry and slides down the screen;
      // only floors the pile is swallowing repaint each tick.
      this.cmds.push(coreFloorClear(b, rect, burial)
        ? { depth, key, version: 'shell', mobile: true, offsetY: drop * ISO_Z, run: g => drawCoreFloor(g, b, rect, -Infinity, 0) }
        : { depth, key, version: b.visualRevision, mobile: true, run: g => drawCoreFloor(g, b, rect, burial) });
    }
  }

  private drawStandingBuilding(frame: RenderFrame, b: Building, bw: number, bd: number, commandStart: number): void {
    const { town, dozer } = frame;
    const plan = this.planStandingBuilding(frame, b, bw, bd);
    const visBefore = frame.visible;
    const buildKey = `${b.visualRevision}:${frame.viewSig}:${plan.needsInterior ? 1 : 0}:${plan.needsDetails ? 1 : 0}:${town.season}`;
    const cacheKey = plan.live ? "" : buildKey;
    if (cacheKey && this.reuseStaticBuilding(frame, b, cacheKey, visBefore)) return;
    const nearKey = plan.live && !plan.animating ? this.nearBuildingKey(dozer, buildKey) : "";
    if (nearKey && this.reuseNearBuilding(frame, b, nearKey, visBefore)) return;
    const occludedBefore = frame.occluded;
    frame.occluded = false;
    const visit = this.buildingVisit(frame, b, bw, bd, plan);
    this.pushBuildingPieces(visit);
    // Live decks still bake painter order here. Static decks keep per-piece commands
    // so submit-time culling can reveal floors without waiting on a cache rebuild.
    if (b.openDecks && plan.live) this.bakeLiveDecks(commandStart);
    this.stampBuildingCmds(b, commandStart, plan.live
      ? [b.visualRevision, dozer.x.toFixed(2), dozer.y.toFixed(2), visit.fades.values.join(","), frame.viewSig].join(":")
      : [b.visualRevision, frame.viewSig].join(":"));
    const occluded = frame.occluded;
    frame.occluded = occludedBefore || occluded;
    if (nearKey) this.storeNearBuilding(b, nearKey, visit.fades, commandStart, occluded, frame.visible - visBefore);
    if (cacheKey) this.storeStaticBuilding(frame, b, cacheKey, commandStart, visBefore);
  }

  /** Level of detail for one building, plus its ground-layer outline and footprint shadow. */
  private planStandingBuilding(frame: RenderFrame, b: Building, bw: number, bd: number): BuildingPlan {
    const { dozer, view } = frame;
    const near = dozer.x > b.x - 6 && dozer.x < b.x + bw + 6 && dozer.y > b.y - 6 && dozer.y < b.y + bd + 6;
    const lod = buildingLod(near, view.overview, this.zoom);
    const animating = buildingAnimating(b);
    // A damaged shell holding still between revisions stays on the static cache.
    const live = buildingIsLive(lod, animating);
    const plan = { lod, animating, live, needsInterior: buildingNeedsInterior(b, view, lod), needsDetails: buildingNeedsDetails(view, lod) };
    const surfaces = getBuildingSurfaces(b);
    frame.surfaceGeometry += surfaces.geometryCount;
    if (this.jobTarget === b) this.drawJobOutline(b, bw, bd);
    if (view.walls && b.cells.some((c) => c.state !== "gone" && c.state !== "falling")) {
      frame.visible++;
      // Ground layer only: a depth-sorted footprint shadow paints over far gable bays.
      drawBuildingFootprintShadow(this.groundOverlays, surfaces.footprint, 1);
    }
    return plan;
  }

  private buildingVisit(frame: RenderFrame, b: Building, bw: number, bd: number, plan: BuildingPlan): BuildingVisit {
    const { dozer } = frame;
    const { live } = plan;
    const fades = new BuildingFades(this.fades, b.id, frame.dt);
    return {
      ...plan, frame, b, bw, bd, fades,
      fadeBox: (key, x, y, w, d, z, top) => {
        if (!live) return 1;
        const alpha = fades.sample(key, objectOcclusionFade(dozer, x, y, w, d, z, top));
        if (alpha < .6 || pieceHidesDozer(dozer, x, y, w, d, z, top)) frame.occluded = true;
        return alpha;
      },
    };
  }

  /** Every piece of a standing building, in the order the painter sort ties expect. */
  private pushBuildingPieces(visit: BuildingVisit): void {
    const { b, frame: { view } } = visit;
    this.pushCoreSupports(visit);
    this.pushFacadeDetails(visit);
    // Split long facades only when interior slabs can cover them in painter order.
    const walls = wallPaintSpans(b, visit.needsInterior);
    this.pushDeckSlabs(visit);
    this.pushDeckTiles(visit);
    if (view.walls && !b.canopy && !b.openDecks) for (const span of walls) this.pushWallSpan(visit, span);
    if (visit.needsInterior) this.pushInteriors(visit);
    if (view.walls) this.pushFallingCells(visit);
    this.pushRoofs(visit);
  }

  private storeNearBuilding(b: Building, nearKey: string, fades: BuildingFades, commandStart: number, occluded: boolean, visible: number): void {
    if (fades.settled) {
      this.nearBuildingCmds.set(b, { key: nearKey, cmds: this.cmds.slice(commandStart), fades: fades.keys, occluded, visible });
    } else this.nearBuildingCmds.delete(b);
  }

  private drawJobOutline(b: Building, bw: number, bd: number): void {
    const inset = .3;
    for (const [x, y, w, d] of [[b.x - inset, b.y - inset, bw + inset * 2, .07],
      [b.x - inset, b.y + bd + inset, bw + inset * 2, .07],
      [b.x - inset, b.y - inset, .07, bd + inset * 2], [b.x + bw + inset, b.y - inset, .07, bd + inset * 2]]) {
      drawGroundPoly(this.groundOverlays, x!, y!, w!, d!, 0xd5b568, .65);
    }
  }

  private reuseStaticBuilding(frame: RenderFrame, b: Building, cacheKey: string, visBefore: number): boolean {
    const hit = this.staticBuildingCmds.get(b);
    if (!hit || hit.key !== cacheKey) return false;
    const shown = this.takeStaticBuildingCmds(hit.cmds, !!b.openDecks);
    frame.visible = visBefore + shown.length;
    this.cmds.push(...shown);
    return true;
  }

  private storeStaticBuilding(frame: RenderFrame, b: Building, cacheKey: string, commandStart: number, visBefore: number): void {
    const built = this.cmds.slice(commandStart);
    this.staticBuildingCmds.set(b, { key: cacheKey, cmds: built });
    const shown = this.takeStaticBuildingCmds(built, !!b.openDecks);
    this.cmds.length = commandStart;
    this.cmds.push(...shown);
    frame.visible = visBefore + shown.length;
  }

  /**
   * A near building fades around the dozer and culls live against the camera, so its
   * build holds only for one dozer pose and camera, and only once every fade has landed.
   * The camera only culls, so whole pixels are enough while follow easing creeps in.
   */
  private nearBuildingKey(dozer: Dozer, buildKey: string): string {
    return [buildKey, dozer.x.toFixed(2), dozer.y.toFixed(2), dozer.heading.toFixed(2),
      Math.round(this.camX), Math.round(this.camY), this.zoom.toFixed(3), this.viewW, this.viewH].join(":");
  }

  private reuseNearBuilding(frame: RenderFrame, b: Building, nearKey: string, visBefore: number): boolean {
    const hit = this.nearBuildingCmds.get(b);
    if (!hit || hit.key !== nearKey) return false;
    this.fades.keep(hit.fades);
    if (hit.occluded) frame.occluded = true;
    frame.visible = visBefore + hit.visible;
    this.cmds.push(...hit.cmds);
    return true;
  }

  private pushCoreSupports({ frame, b, live }: BuildingVisit): void {
    const { dozer, view } = frame;
    if (!view.walls) return;
    for (const c of b.cells) if (c.coreSupport && cellPresent(c)) {
      const box = cellWorldBox(b, c);
      const alpha = !live || view.reveal || view.maxFloor === 0 ? 1 : objectOcclusionFade(dozer, box.x, box.y, box.w, box.d, 0, FLOOR_Z);
      this.cmds.push({
        depth: depthKey(box.x + .3, box.y + .3, .1),
        cull: { x: box.x, y: box.y, w: box.w, d: box.d, z0: 0, z1: FLOOR_Z },
        run: g => drawIsoBox(g, box.x, box.y, box.w, box.d, 0, FLOOR_Z, 0xb6a784, 0x827754, 0x9c8d68, alpha),
      });
    }
  }

  private pushFacadeDetails({ frame, b, live, needsDetails, fadeBox }: BuildingVisit): void {
    for (const detail of needsDetails ? b.facadeDetails : []) {
      if (detail.floor > frame.view.maxFloor) continue;
      const z0 = detail.floor * FLOOR_Z;
      const detailBox = {
        x: b.x + detail.gx * b.cellSize,
        y: b.y + detail.gy * b.cellSize,
        w: (detail.side === "south" ? detail.width : 1) * b.cellSize,
        d: (detail.side === "east" ? detail.width : 1) * b.cellSize,
        z0,
        z1: z0 + FLOOR_Z,
      };
      if (live && !this.cullBoxVisible(detailBox)) continue;
      const command = facadeDetailCommand(b, detail, fadeBox(`detail:${detail.id}`,
        detailBox.x, detailBox.y, detailBox.w, detailBox.d, detailBox.z0, detailBox.z1));
      if (command) { frame.visible++; this.cmds.push({ ...command, cull: detailBox }); }
    }
  }

  private cullBoxVisible(box: CullBox): boolean {
    return this.visibleBox(box.x, box.y, box.w, box.d, box.z0, box.z1);
  }

  /** Canopy and parking-deck slabs, one per standing cell. */
  private pushDeckSlabs({ frame, b, bw, bd, live }: BuildingVisit): void {
    const { view } = frame;
    if (!(b.canopy || b.openDecks) || !view.walls) return;
    for (const c of b.cells) {
      if (c.state === 'gone' || c.state === 'falling' || c.floor > view.maxFloor) continue;
      const deckBox = { x: b.x, y: b.y, w: bw, d: bd, z0: c.floor * FLOOR_Z, z1: (c.floor + 1) * FLOOR_Z };
      if (live && !this.cullBoxVisible(deckBox)) continue;
      const box = cellWorldBox(b, c);
      this.cmds.push({ floor:c.floor, depth: depthKey(box.x + box.w / 2, box.y + box.d / 2, c.floor * FLOOR_Z),
        cull: deckBox,
        run: g => drawIsoBox(g, box.x, box.y, box.w, box.d, c.floor * FLOOR_Z, FLOOR_Z, 0xb7bab0, 0x697a70, 0x8d9c91) });
    }
  }

  private pushDeckTiles({ frame, b, needsDetails }: BuildingVisit): void {
    const { view } = frame;
    if (!b.openDecks) return;
    for (const tile of b.floorTiles) {
      if (tile.void || tile.state === 'gone' || tile.floor > view.maxFloor || !paintsFloorSlab(tile.floor)) continue;
      const cs=b.cellSize, x=b.x+tile.gx*cs, y=b.y+tile.gy*cs;
      const z=tile.floor*FLOOR_Z*(1-tile.fallT)+.18;
      const tileBox = { x, y, w: cs, d: cs, z0: z, z1: z + .45 };
      // Low barriers belong to their deck tile and descend with it.
      if (view.walls && tile.floor>0) for (const [bx,by,bw,bd] of deckBarriers(b, tile.gx, tile.gy, x, y))
        this.cmds.push({floor:tile.floor,depth:depthKey(bx!+bw!/2,by!+bd!/2,z),cull:tileBox,run:g=>drawIsoBox(g,bx!,by!,bw!,bd!,z,.45*(1-tile.fallT),0xb9b7a8,0x777f75,0x929b8e)});
      // Short end-of-deck parking bays stay clear of the alternating ramp lanes.
      if(needsDetails && tile.gx>=b.w-3 && tile.gx<b.w-1 && [2,5,8].includes(tile.gy))
        this.cmds.push({floor:tile.floor,depth:depthKey(x+cs/2,y+.02,z+.01),cull:tileBox,run:g=>drawIsoBox(g,x,y,cs,.055,z,.012,0xe0dfc7,0xe0dfc7,0xe0dfc7)});
    }
  }

  private pushWallSpan({ frame, b, live, fades }: BuildingVisit, span: WallSpan): void {
    const { dozer, view } = frame;
    if (span.floor > view.maxFloor) return;
    const wallZ = span.floor * FLOOR_Z;
    const wallTop = (span.floor + 1) * FLOOR_Z;
    if (live && !this.cullBoxVisible(wallSpanBox(b, span, wallZ, wallTop))) return;
    const runs = live ? wallSpanFadeRuns(b, span, dozer) : [{ span, fade: 1 }];
    for (const run of runs) {
      const s = run.span;
      const box = wallSpanBox(b, s, wallZ, wallTop);
      const alpha = live
        ? fades.sample(`wall:${s.dir}:${s.floor}:${s.gx0}:${s.gy0}`,
          Math.min(run.fade, objectOcclusionFade(dozer, box.x, box.y, box.w, box.d, wallZ, wallTop)))
        : 1;
      if (live && (alpha < .6 || pieceHidesDozer(dozer, box.x, box.y, box.w, box.d, wallZ, wallTop))) frame.occluded = true;
      frame.visible++;
      this.cmds.push({
        key: `building:${b.id}:wall:${s.dir}:${s.floor}:${s.gx0}:${s.gy0}`,
        depth: run.span.depth,
        cull: box,
        run: (g) => drawWallSpan(g, b, run.span, alpha),
      });
    }
  }

  private pushInteriors({ frame, b, fadeBox }: BuildingVisit): void {
    const { view } = frame;
    const reveal = view.reveal || b.openDecks || b.construction.skin === 'glass' || !view.roofs || !view.walls || view.maxFloor < b.floors - 1;
    const interiors = interiorCmds(b, 1, { fadeBox, reveal, maxFloor: view.maxFloor })
      .filter(c => c.kind === "floor" ? view.floors : c.kind === "fixture" ? view.contents : view.walls);
    this.pushShown(frame, interiors);
  }

  private pushFallingCells({ frame, b }: BuildingVisit): void {
    for (const cell of b.cells) {
      if (cell.floor > frame.view.maxFloor || cell.state !== "falling") continue;
      const cx = b.x + cell.gx * b.cellSize + cell.fallDx * cell.fallT * 0.85;
      const cy = b.y + cell.gy * b.cellSize + cell.fallDy * cell.fallT * 0.85;
      frame.visible++;
      this.cmds.push({
        depth: depthKey(
          b.x + (cell.gx + 0.5) * b.cellSize + cell.fallDx * cell.fallT,
          b.y + (cell.gy + 0.5) * b.cellSize + cell.fallDy * cell.fallT,
          cell.floor * FLOOR_Z,
        ),
        run: (g) => {
          drawShadow(g, cx, cy, b.cellSize, b.cellSize, 0.18);
          drawFallingCell(g, b, cell, 1);
        },
      });
    }
  }

  private pushRoofs(visit: BuildingVisit): void {
    const { frame, b, lod } = visit;
    const { view } = frame;
    const liveRoofs = b.roofs.filter((roof) => roof.state !== "gone" && roof.floor <= view.maxFloor);
    if (!view.roofs || !liveRoofs.length) return;
    frame.total += liveRoofs.length;
    for (const roof of liveRoofs) this.pushRoof(visit, roof);
    if (b.features.chimney && lod !== "overview") this.pushChimney(frame, b);
  }

  private pushRoof({ frame, b, live, fadeBox }: BuildingVisit, roof: RoofSection): void {
    const moved = displacedRoofVerts(roof);
    const xs = moved.map(v => v.x), ys = moved.map(v => v.y), zs = moved.map(v => v.z);
    const rx = Math.min(...xs), ry = Math.min(...ys), rw = Math.max(...xs) - rx, rd = Math.max(...ys) - ry;
    const rz0 = Math.min(...zs), rz1 = Math.max(...zs) + .2;
    if (live && !this.visibleBox(rx, ry, rw, rd, rz0, rz1)) return;
    const alpha = fadeBox(`roof:${roof.id}`, rx, ry, rw, rd, rz0, rz1);
    frame.visible++;
    this.cmds.push({
      key: `building:${b.id}:roof:${roof.id}`,
      depth: roofCommandDepth(b, roof, moved),
      cull: { x: rx, y: ry, w: rw, d: rd, z0: rz0, z1: rz1 },
      run: (g) => drawRoofBay(g, b, roof, alpha, frame.town.season),
    });
  }

  private pushChimney(frame: RenderFrame, b: Building): void {
    const ch = chimneyWorld(b);
    if (!ch) return;
    frame.visible++;
    this.cmds.push({
      depth: depthKey(ch.x, ch.y, ch.z + 0.4),
      cull: { x: ch.x, y: ch.y, w: 0.32, d: 0.32, z0: ch.z, z1: ch.z + 0.85 },
      run: (g) => drawChimney(g, ch, 1),
    });
  }

  private bakeLiveDecks(commandStart: number): void {
    const decks = this.cmds.splice(commandStart).sort((a,c)=>(a.floor??-1)-(c.floor??-1)||a.depth-c.depth);
    if(decks.length) this.cmds.push({depth:Math.max(...decks.map(c=>c.depth)),run:g=>{for(const c of decks)c.run(g);}});
  }

  /**
   * Every piece shares the building version, so adjacent pieces can share one Graphics
   * after the painter sort whether the building is live or cached.
   */
  private stampBuildingCmds(b: Building, commandStart: number, version: string): void {
    const chunk = `b${b.id}`;
    for (let j = commandStart; j < this.cmds.length; j++) {
      const cmd = this.cmds[j]!;
      if (!cmd.key) cmd.key = "building:" + b.id + ":" + (j - commandStart);
      cmd.version = version;
      cmd.chunk = chunk;
    }
  }

  /** Catalog props. */
  private passProps(frame: RenderFrame): void {
    const { town, view } = frame;
    for (const p of view.props && !frame.hideDressing ? town.props : []) {
      if (p.broken) continue;
      frame.total++;
      if (!this.visibleBox(p.x, p.y, p.w, p.d, p.elev, p.elev + 3.2)) continue;
      frame.visible++;
      this.cmds.push({
        key: 'prop:' + p.id,
        version: [town.season, p.x, p.y, p.w, p.d, p.elev, p.heading, p.hp, JSON.stringify(p.pose)].join(':'),
        depth: depthKey(p.x + p.w / 2, p.y + p.d / 2, p.elev + 0.4),
        run: (g) => drawCatalogProp(g, p, town.season),
      });
    }
  }

  /** Forest canopy garnish. */
  private passGarnish(frame: RenderFrame): void {
    const { view } = frame;
    if (!view.terrain) return;
    if (frame.hideDressing) for (const mass of this.forestMasses) this.pushForestMass(frame, mass);
    for (const tree of this.garnish) {
      if (frame.hideDressing && tree.form !== "edge") continue;
      this.pushGarnishTree(frame, tree);
    }
  }

  private pushForestMass(frame: RenderFrame, mass: ForestMass): void {
    frame.total++;
    if (!this.visibleBox(mass.x, mass.y, mass.w, mass.d, 0, 2.2)) return;
    frame.visible++;
    this.cmds.push({
      key: `canopy:${mass.x}:${mass.y}:${mass.w}:${mass.d}`,
      version: `${frame.town.season}:${mass.species}`,
      depth: depthKey(mass.x + mass.w * 0.5, mass.y + mass.d * 0.5, 1.2),
      run: (g) => drawForestMass(g, mass, frame.town.season),
    });
  }

  private pushGarnishTree(frame: RenderFrame, tree: ForestGarnish): void {
    frame.total++;
    if (!this.visibleBox(tree.x - 1.1, tree.y - 1.1, 2.2, 2.2, 0, 3.6)) return;
    frame.visible++;
    const understory = tree.form === "understory";
    const alpha = objectOcclusionFade(frame.dozer, tree.x - 0.75, tree.y - 0.75, 1.5, 1.5, 0, understory ? 0.58 : 2.6);
    this.cmds.push({
      key: `garnish:${tree.seed}`,
      version: `${tree.x}:${tree.y}:${tree.heading}:${tree.species}:${tree.form}:${tree.scale}:${tree.tint}:${tree.phenology}:${alpha.toFixed(2)}`,
      depth: depthKey(tree.x, tree.y, understory ? 0.5 : 1.35),
      run: (g) => drawForestGarnish(g, tree, alpha),
    });
  }

  /** Debris, yard loads, traffic, and the player dozer. */
  private passDynamics(frame: RenderFrame): void {
    const { town, view } = frame;
    const debrisPoses = new Map<number, string>();
    for (const r of view.debris ? town.rubble : []) this.pushDebris(frame, r, debrisPoses);
    this.debrisPoses = debrisPoses;

    for(const load of town.yard?.loads??[]){const v=load.vehicle;this.cmds.push({key:'yard-load:'+v.id,mobile:true,version:[v.x,v.y,v.heading,load.z].join(':'),depth:depthKey(v.x,v.y,load.z)+3000,run:g=>drawOrientedIsoBox(g,v.x,v.y,v.heading,3.5,2.2,load.z,.25,0x9da5a0,0x565d5a,0x7c8580)});}
    for(const v of view.vehicles ? town.vehicles : []) for(const group of vehicleRenderGroups(v)) {
      frame.total++;
      if(!screenAabbVisible(group.bounds,this.viewW,this.viewH,this.camX,this.camY,this.zoom))continue;
      frame.visible++;
      this.cmds.push({key:'vehicle:'+v.id+':'+group.roots.join(','),mobile:true,version:[v.revision,v.x,v.y,v.heading,v.elev,v.pitch,v.roll,v.steer,v.debugParts].join(':'),depth:group.depth,run:g=>drawVehicleAssembly(g,v,group.roots)});
    }
    if (view.vehicles && frame.showPlayer) this.pushPlayer(frame);
  }

  private pushDebris(frame: RenderFrame, r: Rubble, debrisPoses: Map<number, string>): void {
    frame.total++;
    if (!this.visibleBox(r.x - r.w, r.y - r.d, r.w * 2, r.d * 2, r.elev, r.elev + r.thickness + 0.25)) return;
    frame.visible++;
    // A fragment that moved since last frame repaints anyway, so it rides in the
    // airborne fx batch instead of splitting it; at rest it keeps its own geometry.
    const version = debrisVersion(r);
    const moved = this.debrisPoses.get(r.id) !== version;
    debrisPoses.set(r.id, version);
    this.cmds.push({
      ...(moved ? { chunk: FX_CHUNK } : { key: 'debris:' + r.id, version }),
      mobile: true,
      depth: depthKey(r.x, r.y, r.elev + r.thickness * 0.5),
      run: (g) => drawDebris(g, r),
    });
  }

  private pushPlayer(frame: RenderFrame): void {
    const { dozer } = frame;
    frame.total++;
    frame.visible++;
    const emphasis = frame.hideDressing || this.zoom < 0.7;
    this.cmds.push({
      key: "dozer",
      mobile: true,
      version: [dozer.x, dozer.y, dozer.heading, dozer.bladeDown, dozer.odo, Math.round(dozer.pitch * 400), Math.round(dozer.lastImpact * 100), emphasis].join(":"),
      depth: depthKey(dozer.x, dozer.y, 0.4),
      run: (g) => drawDozer(g, dozer, emphasis),
    });
  }

  /** Particles and birds. */
  private passEffects(frame: RenderFrame): void {
    const { particles, birds, view, dozer, town } = frame;
    this.weather.step({
      dt: frame.dt,
      kind: town.weather.kind,
      detail: view.effects ? town.weatherDetail : "off",
      camX: dozer.x,
      camY: dozer.y,
      seed: town.seed,
    });
    for (const flake of this.weather.flakes) {
      this.pushFx(frame, flake.x - 0.2, flake.y - 0.2, 0.4, 0.4, 0, flake.z + 0.2, depthKey(flake.x, flake.y, flake.z), (g) => drawWeatherFlake(g, flake));
    }
    const items = view.effects ? particles.items : [];
    for (let i = 0; i < items.length; i++) if (items[i]!.alive) this.pushParticle(frame, items[i]!, i);
    for (const bird of view.effects ? birds : []) {
      this.pushFx(frame, bird.x - 0.4, bird.y - 0.4, 0.8, 0.8, bird.z, bird.z + 0.2, depthKey(bird.x, bird.y, bird.z), (g) => drawBird(g, bird));
    }
  }

  /** One airborne effect in the shared fx batch, culled against its box. */
  private pushFx(frame: RenderFrame, x: number, y: number, w: number, d: number, z0: number, z1: number, depth: number, run: (g: Graphics) => void): void {
    frame.total++;
    if (!this.visibleBox(x, y, w, d, z0, z1)) return;
    frame.visible++;
    this.cmds.push({ chunk: FX_CHUNK, mobile: true, depth, run });
  }

  /**
   * Airborne effects move every frame, so painter-adjacent runs share one Graphics.
   * Settled chips only fade, and keep their own geometry between alpha steps.
   */
  private pushParticle(frame: RenderFrame, p: Particle, i: number): void {
    const speck = frame.hideDressing;
    frame.total++;
    if (speck && particleBelowSpeck(p)) return;
    if (!this.visibleBox(p.x - 0.3, p.y - 0.3, 0.6, 0.6, 0, p.z + 0.2)) return;
    frame.visible++;
    this.cmds.push({
      ...(p.settled ? { key: `particle:${i}`, version: `${settledParticleVersion(p)}:${speck ? 1 : 0}` } : { chunk: FX_CHUNK }),
      mobile: true,
      depth: depthKey(p.x, p.y, p.z),
      run: speck ? (g) => drawParticleSpeck(g, p) : (g) => drawParticle(g, p),
    });
  }

  /** Depth-sort, submit, occlusion chevron, debug overlay, and stats. */
  private submitDraw(frame: RenderFrame): void {
    const { town, dozer, view } = frame;
    this.cmds.sort((a, b) => a.depth - b.depth);
    this.chunkSplits.next();
    const submitted = coalesceStaticChunks(this.cmds, this.chunkSplits);
    this.drawing.draw(submitted);
    const hidden = frame.occluded && !view.overview;
    this.dozerHidden = hidden;
    if (hidden) {
      const fx = Math.cos(dozer.heading), fy = Math.sin(dozer.heading);
      const point = (along: number, across: number) => {
        const p = worldToScreen(dozer.x + fx * along - fy * across, dozer.y + fy * along + fx * across, .5);
        return [p.x, p.y];
      };
      // Same open chevron and blade edge as before; stroke scales with zoom so street camera keeps it readable.
      const stroke = 6 / Math.max(0.4, this.zoom);
      this.world.poly([...point(-.4, -.4), ...point(.5, 0), ...point(-.4, .4)], false);
      this.world.stroke({ color: 0xffe39a, width: stroke, alpha: .75 });
      this.world.poly([...point(DOZER.bladeReach, -DOZER.bladeHalf), ...point(DOZER.bladeReach, DOZER.bladeHalf)], false);
      this.world.stroke({ color: 0xffe39a, width: stroke, alpha: .75 });
    }
    drawDebugOverlay(this.debugOverlay, town, dozer, view);
    this.drawLandmarkMarkers();
    this.fades.end();
    this.stats = {
      total: frame.total,
      visible: frame.visible,
      commands: submitted.length,
      surfaceGeometry: frame.surfaceGeometry,
      cached: this.drawing.size,
      rebuilt: this.drawing.rebuilt,
      terrainChunks: frame.terrainCounts.chunks,
      terrainCells: frame.terrainCounts.cells,
      groundRebuilds: frame.groundRebuilds,
      pileTilesRebuilt: this.pileHints.rebuilt,
    };
  }

  private drawLandmarkMarkers(): void {
    this.landmarkPin.clear();
    this.landmarkArrow.clear();
    const target = this.landmarkTarget;
    if (!target || target.fullyDown) return;
    const cx = target.x + target.w * target.cellSize * 0.5;
    const cy = target.y + target.d * target.cellSize * 0.5;
    const top = target.floors * FLOOR_Z + 1.2;
    const peak = worldToScreen(cx, cy, top);
    this.landmarkPin.circle(peak.x, peak.y - 10, 7).fill({ color: 0xf0c14b, alpha: 0.95 });
    this.landmarkPin.circle(peak.x, peak.y - 10, 3).fill(0x1b211f);
    this.landmarkPin.moveTo(peak.x, peak.y - 3).lineTo(peak.x - 5, peak.y + 6).lineTo(peak.x + 5, peak.y + 6).fill({ color: 0xf0c14b, alpha: 0.95 });
    const screenX = peak.x * this.zoom - this.camX + this.viewW / 2;
    const screenY = peak.y * this.zoom - this.camY + this.viewH / 2;
    const pad = 36;
    const onScreen = screenX > pad && screenX < this.viewW - pad && screenY > pad && screenY < this.viewH - pad;
    if (onScreen) return;
    const x = Math.max(pad, Math.min(this.viewW - pad, screenX));
    const y = Math.max(pad, Math.min(this.viewH - 140, screenY));
    const angle = Math.atan2(screenY - y, screenX - x);
    this.landmarkArrow.position.set(x, y);
    this.landmarkArrow.rotation = angle;
    this.landmarkArrow.moveTo(12, 0).lineTo(-8, -7).lineTo(-8, 7).fill({ color: 0xf0c14b, alpha: 0.92 });
  }
}

/** Fades one building samples while it builds, for its near-build reuse and its version. */
class BuildingFades {
  readonly keys: string[] = [];
  readonly values: number[] = [];
  settled = true;
  constructor(private readonly fades: VisibilityFades, private readonly id: number, private readonly dt: number) {}

  sample(key: string, target: number): number {
    const fadeKey = `${this.id}:${key}`;
    const alpha = this.fades.sample(fadeKey, target, this.dt);
    this.keys.push(fadeKey);
    if (alpha !== target) this.settled = false;
    this.values.push(Math.round(alpha * 1000));
    return alpha;
  }
}

type FadeBox = (key: string, x: number, y: number, w: number, d: number, z: number, top: number) => number;

interface BuildingPlan {
  lod: BuildingLod;
  animating: boolean;
  live: boolean;
  needsInterior: boolean;
  needsDetails: boolean;
}

/** One standing building's draw state, shared by the piece builders. */
interface BuildingVisit extends BuildingPlan {
  frame: RenderFrame;
  b: Building;
  bw: number;
  bd: number;
  fades: BuildingFades;
  /** Occlusion fade for a piece's box; a live piece that hides the dozer marks the frame occluded. */
  fadeBox: FadeBox;
}

function wallSpanBox(b: Building, s: WallSpan, z0: number, z1: number): CullBox {
  const cs = b.cellSize;
  return {
    x: b.x + (s.dir === "east" ? s.gx0 + 1 : s.gx0) * cs,
    y: b.y + (s.dir === "south" ? s.gy0 + 1 : s.gy0) * cs,
    w: s.dir === "east" ? .08 : (s.gx1 - s.gx0 + 1) * cs,
    d: s.dir === "south" ? .08 : (s.gy1 - s.gy0 + 1) * cs,
    z0,
    z1,
  };
}

/** Low barrier boxes along the outer edges a deck tile sits on. */
function deckBarriers(b: Building, gx: number, gy: number, x: number, y: number): number[][] {
  const cs = b.cellSize;
  return [
    ...(gx === 0 ? [[x, y, .12, cs]] : []), ...(gx === b.w - 1 ? [[x + cs - .12, y, .12, cs]] : []),
    ...(gy === 0 ? [[x, y, cs, .12]] : []), ...(gy === b.d - 1 ? [[x, y + cs - .12, cs, .12]] : []),
  ];
}

function groundKey({ town, view, condition }: RenderFrame): string {
  return `${view.terrain}:${view.roads}:${town.district}:${town.seed}:${town.lots.length}:${town.network.mesh.length}:${town.ground.length}:${town.features?.length ?? 0}:${town.featureRevision ?? 0}:${condition}:${town.season}`;
}

/** Authored ground patches, or a plain lot cover per lot when a town has none. */
function groundCovers(town: Town): GroundPatch[] {
  if (town.ground.length) return town.ground;
  return town.lots.map((lot) => ({
    x: lot.x,
    y: lot.y,
    w: lot.w,
    d: lot.d,
    heading: 0,
    cover: "lot" as CoverKind,
    seed: town.seed,
    z: 0,
  }));
}
