import { CELL, FLOOR_Z } from "../game/constants";
import { debrisKind, ParticlePool } from "../fx/particles";
import { archetypeById, fullMask, occupiedMask, type ArchetypeId } from "../world/archetypes";
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
import { generateRoofs, roofsNeedStep, stepRoofs, type RoofDebrisSpawn } from "./roof";

let nextId = 1;

function makeCell(gx: number, gy: number, floor: number, material: Material, isSupport: boolean): Cell {
  const hp = materialHp(material);
  return {
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
  kind: BuildingKind;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  floors: number;
  material: Material;
  roof: RoofStyle;
  cellSize?: number;
  archetypeId?: string;
  secondary?: Material;
  theme?: FacadeTheme;
  roofAxis?: RoofAxis;
  mask?: boolean[][][];
  features?: Partial<BuildingFeatureSpec>;
  windowStride?: number;
  door?: "center-s" | "offset-s";
  loading?: boolean;
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
  const w = spec.w;
  const d = spec.d;
  const stride = spec.windowStride ?? (spec.kind === "house" ? 1 : 2);
  const occ = (x: number, y: number, f = floor) => occupied[f]?.[x]?.[y] === true;
  const north = gy === 0 || !occ(gx, gy - 1);
  const south = gy === d - 1 || !occ(gx, gy + 1);
  const west = gx === 0 || !occ(gx - 1, gy);
  const east = gx === w - 1 || !occ(gx + 1, gy);
  const edge = north || south || west || east;
  if (!edge) return;
  const grouped = spec.theme === "colonial" || spec.theme === "civic";
  const windowHere = grouped ? gx % 2 === 0 || gx % 2 === 1 : gx % stride === 0 || gy % stride === 0;
  if (floor > 0 || spec.floors === 1) {
    if (north && windowHere) cell.windowN = true;
    if (east && (grouped || gy % stride === 0)) cell.windowE = true;
    if (south && windowHere) cell.windowS = true;
    if (west && (grouped || gy % stride === 0)) cell.windowW = true;
  }
  if (floor === 0) {
    if (north && gx % 2 === 1) cell.windowN = true;
    if (east && gy % 2 === 0) cell.windowE = true;
    if (west && gy % 2 === 0) cell.windowW = true;
  }
}

function placeOpenings(spec: BuildingSpec, grid: Cell[][][], occupied: boolean[][][]): void {
  const south: number[] = [];
  for (let gx = 0; gx < spec.w; gx++) {
    if (occupied[0]?.[gx]?.[spec.d - 1]) south.push(gx);
  }
  if (south.length === 0) return;
  const doorGx =
    spec.door === "offset-s" ? south[0]! : south[Math.floor(south.length / 2)]!;
  const doorCell = grid[0]![doorGx]![spec.d - 1]!;
  if (spec.loading || spec.kind === "industrial") doorCell.loadingS = true;
  else doorCell.doorS = true;
  if (spec.loading || spec.kind === "industrial") {
    for (const gx of south) {
      if (Math.abs(gx - doorGx) === 1) grid[0]![gx]![spec.d - 1]!.loadingS = true;
    }
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

export function createBuilding(spec: BuildingSpec): Building {
  const cellSize = spec.cellSize ?? CELL;
  const archetype = spec.archetypeId ? archetypeById(spec.archetypeId) : undefined;
  const features: BuildingFeatureSpec = {
    porch: spec.features?.porch ?? archetype?.features.porch ?? false,
    awning: spec.features?.awning ?? archetype?.features.awning ?? false,
    parapet: spec.features?.parapet ?? archetype?.features.parapet ?? spec.roof === "flat",
    chimney: spec.features?.chimney ?? archetype?.features.chimney ?? spec.kind === "house",
    garage: spec.features?.garage ?? archetype?.features.garage ?? false,
  };
  const mask = spec.mask ?? (archetype ? occupiedMask(archetype, spec.w, spec.d, spec.floors) : fullMask(spec.floors, spec.w, spec.d));
  const theme = spec.theme ?? archetype?.theme ?? defaultTheme(spec.kind);
  const roofAxis: RoofAxis = spec.roofAxis ?? archetype?.roofAxis ?? (spec.w >= spec.d ? "x" : "y");
  const windowStride = spec.windowStride ?? archetype?.windowStride ?? 2;
  const door = spec.door ?? archetype?.door ?? "center-s";
  const loading = spec.loading ?? archetype?.loading ?? spec.kind === "industrial";
  const filled: BuildingSpec = { ...spec, theme, windowStride, door, loading };
  const grid: Cell[][][] = [];
  const cells: Cell[] = [];

  for (let floor = 0; floor < spec.floors; floor++) {
    const layer: Cell[][] = [];
    for (let gx = 0; gx < spec.w; gx++) {
      const col: Cell[] = [];
      for (let gy = 0; gy < spec.d; gy++) {
        const live = mask[floor]?.[gx]?.[gy] === true;
        const occN = (x: number, y: number) => mask[floor]?.[x]?.[y] === true;
        const edge = !occN(gx - 1, gy) || !occN(gx + 1, gy) || !occN(gx, gy - 1) || !occN(gx, gy + 1);
        const corner = (!occN(gx - 1, gy) || !occN(gx + 1, gy)) && (!occN(gx, gy - 1) || !occN(gx, gy + 1));
        let isSupport = live && (corner || (floor === 0 && edge && (gx + gy) % 2 === 0));
        if (spec.kind === "industrial" && floor === 0 && gx === Math.floor(spec.w / 2) && gy === Math.floor(spec.d / 2)) {
          isSupport = live;
        }
        let mat = spec.material;
        if (spec.kind === "house" && floor === spec.floors - 1) mat = "wood";
        if (spec.kind === "industrial" && floor === 0 && gy === spec.d - 1) mat = spec.secondary ?? "metal";
        const cell = makeCell(gx, gy, floor, mat, isSupport);
        if (spec.secondary && floor === 0 && gy === spec.d - 1 && live && spec.kind !== "industrial") {
          cell.facadeMaterial = spec.secondary;
        }
        if (!live) {
          cell.state = "gone";
          cell.hp = 0;
          col.push(cell);
          continue;
        }
        applyFacade(cell, filled, mask, gx, gy, floor);
        col.push(cell);
        cells.push(cell);
      }
      layer.push(col);
    }
    grid.push(layer);
  }
  placeOpenings(filled, grid, mask);

  const building: Building = {
    id: nextId++,
    kind: spec.kind,
    name: spec.name,
    archetypeId: spec.archetypeId ?? (spec.kind === "house" ? "cottage" : spec.kind === "shop" ? "storefront" : "warehouse"),
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
    secondary: spec.secondary ?? archetype?.secondary ?? spec.material,
    windowStride,
    features,
    decorBoxes: makeDecor(spec, cellSize, features),
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
  building.roofs = generateRoofs(building);
  return building;
}

export function createBuildingFromArchetype(
  archetypeId: ArchetypeId | string,
  name: string,
  x: number,
  y: number,
  overrides: Partial<Pick<BuildingSpec, "w" | "d" | "floors" | "material" | "roof" | "roofAxis">> = {},
): Building {
  const a = archetypeById(archetypeId);
  return createBuilding({
    kind: a.kind,
    name,
    x,
    y,
    w: overrides.w ?? a.w,
    d: overrides.d ?? a.d,
    floors: overrides.floors ?? a.floors,
    material: overrides.material ?? a.material,
    roof: overrides.roof ?? a.roof,
    archetypeId: a.id,
    secondary: a.secondary,
    theme: a.theme,
    roofAxis: overrides.roofAxis ?? a.roofAxis,
    features: a.features,
    windowStride: a.windowStride,
    door: a.door,
    loading: a.loading,
  });
}

function markBuildingChanged(building: Building, collision = true): void {
  building.structureDirty = true;
  building.roofDirty = true;
  if (collision) building.collisionDirty = true;
}

function buildingNeedsStructureStep(building: Building): boolean {
  if (building.fullyDown && !roofsNeedStep(building)) return false;
  if (building.structureDirty || building.roofDirty) return true;
  if (roofsNeedStep(building)) return true;
  for (const cell of building.cells) {
    if (cell.state === "breached" || cell.state === "falling") return true;
    if (cell.sag > 1e-4 || cell.unsupportedTime > 1e-4) return true;
  }
  return false;
}

export function resetBuildingIds(): void {
  nextId = 1;
}

function cashFor(cell: Cell, kind: "chip" | "breach" | "collapse"): number {
  const base =
    cell.material === "concrete" ? 18 : cell.material === "brick" ? 14 : cell.material === "metal" ? 16 : 10;
  if (kind === "chip") return 3 + (cell.isSupport ? 2 : 0);
  if (kind === "breach") return base + (cell.isSupport ? 12 : 0) + cell.floor * 4;
  return base + 16 + cell.floor * 8 + (cell.isSupport ? 20 : 0);
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
  const before = cell.hp;
  const was = cell.state;
  const wasSolid = cellPresent(cell);
  cell.hp = Math.max(0, cell.hp - amount);
  cell.lastHitNx = nx;
  cell.lastHitNy = ny;
  let cash = 0;
  const c = cellCenter(building, cell);

  if (was === "intact" && cell.hp <= cell.maxHp * 0.58) {
    cell.state = "cracked";
    particles.burst(debrisKind(cell.material), c.x, c.y, c.z, 0.45);
    cash += cashFor(cell, "chip");
    events.push({ kind: "chip", x: c.x, y: c.y, z: c.z, mag: 0.4, material: cell.material, cash });
  }

  if (cell.hp <= 0 && (was === "intact" || was === "cracked" || cell.state === "cracked")) {
    cell.state = "breached";
    cell.hp = 0;
    particles.burst(debrisKind(cell.material), c.x, c.y, c.z, 1.1);
    particles.burst("glass", c.x, c.y, c.z + 0.4, 0.6);
    cash += cashFor(cell, "breach");
    events.push({ kind: "breach", x: c.x, y: c.y, z: c.z, mag: 0.9, material: cell.material, cash: cashFor(cell, "breach") });
  }

  if (was === "intact" && cell.state === "intact" && before !== cell.hp && amount > 8) {
    particles.spawn(debrisKind(cell.material), c.x, c.y, c.z, 2, 1.2, 2);
  }

  if (was !== cell.state || wasSolid !== cellPresent(cell)) {
    markBuildingChanged(building, wasSolid !== cellPresent(cell) || cell.state === "breached");
  }

  return cash;
}

function markSupported(building: Building, supported: boolean[]): void {
  const { w, d, floors } = building;
  const idx = (floor: number, gx: number, gy: number) => floor * w * d + gx * d + gy;
  supported.fill(false);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  for (let floor = 0; floor < floors; floor++) {
    const dist = new Array<number>(w * d).fill(99);
    const queue: number[] = [];
    let qh = 0;
    for (let gx = 0; gx < w; gx++) {
      for (let gy = 0; gy < d; gy++) {
        const cell = building.grid[floor]![gx]![gy]!;
        if (!cellPresent(cell)) continue;
        const underOk = floor === 0 || cellPresent(building.grid[floor - 1]![gx]![gy]!);
        if (cell.isSupport && !underOk) continue;
        if (!underOk) continue;
        const i = gx * d + gy;
        dist[i] = 0;
        queue.push(i);
      }
    }
    while (qh < queue.length) {
      const i = queue[qh++]!;
      const gx = Math.floor(i / d);
      const gy = i - gx * d;
      const cell = building.grid[floor]![gx]![gy]!;
      const span = beamSpan(cell.material);
      for (const [dx, dy] of dirs) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= d) continue;
        const nb = building.grid[floor]![nx]![ny]!;
        if (!cellPresent(nb)) continue;
        if (nb.isSupport) continue;
        const ni = nx * d + ny;
        const nd = dist[i]! + 1;
        if (nd < dist[ni]! && nd <= span) {
          dist[ni] = nd;
          queue.push(ni);
        }
      }
    }
    for (let gx = 0; gx < w; gx++) {
      for (let gy = 0; gy < d; gy++) {
        if (dist[gx * d + gy]! < 99) supported[idx(floor, gx, gy)] = true;
      }
    }
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
  cash: number;
  rubbleSpawns: {
    x: number;
    y: number;
    dx: number;
    dy: number;
    material: Material;
    floor: number;
    cellSize: number;
    source?: "wall" | "roof";
  }[];
  leans: { x: number; y: number; dx: number; dy: number; mag: number }[];
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
  const result: StructureStepResult = { cash: 0, rubbleSpawns: [], leans: [] };
  const scratch: boolean[] = [];
  let stepped = 0;
  let skipped = 0;

  const roofSpawns: RoofDebrisSpawn[] = [];

  for (const building of buildings) {
    if (building.fullyDown && !roofsNeedStep(building)) {
      skipped++;
      continue;
    }
    if (!buildingNeedsStructureStep(building)) {
      skipped++;
      continue;
    }
    stepped++;
    scratch.length = building.w * building.d * building.floors;
    markSupported(building, scratch);
    const idx = (floor: number, gx: number, gy: number) =>
      floor * building.w * building.d + gx * building.d + gy;

    for (const cell of building.cells) {
      if (cell.state === "gone") continue;
      if (cell.state === "falling") {
        cell.fallT += dt / 0.42;
        if (cell.fallT >= 1) {
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
        continue;
      }

      const supported = scratch[idx(cell.floor, cell.gx, cell.gy)] === true;
      if (cell.state === "breached") {
        cell.unsupportedTime += dt;
        if (cell.unsupportedTime > 0.85) {
          result.cash += startFall(building, cell, particles, events);
        }
        continue;
      }

      if (!cellPresent(cell)) continue;

      if (supported) {
        cell.unsupportedTime = Math.max(0, cell.unsupportedTime - dt * 2);
        cell.sag = Math.max(0, cell.sag - dt * 1.4);
        continue;
      }

      cell.unsupportedTime += dt;
      cell.sag = Math.min(1, cell.unsupportedTime / 0.32);
      if (cell.unsupportedTime > 0.22 && cell.state === "intact") {
        cell.state = "cracked";
      }
      if (cell.unsupportedTime > 0.38) {
        result.cash += applyCellDamage(building, cell, 26 * dt, cell.lastHitNx, cell.lastHitNy, particles, events);
      }
      if (cell.unsupportedTime > 0.52) {
        result.cash += startFall(building, cell, particles, events);
      }
    }

    stepRoofs(building, dt, particles, events, roofSpawns);
    const cellsDown = building.cells.every((c) => c.state === "gone");
    const roofsDown = building.roofs.every((r) => r.state === "gone");
    if (cellsDown && roofsDown) building.fullyDown = true;
    building.structureDirty = buildingStillUnsettled(building);
    building.roofDirty = roofsNeedStep(building);
  }

  for (const spawn of roofSpawns) result.rubbleSpawns.push(spawn);

  if (stats) {
    stats.stepped = stepped;
    stats.skipped = skipped;
  }
  return result;
}

function buildingStillUnsettled(building: Building): boolean {
  if (building.fullyDown) return false;
  for (const cell of building.cells) {
    if (cell.state === "breached" || cell.state === "falling") return true;
    if (cell.sag > 1e-4 || cell.unsupportedTime > 1e-4) return true;
  }
  return false;
}

export function buildingBonus(building: Building): number {
  if (building.kind === "industrial") return 360;
  if (building.kind === "shop") return 220;
  return 140;
}

export function hitCellsAt(
  building: Building,
  x: number,
  y: number,
  onlySolid = false,
): Cell[] {
  const hits: Cell[] = [];
  if (x < building.x || y < building.y) return hits;
  const gx = Math.floor((x - building.x) / building.cellSize);
  const gy = Math.floor((y - building.y) / building.cellSize);
  if (gx < 0 || gy < 0 || gx >= building.w || gy >= building.d) return hits;
  for (let floor = 0; floor < building.floors; floor++) {
    const cell = building.grid[floor]![gx]![gy]!;
    if (cell.state === "gone" || cell.state === "falling") continue;
    if (onlySolid && !cellPresent(cell)) continue;
    if (floor > 0) continue;
    hits.push(cell);
  }
  return hits;
}

export function footprintSolid(building: Building, gx: number, gy: number): boolean {
  const cell = building.grid[0]?.[gx]?.[gy];
  return !!cell && cellPresent(cell);
}

export function remainingCells(building: Building): number {
  return building.cells.filter((c) => c.state !== "gone").length;
}

export { FLOOR_Z };
