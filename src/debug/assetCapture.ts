import { testVehicleImpact, yardVehicleRoute } from '../world/testYard';
import { hitVehicle, partPose } from '../vehicle/runtime';
import { vehicleStats } from '../vehicle/world';
import { VEHICLES } from '../vehicle/definitions';
import { isCoreBearing } from '../structure/coreCollapse';
import { Application } from 'pixi.js';
import { SIM_DT, FLOOR_Z } from '../game/constants';
import { ParticlePool } from '../fx/particles';
import { WorldRenderer } from '../render/WorldRenderer';
import { createTown, type Town } from '../world/town';
import { bayBuildings, bayProps, bayVehicles, discoverYardAssets, instantiateBay, type YardBay } from '../world/yardCatalog';
import { PileField } from '../sim/pile';
import { emptyTerrain, RoadBuilder, linePoints, pt } from '../world/roads';
import { CATALOG_CAPTURE_DOZER } from './catalogCaptureDozer';
import { createDozer, stepDozer } from '../vehicle/dozer';
import { createRoadVehicle } from '../vehicle/roadVehicle';
import { worldBoundsToScreen } from '../world/iso';
import { defaultDebugView, DEBUG_GROUPS, type DebugView } from './view';
import { archetypeById } from '../world/archetypes';
import { getAsset } from '../world/catalog';
import { applyCellDamage } from '../structure/building';
import { facadeDetailPose, facadeDetailSupports, FACADE_DETAIL_KINDS } from '../structure/facadeDetails';
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
  const assets = discoverYardAssets();
  for (const kind of FACADE_DETAIL_KINDS) {
    const host = assets.find(a => a.archetype?.facadeDetails?.some(d => d.kind === kind));
    if (host) assets.push({ ...host, id: `detail:${kind}`, name: `${kind} (${host.name})`, category: 'detail' });
  }
  for (const [id, name, variants] of [['bulldozer', 'Bulldozer', 2], ['road-vehicle', 'Moving road vehicle', 1]] as const) {
    assets.push({ id: `vehicle:${id}`, name, category: 'runtime-vehicle', material: 'metal',
      destruction: 'unsupported', variants, w: 6, d: 4, clearance: 12 });
  }
  let town: Town, bay: YardBay, dozer: ReturnType<typeof createDozer>;
  const particles = new ParticlePool();
  let ticks = 0;
  let camera: ReturnType<typeof worldBoundsToScreen>;

  function snapshot() {
    return { id: bay.asset.id, variant: bay.variant, ticks, seconds: ticks * SIM_DT,
      debug: { ...renderer.debug }, camera: { ...camera, zoom: renderer.zoom },
      buildings: bayBuildings(bay).map(b => ({ id: b.archetypeId, floors: b.floors,
        cells: b.cells.reduce<Record<string, number>>((a, c) => { a[c.state] = (a[c.state] ?? 0) + 1; return a; }, {}),
        fixtures: b.fixtures.length, brokenFixtures: b.fixtures.filter(f => f.broken).length,
        details: b.facadeDetails.map(d => ({ id: d.id, kind: d.kind, pose: facadeDetailPose(b, d) })),
        corePhase: b.coreCollapse?.phase ?? null, elevatedTank: b.elevatedTank ? { ...b.elevatedTank } : null,
        silos:b.silos?.map(s=>({id:s.definition.id,phase:s.phase,progress:s.progress})) ?? [] })),
      props: bayProps(bay).map(p => ({ id: p.assetId, hp: p.hp, broken: p.broken })),
      vehicles: town.vehicles.map(v=>({id:v.definitionId,x:v.x,y:v.y,heading:v.heading,status:v.status,routeStatus:v.routeStatus,owner:v.yardOwner,parts:v.parts.map(p=>({damage:p.damage,detached:p.detached,sleeping:p.sleeping})),poses:v.parts.map((_,i)=>partPose(v,i))})),
      vehicleStats:{...vehicleStats},
      vehicle: bay.asset.category === 'runtime-vehicle' ? { ...(town.roadCar ?? dozer) } : null,
      rubble: town.rubble.length, pileMass: town.pile.mass.reduce((a, b) => a + b, 0) };
  }
  function render(view: Partial<DebugView> = {}) {
    if(bay.vehicle){
      const vehicle=bay.vehicle, radius=Math.max(...vehicle.parts.map((_,i)=>partPose(vehicle,i).length),4)*2;
      // Keep the subject legible when a small detached part travels beyond the shot.
      // The snapshot still records every part, including those outside the camera.
      const poses=vehicle.parts.map((_,i)=>partPose(vehicle,i)).filter(p=>Math.hypot(p.x-vehicle.x,p.y-vehicle.y)<=radius);
      const minX=Math.min(...poses.map(p=>p.x-p.length)),minY=Math.min(...poses.map(p=>p.y-p.width));const maxX=Math.max(...poses.map(p=>p.x+p.length)),maxY=Math.max(...poses.map(p=>p.y+p.width));
      camera=worldBoundsToScreen(minX-2,minY-2,maxX-minX+4,maxY-minY+4,0,4);renderer.zoom=Math.min(3,.88*Math.min(1280/(camera.maxX-camera.minX),960/(camera.maxY-camera.minY)));renderer.camX=(camera.minX+camera.maxX)/2*renderer.zoom;renderer.camY=(camera.minY+camera.maxY)/2*renderer.zoom;
    } else if (bay.asset.category === 'runtime-vehicle') {
      const vehicle = town.roadCar ?? dozer;
      camera = worldBoundsToScreen(vehicle.x - 5, vehicle.y - 4, 10, 8, 0, 3);
      renderer.zoom = Math.min(6, .88 * Math.min(1280 / (camera.maxX - camera.minX), 960 / (camera.maxY - camera.minY)));
      renderer.camX = (camera.minX + camera.maxX) / 2 * renderer.zoom;
      renderer.camY = (camera.minY + camera.maxY) / 2 * renderer.zoom;
    }
    Object.assign(renderer.debug, defaultDebugView(), view);
    // World stepping may clamp the off-scene player back into world bounds.
    // Only explicit runtime-vehicle contexts should draw that simulation helper.
    if (bay.asset.category !== 'runtime-vehicle' && !town.vehicles.length) renderer.debug.vehicles = false;
    renderer.invalidate();
    renderer.layout(1280, 960, 0, 0);
    // Allow visibility fades to converge without advancing simulation.
    renderer.draw(town, dozer, particles, [], 10, bay.asset.id === 'vehicle:bulldozer');
    app.render();
    return snapshot();
  }
  function load(id: string, variant = 0) {
    const asset = assets.find(a => a.id === id);
    if (!asset) throw new Error(`Unknown capture asset ${id}`);
    if (!Number.isInteger(variant) || variant < 0 || variant >= asset.variants) throw new Error('Invalid variant');
    town = createTown({ seed: 4517 });
    const pad = Math.max(12, asset.clearance);
    bay = { key: `capture:${id}`, asset, variant, baseline: false, intactFacade: true, x: 0, y: 0,
      w: asset.w + pad * 2, d: asset.d + pad * 2 };
    // InstantiateBay positions the asset by clearance, so match the reserved origin.
    bay.x = pad - asset.clearance; bay.y = pad - asset.clearance;
    instantiateBay(bay);
    town.buildings = bayBuildings(bay); town.props = bayProps(bay);town.vehicles=bayVehicles(bay);
    if (asset.category === 'detail') for (const b of town.buildings)
      b.facadeDetails = b.facadeDetails.filter(d => `detail:${d.kind}` === asset.id);
    town.rubble = []; town.marks = []; town.collapsedSites = [];
    town.yard = undefined; town.lots = []; town.ground = []; town.roads = [];
    town.network = new RoadBuilder().finish(); town.roadCar = null;
    town.minX = 0; town.minY = 0; town.maxX = asset.w + pad * 2; town.maxY = asset.d + pad * 2;
    town.pile = new PileField(0, 0, town.maxX + 2, town.maxY + 2);
    town.terrain = emptyTerrain(0, 0, town.maxX + 2, town.maxY + 2);
    town.debrisOwnerAt = () => bay.key; town.pile.ownerAt = town.debrisOwnerAt;
    particles.ownerAt = town.debrisOwnerAt; particles.reseed(4517);
    dozer = createDozer(CATALOG_CAPTURE_DOZER.x, CATALOG_CAPTURE_DOZER.y, CATALOG_CAPTURE_DOZER.heading);
    if (id === 'vehicle:bulldozer') {
      dozer = createDozer(pad + 3, pad + 2, 0);
      dozer.bladeDown = variant === 1;
    } else if (id === 'vehicle:road-vehicle') {
      const roads = new RoadBuilder(), a = roads.node(2, pad + 2), b = roads.node(town.maxX - 2, pad + 2);
      roads.segment(a, b, linePoints(pt(a), pt(b)), { roadClass: 'rural', width: 3.2 });
      town.network = roads.finish();
      town.roadCar = createRoadVehicle(pad + 3, pad + 2, 0);town.vehicles.push(town.roadCar);
    }
    ticks = 0; invalidateWorldCollision();
    const height = Math.max(1, ...town.buildings.map(b => b.floors * FLOOR_Z + (b.elevatedTank ? b.elevatedTank.definition.height + .5 : 1.5)), asset.prop?.footprint.h ?? 0);
    camera = worldBoundsToScreen(pad - 3, pad - 3, asset.w + 6, asset.d + 6, 0, height);
    renderer.zoom = Math.min(3, .88 * Math.min(1280 / (camera.maxX - camera.minX), 960 / (camera.maxY - camera.minY)));
    renderer.camX = (camera.minX + camera.maxX) / 2 * renderer.zoom;
    renderer.camY = (camera.minY + camera.maxY) / 2 * renderer.zoom;
    return render();
  }
  function advance(frames: number) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 3600) throw new Error('Expected 0–3600 fixed steps');
    for (let i = 0; i < frames; i++) {
      if (bay.asset.id === 'vehicle:bulldozer') stepDozer(dozer, { throttle: .5, steer: .25,
        blade: bay.variant === 1, engineMul: 1, bladeMul: 1, pushMul: 1 }, SIM_DT);
      stepWorld(town, dozer, particles, { blade: 0, engine: 0, push: 0 }, SIM_DT); ticks++;
    }
    return snapshot();
  }
  function damage(stage: 'crack' | 'breach' | 'supports' | 'all') {
    if (bay.asset.category === 'runtime-vehicle') throw new Error('Runtime vehicles have no production destruction mechanic');
    for(const v of bayVehicles(bay))testVehicleImpact(v,stage==='crack'?'front':'overhead',stage==='all'?120:stage==='crack'?3:20);
    for (const p of bayProps(bay)) if (!p.broken) {
      if (stage === 'crack') applyAssetHit(p, p.maxHp * .3, 1, 0);
      else if (stage !== 'breach' || p === bayProps(bay)[0]) destroyProp(town, p, particles, [], p.x - 1, p.y);
    }
    for (const b of bayBuildings(bay)) {
      if (bay.asset.category === 'detail' && (stage === 'crack' || stage === 'breach')) {
        for (const detail of b.facadeDetails) for (const c of facadeDetailSupports(b, detail))
          applyCellDamage(b, c, stage === 'crack' ?
            (detail.kind === 'display-glazing' ? c.cladding?.maxHp ?? 0 : c.maxHp * .3) : 10000, 0, 1, particles, []);
        continue;
      }
      if (bay.asset.fixture && stage !== 'supports') {
        for (const f of b.fixtures) {
          const result = applyFixtureDamage(b, f, stage === 'crack' ? f.maxHp * .3 : 10000, 1, 0, particles, []);
          spawnFixtureFrags(town, result.frags);
        }
        continue;
      }
      for (const c of b.cells) {
        const target = stage === 'all' || (c.floor === 0 && (stage === 'supports' ? (b.coreCollapse ? isCoreBearing(b, c.gx, c.gy) : true) : c.exterior.south));
        if (target) applyCellDamage(b, c, stage === 'crack' ? c.maxHp * .3 : 10000, 0, -1, particles, []);
      }
    }
    invalidateWorldCollision();
    return snapshot();
  }
  function vehicleScenario(action: 'heading'|'travel'|'front'|'side'|'rear'|'overhead'|'push',value=0) {
    const v=bay.vehicle;if(!v)throw new Error('Select a modular vehicle');
    if(action==='heading'){v.heading=value;v.revision++;}
    else if(action==='travel'){town.maxX=100;town.maxY=100;yardVehicleRoute(v);}
    else if(action==='push')hitVehicle(v,[{x:v.x,y:v.y,z:v.elev+.3,nx:1,ny:0,nz:0,impulse:2,source:'capture-push'}]);
    else testVehicleImpact(v,action,value||8);
    return snapshot();
  }
  function inputs(id: string) {
    const asset = assets.find(a => a.id === id);
    if (!asset) throw new Error(`Unknown capture asset ${id}`);
    return { asset, seed: 4517,
      siteBuildings: asset.site?.buildings.map(b => archetypeById(b.building)),
      siteEquipment: asset.site?.equipment.map(p => getAsset(p.asset)),
      siteVehicles: asset.site?.equipment.flatMap(p => VEHICLES.filter(v => v.id === p.asset)),
      fixtureHost: asset.fixture ? archetypeById('rivertown') : undefined };
  }
  const api = { version: 1, inputs, catalog: assets.map(a => ({ id: a.id, name: a.name, category: a.category, variants: a.variants,
    destruction: a.category === 'runtime-vehicle' ? 'unsupported' : 'supported',
    floors: a.fixture ? (a.fixtureLevels??1)*2 : a.archetype?.floors ?? Math.max(0, ...(a.site?.buildings.map(m => assets.find(v => v.archetype?.id === m.building)?.archetype?.floors ?? 0) ?? [])) })),
    layers: DEBUG_GROUPS[0].options.map(([id]) => id), load, render, advance, damage, snapshot, vehicleScenario };
  Object.assign(window, { __assetCapture: api });
  document.title = 'PERMIT DENIED — Asset capture';
}
