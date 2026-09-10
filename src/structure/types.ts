export type Material = "wood" | "brick" | "concrete" | "metal" | "glass";
export type BuildingKind = "house" | "shop" | "industrial";
export type RoofStyle = "gable" | "flat" | "shed";
export type CellState = "intact" | "cracked" | "breached" | "falling" | "gone";
export type RoofSectionState = "intact" | "sagging" | "falling" | "gone";
export type RoofAxis = "x" | "y";
export type FacadeTheme = "cottage" | "ranch" | "colonial" | "walkup" | "porch" | "storefront" | "corner" | "civic" | "warehouse";
export type LotZone = "residential" | "commercial" | "industrial";
export type LotIdentity = "residence" | "farm" | "service" | "contractor" | "utility" | "shop";
export type FloorFinish = "plank" | "tile" | "linoleum";
export type RoomKind = "kitchen" | "bathroom" | "living";
export type FixtureKind = "cabinet" | "counter" | "toilet" | "sofa" | "table" | "radiator";
export type SiteMarkKind = "slab" | "dirt" | "crack" | "ridge" | "remnant" | "outline";
export type CoverKind =
  | "grass"
  | "scrub"
  | "dirt"
  | "gravel"
  | "tracks"
  | "concrete"
  | "parking"
  | "driveway"
  | "planted"
  | "lot";
export type DestructionProfile =
  | "brittle"
  | "bend-snap"
  | "crush"
  | "topple"
  | "roll"
  | "panel-collapse"
  | "explosive";
export type AssetFamily = "residential" | "agricultural" | "commercial" | "roadside" | "vegetation" | "legacy";
export type AssetTag =
  | "roadside"
  | "residential"
  | "agricultural"
  | "utility"
  | "commercial"
  | "vegetation"
  | "explosive"
  | "rollable"
  | "tall";
export type RoadClass =
  | "rural"
  | "residential"
  | "commercial"
  | "arterial"
  | "highway"
  | "service"
  | "driveway"
  | "ramp";
export type RoadSurfaceKind = "asphalt" | "gravel" | "dirt" | "concrete";
export type JunctionType = "none" | "end" | "T" | "cross" | "Y";
export type VehicleRole = "civilian" | "police";

export interface Cell {
  gx: number;
  gy: number;
  floor: number;
  material: Material;
  /** Render-only south/ground facade skin; structural HP uses `material`. */
  facadeMaterial: Material;
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

export interface RoofVertex {
  x: number;
  y: number;
  z: number;
}

export interface RoofSection {
  id: number;
  style: RoofStyle;
  support: { gx: number; gy: number }[];
  verts: RoofVertex[];
  ridge?: { ax: number; ay: number; az: number; bx: number; by: number; bz: number };
  state: RoofSectionState;
  sag: number;
  unsupportedTime: number;
  fallT: number;
  fallDx: number;
  fallDy: number;
  material: Material;
  /** World hinge the section tips around while sagging or falling. */
  hingeX: number;
  hingeY: number;
  hingeZ: number;
  /** Horizontal unit axis for the cheap tip rotation. */
  tiltAx: number;
  tiltAy: number;
}

export interface BuildingFeatureSpec {
  porch: boolean;
  awning: boolean;
  parapet: boolean;
  chimney: boolean;
  garage: boolean;
}

export interface DecorBox {
  x: number;
  y: number;
  w: number;
  d: number;
  kind: "porch" | "awning" | "chimney" | "parapet";
}

export interface InteriorFixture {
  id: number;
  kind: FixtureKind;
  room: RoomKind;
  floor: number;
  support: { gx: number; gy: number }[];
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  heading: number;
  material: Material;
  hp: number;
  maxHp: number;
  broken: boolean;
}

export interface Building {
  id: number;
  kind: BuildingKind;
  name: string;
  archetypeId: string;
  theme: FacadeTheme;
  x: number;
  y: number;
  w: number;
  d: number;
  elev: number;
  floors: number;
  cellSize: number;
  roof: RoofStyle;
  roofAxis: RoofAxis;
  secondary: Material;
  windowStride: number;
  features: BuildingFeatureSpec;
  decorBoxes: DecorBox[];
  fixtures: InteriorFixture[];
  cells: Cell[];
  grid: Cell[][][];
  roofs: RoofSection[];
  fullyDown: boolean;
  collapseBonusPaid: boolean;
  leanX: number;
  leanY: number;
  structureDirty: boolean;
  collisionDirty: boolean;
  roofDirty: boolean;
}

export interface SiteMark {
  kind: SiteMarkKind;
  x: number;
  y: number;
  w: number;
  d: number;
  heading: number;
  seed: number;
  z: number;
}

export interface CollapsedSite {
  buildingId: number;
  x: number;
  y: number;
  w: number;
  d: number;
  seed: number;
  foundationMaterial: Material;
  collapseDirectionX: number;
  collapseDirectionY: number;
  marks: SiteMark[];
  channels: { x: number; y: number; r: number }[];
}

export type DebrisLayer = "remnant" | "fragment";
export type DebrisShape = "chunk" | "beam" | "panel";
export type DebrisSkin = "default" | "roofing";
export type GroundKind = "chip" | "splinter" | "dust" | "glass" | "scrape";

export interface Rubble {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  omega: number;
  w: number;
  d: number;
  elev: number;
  thickness: number;
  mass: number;
  material: Material;
  shape: DebrisShape;
  layer: DebrisLayer;
  skin: DebrisSkin;
  seed: number;
  hp: number;
  damage: number;
  crushability: number;
  friction: number;
  sleeping: boolean;
  sleepT: number;
  touchedAt: number;
}

export interface GroundMark {
  x: number;
  y: number;
  w: number;
  d: number;
  heading: number;
  kind: GroundKind;
  material: Material;
  seed: number;
  alpha: number;
}

export interface Obstruction {
  height: number;
  compaction: number;
  resistance: number;
  blocked: boolean;
}

export interface VehicleProfile {
  mass: number;
  radius: number;
  pushForce: number;
  traction: number;
  clearance: number;
  resistanceMul: number;
}

export interface RoadVehicle {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  odo: number;
  alive: boolean;
  layer: number;
  elev: number;
  laneId: string | null;
  route: string[];
  routeIndex: number;
  waitT: number;
  reversing: boolean;
}

export interface PropPose {
  lean: number;
  leanX: number;
  leanY: number;
  crush: number;
  roll: number;
}

export interface Prop {
  id: number;
  assetId: string;
  /** Catalog id; kept so existing camera / pole checks still read a string. */
  kind: string;
  variant: number;
  x: number;
  y: number;
  w: number;
  d: number;
  hp: number;
  maxHp: number;
  heading: number;
  elev: number;
  broken: boolean;
  material: Material;
  pose: PropPose;
  vx: number;
  vy: number;
  omega: number;
}

export interface Lot {
  id: string;
  x: number;
  y: number;
  w: number;
  d: number;
  heading: number;
  zone: LotZone;
  identity: LotIdentity;
  accessId: string;
  templateId: string;
}

export interface GroundPatch {
  x: number;
  y: number;
  w: number;
  d: number;
  heading: number;
  cover: CoverKind;
  seed: number;
  z: number;
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
  kind: "chip" | "breach" | "collapse" | "impact" | "cash" | "snap" | "bird" | "scrape" | "crush" | "spark" | "blast";
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
