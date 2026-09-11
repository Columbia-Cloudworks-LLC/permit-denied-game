import { CELL } from '../game/constants';
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
  prop?: AssetDef; archetype?: Archetype; fixture?: FixtureKind;
  site?: BuildingSite;
}
export function discoverYardAssets(props: readonly AssetDef[] = ASSET_CATALOG, buildings: readonly Archetype[] = ARCHETYPES, sites: readonly BuildingSite[] = BUILDING_SITES): YardAsset[] {
  const fixtures = new Set(CONTENT_ASSETS.map(a => a.id));
  return [
    ...buildings.map(a => ({ id: `building:${a.id}`, name: a.label, category: 'building', material: a.construction.structure,
      destruction: `${a.construction.walls} collapse`, variants: 1,
      w: a.w * (a.cellSize ?? CELL), d: a.d * (a.cellSize ?? CELL), clearance: Math.max(5, a.floors * .55 + 3), archetype: a })),
    ...sites.map(site => ({ id: `site:${site.id}`, name: site.label, category: 'site', material: 'mixed',
      destruction: 'independent buildings + equipment', variants: 1, w: site.w, d: site.d, clearance: 6, site })),
    ...props.map(a => ({ id: `prop:${a.id}`, name: a.id.replaceAll('-', ' '), category: a.family,
      material: a.material, destruction: a.destruction, variants: a.variants,
      w: Math.max(a.footprint.w, a.collision.w), d: Math.max(a.footprint.d, a.collision.d),
      clearance: Math.max(3, a.minClear, a.footprint.h, a.explodeRadius + 3), prop: a })),
    ...props.filter(a => fixtures.has(a.id)).map(a => ({ id: `fixture:${a.id}`, name: `${a.id.slice(9)} (interior)`,
      category: 'fixture', material: a.material, destruction: a.destruction, variants: 1,
      w: 5 * CELL, d: 4 * CELL, clearance: 5, fixture: a.id.slice(9) as FixtureKind })),
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
  return a.fixture ? 40 : 0;
}
export interface YardBox { x: number; y: number; w: number; d: number }
export interface YardBay extends YardBox { key: string; asset: YardAsset; variant: number; baseline: boolean; building?: Building; prop?: Prop; site?: { buildings: Building[]; props: Prop[] } }
export function bayBuildings(bay: YardBay): Building[] { return bay.site?.buildings ?? (bay.building ? [bay.building] : []); }
export function bayProps(bay: YardBay): Prop[] { return bay.site?.props ?? (bay.prop ? [bay.prop] : []); }
export function overlap(a: YardBox, b: YardBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.d && a.y + a.d > b.y;
}
export function layoutYard(assets = discoverYardAssets(), x = 8, y = 12): YardBay[] {
  const out: YardBay[] = [];
  let cx = x, cy = y, row = 0, category = '';
  for (const asset of assets) {
    if (yardAssetIssue(asset)) continue;
    const w = asset.w + asset.clearance * 2, d = asset.d + asset.clearance * 2;
    if (cx > x && (cx + w > x + 105 || category !== asset.category)) { cx = x; cy += row + 6; row = 0; }
    out.push({ key: `baseline:${asset.id}`, asset, variant: 0, baseline: true, x: cx, y: cy, w, d });
    cx += w + 6; row = Math.max(row, d); category = asset.category;
  }
  return out;
}
export function instantiateBay(bay: YardBay): void {
  const a = bay.asset, x = bay.x + a.clearance, y = bay.y + a.clearance;
  if (a.site) {
    bay.site = instantiateBuildingSite(a.site, x, y);
  } else if (a.archetype) {
    // Use the production constructor. Source registry additions need no yard placement edits.
    bay.building = createBuildingFromDefinition(a.archetype, a.name, x, y);
  } else if (a.fixture) {
    const b = createBuilding({ name: a.name, kind: 'shop', x, y, w: 5, d: 4, floors: 2,
      roof: 'flat', construction: archetypeById('rivertown').construction, openings: [],
      layout: { partitions: false,
        rooms: [0, 1].map(floor => ({ id: `room-${floor}`, kind: 'living', floor, x: 0, y: 0, w: 1, d: 1, finish: 'plank', contents: [] })) } });
    // Open-front contextual host: retain floor tiles under the opening, so the
    // production envelope/exposure and ground collision paths are active at entry.
    for (const cell of b.cells) if (cell.gy === b.d - 1 && cell.gx >= 1 && cell.gx <= 3) {
      cell.state = 'gone'; cell.hp = 0;
    }
    b.fixtures = [0, 1].map(floor => makeFixture(b, floor + 1, a.fixture!, 'living', floor, x + 2, y + 2, 1, 1, 1));
    bay.building = b;
  } else if (a.prop) bay.prop = spawnAssetDefinition(a.prop, x, y, 0, bay.variant);
}
