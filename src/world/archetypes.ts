import { parseCampaignPlacement } from './campaignPlacement';
import { validateConstruction, validateLayout, stairLandingCells, type ConstructionDef, type LayoutDef, type OpeningDef } from '../structure/construction';
import type { BuildingFeatureSpec, BuildingKind, FacadeTheme, LotZone, RoofAxis, RoofStyle } from '../structure/types';
import { FACADE_DETAIL_KINDS, type FacadeDetailDef } from '../structure/facadeDetails';

export type ArchetypeId = string;
/** Fully resolved, serializable building definition consumed by the building compiler. */
export interface Archetype {
  silos?: import('../structure/silos').SiloDef[];
  openDecks?: { columns: { x: number; y: number }[] };
  canopy?: { columns: { x: number; y: number }[] };
  floorVoids?: { floor:number; x:number; y:number; w:number; d:number }[];
  elevatedTank?: import('../structure/elevatedTank').ElevatedTankDef;
  facadeDetails?: FacadeDetailDef[];
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
  campaign?: import('./campaignPlacement').CampaignPlacement;
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
  checkFields(value as Record<string, unknown>, shape as Record<string, Shape>, path);
}
function checkFields(record: Record<string, unknown>, fields: Record<string, Shape>, path: string): void {
  if ('*' in fields) { for (const [key, v] of Object.entries(record)) checkShape(v, fields['*']!, `${path}.${key}`); return; }
  for (const key of Object.keys(record)) if (!(key in fields) && !(`${key}?` in fields)) throw new Error(`${path}.${key}: unknown field`);
  for (const [key, s] of Object.entries(fields)) {
    const optional = key.endsWith('?'), name = optional ? key.slice(0, -1) : key;
    if (optional && !(name in record)) continue;
    checkShape(record[name], s, `${path}.${name}`);
  }
}
const constructionShape: Shape = { id: 'string', walls: 'string', structure: 'string', skin: 'string', floor: 'string', roof: 'string', fallDuration: 'number', failureDelay: 'number' };
const stairShape: Shape = { a:'string', b:'string', x:'number', y:'number', w:'number', d:'number', 'kind?':'string', 'rotation?':'number' };
const layoutShape: Shape = { partitions: 'boolean', 'stairs?': [stairShape], 'connections?': [{ a: 'string', b: 'string', at: 'number', width: 'number' }], rooms: [{ id: 'string', kind: 'string', floor: 'number', x: 'number', y: 'number', w: 'number', d: 'number', finish: 'string',
  'floorDesigns?': [{ id: 'string', kind: 'string', x: 'number', y: 'number', w: 'number', d: 'number' }],
  contents: [{ id: 'string', kind: 'string', x: 'number', y: 'number', w: 'number', d: 'number', h: 'number', rotation: 'number' }] }] };
const sectionShape: Shape = { id: 'string', role: 'string', x: 'number', y: 'number', w: 'number', d: 'number', floor: 'number', floors: 'number', layout: 'string' };
const buildingShape: Shape = { version: 'number', id: 'string', kind: 'string', label: 'string', w: 'number', d: 'number', floors: 'number',
  construction: 'string', 'layout?': 'string', 'footprint?': [['string']], 'sections?': [sectionShape],
  'partitions?': 'boolean', 'connections?': [{ a: 'string', b: 'string', at: 'number', width: 'number' }],
  'stairs?': [stairShape],
  openings: [{ floor: 'number', side: 'string', at: 'number', kind: 'string', 'cell?': { x: 'number', y: 'number' } }],
  roof: 'string', 'roofAxis?': 'string', theme: 'string', windowStride: 'number',
  'coreCollapse?': { supports: [{ x: 'number', y: 'number', weight: 'number' }], capacityThreshold: 'number', warningDuration: 'number', duration: 'number' },
  'elevatedTank?': { radius: 'number', height: 'number', minimumLegs: 'number', warningDuration: 'number', fallDuration: 'number' },
  'canopy?': { columns: [{ x: 'number', y: 'number' }] },
  'silos?': [{ id:'string',gx:'number',gy:'number',diameter:'number',height:'number',minimumSupports:'number',feed:{gx:'number',gy:'number',floor:'number'} }],
  'openDecks?': { columns: [{ x: 'number', y: 'number' }] },
  'floorVoids?': [{ floor:'number', x:'number', y:'number', w:'number', d:'number' }],
  'cellSize?': 'number', 'generationOrder?': 'number',
  'traits?': { 'use?': ['string'], 'form?': ['string'], 'construction?': ['string'], 'style?': ['string'], 'era?': ['string'], 'scale?': ['string'] },
  features: { porch: 'boolean', awning: 'boolean', parapet: 'boolean', chimney: 'boolean', garage: 'boolean' },
  'facadeDetails?': [{ id: 'string', kind: 'string', floor: 'number', gx: 'number', gy: 'number', side: 'string', width: 'number', 'text?': 'string' }],
  zones: { residential: 'number', commercial: 'number', industrial: 'number' },
  'campaign?': { levels: { '*': 'number' }, 'maxRepeats?': 'number', 'landmarkOnly?': 'boolean', 'zones?': ['string'], 'family?': 'string', 'exception?': 'boolean', 'urbanBands?': ['string'], 'streetRole?': 'string' } };

