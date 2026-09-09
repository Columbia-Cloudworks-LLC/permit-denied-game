export type Material = "wood" | "brick" | "concrete" | "metal" | "glass";
export type BuildingKind = "house" | "shop" | "industrial";
export type RoofStyle = "gable" | "flat" | "shed";
export type CellState = "intact" | "cracked" | "breached" | "falling" | "gone";

export interface Cell {
  gx: number;
  gy: number;
  floor: number;
  material: Material;
  hp: number;
  maxHp: number;
  isSupport: boolean;
  state: CellState;
  sag: number;
  unsupportedTime: number;
  fallT: number;
  fallDx: number;
  fallDy: number;
  lastHitNx: number;
  lastHitNy: number;
  windowN: boolean;
  windowE: boolean;
  windowS: boolean;
  windowW: boolean;
  doorS: boolean;
  loadingS: boolean;
}

export interface Building {
  id: number;
  kind: BuildingKind;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  floors: number;
  cellSize: number;
  roof: RoofStyle;
  cells: Cell[];
  grid: Cell[][][];
  fullyDown: boolean;
  collapseBonusPaid: boolean;
  leanX: number;
  leanY: number;
}

export interface Rubble {
  id: number;
  x: number;
  y: number;
  w: number;
  d: number;
  z: number;
  material: Material;
  hp: number;
  vx: number;
  vy: number;
}

export interface Prop {
  id: number;
  kind: "fence" | "light" | "camera" | "car" | "dumpster" | "barricade";
  x: number;
  y: number;
  w: number;
  d: number;
  hp: number;
  maxHp: number;
  heading: number;
  broken: boolean;
  material: Material;
}

export interface Bird {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

export type ParticleKind = "brick" | "concrete" | "wood" | "glass" | "metal" | "dust";

export interface Particle {
  alive: boolean;
  kind: ParticleKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  rot: number;
  spin: number;
  settled: boolean;
}

export interface WorldEvent {
  kind: "chip" | "breach" | "collapse" | "impact" | "cash" | "snap" | "bird";
  x: number;
  y: number;
  z: number;
  mag: number;
  material?: Material;
  cash?: number;
}

export function materialHp(material: Material): number {
  switch (material) {
    case "wood":
      return 26;
    case "brick":
      return 40;
    case "concrete":
      return 62;
    case "metal":
      return 54;
    case "glass":
      return 9;
  }
}

export function beamSpan(material: Material): number {
  switch (material) {
    case "wood":
      return 1;
    case "brick":
      return 2;
    case "concrete":
      return 2;
    case "metal":
      return 2;
    case "glass":
      return 0;
  }
}

export function cellPresent(cell: Cell): boolean {
  return cell.state === "intact" || cell.state === "cracked";
}

export function cellSolid(cell: Cell): boolean {
  return cell.state === "intact" || cell.state === "cracked";
}

export function cellWorldBox(b: Building, cell: Cell): { x: number; y: number; w: number; d: number } {
  return {
    x: b.x + cell.gx * b.cellSize,
    y: b.y + cell.gy * b.cellSize,
    w: b.cellSize,
    d: b.cellSize,
  };
}

export function cellCenter(b: Building, cell: Cell): { x: number; y: number; z: number } {
  return {
    x: b.x + (cell.gx + 0.5) * b.cellSize,
    y: b.y + (cell.gy + 0.5) * b.cellSize,
    z: cell.floor * 2.35 + 1.1,
  };
}

export function anyFloating(buildings: Building[]): boolean {
  for (const b of buildings) {
    for (const cell of b.cells) {
      if (!cellPresent(cell)) continue;
      if (cell.floor === 0) continue;
      const under = b.grid[cell.floor - 1]?.[cell.gx]?.[cell.gy];
      if (under && cellPresent(under)) continue;
      if (cell.unsupportedTime < 0.05) continue;
      if (cell.state === "intact" || cell.state === "cracked") {
        if (cell.unsupportedTime > 0.6 && cell.sag < 0.2) return true;
      }
    }
  }
  return false;
}
