import { automaticCore, DETAILED_FLOORS, initializeCore, stepCoreCollapse, type CoreImpact } from './coreCollapse';
import { initializeElevatedTank, stepElevatedTank } from './elevatedTank';
import { siloAt, siloSupports, stepSilos } from './silos';
import { initializeFacadeDetails } from './facadeDetails';
import { CELL } from "../game/constants";
import { cashFor } from "./cellCash";
import { validateConstruction, validateLayout, roomAt, openingCell, type LayoutDef, type OpeningDef, type ConstructionDef } from "./construction";
import { debrisKind, ParticlePool } from "../fx/particles";
import { archetypeById, fullMask, occupiedMask, validateBuildingDefinition, type ArchetypeId, type Archetype } from "../world/archetypes";
import type {
  Building,
  BuildingFeatureSpec,
  BuildingKind,
  Cell,
  DecorBox,
  FacadeTheme,
  Material,
  RoofAxis,
  RoofStyle,
  WorldEvent,
} from "./types";
import { beamSpan, cellCenter, cellPresent, materialHp } from "./types";
import { generateInteriors, stepInteriors, type FixtureFrag } from "./interior";
import { generateRoofs, roofsNeedStep, stepRoofs, type RoofDebrisSpawn } from "./roof";

let nextId = 1;

function makeCell(gx: number, gy: number, floor: number, material: Material, isSupport: boolean): Cell {
  const hp = materialHp(material);
  return {
    exterior: { north: false, south: false, east: false, west: false },
    gx,
    gy,
    floor,
    material,
    hp,
    maxHp: hp,
    isSupport,
    state: "intact",
    sag: 0,
    unsupportedTime: 0,
    fallT: 0,
    fallDx: 0,
    fallDy: 0,
    lastHitNx: 0,
    lastHitNy: 0,
    windowN: false,
    windowE: false,
    windowS: false,
    windowW: false,
    doorS: false,
    loadingS: false,
    facadeMaterial: material,
  };
}

export interface BuildingSpec {
  facadeDetails?: import('./facadeDetails').FacadeDetailDef[];
  construction: ConstructionDef;
  layout: LayoutDef;
  openings: OpeningDef[];
  kind: BuildingKind;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  floors: number;
  roof: RoofStyle;
  cellSize?: number;
  archetypeId?: string;
  theme?: FacadeTheme;
  roofAxis?: RoofAxis;
  mask?: boolean[][][];
  features?: Partial<BuildingFeatureSpec>;
  windowStride?: number;
}

