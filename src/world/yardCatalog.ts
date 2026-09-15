import { VEHICLES, vehicleDefinition } from '../vehicle/definitions';
import { createVehicle } from '../vehicle/runtime';
import type { VehicleDefinition, VehicleState } from '../vehicle/types';
import { CELL, FLOOR_Z } from '../game/constants';
import { createBuilding, createBuildingFromDefinition } from '../structure/building';
import { makeFixture } from '../structure/interior';
import type { Building, FixtureKind, Prop } from '../structure/types';
import { ASSET_CATALOG, spawnAssetDefinition, type AssetDef } from './catalog';
import { ARCHETYPES, archetypeById, type Archetype } from './archetypes';
import { CONTENT_ASSETS } from './contents';
import { BUILDING_SITES, instantiateBuildingSite, type BuildingSite } from './buildingSites';

export interface YardAsset {
  id: string; name: string; category: string; material: string; destruction: string;
  variants: number; w: number; d: number; clearance: number;
  vehicle?: VehicleDefinition;
  prop?: AssetDef; archetype?: Archetype; fixture?: FixtureKind;
  fixtureSize?: { w:number; d:number; h:number };
  fixtureLevels?: number;
  site?: BuildingSite;
}
export function discoverYardAssets(props: readonly AssetDef[] = ASSET_CATALOG, buildings: readonly Archetype[] = ARCHETYPES, sites: readonly BuildingSite[] = BUILDING_SITES, vehicles: readonly VehicleDefinition[] = VEHICLES): YardAsset[] {
  const fixtures = new Set(CONTENT_ASSETS.map(a => a.id));
  return [
    ...buildings.map(a => ({ id: `building:${a.id}`, name: a.label, category: 'building', material: a.construction.structure,
      destruction: `${a.construction.walls} collapse`, variants: 1,
      w: a.w * (a.cellSize ?? CELL), d: a.d * (a.cellSize ?? CELL), clearance: Math.max(5, a.floors * .55 + 3), archetype: a })),
    ...sites.map(site => ({ id: `site:${site.id}`, name: site.label, category: 'site', material: 'mixed',
      destruction: 'independent buildings + equipment', variants: 1, w: site.w, d: site.d, clearance: 6, site })),
    ...vehicles.map(vehicle=>({id:`vehicle:${vehicle.id}`,name:vehicle.name,category:'vehicle',material:'mixed',destruction:'assembly',variants:2,w:vehicle.length*(vehicle.id==='tractor-trailer'?2:1.8),d:vehicle.width*1.6,clearance:10,vehicle})),
    ...props.filter(a=>!VEHICLES.some(v=>v.id===a.id)).map(a => ({ id: `prop:${a.id}`, name: a.id.replaceAll('-', ' '), category: a.family,
      material: a.material, destruction: a.destruction, variants: a.variants,
      w: Math.max(a.footprint.w, a.collision.w), d: Math.max(a.footprint.d, a.collision.d),
      clearance: Math.max(3, a.minClear, a.footprint.h, a.explodeRadius + 3), prop: a })),
    ...props.filter(a => fixtures.has(a.id)).map(a => ({ id: `fixture:${a.id}`, name: `${a.id.slice(9)} (interior)`,
      category: 'fixture', material: a.material, destruction: a.destruction, variants: 1,
      w: Math.max(5,Math.ceil((a.footprint.w+3)/CELL)) * CELL,
      d: Math.max(4,Math.ceil((a.footprint.d+3)/CELL)) * CELL,
      clearance: 5, fixture: a.id.slice(9) as FixtureKind, fixtureSize: a.footprint,
      fixtureLevels: Math.ceil((a.footprint.h+.2)/FLOOR_Z) })),
  ].sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
}
export function yardAssetIssue(a: YardAsset): string | undefined {
  if (!a.id.trim() || ![a.w, a.d, a.clearance, a.variants].every(Number.isFinite) || a.w <= 0 || a.d <= 0 || a.clearance < 0 || !Number.isInteger(a.variants) || a.variants < 1) return `${a.id}: invalid dimensions or variants`;
  if (a.prop && (!Number.isFinite(a.prop.hp) || a.prop.hp <= 0 || !Number.isFinite(a.prop.mass) || a.prop.mass <= 0)) return `${a.id}: invalid health or mass`;
  return undefined;
}
export function yardGridSlots(a: YardAsset): number {
  if (a.archetype) return a.archetype.w * a.archetype.d * a.archetype.floors;
  if (a.site) return a.site.buildings.reduce((n, member) => {
    const def = archetypeById(member.building); return n + def.w * def.d * def.floors;
  }, 0);
  return a.fixture ? Math.round(a.w/CELL)*Math.round(a.d/CELL)*2*(a.fixtureLevels??1) : 0;
}
export interface YardBox { x: number; y: number; w: number; d: number }
export interface YardBay extends YardBox {
  key: string; asset: YardAsset; variant: number; baseline: boolean; focused?: boolean;
  /** Catalog/capture keeps every south cell. Yard tests still open the front for entry. */
  intactFacade?: boolean;
  building?: Building; prop?: Prop; vehicle?: VehicleState;
  site?: { buildings: Building[]; props: Prop[]; vehicles?: VehicleState[] };
}
export function bayBuildings(bay: YardBay): Building[] { return bay.site?.buildings ?? (bay.building ? [bay.building] : []); }
export function bayProps(bay: YardBay): Prop[] { return bay.site?.props ?? (bay.prop ? [bay.prop] : []); }
export function bayVehicles(bay: YardBay): VehicleState[] {return bay.site?.vehicles ?? (bay.vehicle?[bay.vehicle]:[]); }
export function overlap(a: YardBox, b: YardBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.d && a.y + a.d > b.y;
}
export function layoutYard(assets = discoverYardAssets(), x = 8, y = 12): YardBay[] {
  const out: YardBay[] = [];
  let cx = x, cy = y, row = 0, category = '';
  for (const asset of assets) {
    if (yardAssetIssue(asset)) continue;
    const w = asset.w + asset.clearance * 2, d = asset.d + asset.clearance * 2;
    if (cx > x && (cx + w > x + 140 || category !== asset.category)) { cx = x; cy += row + 6; row = 0; }
    out.push({ key: `baseline:${asset.id}`, asset, variant: 0, baseline: true, x: cx, y: cy, w, d });
    cx += w + 6; row = Math.max(row, d); category = asset.category;
  }
  return out;
}
export function instantiateBay(bay: YardBay): void {
  const a = bay.asset, x = bay.x + a.clearance, y = bay.y + a.clearance;
  if(a.vehicle) {bay.vehicle=createVehicle(a.vehicle.id,x+a.w/2,y+a.d/2-6,0,bay.variant);bay.vehicle.yardOwner=bay.key;}
  else if (a.site) {
    bay.site = instantiateBuildingSite(a.site, x, y);
    bay.site.vehicles=[];bay.site.props=bay.site.props.filter(p=>{if(!VEHICLES.some(d=>d.id===p.assetId))return true;const v=createVehicle(vehicleDefinition(p.assetId).id,p.x+p.w/2,p.y+p.d/2,p.heading,p.variant);v.yardOwner=bay.key;bay.site!.vehicles!.push(v);return false;});
  } else if (a.archetype) {
    // Use the production constructor. Source registry additions need no yard placement edits.
    bay.building = createBuildingFromDefinition(a.archetype, a.name, x, y);
  } else if (a.fixture) {
    const levels=a.fixtureLevels??1, floors = bay.focused ? levels : levels * 2;
    const b = createBuilding({ name: a.name, kind: 'shop', x, y, w: Math.round(a.w/CELL), d: Math.round(a.d/CELL), floors,
      roof: 'flat', construction: archetypeById('rivertown').construction, openings: [],
      layout: { partitions: false,
        rooms: Array.from({length:floors},(_,floor) => ({ id: `room-${floor}`, kind: 'living', floor, x: 0, y: 0, w: 1, d: 1, finish: 'plank', contents: [] })) } });
    if(levels>1)b.floorTiles=b.floorTiles.map(t=>t.floor%levels!==0 && t.gx>0 && t.gx<b.w-1 && t.gy>0 && t.gy<b.d-1?{...t,void:true}:t);
    // Yard tests open the south wall so the fixture is reachable. Catalog capture
    // keeps an intact facade — the public shot is not a cutaway or dollhouse.
    if (!bay.intactFacade) {
      for (const cell of b.cells) if (cell.gy === b.d - 1 && cell.gx >= 1 && cell.gx <= 3) {
        cell.state = 'gone'; cell.hp = 0;
      }
    }
    const size=a.fixtureSize??{w:1,d:1,h:1};
    b.fixtures = (bay.focused ? [0] : [0, levels]).map(floor => makeFixture(b, floor + 1, a.fixture!, 'living', floor, x + 2, y + 2, size.w, size.d, size.h));
    bay.building = b;
  } else if (a.prop) bay.prop = spawnAssetDefinition(a.prop, x, y, 0, bay.variant);
}
