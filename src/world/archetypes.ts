import data from './data/buildings.json';
import { validateConstruction, validateLayout, type ConstructionDef, type LayoutDef, type OpeningDef } from '../structure/construction';
import type { BuildingFeatureSpec, BuildingKind, FacadeTheme, LotZone, RoofAxis, RoofStyle } from '../structure/types';

export type ArchetypeId = string;
/** Fully resolved, serializable building definition consumed by the building compiler. */
export interface Archetype {
  id: string;
  kind: BuildingKind;
  label: string;
  w: number; d: number; floors: number;
  construction: ConstructionDef;
  layout: LayoutDef;
  footprint: string[][];
  openings: OpeningDef[];
  roof: RoofStyle;
  roofAxis?: RoofAxis;
  theme: FacadeTheme;
  windowStride: number;
  features: BuildingFeatureSpec;
  zones: Record<LotZone, number>;
}
type CatalogData = {
  version: number;
  constructions: Record<string, ConstructionDef>;
  layouts: Record<string, LayoutDef>;
  buildings: (Omit<Archetype, 'construction' | 'layout'> & { construction: string; layout: string })[];
};
type Shape = 'string' | 'number' | 'boolean' | { [key: string]: Shape } | readonly [Shape];
/** Reject unknown fields and malformed JSON at the only external authoring seam. */
function checkShape(value: unknown, shape: Shape, path: string): void {
  if (typeof shape === 'string') {
    if (typeof value !== shape || (shape === 'number' && !Number.isFinite(value))) throw new Error(`${path}: expected ${shape}`);
    return;
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) throw new Error(`${path}: expected array`);
    value.forEach((v, i) => checkShape(v, shape[0]!, `${path}[${i}]`)); return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected object`);
  const record = value as Record<string, unknown>, fields = shape as Record<string, Shape>;
  if ('*' in fields) { for (const [key, v] of Object.entries(record)) checkShape(v, fields['*']!, `${path}.${key}`); return; }
  for (const key of Object.keys(record)) if (!(key in fields) && !(`${key}?` in fields)) throw new Error(`${path}.${key}: unknown field`);
  for (const [key, s] of Object.entries(fields)) {
    const optional = key.endsWith('?'), name = optional ? key.slice(0, -1) : key;
    if (optional && !(name in record)) continue;
    checkShape(record[name], s, `${path}.${name}`);
  }
}
const constructionShape: Shape = { id: 'string', walls: 'string', structure: 'string', skin: 'string', floor: 'string', roof: 'string', fallDuration: 'number', failureDelay: 'number' };
const layoutShape: Shape = { partitions: 'boolean', 'connections?': [{ a: 'string', b: 'string', at: 'number', width: 'number' }], rooms: [{ id: 'string', kind: 'string', floor: 'number', x: 'number', y: 'number', w: 'number', d: 'number', finish: 'string',
  contents: [{ id: 'string', kind: 'string', x: 'number', y: 'number', w: 'number', d: 'number', h: 'number', rotation: 'number' }] }] };
const buildingShape: Shape = { id: 'string', kind: 'string', label: 'string', w: 'number', d: 'number', floors: 'number',
  construction: 'string', layout: 'string', footprint: [['string']], openings: [{ floor: 'number', side: 'string', at: 'number', kind: 'string' }],
  roof: 'string', 'roofAxis?': 'string', theme: 'string', windowStride: 'number',
  features: { porch: 'boolean', awning: 'boolean', parapet: 'boolean', chimney: 'boolean', garage: 'boolean' },
  zones: { residential: 'number', commercial: 'number', industrial: 'number' } };

export function validateBuildingDefinition(a: Archetype): string[] {
  const issues = validateConstruction(a.construction);
  if (!a.id.trim() || !a.label.trim()) issues.push('Building needs an id and label');
  if (![a.w, a.d, a.floors].every(n => Number.isInteger(n) && n > 0 && n <= 64)) return [...issues, 'Invalid building dimensions (1–64 cells/floors)'];
  if (!['house', 'shop', 'industrial'].includes(a.kind) || !['gable', 'flat', 'shed'].includes(a.roof) ||
    (a.roofAxis !== undefined && !['x', 'y'].includes(a.roofAxis)) ||
    !['cottage', 'ranch', 'colonial', 'walkup', 'porch', 'storefront', 'corner', 'civic', 'warehouse'].includes(a.theme)) issues.push('Unknown building kind, roof, axis or theme');
  if (!Number.isInteger(a.windowStride) || a.windowStride < 1 || Object.values(a.zones).some(n => !Number.isFinite(n) || n < 0)) issues.push('Invalid window stride or zoning weight');
  if (a.footprint.length !== a.floors || a.footprint.some(layer => layer.length !== a.d || layer.some(row => row.length !== a.w || /[^#.]/.test(row)) || !layer.some(row => row.includes('#')))) return [...issues, 'Footprint dimensions must match building dimensions and use # or .'];
  const mask = occupiedMask(a);
  issues.push(...validateLayout(a.layout, a.w, a.d, a.floors, mask));
  if (!a.openings.some(o => o.floor === 0)) issues.push('Building needs a ground-floor entrance');
  for (const opening of a.openings) {
    if (!Number.isInteger(opening.floor) || opening.floor < 0 || opening.floor >= a.floors || opening.side !== 'south' ||
      !Number.isFinite(opening.at) || opening.at < 0 || opening.at > 1 || !['door', 'loading'].includes(opening.kind)) issues.push('Invalid entrance (supported frontage: south)');
    else if (!a.footprint[opening.floor]![a.d - 1]!.includes('#')) issues.push('Entrance must touch occupied frontage');
  }
  return issues;
}
export function parseBuildingCatalog(input: unknown): readonly Archetype[] {
  checkShape(input, { version: 'number', constructions: { '*': constructionShape }, layouts: { '*': layoutShape }, buildings: [buildingShape] }, 'catalog');
  const raw = structuredClone(input) as CatalogData;
  if (raw.version !== 1) throw new Error('Unsupported building catalog version');
  for (const [key, def] of Object.entries(raw.constructions)) {
    const issues = validateConstruction(def);
    if (key !== def.id || issues.length) throw new Error(`Construction ${key}: ${issues.join('; ') || 'id must match key'}`);
  }
  const seen = new Set<string>();
  return raw.buildings.map(entry => {
    const construction = raw.constructions[entry.construction], layout = raw.layouts[entry.layout];
    if (!construction || !layout) throw new Error(`Building ${entry.id}: unknown construction or layout reference`);
    if (seen.has(entry.id)) throw new Error(`Duplicate building id ${entry.id}`);
    seen.add(entry.id);
    const a: Archetype = { ...entry, construction, layout };
    const issues = validateBuildingDefinition(a);
    if (issues.length) throw new Error(`Building ${a.id}: ${issues.join('; ')}`);
    return freezeDefinition(a);
  });
}
function freezeDefinition<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDefinition(child);
    Object.freeze(value);
  }
  return value;
}
export function fullMask(floors: number, w: number, d: number): boolean[][][] {
  return Array.from({ length: floors }, () => Array.from({ length: w }, () => Array<boolean>(d).fill(true)));
}
export function occupiedMask(a: Archetype, w = a.w, d = a.d, floors = a.floors): boolean[][][] {
  if (w !== a.w || d !== a.d || floors !== a.floors) {
    if (a.footprint.some(layer => layer.some(row => row.includes('.')))) throw new Error('Resize an irregular building by authoring its footprint and layout together');
    return fullMask(floors, w, d);
  }
  return a.footprint.map(layer => Array.from({ length: w }, (_, gx) => Array.from({ length: d }, (_, gy) => layer[gy]![gx] === '#')));
}
export const ARCHETYPES = parseBuildingCatalog(data);
const BY_ID = new Map(ARCHETYPES.map(a => [a.id, a]));
export function archetypeById(id: string): Archetype {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown archetype ${id}`);
  return found;
}
export function pickArchetype(zone: LotZone, rng: { range(a: number, b: number): number }): Archetype {
  const pool = ARCHETYPES.filter(a => a.zones[zone] > 0);
  let pick = rng.range(0, pool.reduce((n, a) => n + a.zones[zone], 0));
  for (const a of pool) { pick -= a.zones[zone]; if (pick <= 0) return a; }
  return pool[pool.length - 1]!;
}
export function lotZoneFor(row: number, col: number, rows: number, cols: number): LotZone {
  if (row === 0 || col === 0) return col + row === 0 ? 'commercial' : row === 0 ? 'commercial' : 'residential';
  if (row === rows - 1 && col >= cols - 2 || row >= Math.max(1, rows - 2) && col >= Math.max(1, cols - 2)) return 'industrial';
  if (col === cols - 1 && row <= 1) return 'commercial';
  return 'residential';
}
