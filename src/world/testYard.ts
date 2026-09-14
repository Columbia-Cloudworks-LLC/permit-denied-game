import { vehicleBoxes, boxBounds } from '../vehicle/world';
import { runVehicle, parkVehicle, hitVehicle, partPose } from '../vehicle/runtime';
import type { VehicleState } from '../vehicle/types';
import { PileField } from '../sim/pile';
import { rubbleAabb } from '../sim/debris';
import { invalidateWorldCollision } from '../sim/worldSim';
import type { ParticlePool } from '../fx/particles';
import { createRoadVehicle, replaceRoadVehicle } from '../vehicle/roadVehicle';
import { emptyTerrain, RoadBuilder, linePoints, pt } from './roads';
import { bayBuildings, bayProps, bayVehicles, discoverYardAssets, yardAssetIssue, yardGridSlots, instantiateBay, layoutYard, overlap, type YardAsset, type YardBay, type YardBox } from './yardCatalog';
import type { Town } from './town';
import type { TestMapRequest } from './testMapRequest';

export interface TestYard { request: TestMapRequest; assets: YardAsset[]; bays: YardBay[]; sequence: number; baselineEnd: number; issues: string[]; loads?: {vehicle:VehicleState;z:number;vz:number}[] }
export function populateTestYard(town: Town, request: TestMapRequest = { kind: 'yard' }): Town {
  if (request.kind === 'asset') return populateFocusedTest(town, request);
  const assets = discoverYardAssets(), bays = layoutYard(assets);
  const maxX = Math.max(...bays.map(b => b.x + b.w)) + 12;
  const baselineEnd = Math.max(...bays.map(b => b.y + b.d)) + 10;
  const maxY = baselineEnd + 280;
  town.vehicles = []; town.roadCar=null; town.buildings = []; town.props = []; town.lots = []; town.ground = [];
  town.minX = 0; town.minY = 0; town.maxX = maxX; town.maxY = maxY;
  town.pile = new PileField(0, 0, maxX + 2, maxY + 2);
  town.terrain = emptyTerrain(0, 0, maxX + 2, maxY + 2);
  town.yard = { request, assets, bays, sequence: 0, baselineEnd, issues: assets.map(yardAssetIssue).filter((i): i is string => !!i) };
  town.debrisOwnerAt = (x, y) => ownerAt(town, x, y);
  town.pile.ownerAt = town.debrisOwnerAt;
  for (const bay of bays) {
    try { addBay(town, bay); } catch (error) { town.yard.issues.push(`${bay.asset.id}: ${String(error)}`); }
    town.ground.push({ x: bay.x, y: bay.y, w: bay.w, d: bay.d, heading: 0, cover: 'gravel', seed: town.seed, z: .01 });
    if(bay.vehicle){const v=bay.vehicle,cx=v.x,cy=v.y+7;
      for(let i=0;i<24;i++){const a=i*Math.PI/12,b=(i+1)*Math.PI/12,x=cx+Math.cos(a)*7,y=cy+Math.sin(a)*7,ex=cx+Math.cos(b)*7,ey=cy+Math.sin(b)*7;
        town.ground.push({x:(x+ex)/2-1.1,y:(y+ey)/2-1.1,w:2.2,d:2.2,heading:0,cover:'parking',seed:town.seed,z:.02});}
    }
  }
  const roads = new RoadBuilder(), a = roads.node(2, 4), b = roads.node(maxX - 2, 4);
  roads.segment(a, b, linePoints(pt(a), pt(b)), { roadClass: 'rural', width: 3.2 });
  town.network = roads.finish(); town.roads = [{ x: 2, y: 2.4, w: maxX - 4, d: 3.2 }];
  town.roadSpawnX = 5; town.roadSpawnY = 4; town.roadSpawnHeading = 0;
  town.spawnX = bays[0]!.x + bays[0]!.w / 2; town.spawnY = bays[0]!.y - 2; town.spawnHeading = Math.PI / 2;
  return town;
}

