import { testVehicleImpact, yardVehicleRoute } from '../world/testYard';
import { hitVehicle, partPose } from '../vehicle/runtime';
import { vehicleStats } from '../vehicle/world';
import { VEHICLES } from '../vehicle/definitions';
import { isCoreBearing } from '../structure/coreCollapse';
import { Application } from 'pixi.js';
import { SIM_DT } from '../game/constants';
import { ParticlePool } from '../fx/particles';
import { WorldRenderer } from '../render/WorldRenderer';
import { type Town } from '../world/town';
import { bayBuildings, bayProps, bayVehicles, discoverYardAssets, type YardAsset, type YardBay } from '../world/yardCatalog';
import { RoadBuilder, linePoints, pt } from '../world/roads';
import { createIsolateLot, frameIsolateLot } from './isolateLot';
import { createDozer, stepDozer, type Dozer } from '../vehicle/dozer';
import { createRoadVehicle } from '../vehicle/roadVehicle';
import { worldBoundsToScreen, type ScreenAabb } from '../world/iso';
import { defaultDebugView, DEBUG_GROUPS, type DebugView } from './view';
import { archetypeById } from '../world/archetypes';
import { getAsset } from '../world/catalog';
import { applyCellDamage } from '../structure/building';
import { facadeDetailPose, facadeDetailSupports, FACADE_DETAIL_KINDS, type FacadeDetailDef } from '../structure/facadeDetails';
import type { Building, Cell, Prop } from '../structure/types';
import type { VehicleState } from '../vehicle/types';
import { applyFixtureDamage } from '../structure/interior';
import { applyAssetHit, destroyProp } from '../sim/assets';
import { invalidateWorldCollision, spawnFixtureFrags, stepWorld } from '../sim/worldSim';

/** Explicit capture route: isolated production assets, renderer and fixed-step damage.
 * No ticker, input, audio, wall-clock advancement, or screenshot-only geometry. */
export async function bootAssetCapture(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#game-root')!;
  root.style.inset = '0';
  document.querySelector<HTMLElement>('#hud-root')!.style.display = 'none';
  const app = new Application();
  await app.init({ width: 1280, height: 960, resolution: 1, antialias: false, autoStart: false,
    background: 0x30362e, preference: 'webgl', preserveDrawingBuffer: true });
  root.appendChild(app.canvas);
  const renderer = new WorldRenderer();
  app.stage.addChild(renderer.root);
  const session = new AssetCaptureSession(renderer, () => app.render());
  Object.assign(window, { __assetCapture: session.api() });
  document.title = 'PERMIT DENIED — Asset capture';
}

/** The yard catalog plus one entry per facade detail kind and the two runtime vehicles. */
function captureAssets(): YardAsset[] {
  const assets = discoverYardAssets();
  for (const kind of FACADE_DETAIL_KINDS) {
    const host = assets.find(a => a.archetype?.facadeDetails?.some(d => d.kind === kind));
    if (host) assets.push({ ...host, id: `detail:${kind}`, name: `${kind} (${host.name})`, category: 'detail' });
  }
  for (const [id, name, variants] of [['bulldozer', 'Bulldozer', 2], ['road-vehicle', 'Moving road vehicle', 1]] as const) {
    assets.push({ id: `vehicle:${id}`, name, category: 'runtime-vehicle', material: 'metal',
      destruction: 'unsupported', variants, w: 6, d: 4, clearance: 12 });
  }
  return assets;
}

type CaptureStage = 'crack' | 'breach' | 'supports' | 'all';
type VehicleAction = 'heading' | 'travel' | 'front' | 'side' | 'rear' | 'overhead' | 'push';
const VEHICLE_STAGE_LOAD: Record<CaptureStage, number> = { crack: 3, breach: 20, supports: 20, all: 120 };
const VIEW_W = 1280, VIEW_H = 960;

/** One isolated asset on its own lot, drawn and damaged on demand for the capture scripts. */
export class AssetCaptureSession {
  readonly assets = captureAssets();
  private town!: Town;
  private bay!: YardBay;
  private dozer!: Dozer;
  private camera!: ScreenAabb;
  private readonly particles = new ParticlePool();
  private ticks = 0;