const BUILDING_KINDS: readonly string[] = ['house', 'shop', 'industrial'];
const ROOF_STYLES: readonly string[] = ['gable', 'flat', 'shed', 'sawtooth'];
const ROOF_AXES: readonly string[] = ['x', 'y'];
const FACADE_THEMES: readonly string[] = ['cottage', 'ranch', 'colonial', 'walkup', 'porch', 'storefront', 'corner', 'civic', 'warehouse'];
const DETAIL_SIDES: readonly string[] = ['south', 'east'];
const GROUND_DETAILS: readonly string[] = ['entry-steps', 'porch', 'roll-up-door'];
const OPENING_KINDS: readonly string[] = ['door', 'loading'];
/** The support cell and its four neighbours must all sit inside the ground footprint. */
const SUPPORT_CROSS = [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]] as const;
type GridPoint = { x: number; y: number };
type FloorVoid = NonNullable<Archetype['floorVoids']>[number];
type StairDef = NonNullable<LayoutDef['stairs']>[number];
type RoomDef = LayoutDef['rooms'][number];
type SiloDef = NonNullable<Archetype['silos']>[number];

const within = (n: number, lo: number, hi: number): boolean => n >= lo && n <= hi;
const oddWithin = (n: number, lo: number, hi: number): boolean => within(n, lo, hi) && n % 2 === 1;
const occupied = (a: Archetype, floor: number, x: number, y: number): boolean => a.footprint[floor]?.[y]?.[x] === '#';
const voidCovers = (a: Archetype, floor: number, gx: number, gy: number): boolean =>
  !!a.floorVoids?.some(v => v.floor === floor && gx >= v.x && gx < v.x + v.w && gy >= v.y && gy < v.y + v.d);