function populateFocusedTest(town: Town, request: Extract<TestMapRequest, { kind: 'asset' }>): Town {
  const assets = discoverYardAssets(), asset = assets.find(a => a.id === request.assetId);
  town.yard = { request, assets, bays: [], sequence: 0, baselineEnd: 0, issues: [] };
  const issue = !asset ? `Unknown asset: ${request.assetId || '(empty ID)'}. Select an asset in the catalog and choose Test This Asset.`
    : yardAssetIssue(asset) ?? (!Number.isInteger(request.variant) || request.variant < 0 || request.variant >= asset.variants
      ? `Invalid variant for ${asset.name}. Choose 0–${asset.variants - 1} in the catalog and launch again.` : undefined);
  if (issue) town.yard.issues.push(issue);
  let maxX = 32, maxY = 32;
  if (asset && !issue) {
    // Include the complete rotational envelope, including articulated attachments.
    const reach = asset.vehicle ? Math.max(...asset.vehicle.parts.map(p => Math.hypot(p.x, p.y) + Math.hypot(p.length, p.width) / 2)) : 0;
    const margin = Math.max(12, asset.clearance, reach + 14);
    const focusedAsset = { ...asset, clearance: margin };
    const bay: YardBay = { key: `baseline:${asset.id}`, asset: focusedAsset, variant: request.variant, baseline: true, focused: true,
      x: 0, y: 0, w: asset.w + margin * 2, d: asset.d + margin * 2 };
    addBay(town, bay); town.yard.bays.push(bay);
    maxX = bay.w; maxY = bay.d;
    town.spawnX = margin + asset.w / 2; town.spawnY = margin + asset.d + 5;
    if (bay.vehicle) {
      // Approach from outside the near edge of the loop, keeping the subject
      // close enough to see while the parked dozer leaves the route clear.
      town.spawnY = bay.vehicle.y - reach - 4; town.spawnHeading = Math.PI / 2;
    }
  }
  town.maxX = maxX; town.maxY = maxY;
  town.yard.baselineEnd = maxY;
  town.pile = new PileField(0, 0, maxX + 2, maxY + 2);
  town.terrain = emptyTerrain(0, 0, maxX + 2, maxY + 2);
  town.ground = [{ x: 0, y: 0, w: maxX, d: maxY, heading: 0, cover: 'concrete', seed: town.seed, z: 0 }];
  town.debrisOwnerAt = () => town.yard?.bays[0]?.key;
  town.pile.ownerAt = town.debrisOwnerAt;
  return town;
}
function addBay(town: Town, bay: YardBay): void {
  instantiateBay(bay);
  town.buildings.push(...bayBuildings(bay));
  town.props.push(...bayProps(bay));
  for(const v of bayVehicles(bay)){v.yardOwner=bay.key;town.vehicles.push(v);}
}
export function ownerAt(town: Town, x: number, y: number): string | undefined {
  const moving = town.yard?.bays.find(b => bayProps(b).some(p => x >= p.x - .2 && x <= p.x + p.w + .2 && y >= p.y - .2 && y <= p.y + p.d + .2));
  if (moving) return moving.key;
  return town.yard?.bays.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.d)?.key;
}
export function planBatch(assets: YardAsset[], quantity: number, variants: boolean, x: number, y: number, variant = 0): YardBay[] {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('Quantity must be 1–100.');
  const out: YardBay[] = []; let cx = x, cy = y, row = 0;
  const slots = assets.reduce((n, a) => n + yardGridSlots(a) * quantity * (variants ? a.variants : 1), 0);
  if (slots > 32768) throw new Error('Batch exceeds 32768 building grid slots; place fewer large structures.');
  for (const asset of assets) for (let v = 0; v < (variants ? asset.variants : 1); v++) for (let n = 0; n < quantity; n++) {
    if (out.length >= 500) throw new Error('Limit each placement to 500 instances.');
    const issue = yardAssetIssue(asset); if (issue) throw new Error(issue);
    const w = asset.w + asset.clearance * 2, d = asset.d + asset.clearance * 2;
    if (cx > x && cx + w > x + 100) { cx = x; cy += row + 4; row = 0; }
    out.push({ asset, variant: variants ? v : variant, key: '', baseline: false, x: cx, y: cy, w, d });
    cx += w + 4; row = Math.max(row, d);
  }
  return out;
}
export function placementError(town: Town, plan: YardBay[], dozer?: { x: number; y: number }): string | undefined {
  if (!plan.length) return 'No matching assets.';
  if (town.buildings.reduce((n, b) => n + b.w * b.d * b.floors, 0) + plan.reduce((n, b) => n + yardGridSlots(b.asset), 0) > 65536) return 'Yard exceeds 65536 building grid slots; remove some structures first.';
  for (const [index, b] of plan.entries()) {
    const issue = yardAssetIssue(b.asset); if (issue) return issue;
    if (plan.slice(index + 1).some(other => overlap(b, other))) return "Batch bays overlap each other.";
    if (![b.x, b.y, b.w, b.d].every(Number.isFinite)) return 'Coordinates must be finite numbers.';
    if (b.x < 0 || b.y < 8 || b.x + b.w > town.maxX || b.y + b.d > 3200) return 'Outside yard bounds; use the experiment area or a smaller batch.';
    if (town.yard?.bays.some(other => overlap(b, other))) return 'Overlaps a reserved test bay. Move into an empty area.';
    if (dozer && overlap(b, { x: dozer.x - 1.5, y: dozer.y - 1.5, w: 3, d: 3 })) return 'Move the dozer out of the placement area.';
    if(town.vehicles.some(v=>vehicleBoxes(v).some(q=>overlap(b,boxBounds(q))))) return 'Vehicle or wreck obstructs this area.';
    if (town.props.some(p => !p.broken && overlap(b, p))) return 'An asset has moved into this area.';
    const pile = town.pile;
    for (let y = Math.max(0, Math.floor((b.y - pile.oy) / pile.cell)); y < Math.min(pile.rows, Math.ceil((b.y + b.d - pile.oy) / pile.cell)); y++) {
      for (let x = Math.max(0, Math.floor((b.x - pile.ox) / pile.cell)); x < Math.min(pile.cols, Math.ceil((b.x + b.w - pile.ox) / pile.cell)); x++) {
        if (pile.mass[y * pile.cols + x]! > 1e-5) return 'Pile material obstructs this area. Clear it first.';
      }
    }
    if (town.rubble.some(r => overlap(b, rubbleAabb(r)))) return 'Debris obstructs this area. Clear it first.';
    if (b.variant < 0 || b.variant >= b.asset.variants || !Number.isInteger(b.variant)) return 'Variant is out of range.';
  }
  return undefined;
}
export function spawnBatch(town: Town, plan: YardBay[], dozer?: { x: number; y: number }): void {
  const error = placementError(town, plan, dozer); if (error) throw new Error(error);
  const yard = town.yard!;
  // Construct the entire batch before changing the live world. A bad source
  // definition must not leave a partially placed batch or stale collision index.
  for (const bay of plan) instantiateBay(bay);
  const maxY = Math.max(town.maxY, ...plan.map(b => b.y + b.d + 10));
  if (maxY > town.maxY) {
    town.pile = town.pile.grow(town.maxX + 2, maxY + 2);
    town.terrain = emptyTerrain(0, 0, town.maxX + 2, maxY + 2);
    town.maxY = maxY;
  }
  for (const bay of plan) {
    bay.key = `user:${++yard.sequence}`;
    town.props.push(...bayProps(bay));
  for(const v of bayVehicles(bay)){v.yardOwner=bay.key;town.vehicles.push(v);}
    town.buildings.push(...bayBuildings(bay));
    yard.bays.push(bay);
  }
  changed(town);
}
function inside(area: YardBox, p: { x: number; y: number }): boolean { return p.x >= area.x && p.x <= area.x + area.w && p.y >= area.y && p.y <= area.y + area.d; }
export function clearTestArea(town: Town, bay: YardBay, particles?: ParticlePool): void {
  town.rubble = town.rubble.filter(r => !inside(bay, r));
  town.marks = town.marks.filter(m => !inside(bay, m));
  town.pile.clearArea(bay.x, bay.y, bay.w, bay.d);
  if (particles) for (const p of particles.items) if (inside(bay, p)) p.alive = false;
  changed(town);
}
export function clearBayDebris(town: Town, bay: YardBay, particles?: ParticlePool): void {
  town.rubble = town.rubble.filter(r => r.yardOwner !== bay.key && !(r.yardOwner === undefined && inside(bay, r)));
  town.marks = town.marks.filter(r => r.yardOwner !== bay.key && !(r.yardOwner === undefined && inside(bay, r)));
  town.pile.removeOwner(bay.key);
  if (particles) for (const p of particles.items) if (p.yardOwner === bay.key || (!p.yardOwner && inside(bay, p))) p.alive = false;
  changed(town);
}
export function removeBay(town: Town, bay: YardBay, particles?: ParticlePool): void {
  clearBayDebris(town, bay, particles);
  const buildings = new Set(bayBuildings(bay)), props = new Set(bayProps(bay));
  if(town.yard?.loads)town.yard.loads=town.yard.loads.filter(l=>!bayVehicles(bay).includes(l.vehicle));
  const vehicles=new Set(bayVehicles(bay));town.vehicles=town.vehicles.filter(v=>!vehicles.has(v));if(town.roadCar&&vehicles.has(town.roadCar))town.roadCar=null;
  town.props = town.props.filter(p => !props.has(p));
  town.buildings = town.buildings.filter(b => !buildings.has(b));
  const ids = new Set([...buildings].map(b => b.id));
  town.collapsedSites = town.collapsedSites.filter(s => !ids.has(s.buildingId));
  town.yard!.bays = town.yard!.bays.filter(b => b !== bay);
  changed(town);
}
export function restoreBay(town: Town, bay: YardBay, particles?: ParticlePool): void {
  const following = !!bay.vehicle && town.roadCar === bay.vehicle;
  const replacement = { ...bay, prop: undefined, vehicle:undefined, building: undefined, site: undefined };
  instantiateBay(replacement);
  removeBay(town, bay, particles);
  bay.vehicle=replacement.vehicle;
  bay.prop = replacement.prop; bay.building = replacement.building; bay.site = replacement.site;
  if (following) town.roadCar = bay.vehicle ?? null;
  town.props.push(...bayProps(bay));
  for(const v of bayVehicles(bay)){v.yardOwner=bay.key;town.vehicles.push(v);}
  town.buildings.push(...bayBuildings(bay));
  town.yard!.bays.push(bay); changed(town);
}
function changed(town: Town): void { town.visualRevision++; town.siteRevision++; invalidateWorldCollision(); }
export function yardRoadVehicle(town: Town): void { replaceRoadVehicle(town, createRoadVehicle(town.roadSpawnX, town.roadSpawnY, 0)); }
export function yardVehicleRoute(v:VehicleState,delay=0,bay?:YardBay):void {
  const r=7,cx=bay ? bay.x+bay.asset.clearance+bay.asset.w/2 : v.x,cy=(bay ? bay.y+bay.asset.clearance+bay.asset.d/2-6 : v.y)+r;
  const points=Array.from({length:24},(_,i)=>{const angle=-Math.PI/2+(i+1)*Math.PI/12;return {x:cx+Math.cos(angle)*r,y:cy+Math.sin(angle)*r};});
  runVehicle(v,points,delay);
}
export function runYardFleet(town:Town):void {let n=0;for(const b of town.yard?.bays??[])if(b.baseline&&b.vehicle)yardVehicleRoute(b.vehicle,n++*.5,b);}
export function testVehicleImpact(v:VehicleState,kind:'front'|'side'|'rear'|'overhead',strength=6):void {
  parkVehicle(v);const poses=v.parts.map((_,i)=>partPose(v,i));
  if(kind==='overhead'){hitVehicle(v,poses.map((p,i)=>({x:p.x,y:p.y,z:p.z+p.height,nx:0,ny:0,nz:-1,impulse:strength,source:'overhead:'+i})));return;}
  const nx=kind==='side'?-Math.sin(v.heading):Math.cos(v.heading)*(kind==='front'?-1:1),ny=kind==='side'?Math.cos(v.heading):Math.sin(v.heading)*(kind==='front'?-1:1);
  const p=poses.reduce((a,b)=>a.x*nx+a.y*ny < b.x*nx+b.y*ny?a:b);
  hitVehicle(v,[{x:p.x,y:p.y,z:p.z+p.height*.5,nx,ny,nz:0,impulse:strength,source:'yard-impact'}]);
}