function defaultTheme(kind: BuildingKind): FacadeTheme {
  switch (kind) {
    case "house":
      return "cottage";
    case "shop":
      return "storefront";
    case "industrial":
      return "warehouse";
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

function applyFacade(
  cell: Cell,
  spec: BuildingSpec,
  occupied: boolean[][][],
  gx: number,
  gy: number,
  floor: number,
): void {
  const exposed = exposedSides(spec, occupied, gx, gy, floor);
  if (!(exposed.north || exposed.south || exposed.west || exposed.east)) return;
  if (floor > 0 || spec.floors === 1) upperWindows(cell, spec, exposed, gx, gy);
  if (floor === 0) groundWindows(cell, exposed, gx, gy);
}

type ExposedSides = { north: boolean; south: boolean; west: boolean; east: boolean };

/** Sides on the building edge or facing an unoccupied cell on the same floor. */
function exposedSides(spec: BuildingSpec, occupied: boolean[][][], gx: number, gy: number, floor: number): ExposedSides {
  return {
    north: gy === 0 || !maskAt(occupied, floor, gx, gy - 1),
    south: gy === spec.d - 1 || !maskAt(occupied, floor, gx, gy + 1),
    west: gx === 0 || !maskAt(occupied, floor, gx - 1, gy),
    east: gx === spec.w - 1 || !maskAt(occupied, floor, gx + 1, gy),
  };
}

/** Ground floors add alternating windows on north, east and west walls; the south frontage holds doors. */
function groundWindows(cell: Cell, exposed: ExposedSides, gx: number, gy: number): void {
  if (exposed.north && gx % 2 === 1) cell.windowN = true;
  if (exposed.east && gy % 2 === 0) cell.windowE = true;
  if (exposed.west && gy % 2 === 0) cell.windowW = true;
}

/** Upper-floor (or single-storey) windows: grouped themes glaze every exposed bay, others every `stride` cells. */
function upperWindows(cell: Cell, spec: BuildingSpec, exposed: ExposedSides, gx: number, gy: number): void {
  const stride = spec.windowStride ?? (spec.kind === "house" ? 1 : 2);
  const grouped = spec.theme === "colonial" || spec.theme === "civic";
  const windowHere = grouped ? gx % 2 === 0 || gx % 2 === 1 : gx % stride === 0 || gy % stride === 0;
  const sideWindow = grouped || gy % stride === 0;
  if (exposed.north && windowHere) cell.windowN = true;
  if (exposed.east && sideWindow) cell.windowE = true;
  if (exposed.south && windowHere) cell.windowS = true;
  if (exposed.west && sideWindow) cell.windowW = true;
}

function placeOpenings(spec: BuildingSpec, grid: Cell[][][], occupied: boolean[][][]): void {
  for (const opening of spec.openings) {
    const resolved = openingCell(opening, spec.w, spec.d, occupied);
    if (!resolved) throw new Error('Entrance must touch exposed south frontage');
    const { gx, gy, frontage: south } = resolved;
    const cell = grid[opening.floor]![gx]![gy]!;
    if (opening.kind === 'loading') {
      for (const x of south) if (Math.abs(x - gx) <= 1) grid[opening.floor]![x]![gy]!.loadingS = true;
    } else cell.doorS = true;
  }
}

function makeDecor(spec: BuildingSpec, cellSize: number, features: BuildingFeatureSpec): DecorBox[] {
  const boxes: DecorBox[] = [];
  const bw = spec.w * cellSize;
  const bd = spec.d * cellSize;
  if (features.porch) {
    boxes.push({
      x: spec.x + bw * 0.22,
      y: spec.y + bd - 0.02,
      w: bw * 0.42,
      d: 0.55,
      kind: "porch",
    });
  }
  if (features.awning) {
    boxes.push({
      x: spec.x + 0.08,
      y: spec.y + bd - 0.02,
      w: bw - 0.16,
      d: 0.38,
      kind: "awning",
    });
  }
  if (features.chimney) {
    boxes.push({
      x: spec.x + bw - cellSize * 0.55,
      y: spec.y + 0.12,
      w: 0.38,
      d: 0.38,
      kind: "chimney",
    });
  }
  if (features.parapet) {
    boxes.push({
      x: spec.x - 0.04,
      y: spec.y - 0.04,
      w: bw + 0.08,
      d: bd + 0.08,
      kind: "parapet",
    });
  }
  return boxes;
}

type SiloSpec = NonNullable<Archetype['silos']>[number];
type SiloMount = ReturnType<typeof siloSupports>[number];
type ColumnFrame = NonNullable<Archetype['canopy']>;
/** Everything one grid cell needs to decide its role while the building is assembled. */
interface CellGridBuild {
  spec: BuildingSpec;
  archetype: Archetype | undefined;
  mask: boolean[][][];
  frame: ColumnFrame | undefined;
  cellSize: number;
}

const maskAt = (mask: boolean[][][], floor: number, gx: number, gy: number): boolean => mask[floor]?.[gx]?.[gy] === true;
const sameFrame = (spec: BuildingSpec, a: Archetype): boolean => spec.w === a.w && spec.d === a.d && spec.floors === a.floors;

function checkPlacement(spec: BuildingSpec, cellSize: number): void {
  if (![spec.w, spec.d, spec.floors].every(n => Number.isInteger(n) && n > 0 && n <= 64) || ![spec.x, spec.y, cellSize].every(Number.isFinite) || cellSize <= 0) throw new Error('Invalid building dimensions or placement');
  if (spec.w * spec.d * spec.floors > 8192) throw new Error('Building exceeds 8192 grid slots');
}

/** Assemblies with authored structure cannot be resized or re-roofed by the placer. */
function checkAuthoredFrame(spec: BuildingSpec, a: Archetype): void {
  const authored = sameFrame(spec, a);
  if (a.silos && !authored) throw new Error('Silo assemblies require authored dimensions');
  if (a.openDecks && !authored) throw new Error('Open decks require their authored frame dimensions');
  if (a.floorVoids?.length && !authored) throw new Error('Floor openings require authored building dimensions');
  checkFlatRoofAssembly(spec, a, authored);
}

/** Canopies, core-collapse towers and elevated tanks also keep their authored flat roof. */
function checkFlatRoofAssembly(spec: BuildingSpec, a: Archetype, authored: boolean): void {
  const flat = spec.roof === 'flat';
  if (a.canopy && !(spec.w === a.w && spec.d === a.d && spec.floors === 1 && flat)) throw new Error('Canopies require their authored frame dimensions');
  if (a.coreCollapse && !(authored && flat)) throw new Error('Core-collapse buildings require their authored dimensions and flat roof; create a variation to move supports');
  if (a.elevatedTank && !(authored && flat && !spec.layout.rooms.length && !spec.layout.partitions && !spec.openings.length)) throw new Error('Elevated tanks require their authored frame dimensions and no enclosed rooms');
}

function featureFlag(spec: BuildingSpec, archetype: Archetype | undefined, key: keyof BuildingFeatureSpec, fallback: boolean): boolean {
  return spec.features?.[key] ?? archetype?.features[key] ?? fallback;
}

function resolveFeatures(spec: BuildingSpec, archetype: Archetype | undefined): BuildingFeatureSpec {
  return {
    porch: featureFlag(spec, archetype, 'porch', false),
    awning: featureFlag(spec, archetype, 'awning', false),
    parapet: featureFlag(spec, archetype, 'parapet', spec.roof === "flat"),
    chimney: featureFlag(spec, archetype, 'chimney', spec.kind === "house"),
    garage: featureFlag(spec, archetype, 'garage', false),
  };
}

function resolveMask(spec: BuildingSpec, archetype: Archetype | undefined): boolean[][][] {
  const mask = spec.mask ?? (archetype ? occupiedMask(archetype, spec.w, spec.d, spec.floors) : fullMask(spec.floors, spec.w, spec.d));
  if (mask.length !== spec.floors || mask.some(layer => layer.length !== spec.w || layer.some(col => col.length !== spec.d || col.some(v => typeof v !== 'boolean')))) throw new Error('Invalid footprint dimensions');
  return mask;
}

function checkOpenings(spec: BuildingSpec): void {
  for (const opening of spec.openings) {
    if (opening.side !== 'south' || !['door', 'loading'].includes(opening.kind) || !Number.isInteger(opening.floor) || opening.floor < 0 || opening.floor >= spec.floors || !Number.isFinite(opening.at) || opening.at < 0 || opening.at > 1) throw new Error('Invalid entrance');
  }
}

function resolveStyle(spec: BuildingSpec, archetype: Archetype | undefined): { theme: FacadeTheme; roofAxis: RoofAxis; windowStride: number } {
  return {
    theme: spec.theme ?? archetype?.theme ?? defaultTheme(spec.kind),
    roofAxis: spec.roofAxis ?? archetype?.roofAxis ?? (spec.w >= spec.d ? "x" : "y"),
    windowStride: spec.windowStride ?? archetype?.windowStride ?? 2,
  };
}

export function createBuilding(spec: BuildingSpec, definition?: Archetype): Building {
  const cellSize = spec.cellSize ?? CELL;
  checkPlacement(spec, cellSize);
  const archetype = definition ?? (spec.archetypeId ? archetypeById(spec.archetypeId) : undefined);
  if (archetype) checkAuthoredFrame(spec, archetype);
  const construction = spec.construction;
  const constructionIssues = validateConstruction(construction);
  if (constructionIssues.length) throw new Error(`Invalid construction ${construction.id}: ${constructionIssues.join("; ")}`);
  const features = resolveFeatures(spec, archetype);
  const mask = resolveMask(spec, archetype);
  checkOpenings(spec);
  const { theme, roofAxis, windowStride } = resolveStyle(spec, archetype);
  const filled: BuildingSpec = { ...spec, theme, windowStride };
  const layoutIssues = archetype?.elevatedTank ? [] : validateLayout(spec.layout, spec.w, spec.d, spec.floors, mask, spec.openings);
  if (layoutIssues.length) throw new Error(`Invalid layout: ${layoutIssues.join("; ")}`);
  const { grid, cells } = buildCellGrid({ spec: filled, archetype, mask, frame: archetype?.canopy ?? archetype?.openDecks, cellSize });
  placeOpenings(filled, grid, mask);

  // The bearing line depends only on floor and x, not on each individual slab tile.
  const bearing = Array.from({ length: spec.floors }, (_, floor) =>
    Array.from({ length: spec.w }, (_, gx) => cells.filter(c => c.floor === floor && c.isSupport && (archetype?.openDecks || Math.abs(c.gx - gx) <= 1))
      .map(c => ({ gx: c.gx, gy: c.gy }))));
  if (archetype?.sections) assignTransferSupport(cells, grid, bearing);

  const building: Building = {
    ...assemblyFlags(archetype),
    visualRevision: 1,
    retired: false,
    settledAwayTime: 0,
    construction,
    layout: spec.layout,
    lotId: null,
    floorTiles: makeFloorTiles(spec, mask, bearing, archetype),
    id: nextId++,
    kind: spec.kind,
    name: spec.name,
    archetypeId: spec.archetypeId ?? construction.id,
    theme,
    x: spec.x,
    y: spec.y,
    w: spec.w,
    d: spec.d,
    elev: 0,
    floors: spec.floors,
    cellSize,
    roof: spec.roof,
    roofAxis,
    windowStride,
    features,
    facadeDetails: structuredClone(spec.facadeDetails ?? archetype?.facadeDetails ?? []),
    decorBoxes: makeDecor(spec, cellSize, features),
    fixtures: [],
    cells,
    grid,
    roofs: [],
    fullyDown: false,
    collapseBonusPaid: false,
    leanX: 0,
    leanY: 0,
    structureDirty: false,
    collisionDirty: true,
    roofDirty: false,
  };
  initializeAssemblies(building, archetype);
  return building;
}

function buildCellGrid(b: CellGridBuild): { grid: Cell[][][]; cells: Cell[] } {
  const grid: Cell[][][] = [];
  const cells: Cell[] = [];
  for (let floor = 0; floor < b.spec.floors; floor++) {
    const layer: Cell[][] = [];
    for (let gx = 0; gx < b.spec.w; gx++) {
      const col: Cell[] = [];
      for (let gy = 0; gy < b.spec.d; gy++) {
        const cell = makeGridCell(b, floor, gx, gy);
        col.push(cell);
        if (cell.state !== "gone") cells.push(cell);
      }
      layer.push(col);
    }
    grid.push(layer);
  }
  return { grid, cells };
}

function makeGridCell(b: CellGridBuild, floor: number, gx: number, gy: number): Cell {
  const { mask, archetype } = b;
  const coreSupport = floor === 0 && !!archetype?.coreCollapse?.supports.some(p => p.x === gx && p.y === gy);
  const silo = floor === 0 ? siloAt(archetype?.silos ?? [], gx, gy) : undefined;
  const siloMount = silo ? siloSupports(silo).find(p => p.gx === gx && p.gy === gy) : undefined;
  const live = cellBears(b, floor, gx, gy, coreSupport, silo, siloMount);
  const cell = makeCell(gx, gy, floor, b.spec.construction.structure, live);
  cell.exterior = { north: !maskAt(mask, floor, gx, gy - 1), south: !maskAt(mask, floor, gx, gy + 1), west: !maskAt(mask, floor, gx - 1, gy), east: !maskAt(mask, floor, gx + 1, gy) };
  applyCellRole(cell, b, coreSupport);
  if (!live) {
    cell.state = "gone";
    cell.hp = 0;
    return cell;
  }
  if (!b.frame && !silo) applyFacade(cell, b.spec, mask, gx, gy, floor);
  if (silo && siloMount) mountSiloCell(cell, silo, siloMount, b.cellSize);
  return cell;
}

/** Whether this grid slot holds a standing, load-bearing-capable cell. */
function cellBears(b: CellGridBuild, floor: number, gx: number, gy: number, coreSupport: boolean, silo: SiloSpec | undefined, siloMount: SiloMount | undefined): boolean {
  const { mask, frame } = b;
  if (!maskAt(mask, floor, gx, gy)) return false;
  if (silo) return !!siloMount;
  if (frame) return !(b.archetype?.openDecks && floor === b.spec.floors - 1) && frame.columns.some(p => p.x === gx && p.y === gy);
  const edge = !maskAt(mask, floor, gx - 1, gy) || !maskAt(mask, floor, gx + 1, gy) || !maskAt(mask, floor, gx, gy - 1) || !maskAt(mask, floor, gx, gy + 1);
  return edge || coreSupport;
}

function applyCellRole(cell: Cell, b: CellGridBuild, coreSupport: boolean): void {
  const construction = b.spec.construction, mat = construction.structure;
  cell.role = construction.walls === "frame" && (cell.gy === 0 || cell.gy === b.spec.d - 1) && cell.gx % 2 === 0 ? "column" : "wall";
  cell.isSupport = construction.walls !== "frame" || cell.role === "column";
  cell.facadeMaterial = construction.skin;
  if (cell.role === "column") cell.cladding = { material: construction.skin, hp: 12, maxHp: 12, shed: false };
  if (construction.walls === "frame" && cell.role === "wall") {
    cell.hp = cell.maxHp = materialHp(mat) * .35;
    if (construction.skin === 'glass') {
      cell.material = 'glass';
      cell.hp = cell.maxHp = materialHp('glass');
    }
  }
  if (b.archetype?.coreCollapse) { cell.isSupport = coreSupport; cell.coreSupport = coreSupport; if (coreSupport) cell.role = "column"; }
  if (b.frame) { cell.role = 'column'; cell.isSupport = true; cell.cladding = undefined; cell.hp = cell.maxHp = materialHp(mat); }
}

function mountSiloCell(cell: Cell, silo: SiloSpec, siloMount: SiloMount, cellSize: number): void {
  cell.silo={id:silo.id,cx:(silo.gx+silo.diameter/2)*cellSize,cy:(silo.gy+silo.diameter/2)*cellSize,radius:silo.diameter*cellSize/2,angle:siloMount.angle};
  cell.exterior={north:false,south:false,east:false,west:false};cell.role='wall';cell.isSupport=true;cell.cladding=undefined;
  cell.material='metal';cell.hp=cell.maxHp=materialHp('metal');
}

function assignTransferSupport(cells: Cell[], grid: Cell[][][], bearing: { gx: number; gy: number }[][][]): void {
  for (const cell of cells) {
    // Setbacks bear on the lower slab's existing bearing line. Transfer disappears
    // when that line is lost; this is a controlled collapse model, not engineering FEA.
    if (cell.floor > 0 && !cellPresent(grid[cell.floor - 1]![cell.gx]![cell.gy]!)) {
      cell.transferSupport = bearing[cell.floor - 1]![cell.gx];
    }
  }
}

function assemblyFlags(archetype: Archetype | undefined): Pick<Building, 'silos' | 'canopy' | 'openDecks'> {
  return {
    ...(archetype?.silos?{silos:archetype.silos.map(definition=>({definition,phase:'standing' as const,progress:0,dx:0,dy:0}))}:{}),
    ...(archetype?.canopy ? { canopy: true } : {}),
    ...(archetype?.openDecks ? { openDecks: true } : {}),
  };
}

function makeFloorTiles(spec: BuildingSpec, mask: boolean[][][], bearing: { gx: number; gy: number }[][][], archetype: Archetype | undefined): Building['floorTiles'] {
  return Array.from({ length: spec.floors }, (_, floor) =>
    Array.from({ length: spec.w }, (_, gx) => Array.from({ length: spec.d }, (_, gy) => ({
      gx, gy, floor, roomId: "", state: "intact" as const, fallT: 0,
      ...(archetype?.floorVoids?.some(v=>v.floor===floor && gx>=v.x && gx<v.x+v.w && gy>=v.y && gy<v.y+v.d)?{void:true}:{}),
      support: floor === 0 ? [] : bearing[floor - 1]![gx]!,
    })).filter(t => mask[floor]?.[gx]?.[t.gy])).flat()).flat();
}

function initializeAssemblies(building: Building, archetype: Archetype | undefined): void {
  if(archetype?.elevatedTank) initializeElevatedTank(building, archetype.elevatedTank);
  else initializeEnclosure(building, archetype);
  if (archetype?.coreCollapse) initializeCore(building, archetype.coreCollapse);
  else if (building.floors > DETAILED_FLOORS && !building.elevatedTank) initializeCore(building, automaticCore(building));
  initializeFacadeDetails(building);
}

/** Rooms, roofs and fixtures for every building that is not a bare tank frame. */
function initializeEnclosure(building: Building, archetype: Archetype | undefined): void {
  for (const tile of building.floorTiles) tile.roomId = roomAt(building, tile.gx, tile.gy, tile.floor)!.id;
  const allTiles=building.floorTiles;
  if(archetype?.silos)building.floorTiles=allTiles.filter(t=>!siloAt(archetype.silos!,t.gx,t.gy));
  building.roofs = archetype?.openDecks ? [] : generateRoofs(building);
  building.floorTiles=allTiles;
  if (archetype?.canopy) for (const roof of building.roofs) roof.support = archetype.canopy.columns.map(p => ({ gx: p.x, gy: p.y }));
  building.fixtures = generateInteriors(building);
}
export function createBuildingFromArchetype(
  archetypeId: ArchetypeId | string,
  name: string,
  x: number,
  y: number,
  overrides: Partial<Pick<BuildingSpec, "w" | "d" | "floors" | "roof" | "roofAxis">> = {},
): Building {
  return createBuildingFromDefinition(archetypeById(archetypeId), name, x, y, overrides);
}

export function createBuildingFromDefinition(a: Archetype, name: string, x: number, y: number, overrides: Partial<Pick<BuildingSpec, "w" | "d" | "floors" | "roof" | "roofAxis">> = {}): Building {
  const issues = validateBuildingDefinition(a);
  if (issues.length) throw new Error(`Invalid building ${a.id}: ${issues.join("; ")}`);
  return createBuilding({
    construction: a.construction, layout: a.layout, openings: a.openings,
    cellSize: a.cellSize,
    kind: a.kind,
    name,
    x,
    y,
    w: overrides.w ?? a.w,
    d: overrides.d ?? a.d,
    floors: overrides.floors ?? a.floors,
    roof: overrides.roof ?? a.roof,
    archetypeId: a.id,
    theme: a.theme,
    roofAxis: overrides.roofAxis ?? a.roofAxis,
    features: a.features,
    windowStride: a.windowStride,
  }, a);
}

function markBuildingChanged(building: Building, collision = true): void {
  building.visualRevision++;
  building.structureDirty = true;
  building.roofDirty = true;
  if (collision) building.collisionDirty = true;
}

function buildingNeedsStructureStep(building: Building): boolean {
  if (building.fullyDown && !roofsNeedStep(building)) return false;
  if (building.structureDirty || building.roofDirty) return true;
  if (roofsNeedStep(building)) return true;
  return anyCellUnsettled(building);
}

/** Some standing cell is breached, falling, sagging, or losing support. */
function anyCellUnsettled(building: Building): boolean {
  for (const cell of building.cells) {
    if (cell.state === "gone") continue;
    if (cell.state === "breached" || cell.state === "falling") return true;
    if (cell.sag > 1e-4 || cell.unsupportedTime > 1e-4) return true;
  }
  return false;
}

export function resetBuildingIds(): void {
  nextId = 1;
}

export function applyCellDamage(
  building: Building,
  cell: Cell,
  amount: number,
  nx: number,
  ny: number,
  particles: ParticlePool,
  events: WorldEvent[],
): number {
  if (amount <= 0) return 0;
  if (cell.state === "gone" || cell.state === "falling") return 0;
  if (cell.cladding && cell.cladding.hp > 0) {
    amount = strikeCladding(building, cell, cell.cladding, amount, particles);
    if (amount === 0) return 0;
  }
  const before = cell.hp;
  const was = cell.state;
  const wasSolid = cellPresent(cell);
  cell.hp = Math.max(0, cell.hp - amount);
  cell.lastHitNx = nx;
  cell.lastHitNy = ny;
  const c = cellCenter(building, cell);
  let cash = was === "intact" && cell.hp <= cell.maxHp * 0.58 ? crackCell(cell, c, particles, events) : 0;
  if (cell.hp <= 0 && (was === "intact" || was === "cracked" || cell.state === "cracked")) cash += breachCell(cell, c, particles, events);
  settleHit(building, cell, was, wasSolid, before, amount, c, particles);
  return cash;
}

/** Chip dust on heavy hits that left a cell intact, and a rebuild when its state or solidity changed. */
function settleHit(
  building: Building,
  cell: Cell,
  was: Cell["state"],
  wasSolid: boolean,
  before: number,
  amount: number,
  c: { x: number; y: number; z: number },
  particles: ParticlePool,
): void {
  if (was === "intact" && cell.state === "intact" && before !== cell.hp && amount > 8) {
    particles.spawn(debrisKind(cell.material), c.x, c.y, c.z, 2, 1.2, 2);
  }
  const solid = cellPresent(cell);
  if (was !== cell.state || wasSolid !== solid) {
    markBuildingChanged(building, wasSolid !== solid || cell.state === "breached");
  }
}

/** Cladding soaks damage first; returns what is left over for the wall behind it. */
function strikeCladding(building: Building, cell: Cell, cladding: NonNullable<Cell["cladding"]>, amount: number, particles: ParticlePool): number {
  const beforeSkin = cladding.hp;
  cladding.hp = Math.max(0, beforeSkin - amount);
  building.visualRevision++;
  if (cladding.hp === 0) {
    markBuildingChanged(building);
    const center = cellCenter(building, cell);
    particles.burst(debrisKind(cladding.material), center.x, center.y, center.z, .6);
  }
  return Math.max(0, amount - beforeSkin);
}

function crackCell(cell: Cell, c: { x: number; y: number; z: number }, particles: ParticlePool, events: WorldEvent[]): number {
  cell.state = "cracked";
  particles.burst(debrisKind(cell.material), c.x, c.y, c.z, 0.45);
  const cash = cashFor(cell, "chip");
  events.push({ kind: "chip", x: c.x, y: c.y, z: c.z, mag: 0.4, material: cell.material, cash });
  return cash;
}

function breachCell(cell: Cell, c: { x: number; y: number; z: number }, particles: ParticlePool, events: WorldEvent[]): number {
  cell.state = "breached";
  cell.hp = 0;
  particles.burst(debrisKind(cell.material), c.x, c.y, c.z, 1.1);
  particles.burst("glass", c.x, c.y, c.z + 0.4, 0.6);
  const cash = cashFor(cell, "breach");
  events.push({ kind: "breach", x: c.x, y: c.y, z: c.z, mag: 0.9, material: cell.material, cash: cashFor(cell, "breach") });
  return cash;
}

const SPAN_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function markSupported(building: Building, supported: boolean[]): void {
  const { w, d, floors } = building;
  supported.fill(false);
  for (let floor = 0; floor < floors; floor++) {
    const dist = new Array<number>(w * d).fill(99);
    const queue: number[] = [];
    seedBearingCells(building, floor, dist, queue);
    spreadAlongBeams(building, floor, dist, queue);
    for (let i = 0; i < w * d; i++) {
      if (dist[i]! < 99) supported[floor * w * d + i] = true;
    }
  }
}

/** The floor below (or a section's transfer line) carries this cell. */
function restsOnFloorBelow(building: Building, cell: Cell): boolean {
  if (cell.floor === 0) return true;
  const below = building.grid[cell.floor - 1]!;
  return cellPresent(below[cell.gx]![cell.gy]!) || !!cell.transferSupport?.some(s => cellPresent(below[s.gx]![s.gy]!));
}

/** Every present cell resting on the floor below starts at beam distance 0. */
function seedBearingCells(building: Building, floor: number, dist: number[], queue: number[]): void {
  const { w, d } = building;
  for (let gx = 0; gx < w; gx++) {
    for (let gy = 0; gy < d; gy++) {
      const cell = building.grid[floor]![gx]![gy]!;
      if (!cellPresent(cell) || !restsOnFloorBelow(building, cell)) continue;
      const i = gx * d + gy;
      dist[i] = 0;
      queue.push(i);
    }
  }
}

/** Breadth-first beam spans: a non-support cell is carried while within its neighbour's material span. */
function spreadAlongBeams(building: Building, floor: number, dist: number[], queue: number[]): void {
  const { d } = building;
  let qh = 0;
  while (qh < queue.length) {
    const i = queue[qh++]!;
    const gx = Math.floor(i / d);
    const gy = i - gx * d;
    const span = beamSpan(building.grid[floor]![gx]![gy]!.material);
    for (const [dx, dy] of SPAN_DIRS) relaxBeam(building, floor, dist, queue, i, gx + dx, gy + dy, span);
  }
}

function relaxBeam(building: Building, floor: number, dist: number[], queue: number[], from: number, nx: number, ny: number, span: number): void {
  const { w, d } = building;
  if (nx < 0 || ny < 0 || nx >= w || ny >= d) return;
  const nb = building.grid[floor]![nx]![ny]!;
  if (!cellPresent(nb) || nb.isSupport) return;
  const ni = nx * d + ny;
  const nd = dist[from]! + 1;
  if (nd < dist[ni]! && nd <= span) {
    dist[ni] = nd;
    queue.push(ni);
  }
}

function leanFor(building: Building, cell: Cell): { dx: number; dy: number } {
  const cx = (building.w - 1) / 2;
  const cy = (building.d - 1) / 2;
  let dx = cell.gx - cx;
  let dy = cell.gy - cy;
  if (cell.lastHitNx || cell.lastHitNy) {
    dx += cell.lastHitNx * 0.6;
    dy += cell.lastHitNy * 0.6;
  }
  const l = Math.hypot(dx, dy);
  if (l < 0.2) return { dx: cell.lastHitNx || 1, dy: cell.lastHitNy || 0 };
  return { dx: dx / l, dy: dy / l };
}

function startFall(
  building: Building,
  cell: Cell,
  particles: ParticlePool,
  events: WorldEvent[],
): number {
  cell.state = "falling";
  cell.fallT = 0;
  markBuildingChanged(building, true);
  const lean = leanFor(building, cell);
  cell.fallDx = lean.dx;
  cell.fallDy = lean.dy;
  building.leanX += lean.dx;
  building.leanY += lean.dy;
  const c = cellCenter(building, cell);
  particles.burst(debrisKind(cell.material), c.x, c.y, c.z, 1.6);
  particles.collapseCloud(c.x, c.y, c.z, lean.dx, lean.dy);
  const cash = cashFor(cell, "collapse");
  events.push({
    kind: "collapse",
    x: c.x,
    y: c.y,
    z: c.z,
    mag: 1.2 + cell.floor * 0.35,
    material: cell.material,
    cash,
  });
  return cash;
}

export interface StructureStepResult {
  coreImpacts: CoreImpact[];
  cash: number;
  rubbleSpawns: {
    x: number;
    y: number;
    dx: number;
    dy: number;
    material: Material;
    floor: number;
    cellSize: number;
    aggregate?: boolean;
    source?: "wall" | "roof";
    heading?: number;
    elev?: number;
    panelW?: number;
    panelD?: number;
    preservePanelPose?: boolean;
  }[];
  leans: { x: number; y: number; dx: number; dy: number; mag: number }[];
  fixtureFrags: FixtureFrag[];
}

export interface StructureStepStats {
  stepped: number;
  skipped: number;
}

export function stepStructures(
  buildings: Building[],
  dt: number,
  particles: ParticlePool,
  events: WorldEvent[],
  stats?: StructureStepStats,
): StructureStepResult {
  const result: StructureStepResult = { cash: 0, rubbleSpawns: [], leans: [], fixtureFrags: [], coreImpacts: [] };
  const scratch: boolean[] = [];
  let stepped = 0;
  let skipped = 0;

  const roofSpawns: RoofDebrisSpawn[] = [];

  for (const building of buildings) {
    if (stepBuildingStructure(building, dt, particles, events, result, scratch, roofSpawns)) stepped++;
    else skipped++;
  }

  for (const spawn of roofSpawns) result.rubbleSpawns.push(spawn);

  if (stats) {
    stats.stepped = stepped;
    stats.skipped = skipped;
  }
  return result;
}

/** Advance one building; false when it was settled and skipped this step. */
function stepBuildingStructure(
  building: Building,
  dt: number,
  particles: ParticlePool,
  events: WorldEvent[],
  result: StructureStepResult,
  scratch: boolean[],
  roofSpawns: RoofDebrisSpawn[],
): boolean {
  if (building.elevatedTank) stepElevatedTank(building, dt, result, particles, events);
  if (building.silos) {
    stepSilos(building, dt, result, particles);
    if (building.coreCollapse?.phase === 'settled') building.fullyDown = building.silos.every(s => s.phase === 'gone');
  }
  if (building.coreCollapse) {
    const phase = building.coreCollapse.phase;
    if (!building.structureDirty && (phase === 'settled' || phase === 'standing')) return false;
    stepCoreCollapse(building, dt, result, particles, events);
    return true;
  }
  if (building.fullyDown && !roofsNeedStep(building)) return false;
  if (!buildingNeedsStructureStep(building)) return false;
  building.visualRevision++;
  scratch.length = building.w * building.d * building.floors;
  markSupported(building, scratch);
  for (const cell of building.cells) stepCell(building, cell, dt, scratch, particles, events, result);

  stepFloorTiles(building, dt, result);
  stepRoofs(building, dt, particles, events, roofSpawns);
  const interiors = stepInteriors(building, particles, events);
  result.cash += interiors.cash;
  result.fixtureFrags.push(...interiors.frags);
  if (buildingAllDown(building)) building.fullyDown = true;
  building.structureDirty = buildingStillUnsettled(building);
  building.roofDirty = roofsNeedStep(building);
  return true;
}

/** Every wall cell, roof, upper slab, tank and silo is gone. */
function buildingAllDown(building: Building): boolean {
  if (!building.cells.every((c) => c.state === "gone")) return false;
  if (!building.roofs.every((r) => r.state === "gone")) return false;
  if (building.floorTiles.some(t => !t.void && t.floor > 0 && t.state !== "gone")) return false;
  if (building.elevatedTank && building.elevatedTank.phase !== 'gone') return false;
  return !building.silos || building.silos.every(s => s.phase === 'gone');
}

function stepCell(
  building: Building,
  cell: Cell,
  dt: number,
  scratch: readonly boolean[],
  particles: ParticlePool,
  events: WorldEvent[],
  result: StructureStepResult,
): void {
  if (cell.cladding && cell.cladding.hp === 0 && !cell.cladding.shed) shedCladding(building, cell, cell.cladding, result);
  if (cell.state === "gone") return;
  if (cell.state === "falling") {
    stepFallingCell(building, cell, dt, result);
    return;
  }
  const supported = scratch[cell.floor * building.w * building.d + cell.gx * building.d + cell.gy] === true;
  if (cell.state === "breached") {
    cell.unsupportedTime += dt;
    if (cell.unsupportedTime > 0.85) {
      result.cash += startFall(building, cell, particles, events);
    }
    return;
  }
  if (!cellPresent(cell)) return;
  if (supported) {
    cell.unsupportedTime = Math.max(0, cell.unsupportedTime - dt * 2);
    cell.sag = Math.max(0, cell.sag - dt * 1.4);
    return;
  }
  stepUnsupportedCell(building, cell, dt, particles, events, result);
}

/** Cladding at 0 hp peels off once as a thin roof-source panel. */
function shedCladding(building: Building, cell: Cell, cladding: NonNullable<Cell["cladding"]>, result: StructureStepResult): void {
  cladding.shed = true;
  const c = cellCenter(building, cell);
  result.rubbleSpawns.push({ x: c.x, y: c.y, dx: 0, dy: 1, material: cladding.material,
    floor: cell.floor, cellSize: building.cellSize * .4, source: "roof", panelW: building.cellSize, panelD: .5 });
}

function stepFallingCell(building: Building, cell: Cell, dt: number, result: StructureStepResult): void {
  cell.fallT += dt / (building.construction.fallDuration);
  if (cell.fallT < 1) return;
  cell.state = "gone";
  cell.fallT = 1;
  markBuildingChanged(building, true);
  const c = cellCenter(building, cell);
  const disp = 0.65 + cell.floor * 0.55;
  result.rubbleSpawns.push({
    x: c.x + cell.fallDx * disp,
    y: c.y + cell.fallDy * disp,
    dx: cell.fallDx,
    dy: cell.fallDy,
    material: cell.material,
    floor: cell.floor,
    cellSize: building.cellSize,
  });
  result.leans.push({
    x: c.x,
    y: c.y,
    dx: cell.fallDx,
    dy: cell.fallDy,
    mag: 18 + cell.floor * 10,
  });
}

/** Unsupported cells sag, crack, take damage, then fall once past the construction's failure delay. */
function stepUnsupportedCell(building: Building, cell: Cell, dt: number, particles: ParticlePool, events: WorldEvent[], result: StructureStepResult): void {
  cell.unsupportedTime += dt;
  cell.sag = Math.min(1, cell.unsupportedTime / 0.32);
  if (cell.unsupportedTime > 0.22 && cell.state === "intact") {
    cell.state = "cracked";
  }
  if (cell.unsupportedTime > 0.38) {
    result.cash += applyCellDamage(building, cell, 26 * dt, cell.lastHitNx, cell.lastHitNy, particles, events);
  }
  if (cell.unsupportedTime > (building.construction.failureDelay)) {
    result.cash += startFall(building, cell, particles, events);
  }
}

function buildingStillUnsettled(building: Building): boolean {
  if (building.elevatedTank && ['warning','falling'].includes(building.elevatedTank.phase)) return true;
  if (building.silos?.some(s=>s.phase==='falling')) return true;
  if (building.fullyDown) return false;
  if (building.floorTiles.some(t => t.state === "falling")) return true;
  return anyCellUnsettled(building);
}

/** Ground slabs persist. Upper slabs fall only when their authored bearing line is lost. */
function stepFloorTiles(building: Building, dt: number, result: StructureStepResult): void {
  for (const tile of building.floorTiles) {
    if (tile.void || tile.floor === 0 || tile.state === "gone") continue;
    const supported = tile.support.some(s => {
      const cell = building.grid[tile.floor - 1]?.[s.gx]?.[s.gy];
      return cell && cellPresent(cell);
    });
    if (tile.state === "intact" && supported) continue;
    tile.state = "falling";
    tile.fallT += dt / .55;
    building.structureDirty = true;
    building.collisionDirty = true;
    if (tile.fallT < 1) continue;
    tile.state = "gone";
    result.rubbleSpawns.push({
      x: building.x + (tile.gx + .5) * building.cellSize,
      y: building.y + (tile.gy + .5) * building.cellSize,
      dx: .2, dy: 1, material: building.construction.floor,
      floor: tile.floor, cellSize: building.cellSize,
    });
  }
}

export function buildingBonus(building: Building): number {
  if (building.kind === "industrial") return 360;
  if (building.kind === "shop") return 220;
  return 140;
}

export function footprintSolid(building: Building, gx: number, gy: number): boolean {
  const cell = building.grid[0]?.[gx]?.[gy];
  return !!cell && cellPresent(cell);
}

