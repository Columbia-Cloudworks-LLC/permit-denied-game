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
  /** Independent authoring/search dimensions, not simulation dispatch keys. */
  traits?: { use?: string[]; form?: string[]; construction?: string[]; style?: string[]; era?: string[]; scale?: string[] };
  cellSize?: number;
  /** Explicit order keeps legacy weighted generation independent of filenames. */
  generationOrder?: number;
  sections?: SectionDef[];
  coreCollapse?: import("../structure/coreCollapse").CoreCollapseDef;
}
export type Shape = 'string' | 'number' | 'boolean' | { [key: string]: Shape } | readonly [Shape];
/** Reject unknown fields and malformed JSON at the only external authoring seam. */
export function checkShape(value: unknown, shape: Shape, path: string): void {
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
const sectionShape: Shape = { id: 'string', role: 'string', x: 'number', y: 'number', w: 'number', d: 'number', floor: 'number', floors: 'number', layout: 'string' };
const buildingShape: Shape = { version: 'number', id: 'string', kind: 'string', label: 'string', w: 'number', d: 'number', floors: 'number',
  construction: 'string', 'layout?': 'string', 'footprint?': [['string']], 'sections?': [sectionShape],
  'partitions?': 'boolean', 'connections?': [{ a: 'string', b: 'string', at: 'number', width: 'number' }],
  openings: [{ floor: 'number', side: 'string', at: 'number', kind: 'string', 'cell?': { x: 'number', y: 'number' } }],
  roof: 'string', 'roofAxis?': 'string', theme: 'string', windowStride: 'number',
  'coreCollapse?': { supports: [{ x: 'number', y: 'number', weight: 'number' }], capacityThreshold: 'number', warningDuration: 'number', duration: 'number' },
  'cellSize?': 'number', 'generationOrder?': 'number',
  'traits?': { 'use?': ['string'], 'form?': ['string'], 'construction?': ['string'], 'style?': ['string'], 'era?': ['string'], 'scale?': ['string'] },
  features: { porch: 'boolean', awning: 'boolean', parapet: 'boolean', chimney: 'boolean', garage: 'boolean' },
  zones: { residential: 'number', commercial: 'number', industrial: 'number' } };

export function validateBuildingDefinition(a: Archetype): string[] {
  const issues = validateConstruction(a.construction);
  if (!a.id.trim() || !a.label.trim()) issues.push('Building needs an id and label');
  if (![a.w, a.d, a.floors].every(n => Number.isInteger(n) && n > 0 && n <= 64)) return [...issues, 'Invalid building dimensions (1–64 cells/floors)'];
  if (a.w * a.d * a.floors > 8192) return [...issues, 'Building exceeds 8192 grid slots; reduce cells or split the site'];
  if (a.cellSize !== undefined && (!Number.isFinite(a.cellSize) || a.cellSize < .5 || a.cellSize > 4)) issues.push('cellSize must be 0.5–4 world units');
  if (a.layout.rooms.length > 256 || a.layout.rooms.reduce((n, r) => n + r.contents.length, 0) > 512) return [...issues, 'Building exceeds 256 rooms or 512 contents'];
  if (!['house', 'shop', 'industrial'].includes(a.kind) || !['gable', 'flat', 'shed'].includes(a.roof) ||
    (a.roofAxis !== undefined && !['x', 'y'].includes(a.roofAxis)) ||
    !['cottage', 'ranch', 'colonial', 'walkup', 'porch', 'storefront', 'corner', 'civic', 'warehouse'].includes(a.theme)) issues.push('Unknown building kind, roof, axis or theme');
  if (!Number.isInteger(a.windowStride) || a.windowStride < 1 || Object.values(a.zones).some(n => !Number.isFinite(n) || n < 0)) issues.push('Invalid window stride or zoning weight');
  if (a.footprint.length !== a.floors || a.footprint.some(layer => layer.length !== a.d || layer.some(row => row.length !== a.w || /[^#.]/.test(row)) || !layer.some(row => row.includes('#')))) return [...issues, 'Footprint dimensions must match building dimensions and use # or .'];
  if (a.coreCollapse) {
    const c = a.coreCollapse, keys = new Set<string>();
    if (a.floors < 4 || a.roof !== 'flat' || c.supports.length < 3 || c.supports.length > 32 || !(c.capacityThreshold > 0 && c.capacityThreshold < 1) || !(c.warningDuration >= .5 && c.warningDuration <= 5) || !(c.duration >= 2 && c.duration <= 12)) issues.push('Invalid coreCollapse configuration');
    for (const p of c.supports) {
      const key = p.x + ':' + p.y;
      if (![p.x, p.y].every(Number.isInteger) || !(p.weight > 0 && p.weight <= 10) || keys.has(key) || [a.footprint[0]?.[p.y]?.[p.x], a.footprint[0]?.[p.y - 1]?.[p.x], a.footprint[0]?.[p.y + 1]?.[p.x], a.footprint[0]?.[p.y]?.[p.x - 1], a.footprint[0]?.[p.y]?.[p.x + 1]].some(v => v !== '#')) issues.push('Invalid or duplicate coreCollapse support ' + key + '; supports must be inside the ground footprint');
      keys.add(key);
    }
  }
  const mask = occupiedMask(a);
  issues.push(...validateLayout(a.layout, a.w, a.d, a.floors, mask));
  if (!a.openings.some(o => o.floor === 0)) issues.push('Building needs a ground-floor entrance');
  for (const opening of a.openings) {
    if (!Number.isInteger(opening.floor) || opening.floor < 0 || opening.floor >= a.floors || opening.side !== 'south' ||
      !Number.isFinite(opening.at) || opening.at < 0 || opening.at > 1 || !['door', 'loading'].includes(opening.kind)) issues.push('Invalid entrance (supported frontage: south)');
    else if (opening.cell) {
      const { x, y } = opening.cell;
      if (![x, y].every(Number.isInteger) || a.footprint[opening.floor]?.[y]?.[x] !== '#' || a.footprint[opening.floor]?.[y + 1]?.[x] === '#') issues.push('Entrance cell must touch exposed south frontage');
    } else if (!a.footprint[opening.floor]![a.d - 1]!.includes('#')) issues.push('Entrance must touch occupied frontage');
  }
  return issues;
}
export interface SectionDef {
  id: string; role: string; x: number; y: number; w: number; d: number;
  floor: number; floors: number; layout: string;
}
interface BuildingPackage extends Omit<Archetype, 'construction' | 'layout' | 'footprint'> {
  version: number; construction: string; layout?: string; footprint?: string[][];
  partitions?: boolean; connections?: LayoutDef['connections'];
}
/** Pure seam also used by tests/tools. Layout references stay inside their owning directory. */
export function parseBuildingPackages(files: Record<string, unknown>): readonly Archetype[] {
  const constructions = new Map<string, { file: string; def: ConstructionDef }>();
  const layouts = new Map<string, LayoutDef>();
  const entries = Object.entries(structuredClone(files)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  for (const [file, input] of entries) {
    if (file.endsWith('.construction.json')) {
      checkShape(input, constructionShape, file);
      const def = input as ConstructionDef, prior = constructions.get(def.id);
      if (prior) throw new Error(`${file}: Duplicate construction id ${def.id}, first defined in ${prior.file}`);
      const issues = validateConstruction(def);
      if (issues.length) throw new Error(`${file} (construction ${def.id}): ${issues.join('; ')}`);
      constructions.set(def.id, { file, def });
    } else if (file.endsWith('.layout.json')) {
      checkShape(input, layoutShape, file); layouts.set(file, input as LayoutDef);
    }
  }
  const seen = new Map<string, string>(), orders = new Map<number, string>();
  const layoutOwners = new Map<string, { id: string; file: string }>();
  const result: Archetype[] = [];
  for (const [file, input] of entries.filter(([file]) => file.endsWith('.building.json'))) {
    const label = `${file} (building ${(input as { id?: string } | null)?.id ?? '?'})`;
    try {
      checkShape(input, buildingShape, label);
      const entry = input as BuildingPackage;
      if (entry.version !== 1) throw new Error('Unsupported building package version');
      if (seen.has(entry.id)) throw new Error(`Duplicate building id ${entry.id}, first defined in ${seen.get(entry.id)}`);
      seen.set(entry.id, file);
      if (entry.generationOrder !== undefined) {
        if (!Number.isInteger(entry.generationOrder) || entry.generationOrder < 0 || orders.has(entry.generationOrder)) throw new Error(`Invalid or duplicate generationOrder (also ${orders.get(entry.generationOrder)})`);
        orders.set(entry.generationOrder, file);
      }
      const construction = constructions.get(entry.construction);
      if (!construction) throw new Error(`Unknown construction reference ${entry.construction}`);
      const readLayout = (ref: string): LayoutDef => {
        if (!/^[a-zA-Z0-9_-]+\.layout\.json$/.test(ref)) throw new Error(`Layout reference ${ref} must be a sibling .layout.json file`);
        const path = file.slice(0, file.lastIndexOf('/') + 1) + ref;
        const layout = layouts.get(path);
        if (!layout) throw new Error(`Unknown layout reference ${path}`);
        const owner = layoutOwners.get(path);
        if (owner && owner.id !== entry.id) throw new Error(`Layout ${path} is already owned by ${owner.id} in ${owner.file}; copy the layout for this building`);
        layoutOwners.set(path, { id: entry.id, file });
        return structuredClone(layout);
      };
      let layout: LayoutDef, footprint: string[][];
      if (entry.sections) {
        if (entry.layout || entry.footprint) throw new Error('Use sections OR layout + footprint');
        ({ layout, footprint } = compileSections(entry, readLayout));
      } else {
        if (!entry.layout || !entry.footprint) throw new Error('Building needs layout + footprint or sections');
        if (entry.partitions !== undefined || entry.connections) throw new Error('Flat packages own partitions and connections in their layout');
        layout = readLayout(entry.layout); footprint = entry.footprint;
      }
      const { version: _version, partitions: _partitions, connections: _connections, ...definition } = entry;
      const a: Archetype = { ...definition, construction: structuredClone(construction.def), layout, footprint };
      const issues = validateBuildingDefinition(a);
      if (issues.length) throw new Error(`${entry.layout ?? entry.sections?.map(s => `${s.id}: ${s.layout}`).join(', ')}; construction ${construction.file}: ${issues.join('; ')}`);
      result.push(freezeDefinition(a));
    } catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return Object.freeze(result.sort((a, b) => (a.generationOrder ?? Number.MAX_SAFE_INTEGER) - (b.generationOrder ?? Number.MAX_SAFE_INTEGER) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}
function compileSections(entry: BuildingPackage, readLayout: (ref: string) => LayoutDef): { layout: LayoutDef; footprint: string[][] } {
  const { w, d, floors } = entry;
  if (![w, d, floors].every(n => Number.isInteger(n) && n > 0 && n <= 64) || w * d * floors > 8192) throw new Error('Invalid dimensions or exceeds 8192 grid slots');
  if (!entry.sections?.length || entry.sections.length > 64) throw new Error('Expected 1–64 sections');
  const mask = Array.from({ length: floors }, () => Array.from({ length: d }, () => Array<string>(w).fill('.')));
  const rooms: LayoutDef['rooms'][number][] = [], connections: NonNullable<LayoutDef['connections']>[number][] = [];
  const ids = new Set<string>();
  for (const s of entry.sections) {
    if (!s.id.trim() || s.id.includes('/') || ids.has(s.id) || !s.role.trim()) throw new Error(`Invalid or duplicate section ${s.id}`);
    ids.add(s.id);
    if (![s.x, s.y, s.w, s.d, s.floor, s.floors].every(Number.isInteger) || s.x < 0 || s.y < 0 || s.floor < 0 || s.w < 1 || s.d < 1 || s.floors < 1 || s.x + s.w > w || s.y + s.d > d || s.floor + s.floors > floors) throw new Error(`Section ${s.id}: invalid bounds`);
    const template = readLayout(s.layout);
    const issues = validateLayout(template, s.w, s.d, 1, fullMask(1, s.w, s.d));
    if (issues.length) throw new Error(`Section ${s.id}, ${s.layout}: ${issues.join('; ')}`);
    for (let f = s.floor; f < s.floor + s.floors; f++) {
      for (let y = s.y; y < s.y + s.d; y++) for (let x = s.x; x < s.x + s.w; x++) {
        if (mask[f]![y]![x] === '#') throw new Error(`Section ${s.id}: overlaps another section at ${f}:${x},${y}`);
        if (f > 0 && !entry.sections.some(b => b.floor <= f - 1 && b.floor + b.floors > f - 1 && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.d)) throw new Error(`Section ${s.id}: unsupported overhang at ${f}:${x},${y}`);
        mask[f]![y]![x] = '#';
      }
      const id = (room: string) => `${s.id}/${f}/${room}`;
      for (const r of template.rooms) rooms.push({ ...structuredClone(r), id: id(r.id), floor: f, x: (s.x + r.x * s.w) / w, y: (s.y + r.y * s.d) / d, w: r.w * s.w / w, d: r.d * s.d / d });
      for (const c of template.connections ?? []) connections.push({ ...c, a: id(c.a), b: id(c.b) });
      if (rooms.length > 256 || rooms.reduce((n, r) => n + r.contents.length, 0) > 512) throw new Error('Expanded sections exceed 256 rooms or 512 contents');
    }
  }
  return { footprint: mask.map(layer => layer.map(row => row.join(''))), layout: { partitions: entry.partitions ?? false, rooms, connections: [...connections, ...entry.connections ?? []] } };
}
export function parseContentFiles(raw: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).map(([file, text]) => {
    try { return [file, JSON.parse(text)]; } catch (error) { throw new Error(`${file}: malformed JSON: ${String(error)}`); }
  }));
}
export function freezeDefinition<T>(value: T): T {
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
export const BUILDING_FILES = parseContentFiles(import.meta.glob<string>(['./data/**/*.building.json', './data/**/*.layout.json', './data/**/*.construction.json'], { eager: true, query: '?raw', import: 'default' }));
export const ARCHETYPES = parseBuildingPackages(BUILDING_FILES);
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