  constructor(private readonly renderer: WorldRenderer, private readonly present: () => void) {}

  api() {
    const assets = this.assets;
    return { version: 1, inputs: (id: string) => this.inputs(id), catalog: assets.map(a => ({ id: a.id, name: a.name, category: a.category, variants: a.variants,
      destruction: a.category === 'runtime-vehicle' ? 'unsupported' : 'supported',
      floors: catalogFloors(assets, a) })),
      layers: DEBUG_GROUPS[0].options.map(([id]) => id),
      load: (id: string, variant?: number) => this.load(id, variant),
      render: (view?: Partial<DebugView>) => this.render(view),
      advance: (frames: number) => this.advance(frames),
      damage: (stage: CaptureStage) => this.damage(stage),
      snapshot: () => this.snapshot(),
      vehicleScenario: (action: VehicleAction, value?: number) => this.vehicleScenario(action, value) };
  }

  snapshot() {
    const { bay, town, renderer } = this;
    return { id: bay.asset.id, variant: bay.variant, ticks: this.ticks, seconds: this.ticks * SIM_DT,
      debug: { ...renderer.debug }, camera: { ...this.camera, zoom: renderer.zoom },
      buildings: bayBuildings(bay).map(buildingSnapshot),
      props: bayProps(bay).map(p => ({ id: p.assetId, hp: p.hp, broken: p.broken })),
      vehicles: town.vehicles.map(vehicleSnapshot),
      vehicleStats:{...vehicleStats},
      vehicle: bay.asset.category === 'runtime-vehicle' ? { ...(town.roadCar ?? this.dozer) } : null,
      rubble: town.rubble.length, pileMass: town.pile.mass.reduce((a, b) => a + b, 0) };
  }

  render(view: Partial<DebugView> = {}) {
    const { bay, town, renderer } = this;
    if (bay.vehicle) this.frameVehicle(bay.vehicle);
    else if (bay.asset.category === 'runtime-vehicle') this.frameRuntimeVehicle();
    Object.assign(renderer.debug, defaultDebugView(), view);
    // World stepping may clamp the off-scene player back into world bounds.
    // Only explicit runtime-vehicle contexts should draw that simulation helper.
    if (bay.asset.category !== 'runtime-vehicle' && !town.vehicles.length) renderer.debug.vehicles = false;
    renderer.invalidate();
    renderer.layout(VIEW_W, VIEW_H, 0, 0);
    // Allow visibility fades to converge without advancing simulation.
    renderer.draw(town, this.dozer, this.particles, [], 10, bay.asset.id === 'vehicle:bulldozer');
    this.present();
    return this.snapshot();
  }

  /**
   * Keep the subject legible when a small detached part travels beyond the shot.
   * The snapshot still records every part, including those outside the camera.
   */
  private frameVehicle(vehicle: VehicleState): void {
    const radius=Math.max(...vehicle.parts.map((_,i)=>partPose(vehicle,i).length),4)*2;
    const poses=vehicle.parts.map((_,i)=>partPose(vehicle,i)).filter(p=>Math.hypot(p.x-vehicle.x,p.y-vehicle.y)<=radius);
    const minX=Math.min(...poses.map(p=>p.x-p.length)),minY=Math.min(...poses.map(p=>p.y-p.width));const maxX=Math.max(...poses.map(p=>p.x+p.length)),maxY=Math.max(...poses.map(p=>p.y+p.width));
    this.frameBox(worldBoundsToScreen(minX-2,minY-2,maxX-minX+4,maxY-minY+4,0,4), 3);
  }

  private frameRuntimeVehicle(): void {
    const vehicle = this.town.roadCar ?? this.dozer;
    this.frameBox(worldBoundsToScreen(vehicle.x - 5, vehicle.y - 4, 10, 8, 0, 3), 6);
  }

  private frameBox(camera: ScreenAabb, maxZoom: number): void {
    const renderer = this.renderer;
    this.camera = camera;
    renderer.zoom = Math.min(maxZoom, .88 * Math.min(VIEW_W / (camera.maxX - camera.minX), VIEW_H / (camera.maxY - camera.minY)));
    renderer.camX = (camera.minX + camera.maxX) / 2 * renderer.zoom;
    renderer.camY = (camera.minY + camera.maxY) / 2 * renderer.zoom;
  }

