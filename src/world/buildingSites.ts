import { CELL } from '../game/constants';
import { createBuildingFromDefinition } from '../structure/building';
import { ASSET_CATALOG, spawnAssetDefinition, type AssetDef } from './catalog';
import { ARCHETYPES, checkShape, freezeDefinition, parseContentFiles, type Archetype } from './archetypes';

export interface BuildingSite {
  version: number; id: string; label: string; w: number; d: number;
  buildings: { id: string; building: string; x: number; y: number }[];
  equipment: { id: string; asset: string; x: number; y: number }[];
}
export function parseBuildingSites(files: Record<string, unknown>, buildings: readonly Archetype[], assets: readonly AssetDef[]): readonly BuildingSite[] {
  const seen = new Map<string, string>();
  return Object.freeze(Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1).map(([file, input]) => {
    const context = `${file} (site ${(input as { id?: string } | null)?.id ?? '?'})`;
    checkShape(input, { version: 'number', id: 'string', label: 'string', w: 'number', d: 'number',
      buildings: [{ id: 'string', building: 'string', x: 'number', y: 'number' }],
      equipment: [{ id: 'string', asset: 'string', x: 'number', y: 'number' }] }, context);
    const site = structuredClone(input) as BuildingSite;
    const fail = (message: string): never => { throw new Error(`${context}: ${message}`); };
    if (site.version !== 1) fail('Unsupported site version');
    if (!site.id.trim() || !site.label.trim() || seen.has(site.id)) fail(`Duplicate or missing site id ${site.id}; first defined in ${seen.get(site.id)}`);
    seen.set(site.id, file);
    if (site.w <= 0 || site.d <= 0 || site.w > 256 || site.d > 256 || !site.buildings.length || site.buildings.length > 16 || site.equipment.length > 64) fail('Site needs dimensions up to 256, 1–16 buildings and at most 64 equipment items');
    const ids = new Set<string>(), boxes: { x: number; y: number; w: number; d: number }[] = [];
    let slots = 0;
    for (const member of [...site.buildings, ...site.equipment]) {
      if (!member.id.trim() || ids.has(member.id)) fail(`Duplicate or missing member id ${member.id}`);
      ids.add(member.id);
      let w: number, d: number;
      if ('building' in member) {
        const def = buildings.find(b => b.id === member.building) ?? fail(`${member.id}: unknown building reference ${member.building}`);
        w = def.w * (def.cellSize ?? CELL); d = def.d * (def.cellSize ?? CELL);
        slots += def.w * def.d * def.floors;
      } else {
        const def = assets.find(a => a.id === member.asset) ?? fail(`${member.id}: unknown equipment reference ${member.asset}`);
        w = Math.max(def.footprint.w, def.collision.w); d = Math.max(def.footprint.d, def.collision.d);
      }
      const box = { ...member, w, d };
      if (member.x < 0 || member.y < 0 || member.x + w > site.w || member.y + d > site.d) fail(`${member.id}: outside site bounds`);
      if (boxes.some(b => box.x < b.x + b.w && box.x + w > b.x && box.y < b.y + b.d && box.y + d > b.y)) fail(`${member.id}: overlaps another site member`);
      boxes.push(box);
    }
    if (slots > 16384) fail('Site exceeds 16384 grid slots');
    return freezeDefinition(site);
  }));
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