export function validateBuildingDefinition(a: Archetype): string[] {
  const issues = validateConstruction(a.construction);
  const fatal = definitionHeaderIssue(a, issues);
  if (fatal) return [...issues, fatal];
  coreCollapseIssues(a, issues);
  floorVoidIssues(a, issues);
  elevatedTankIssues(a, issues);
  facadeDetailIssues(a, issues);
  if (!a.elevatedTank) issues.push(...validateLayout(a.layout, a.w, a.d, a.floors, occupiedMask(a), a.openings));
  for (const stair of a.layout.stairs ?? []) stairIssues(a, stair, issues);
  canopyIssues(a, issues);
  openDeckIssues(a, issues);
  siloIssues(a, issues);
  openingIssues(a, issues);
  return issues;
}
/** Push recoverable header issues; return the first one that makes deeper checks meaningless. */
function definitionHeaderIssue(a: Archetype, issues: string[]): string | undefined {
  if (!a.id.trim() || !a.label.trim()) issues.push('Building needs an id and label');
  if (![a.w, a.d, a.floors].every(n => Number.isInteger(n) && n > 0 && n <= 64)) return 'Invalid building dimensions (1–64 cells/floors)';
  if (a.w * a.d * a.floors > 8192) return 'Building exceeds 8192 grid slots; reduce cells or split the site';
  if (a.cellSize !== undefined && !(Number.isFinite(a.cellSize) && within(a.cellSize, .5, 4))) issues.push('cellSize must be 0.5–4 world units');
  if (a.layout.rooms.length > 256 || a.layout.rooms.reduce((n, r) => n + r.contents.length, 0) > 512) return 'Building exceeds 256 rooms or 512 contents';
  if (!knownStyle(a)) issues.push('Unknown building kind, roof, axis or theme');
  if (!Number.isInteger(a.windowStride) || a.windowStride < 1 || Object.values(a.zones).some(n => !Number.isFinite(n) || n < 0)) issues.push('Invalid window stride or zoning weight');
  if (!footprintMatches(a)) return 'Footprint dimensions must match building dimensions and use # or .';
  return undefined;
}
function knownStyle(a: Archetype): boolean {
  return BUILDING_KINDS.includes(a.kind) && ROOF_STYLES.includes(a.roof) &&
    (a.roofAxis === undefined || ROOF_AXES.includes(a.roofAxis)) && FACADE_THEMES.includes(a.theme);
}
function footprintMatches(a: Archetype): boolean {
  return a.footprint.length === a.floors && a.footprint.every(layer => layer.length === a.d &&
    layer.every(row => row.length === a.w && !/[^#.]/.test(row)) && layer.some(row => row.includes('#')));
}
function coreCollapseIssues(a: Archetype, issues: string[]): void {
  const c = a.coreCollapse;
  if (!c) return;
  if (!(a.floors >= 4 && a.roof === 'flat' && within(c.supports.length, 3, 32) && c.capacityThreshold > 0 && c.capacityThreshold < 1 &&
    within(c.warningDuration, .5, 5) && within(c.duration, 2, 12))) issues.push('Invalid coreCollapse configuration');
  const keys = new Set<string>();
  for (const p of c.supports) {
    const key = p.x + ':' + p.y;
    if (!coreSupportValid(a, p) || keys.has(key)) issues.push('Invalid or duplicate coreCollapse support ' + key + '; supports must be inside the ground footprint');
    keys.add(key);
  }
}
function coreSupportValid(a: Archetype, p: GridPoint & { weight: number }): boolean {
  return Number.isInteger(p.x) && Number.isInteger(p.y) && p.weight > 0 && p.weight <= 10 &&
    SUPPORT_CROSS.every(([dx, dy]) => occupied(a, 0, p.x + dx, p.y + dy));
}
function floorVoidIssues(a: Archetype, issues: string[]): void {
  const count = a.floorVoids?.length ?? 0;
  if (count > 16 || (count && (a.coreCollapse || a.elevatedTank))) issues.push('Unsupported floor void configuration');
  for (const v of a.floorVoids ?? []) {
    if (!floorVoidInBounds(a, v)) { issues.push('Invalid floor void'); continue; }
    floorVoidEnvelopeIssues(a, v, issues);
    for (const r of a.layout.rooms) if (r.floor === v.floor) fixtureVoidIssues(a, r, v, issues);
  }
}
function floorVoidEnvelopeIssues(a: Archetype, v: FloorVoid, issues: string[]): void {
  for (let x = v.x; x < v.x + v.w; x++) for (let y = v.y; y < v.y + v.d; y++)
    if (!occupied(a, v.floor, x, y)) issues.push('Floor void crosses unoccupied envelope');
}
function floorVoidInBounds(a: Archetype, v: FloorVoid): boolean {
  return Object.values(v).every(Number.isInteger) && v.floor >= 1 && v.floor < a.floors && v.w >= 1 && v.d >= 1 &&
    v.x >= 0 && v.y >= 0 && v.x + v.w <= a.w && v.y + v.d <= a.d;
}
function fixtureVoidIssues(a: Archetype, r: RoomDef, v: FloorVoid, issues: string[]): void {
  for (const s of r.contents) {
    const x = (r.x + s.x * r.w) * a.w, y = (r.y + s.y * r.d) * a.d, w = s.w * r.w * a.w, d = s.d * r.d * a.d;
    if (x < v.x + v.w && x + w > v.x && y < v.y + v.d && y + d > v.y) issues.push('Fixture overlaps floor void: ' + s.id);
  }
}
function elevatedTankIssues(a: Archetype, issues: string[]): void {
  if (!a.elevatedTank) return;
  if (!elevatedTankHostValid(a) || !elevatedTankValid(a) || !elevatedTankBare(a)) issues.push('Invalid elevated tank configuration');
  if (a.footprint.some(layer => layer.some((row, y) => [...row].some((v, x) => (v === '#') !== ((x === 0 || x === a.w - 1) && (y === 0 || y === a.d - 1))))))
    issues.push('Elevated tank footprint must contain exactly four continuous corner legs');
}
function elevatedTankHostValid(a: Archetype): boolean {
  return !a.coreCollapse && a.roof === 'flat' && a.construction.walls === 'frame' && within(a.floors, 2, 6) && oddWithin(a.w, 3, 9) && oddWithin(a.d, 3, 9);
}
function elevatedTankValid(a: Archetype): boolean {
  const t = a.elevatedTank!;
  return within(t.radius, .5, Math.min(a.w, a.d) * (a.cellSize ?? 1.15) / 2) && within(t.height, .5, 4) && [3, 4].includes(t.minimumLegs) &&
    within(t.warningDuration, .2, 2) && within(t.fallDuration, 1, 5);
}
/** The tank's legs carry no rooms, partitions, facade dressing or entrances. */
function elevatedTankBare(a: Archetype): boolean {
  return !a.layout.rooms.length && !a.layout.partitions && !a.layout.connections?.length && !a.facadeDetails?.length && !a.openings.length;
}
function facadeDetailIssues(a: Archetype, issues: string[]): void {
  const detailIds = new Set<string>();
  for (const detail of a.facadeDetails ?? []) {
    if (detailIds.has(detail.id) || !facadeDetailValid(a, detail)) { issues.push('Invalid facade detail ' + detail.id); continue; }
    detailIds.add(detail.id);
    facadeDetailMountIssues(a, detail, issues);
  }
}
function facadeDetailValid(a: Archetype, detail: FacadeDetailDef): boolean {
  return !!detail.id.trim() && FACADE_DETAIL_KINDS.includes(detail.kind) && DETAIL_SIDES.includes(detail.side) &&
    [detail.floor, detail.gx, detail.gy, detail.width].every(Number.isInteger) && within(detail.width, 1, 4) && detail.floor >= 0 && detail.floor < a.floors &&
    (detail.text === undefined || /^[A-Z0-9 ]{1,16}$/.test(detail.text));
}
const topRoofMount = (a: Archetype, detail: FacadeDetailDef, roof: RoofStyle): boolean => a.roof === roof && detail.width === 1 && detail.floor === a.floors - 1;
function facadeDetailMountIssues(a: Archetype, detail: FacadeDetailDef, issues: string[]): void {
  if (detail.kind === 'roof-duct' && !topRoofMount(a, detail, 'flat')) issues.push('Roof ducts require a single mounting cell on the top flat roof');
  if (detail.kind === 'dormer' && !topRoofMount(a, detail, 'gable')) issues.push('Dormers require a single mounting cell on the top gable roof');
  if ((detail.kind === 'fire-escape' && detail.floor === 0) || (GROUND_DETAILS.includes(detail.kind) && detail.floor !== 0))
    issues.push('Invalid mounting floor for facade detail ' + detail.id);
  if (!facadeDetailExposed(a, detail)) issues.push('Facade detail requires exposed mounting cells: ' + detail.id);
}
function facadeDetailExposed(a: Archetype, detail: FacadeDetailDef): boolean {
  const south = detail.side === 'south';
  for (let i = 0; i < detail.width; i++) {
    const x = detail.gx + (south ? i : 0), y = detail.gy + (south ? 0 : i);
    if (!occupied(a, detail.floor, x, y) || occupied(a, detail.floor, x + (south ? 0 : 1), y + (south ? 1 : 0))) return false;
  }
  return true;
}
function stairIssues(a: Archetype, stair: StairDef, issues: string[]): void {
  const lower = a.layout.rooms.find(r => r.id === stair.a), upper = a.layout.rooms.find(r => r.id === stair.b);
  if (!lower || !upper) return;
  if (!a.layout.partitions) issues.push('Stair access requires an explicit partitioned plan');
  for (const { gx, gy } of stairLandingCells(stair, a.w, a.d, upper.floor))
    if (!occupied(a, upper.floor, gx, gy) || voidCovers(a, upper.floor, gx, gy)) issues.push('Stairs require a solid landing at their upper end');
  stairSlabIssues(a, stair, lower.floor, upper.floor, issues);
}
function stairSlabIssues(a: Archetype, stair: StairDef, lowerFloor: number, upperFloor: number, issues: string[]): void {
  for (let gx = 0; gx < a.w; gx++) for (let gy = 0; gy < a.d; gy++) {
    if (stairCovers(a, stair, gx, gy) && (!voidCovers(a, upperFloor, gx, gy) || voidCovers(a, lowerFloor, gx, gy)))
      issues.push('Stairs require a supporting lower slab and an open upper slab');
  }
}
function stairCovers(a: Archetype, stair: StairDef, gx: number, gy: number): boolean {
  return !(gx / a.w >= stair.x + stair.w || (gx + 1) / a.w <= stair.x || gy / a.d >= stair.y + stair.d || (gy + 1) / a.d <= stair.y);
}
const gridCellInside = (a: Archetype, p: GridPoint): boolean =>
  Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < a.w && p.y < a.d;
/** min-max distinct column cells, each accepted by `standsOn`. */
function columnsValid(a: Archetype, columns: GridPoint[], min: number, max: number, standsOn: (p: GridPoint) => boolean): boolean {
  return within(columns.length, min, max) && new Set(columns.map(p => `${p.x},${p.y}`)).size === columns.length &&
    columns.every(p => gridCellInside(a, p) && standsOn(p));
}
function canopyIssues(a: Archetype, issues: string[]): void {
  if (!a.canopy) return;
  const hostValid = a.floors === 1 && a.roof === 'flat' && !a.elevatedTank && !a.coreCollapse && !a.floorVoids?.length && !a.openings.length &&
    !a.layout.partitions && !a.layout.rooms.some(r => r.contents.length);
  if (!hostValid || !columnsValid(a, a.canopy.columns, 4, 8, p => occupied(a, 0, p.x, p.y)))
    issues.push('Canopies require a one-level flat roof, 4-8 distinct occupied column cells, empty unpartitioned space and no entrance panels');
}
function openDeckIssues(a: Archetype, issues: string[]): void {
  if (!a.openDecks) return;
  const hostValid = within(a.floors, 2, 6) && a.roof === 'flat' && !a.canopy && !a.elevatedTank && !a.coreCollapse;
  if (!hostValid || !columnsValid(a, a.openDecks.columns, 4, 16, p => a.footprint.every(f => f[p.y]?.[p.x] === '#')))
    issues.push('Open decks require 2-6 levels and 4-16 distinct continuous column cells');
}
function siloIssues(a: Archetype, issues: string[]): void {
  const silos = a.silos;
  if (!silos) return;
  if (!within(silos.length, 1, 4) || a.canopy || a.openDecks || a.elevatedTank || a.coreCollapse) issues.push('Silos require an ordinary headhouse and 1-4 bins');
  const ids = new Set<string>();
  for (const s of silos) {
    if (ids.has(s.id) || !siloBinValid(a, s) || !siloSupportValid(a, s)) issues.push('Invalid silo dimensions, support threshold or feed mount');
    ids.add(s.id);
    siloBaseIssues(a, s, issues);
    for (const other of silos) if (other !== s && silosOverlap(s, other)) issues.push('Silo bins overlap');
  }
}
function siloBaseIssues(a: Archetype, s: SiloDef, issues: string[]): void {
  for (let y = s.gy; y < s.gy + s.diameter; y++) for (let x = s.gx; x < s.gx + s.diameter; x++)
    if (!occupied(a, 0, x, y) || a.footprint.slice(1).some(f => f[y]?.[x] === '#')) issues.push('Silos require an occupied base without upper floor rooms');
}
function siloBinValid(a: Archetype, s: SiloDef): boolean {
  return !!s.id && [s.gx, s.gy, s.diameter, s.minimumSupports, s.feed.gx, s.feed.gy, s.feed.floor].every(Number.isInteger) &&
    oddWithin(s.diameter, 5, 9) && s.gx >= 0 && s.gy >= 0 && s.gx + s.diameter <= a.w && s.gy + s.diameter <= a.d;
}
function siloSupportValid(a: Archetype, s: SiloDef): boolean {
  return Number.isFinite(s.height) && within(s.height, 3, a.floors * 2.35) && within(s.minimumSupports, 3, 7) && occupied(a, s.feed.floor, s.feed.gx, s.feed.gy);
}
const silosOverlap = (s: SiloDef, o: SiloDef): boolean =>
  s.gx < o.gx + o.diameter && s.gx + s.diameter > o.gx && s.gy < o.gy + o.diameter && s.gy + s.diameter > o.gy;
function openingIssues(a: Archetype, issues: string[]): void {
  if (!a.elevatedTank && !a.canopy && !a.openings.some(o => o.floor === 0)) issues.push('Building needs a ground-floor entrance');
  for (const opening of a.openings) {
    const issue = openingIssue(a, opening);
    if (issue) issues.push(issue);
  }
}
function openingIssue(a: Archetype, opening: OpeningDef): string | undefined {
  if (!(Number.isInteger(opening.floor) && opening.floor >= 0 && opening.floor < a.floors && opening.side === 'south' &&
    Number.isFinite(opening.at) && within(opening.at, 0, 1) && OPENING_KINDS.includes(opening.kind))) return 'Invalid entrance (supported frontage: south)';
  if (opening.cell) {
    const { x, y } = opening.cell;
    return Number.isInteger(x) && Number.isInteger(y) && occupied(a, opening.floor, x, y) && !occupied(a, opening.floor, x, y + 1) ? undefined : 'Entrance cell must touch exposed south frontage';
  }
  return a.footprint[opening.floor]![a.d - 1]!.includes('#') ? undefined : 'Entrance must touch occupied frontage';
}
export interface SectionDef {
  id: string; role: string; x: number; y: number; w: number; d: number;
  floor: number; floors: number; layout: string;
}
interface BuildingPackage extends Omit<Archetype, 'construction' | 'layout' | 'footprint'> {
  version: number; construction: string; layout?: string; footprint?: string[][];
  partitions?: boolean; connections?: LayoutDef['connections']; stairs?: LayoutDef['stairs'];
}
/** Lookups shared by every building package in one parse. */
interface PackageContext {
  constructions: Map<string, { file: string; def: ConstructionDef }>;
  layouts: Map<string, LayoutDef>;
  seen: Map<string, string>;
  orders: Map<number, string>;
  layoutOwners: Map<string, { id: string; file: string }>;
}
/** Pure seam also used by tests/tools. Layout references stay inside their owning directory. */
export function parseBuildingPackages(files: Record<string, unknown>): readonly Archetype[] {
  const entries = Object.entries(structuredClone(files)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const ctx: PackageContext = { constructions: new Map(), layouts: new Map(), seen: new Map(), orders: new Map(), layoutOwners: new Map() };
  for (const [file, input] of entries) {
    if (file.endsWith('.construction.json')) registerConstruction(file, input, ctx);
    else if (file.endsWith('.layout.json')) { checkShape(input, layoutShape, file); ctx.layouts.set(file, input as LayoutDef); }
  }
  const result: Archetype[] = [];
  for (const [file, input] of entries.filter(([file]) => file.endsWith('.building.json'))) {
    const label = `${file} (building ${(input as { id?: string } | null)?.id ?? '?'})`;
    try { result.push(parseBuildingPackage(file, input, label, ctx)); }
    catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return Object.freeze(result.sort((a, b) => (a.generationOrder ?? Number.MAX_SAFE_INTEGER) - (b.generationOrder ?? Number.MAX_SAFE_INTEGER) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}
function registerConstruction(file: string, input: unknown, ctx: PackageContext): void {
  checkShape(input, constructionShape, file);
  const def = input as ConstructionDef, prior = ctx.constructions.get(def.id);
  if (prior) throw new Error(`${file}: Duplicate construction id ${def.id}, first defined in ${prior.file}`);
  const issues = validateConstruction(def);
  if (issues.length) throw new Error(`${file} (construction ${def.id}): ${issues.join('; ')}`);
  ctx.constructions.set(def.id, { file, def });
}
function parseBuildingPackage(file: string, input: unknown, label: string, ctx: PackageContext): Archetype {
  checkShape(input, buildingShape, label);
  const entry = input as BuildingPackage;
  if (entry.campaign) entry.campaign = parseCampaignPlacement(entry.campaign, `${label}.campaign`);
  if (entry.version !== 1) throw new Error('Unsupported building package version');
  registerBuildingId(file, entry, ctx);
  const construction = ctx.constructions.get(entry.construction);
  if (!construction) throw new Error(`Unknown construction reference ${entry.construction}`);
  const { layout, footprint } = packageLayout(file, entry, ctx);
  const { version: _version, partitions: _partitions, connections: _connections, stairs: _stairs, ...definition } = entry;
  const a: Archetype = { ...definition, construction: structuredClone(construction.def), layout, footprint };
  const issues = validateBuildingDefinition(a);
  if (issues.length) throw new Error(`${entry.layout ?? entry.sections?.map(s => `${s.id}: ${s.layout}`).join(', ')}; construction ${construction.file}: ${issues.join('; ')}`);
  return freezeDefinition(a);
}
function registerBuildingId(file: string, entry: BuildingPackage, ctx: PackageContext): void {
  if (ctx.seen.has(entry.id)) throw new Error(`Duplicate building id ${entry.id}, first defined in ${ctx.seen.get(entry.id)}`);
  ctx.seen.set(entry.id, file);
  if (entry.generationOrder === undefined) return;
  if (!Number.isInteger(entry.generationOrder) || entry.generationOrder < 0 || ctx.orders.has(entry.generationOrder)) throw new Error(`Invalid or duplicate generationOrder (also ${ctx.orders.get(entry.generationOrder)})`);
  ctx.orders.set(entry.generationOrder, file);
}
function packageLayout(file: string, entry: BuildingPackage, ctx: PackageContext): { layout: LayoutDef; footprint: string[][] } {
  const readLayout = (ref: string): LayoutDef => readOwnedLayout(file, entry.id, ref, ctx);
  if (entry.sections) {
    if (entry.layout || entry.footprint) throw new Error('Use sections OR layout + footprint');
    return compileSections(entry, readLayout);
  }
  if (!entry.layout || !entry.footprint) throw new Error('Building needs layout + footprint or sections');
  if (entry.partitions !== undefined || entry.connections || entry.stairs) throw new Error('Flat packages own partitions, connections and stairs in their layout');
  return { layout: readLayout(entry.layout), footprint: entry.footprint };
}
function readOwnedLayout(file: string, id: string, ref: string, ctx: PackageContext): LayoutDef {
  if (!/^[a-zA-Z0-9_-]+\.layout\.json$/.test(ref)) throw new Error(`Layout reference ${ref} must be a sibling .layout.json file`);
  const path = file.slice(0, file.lastIndexOf('/') + 1) + ref;
  const layout = ctx.layouts.get(path);
  if (!layout) throw new Error(`Unknown layout reference ${path}`);
  const owner = ctx.layoutOwners.get(path);
  if (owner && owner.id !== id) throw new Error(`Layout ${path} is already owned by ${owner.id} in ${owner.file}; copy the layout for this building`);
  ctx.layoutOwners.set(path, { id, file });
  return structuredClone(layout);
}
type RoomList = LayoutDef['rooms'][number][];
type ConnectionList = NonNullable<LayoutDef['connections']>[number][];
function compileSections(entry: BuildingPackage, readLayout: (ref: string) => LayoutDef): { layout: LayoutDef; footprint: string[][] } {
  const { w, d, floors } = entry;
  if (![w, d, floors].every(n => Number.isInteger(n) && n > 0 && n <= 64) || w * d * floors > 8192) throw new Error('Invalid dimensions or exceeds 8192 grid slots');
  const sections = entry.sections;
  if (!sections?.length || sections.length > 64) throw new Error('Expected 1–64 sections');
  const mask = Array.from({ length: floors }, () => Array.from({ length: d }, () => Array<string>(w).fill('.')));
  const rooms: RoomList = [], connections: ConnectionList = [];
  const ids = new Set<string>();
  for (const s of sections) {
    checkSection(entry, s, ids);
    const template = readSectionTemplate(s, readLayout);
    for (let f = s.floor; f < s.floor + s.floors; f++) {
      stampSectionFloor(sections, s, f, mask);
      expandSectionFloor(entry, s, f, template, rooms, connections);
    }
  }
  return { footprint: mask.map(layer => layer.map(row => row.join(''))), layout: { partitions: entry.partitions ?? false, rooms, connections: [...connections, ...entry.connections ?? []], ...(entry.stairs ? { stairs: entry.stairs } : {}) } };
}
function checkSection(entry: BuildingPackage, s: SectionDef, ids: Set<string>): void {
  if (!s.id.trim() || s.id.includes('/') || ids.has(s.id) || !s.role.trim()) throw new Error(`Invalid or duplicate section ${s.id}`);
  ids.add(s.id);
  if (!sectionInBounds(entry, s)) throw new Error(`Section ${s.id}: invalid bounds`);
}
function sectionInBounds(entry: BuildingPackage, s: SectionDef): boolean {
  return [s.x, s.y, s.w, s.d, s.floor, s.floors].every(Number.isInteger) && s.x >= 0 && s.y >= 0 && s.floor >= 0 && s.w >= 1 && s.d >= 1 && s.floors >= 1 &&
    s.x + s.w <= entry.w && s.y + s.d <= entry.d && s.floor + s.floors <= entry.floors;
}
function readSectionTemplate(s: SectionDef, readLayout: (ref: string) => LayoutDef): LayoutDef {
  const template = readLayout(s.layout);
  if (template.stairs !== undefined) throw new Error('Section stair connections belong in the building package with expanded room IDs');
  const issues = validateLayout(template, s.w, s.d, 1, fullMask(1, s.w, s.d));
  if (issues.length) throw new Error(`Section ${s.id}, ${s.layout}: ${issues.join('; ')}`);
  return template;
}
const sectionHolds = (b: SectionDef, floor: number, x: number, y: number): boolean =>
  b.floor <= floor && b.floor + b.floors > floor && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.d;
function stampSectionFloor(sections: SectionDef[], s: SectionDef, f: number, mask: string[][][]): void {
  for (let y = s.y; y < s.y + s.d; y++) for (let x = s.x; x < s.x + s.w; x++) {
    if (mask[f]![y]![x] === '#') throw new Error(`Section ${s.id}: overlaps another section at ${f}:${x},${y}`);
    if (f > 0 && !sections.some(b => sectionHolds(b, f - 1, x, y))) throw new Error(`Section ${s.id}: unsupported overhang at ${f}:${x},${y}`);
    mask[f]![y]![x] = '#';
  }
}
function expandSectionFloor(entry: BuildingPackage, s: SectionDef, f: number, template: LayoutDef, rooms: RoomList, connections: ConnectionList): void {
  const { w, d } = entry;
  const id = (room: string) => `${s.id}/${f}/${room}`;
  for (const r of template.rooms) rooms.push({ ...structuredClone(r), id: id(r.id), floor: f, x: (s.x + r.x * s.w) / w, y: (s.y + r.y * s.d) / d, w: r.w * s.w / w, d: r.d * s.d / d });
  for (const c of template.connections ?? []) connections.push({ ...c, a: id(c.a), b: id(c.b) });
  if (rooms.length > 256 || rooms.reduce((n, r) => n + r.contents.length, 0) > 512) throw new Error('Expanded sections exceed 256 rooms or 512 contents');
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