  load(id: string, variant = 0) {
    const asset = this.findAsset(id);
    if (!Number.isInteger(variant) || variant < 0 || variant >= asset.variants) throw new Error('Invalid variant');
    const lot = createIsolateLot(asset, variant);
    this.town = lot.town; this.bay = lot.bay; this.dozer = lot.dozer; this.camera = lot.camera;
    // A detail capture shows only that detail on its host building.
    if (asset.category === 'detail') for (const b of this.town.buildings)
      b.facadeDetails = b.facadeDetails.filter(d => `detail:${d.kind}` === asset.id);
    this.particles.ownerAt = this.town.debrisOwnerAt; this.particles.reseed(4517);
    if (id === 'vehicle:bulldozer') {
      this.dozer = createDozer(lot.pad + 3, lot.pad + 2, 0);
      this.dozer.bladeDown = variant === 1;
    } else if (id === 'vehicle:road-vehicle') this.placeRoadVehicle(lot.pad);
    this.ticks = 0; invalidateWorldCollision();
    frameIsolateLot(this.renderer, this.camera, VIEW_W, VIEW_H);
    return this.render();
  }

  /** A single straight rural road across the lot, with a car on it. */
  private placeRoadVehicle(pad: number): void {
    const town = this.town;
    const roads = new RoadBuilder(), a = roads.node(2, pad + 2), b = roads.node(town.maxX - 2, pad + 2);
    roads.segment(a, b, linePoints(pt(a), pt(b)), { roadClass: 'rural', width: 3.2 });
    town.network = roads.finish();
    town.roadCar = createRoadVehicle(pad + 3, pad + 2, 0);town.vehicles.push(town.roadCar);
  }

  private findAsset(id: string): YardAsset {
    const asset = this.assets.find(a => a.id === id);
    if (!asset) throw new Error(`Unknown capture asset ${id}`);
    return asset;
  }

  advance(frames: number) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 3600) throw new Error('Expected 0–3600 fixed steps');
    const { bay, town, particles } = this;
    for (let i = 0; i < frames; i++) {
      if (bay.asset.id === 'vehicle:bulldozer') stepDozer(this.dozer, { throttle: .5, steer: .25,
        blade: bay.variant === 1, engineMul: 1, bladeMul: 1, pushMul: 1 }, SIM_DT);
      stepWorld(town, this.dozer, particles, { blade: 0, engine: 0, push: 0 }, SIM_DT); this.ticks++;
    }
    return this.snapshot();
  }

  damage(stage: CaptureStage) {
    const bay = this.bay;
    if (bay.asset.category === 'runtime-vehicle') throw new Error('Runtime vehicles have no production destruction mechanic');
    for(const v of bayVehicles(bay))testVehicleImpact(v,stage==='crack'?'front':'overhead',VEHICLE_STAGE_LOAD[stage]);
    for (const p of bayProps(bay)) if (!p.broken) this.damageProp(p, stage);
    for (const b of bayBuildings(bay)) this.damageBuilding(b, stage);
    invalidateWorldCollision();
    return this.snapshot();
  }

  /** A crack scuffs a prop; a breach breaks the first one; heavier stages break them all. */
  private damageProp(p: Prop, stage: CaptureStage): void {
    if (stage === 'crack') applyAssetHit(p, p.maxHp * .3, 1, 0);
    else if (stage !== 'breach' || p === bayProps(this.bay)[0]) destroyProp(this.town, p, this.particles, [], p.x - 1, p.y);
  }

  /** A detail capture damages only the detail's supports; a fixture capture only its fixtures; otherwise the staged cells. */
  private damageBuilding(b: Building, stage: CaptureStage): void {
    const crack = stage === 'crack';
    if (this.bay.asset.category === 'detail' && (crack || stage === 'breach')) this.damageDetails(b, crack);
    else if (this.bay.asset.fixture && stage !== 'supports') this.damageFixtures(b, crack);
    else for (const c of b.cells) {
      if (stageTargetsCell(b, c, stage)) applyCellDamage(b, c, crack ? c.maxHp * .3 : 10000, 0, -1, this.particles, []);
    }
  }

  private damageDetails(b: Building, crack: boolean): void {
    for (const detail of b.facadeDetails) for (const c of facadeDetailSupports(b, detail))
      applyCellDamage(b, c, crack ? detailCrackDamage(detail, c) : 10000, 0, 1, this.particles, []);
  }

  private damageFixtures(b: Building, crack: boolean): void {
    for (const f of b.fixtures) {
      const result = applyFixtureDamage(b, f, crack ? f.maxHp * .3 : 10000, 1, 0, this.particles, []);
      spawnFixtureFrags(this.town, result.frags);
    }
  }

  vehicleScenario(action: VehicleAction, value=0) {
    const v=this.bay.vehicle;if(!v)throw new Error('Select a modular vehicle');
    if(action==='heading'){v.heading=value;v.revision++;}
    else if(action==='travel'){this.town.maxX=100;this.town.maxY=100;yardVehicleRoute(v);}
    else if(action==='push')hitVehicle(v,[{x:v.x,y:v.y,z:v.elev+.3,nx:1,ny:0,nz:0,impulse:2,source:'capture-push'}]);
    else testVehicleImpact(v,action,value||8);
    return this.snapshot();
  }

  inputs(id: string) {
    const asset = this.findAsset(id);
    return { asset, seed: 4517,
      siteBuildings: asset.site?.buildings.map(b => archetypeById(b.building)),
      siteEquipment: asset.site?.equipment.map(p => getAsset(p.asset)),
      siteVehicles: asset.site?.equipment.flatMap(p => VEHICLES.filter(v => v.id === p.asset)),
      fixtureHost: asset.fixture ? archetypeById('rivertown') : undefined };
  }
}

