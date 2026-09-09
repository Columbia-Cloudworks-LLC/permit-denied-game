import { CELL, FLOOR_Z } from "../game/constants";
import { debrisKind, ParticlePool } from "../fx/particles";
import type {
  Building,
  BuildingKind,
  Cell,
  Material,
  RoofStyle,
  WorldEvent,
} from "./types";
import { beamSpan, cellCenter, cellPresent, materialHp } from "./types";

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
}

export function createBuilding(spec: BuildingSpec): Building {
  const cellSize = spec.cellSize ?? CELL;
  const grid: Cell[][][] = [];
  const cells: Cell[] = [];

  for (let floor = 0; floor < spec.floors; floor++) {
    const layer: Cell[][] = [];
    for (let gx = 0; gx < spec.w; gx++) {
      const col: Cell[] = [];
      for (let gy = 0; gy < spec.d; gy++) {
        const edge =
          gx === 0 || gy === 0 || gx === spec.w - 1 || gy === spec.d - 1;
        const corner =
          (gx === 0 || gx === spec.w - 1) && (gy === 0 || gy === spec.d - 1);
        let isSupport = corner || (floor === 0 && edge && (gx + gy) % 2 === 0);
        if (spec.kind === "industrial" && floor === 0 && gx === Math.floor(spec.w / 2) && gy === Math.floor(spec.d / 2)) {
          isSupport = true;
        }
        let mat = spec.material;
        if (spec.kind === "house" && floor === spec.floors - 1) mat = "wood";
        if (spec.kind === "industrial" && floor === 0 && gy === spec.d - 1) mat = "metal";
        const cell = makeCell(gx, gy, floor, mat, isSupport);
        if (edge && floor > 0) {
          if (gy === 0) cell.windowN = true;
          if (gx === spec.w - 1) cell.windowE = true;
          if (gy === spec.d - 1) cell.windowS = true;
          if (gx === 0) cell.windowW = true;
        }
        if (edge && floor === 0) {
          if (gy === 0 && gx % 2 === 1) cell.windowN = true;
          if (gx === spec.w - 1 && gy % 2 === 0) cell.windowE = true;
          if (gx === 0 && gy % 2 === 0) cell.windowW = true;
        }
        if (floor === 0 && gy === spec.d - 1 && gx === Math.floor(spec.w / 2)) {
          if (spec.kind === "industrial") cell.loadingS = true;
          else cell.doorS = true;
        }
        if (spec.kind === "industrial" && floor === 0 && gy === spec.d - 1 && Math.abs(gx - Math.floor(spec.w / 2)) === 1) {
          cell.loadingS = true;
        }
        col.push(cell);
        cells.push(cell);
      }
      layer.push(col);
    }
    grid.push(layer);
  }

  return {
    id: nextId++,
    kind: spec.kind,
    name: spec.name,
    x: spec.x,
    y: spec.y,
    w: spec.w,
    d: spec.d,
    floors: spec.floors,
    cellSize,
    roof: spec.roof,
    cells,
    grid,
    fullyDown: false,
    collapseBonusPaid: false,
    leanX: 0,
    leanY: 0,
  };
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
  rubbleSpawns: { x: number; y: number; material: Material; w: number; d: number }[];
  leans: { x: number; y: number; dx: number; dy: number; mag: number }[];
}

export function stepStructures(
  buildings: Building[],
  dt: number,
  particles: ParticlePool,
  events: WorldEvent[],
): StructureStepResult {
  const result: StructureStepResult = { cash: 0, rubbleSpawns: [], leans: [] };
  const scratch: boolean[] = [];

  for (const building of buildings) {
    if (building.fullyDown) continue;
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
          const c = cellCenter(building, cell);
          result.rubbleSpawns.push({
            x: c.x - building.cellSize * 0.35,
            y: c.y - building.cellSize * 0.35,
            material: cell.material,
            w: building.cellSize * 0.7,
            d: building.cellSize * 0.7,
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

    const standing = building.cells.some((c) => c.state !== "gone");
    if (!standing) building.fullyDown = true;
  }

  return result;
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
