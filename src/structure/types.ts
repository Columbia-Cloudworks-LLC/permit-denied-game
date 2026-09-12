import { MATERIALS, type Material } from './materials';
export type { Material } from './materials';
export type BuildingKind = "house" | "shop" | "industrial";
export type RoofStyle = "gable" | "flat" | "shed";
export type CellState = "intact" | "cracked" | "breached" | "falling" | "gone";
export type RoofSectionState = "intact" | "sagging" | "falling" | "gone";
export type RoofAxis = "x" | "y";
export type FacadeTheme = "cottage" | "ranch" | "colonial" | "walkup" | "porch" | "storefront" | "corner" | "civic" | "warehouse";
export type LotZone = "residential" | "commercial" | "industrial";
export type LotIdentity = "residence" | "farm" | "service" | "contractor" | "utility" | "shop";
export type FloorFinish = "plank" | "tile" | "linoleum" | "concrete";
export type RoomKind = "kitchen" | "bathroom" | "living" | "retail" | "storage" | "bedroom" | "production";
export type FixtureKind = "cabinet" | "counter" | "toilet" | "sofa" | "table" | "radiator" | "shelf" | "rack" | "pallet" | "fridge" | "bed" | "machine" | "partition";
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
export type AssetFamily = "residential" | "agricultural" | "commercial" | "roadside" | "vegetation";
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
  coreSupport?: boolean;
  transferSupport?: { gx: number; gy: number }[];
  exterior: { north: boolean; south: boolean; east: boolean; west: boolean };
  role?: "wall" | "column";
  cladding?: { material: Material; hp: number; maxHp: number; shed: boolean };
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
  /** Industrial panels share a bearing bay, but have independent covering/animation. */
  bay?: { id: number; minX: number; maxX: number; minY: number; maxY: number };
  /** Generated once, indexed by actual shared coverage edges. Values are roof array indices. */
  neighbors?: Partial<Record<"minX" | "maxX" | "minY" | "maxY", number[]>>;
  floor: number;
  /** Covered floor tiles are distinct from the walls/columns carrying the roof. */
  coverage?: { gx: number; gy: number }[];
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
  pose: PropPose;
  id: number;
  kind: FixtureKind;
  room: RoomKind;
  roomId: string;
  placementId: string;
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
  coreCollapse?: import("./coreCollapse").CoreCollapseState;
  visualRevision: number;
  retired: boolean;
  settledAwayTime: number;
  construction: import("./construction").ConstructionDef;
  layout: import("./construction").LayoutDef;
  lotId: string | null;
  floorTiles: FloorTile[];
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

export interface FloorTile {
  roomId: string;
  gx: number;
  gy: number;
  floor: number;
  state: "intact" | "falling" | "gone";
  fallT: number;
  support: { gx: number; gy: number }[];
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
  yardOwner?: string;
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
  yardOwner?: string;
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
  lotId: string | null;
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

export type LotSide = 1 | -1;

export interface LotFrontage {
  segmentId: string;
  side: LotSide;
  t0: number;
  t1: number;
}

export interface LotSetbacks {
  front: number;
  side: number;
  rear: number;
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
  /** Frontage road, side of the polyline, and interval in segment t. */
  frontage: LotFrontage;
  /** Closed parcel ring in world space (first point is not repeated). */
  boundary: { x: number; y: number }[];
  /** Axis-aligned buildable envelope after setbacks. */
  buildable: { x: number; y: number; w: number; d: number };
  setbacks: LotSetbacks;
  arrivalX: number;
  arrivalY: number;
  drivewayId: string;
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
  yardOwner?: string;
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

export function materialHp(material: Material): number { return MATERIALS[material].hp; }
export function beamSpan(material: Material): number { return MATERIALS[material].beamSpan; }

export function cellPresent(cell: Cell): boolean {
  return cell.state === "intact" || cell.state === "cracked";
}

export function cellSolid(cell: Cell): boolean {
  return cell.state === "intact" || cell.state === "cracked";
}

export function cellWorldBox(b: Building, cell: Cell): { x: number; y: number; w: number; d: number } {
  {
    const cs = b.cellSize, thick = .18;
    let x = b.x + cell.gx * cs, y = b.y + cell.gy * cs;
    if (cell.coreSupport) return { x: x + cs * .5 - .3, y: y + cs * .5 - .3, w: .6, d: .6 };
    if (cell.role === "column" && cell.cladding?.hp === 0) {
      x += cs * .5 - thick;
      if (cell.gy === b.d - 1) y += cs - thick * 2;
      return { x, y, w: thick * 2, d: thick * 2 };
    }
    if (cell.exterior.north || cell.exterior.south) {
      if (!cell.exterior.north) y += cs - thick;
      return { x, y, w: cs, d: thick };
    }
    if (cell.exterior.east && !cell.exterior.west) x += cs - thick;
    return { x, y, w: thick, d: cs };
  }
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