/** Floors to capture: a fixture's stacked levels, a building's floors, or a site's tallest member. */
function catalogFloors(assets: readonly YardAsset[], a: YardAsset): number {
  if (a.fixture) return (a.fixtureLevels??1)*2;
  return a.archetype?.floors ?? Math.max(0, ...(a.site?.buildings.map(m => assets.find(v => v.archetype?.id === m.building)?.archetype?.floors ?? 0) ?? []));
}

/** Storefront glazing cracks through its panes; other details take a third of their support's strength. */
function detailCrackDamage(detail: FacadeDetailDef, c: Cell): number {
  return detail.kind === 'display-glazing' ? c.cladding?.maxHp ?? 0 : c.maxHp * .3;
}

/** `all` hits every cell; other stages hit the ground floor: its supports (core bearing for a core tower) or its south face. */
function stageTargetsCell(b: Building, c: Cell, stage: CaptureStage): boolean {
  if (stage === 'all') return true;
  if (c.floor !== 0) return false;
  if (stage !== 'supports') return c.exterior.south;
  return b.coreCollapse ? isCoreBearing(b, c.gx, c.gy) : true;
}

function buildingSnapshot(b: Building) {
  return { id: b.archetypeId, floors: b.floors,
    cells: b.cells.reduce<Record<string, number>>((a, c) => { a[c.state] = (a[c.state] ?? 0) + 1; return a; }, {}),
    fixtures: b.fixtures.length, brokenFixtures: b.fixtures.filter(f => f.broken).length,
    details: b.facadeDetails.map(d => ({ id: d.id, kind: d.kind, pose: facadeDetailPose(b, d) })),
    corePhase: b.coreCollapse?.phase ?? null, elevatedTank: b.elevatedTank ? { ...b.elevatedTank } : null,
    silos:b.silos?.map(s=>({id:s.definition.id,phase:s.phase,progress:s.progress})) ?? [] };
}

function vehicleSnapshot(v: VehicleState) {
  return {id:v.definitionId,x:v.x,y:v.y,heading:v.heading,status:v.status,routeStatus:v.routeStatus,owner:v.yardOwner,parts:v.parts.map(p=>({damage:p.damage,detached:p.detached,sleeping:p.sleeping})),poses:v.parts.map((_,i)=>partPose(v,i))};
}
