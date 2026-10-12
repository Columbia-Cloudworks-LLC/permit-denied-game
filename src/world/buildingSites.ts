import { CELL, FLOOR_Z } from '../game/constants';
import { createBuildingFromDefinition } from '../structure/building';
import { parseCampaignPlacement, validateSiteCampaignRules, type CampaignPlacement } from './campaignPlacement';
import { ASSET_CATALOG, spawnAssetDefinition, type AssetDef } from './catalog';
import { ARCHETYPES, checkShape, freezeDefinition, parseContentFiles, type Archetype, type Shape } from './archetypes';

export interface BuildingSite {
  version: number; id: string; label: string; w: number; d: number;
  buildings: { id: string; building: string; x: number; y: number }[];
  equipment: { id: string; asset: string; x: number; y: number }[];
  campaign?: CampaignPlacement;
}
type SiteBox = { x: number; y: number; w: number; d: number; z: number; h: number };
type SiteMember = BuildingSite['buildings'][number] | BuildingSite['equipment'][number];
const siteShape: Shape = { version: 'number', id: 'string', label: 'string', w: 'number', d: 'number',
  buildings: [{ id: 'string', building: 'string', x: 'number', y: 'number' }],
  equipment: [{ id: 'string', asset: 'string', x: 'number', y: 'number' }],
  'campaign?': { levels: { '*': 'number' }, 'maxRepeats?': 'number', 'landmarkOnly?': 'boolean', 'zones?': ['string'] } };
export function parseBuildingSites(files: Record<string, unknown>, buildings: readonly Archetype[], assets: readonly AssetDef[]): readonly BuildingSite[] {
  const seen = new Map<string, string>();
  return Object.freeze(Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1).map(([file, input]) => parseBuildingSite(file, input, seen, buildings, assets)));
}
function parseBuildingSite(file: string, input: unknown, seen: Map<string, string>, buildings: readonly Archetype[], assets: readonly AssetDef[]): BuildingSite {
  const context = `${file} (site ${(input as { id?: string } | null)?.id ?? '?'})`;
  checkShape(input, siteShape, context);
  const site = structuredClone(input) as BuildingSite;
  const fail = (message: string): never => { throw new Error(`${context}: ${message}`); };
  if (site.campaign) site.campaign = parseCampaignPlacement(site.campaign, `${context}.campaign`);
  checkSiteHeader(site, file, seen, fail);
  if (placeSiteMembers(site, buildings, assets, fail) > 16384) fail('Site exceeds 16384 grid slots');
  for (const issue of validateSiteCampaignRules(site, buildings, assets, context)) fail(issue.detail);
  return freezeDefinition(site);
}
function checkSiteHeader(site: BuildingSite, file: string, seen: Map<string, string>, fail: (message: string) => never): void {
  if (site.version !== 1) fail('Unsupported site version');
  if (!site.id.trim() || !site.label.trim() || seen.has(site.id)) fail(`Duplicate or missing site id ${site.id}; first defined in ${seen.get(site.id)}`);
  seen.set(site.id, file);
  if (site.w <= 0 || site.d <= 0 || site.w > 256 || site.d > 256 || !site.buildings.length || site.buildings.length > 16 || site.equipment.length > 64) fail('Site needs dimensions up to 256, 1–16 buildings and at most 64 equipment items');
}
/** Check every member's id, bounds and clearance; returns the grid slots the buildings use. */
function placeSiteMembers(site: BuildingSite, buildings: readonly Archetype[], assets: readonly AssetDef[], fail: (message: string) => never): number {
  const ids = new Set<string>(), boxes: SiteBox[] = [];
  let slots = 0;
  for (const member of [...site.buildings, ...site.equipment]) {
    if (!member.id.trim() || ids.has(member.id)) fail(`Duplicate or missing member id ${member.id}`);
    ids.add(member.id);
    const placed = memberVolumes(member, buildings, assets, fail);
    slots += placed.slots;
    const { w, d } = placed.volumes[0]!;
    if (member.x < 0 || member.y < 0 || member.x + w > site.w || member.y + d > site.d) fail(`${member.id}: outside site bounds`);
    if (placed.volumes.some(box => boxes.some(b => boxesOverlap(box, b)))) fail(`${member.id}: overlaps another site member`);
    boxes.push(...placed.volumes);
  }
  return slots;
}
const boxesOverlap = (a: SiteBox, b: SiteBox): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.d && a.y + a.d > b.y && a.z < b.z + b.h && a.z + a.h > b.z;
/** Collision volumes for one member; the first spans its full footprint. Canopies are a roof slab on thin columns. */
function memberVolumes(member: SiteMember, buildings: readonly Archetype[], assets: readonly AssetDef[], fail: (message: string) => never): { volumes: SiteBox[]; slots: number } {
  if (!('building' in member)) {
    const def = assets.find(a => a.id === member.asset) ?? fail(`${member.id}: unknown equipment reference ${member.asset}`);
    return { slots: 0, volumes: [{ ...member, w: Math.max(def.footprint.w, def.collision.w), d: Math.max(def.footprint.d, def.collision.d), z: 0, h: def.footprint.h }] };
  }
  const def = buildings.find(b => b.id === member.building) ?? fail(`${member.id}: unknown building reference ${member.building}`);
  const cellSize = def.cellSize ?? CELL, w = def.w * cellSize, d = def.d * cellSize, slots = def.w * def.d * def.floors;
  if (!def.canopy) return { slots, volumes: [{ ...member, w, d, z: 0, h: def.floors * FLOOR_Z + 1.5 }] };
  return { slots, volumes: [
    { ...member, w, d, z: FLOOR_Z, h: .25 },
    ...def.canopy.columns.map(p => ({ x: member.x + (p.x + .5) * cellSize - .16, y: member.y + (p.y + .5) * cellSize - .16, w: .32, d: .32, z: 0, h: FLOOR_Z })),
  ] };
}
export const SITE_FILES = parseContentFiles(import.meta.glob<string>('./data/**/*.site.json', { eager: true, query: '?raw', import: 'default' }));
export const BUILDING_SITES = parseBuildingSites(SITE_FILES, ARCHETYPES, ASSET_CATALOG);

/** Each placement owns separate building/prop damage state. IDs identify members within this placement. */
export function instantiateBuildingSite(site: BuildingSite, x: number, y: number, definitions: readonly Archetype[] = ARCHETYPES, assets: readonly AssetDef[] = ASSET_CATALOG) {
  if (![x, y].every(Number.isFinite)) throw new Error(`Site ${site.id}: invalid placement`);
  parseBuildingSites({ [`site:${site.id}`]: site }, definitions, assets);
  const buildings = site.buildings.map(member => {
    const definition = definitions.find(a => a.id === member.building)!;
    return createBuildingFromDefinition(definition, `${site.label} / ${member.id}`, x + member.x, y + member.y);
  });
  const props = site.equipment.map(member => spawnAssetDefinition(assets.find(a => a.id === member.asset)!, x + member.x, y + member.y));
  return { buildings, props };
}
