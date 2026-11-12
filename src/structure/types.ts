import { MATERIALS, type Material } from './materials';
export type { Material } from './materials';
export type BuildingKind = "house" | "shop" | "industrial";
export type RoofStyle = "gable" | "flat" | "shed" | "sawtooth";
export type CellState = "intact" | "cracked" | "breached" | "falling" | "gone";
export type RoofSectionState = "intact" | "sagging" | "falling" | "gone";
export type RoofAxis = "x" | "y";
export type FacadeTheme = "cottage" | "ranch" | "colonial" | "walkup" | "porch" | "storefront" | "corner" | "civic" | "warehouse";
export type LotZone = "residential" | "commercial" | "industrial";
export type LotIdentity = "residence" | "farm" | "service" | "contractor" | "utility" | "shop";
export type FloorFinish = "plank" | "tile" | "linoleum" | "concrete";
export type RoomKind = "kitchen" | "bathroom" | "living" | "retail" | "storage" | "bedroom" | "production";
export type FixtureKind = "cabinet" | "counter" | "toilet" | "sofa" | "table" | "radiator" | "shelf" | "rack" | "pallet" | "fridge" | "bed" | "machine" | "partition"
  | "diner-booth" | "washer-dryer" | "commercial-oven" | "office-desk" | "filing-cabinet" | "checkout-register"
  | "theater-seats" | "repair-lift" | "display-fridge" | "school-desks" | "examination-table" | "nursery-bench"
  | "bowling-pins" | "pinsetter" | "printing-press" | "dairy-vat" | "bottling-line" | "theater-screen" | "staircase" | "vehicle-ramp";
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
  | "lot"
  | "water"
  | "forest-floor"
  | "field-tilled"
  | "field-short"
  | "field-mature"
  | "field-stubble"
  /** Desert yard: decomposed granite and raked gravel in place of turf. */
  | "xeriscape"
  /** Bare caliche or red-dirt verge. */
  | "caliche";
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
/** Scrap a wrecked machine pays out as: copper from coils and windings, or mixed mechanical steel. */
export type SalvageKind = "copper" | "mechanical";
/** Reactive burst when a machine breaks: pressurised refrigerant, greasy exhaust soot, or an electrical arc. */
export type MachineFx = "refrigerant" | "soot" | "arc";
export type RooftopKind =
  | "exhaust-hood" | "duct-run" | "mua-box"
  | "rtu" | "rtu-large" | "condenser-bank" | "chiller"
  | "bulkhead" | "cooling-tower" | "vent-stack" | "comms-mast"
  | "roof-hatch" | "turbine-vent" | "gooseneck-vent" | "skylight-curb" | "flue-stack" | "split-condenser"
  | "swamp-cooler" | "solar-array";
/** Flat-roof membrane family, seeded per building (`roofFinishFor`). */
export type RoofFinish = "tpo" | "bur" | "epdm" | "adobe";
/** What a pitched or regional roof is covered in. */
export type RoofCovering = "shingle" | "barrel-tile" | "metal-seam" | "adobe";

/** Climate-adapted roof silhouette (`stampRegionalExterior`); absent means the archetype's own roof. */
export interface RoofForm {
  id: "barrel-tile-gable" | "adobe-flat" | "hip-metal" | "hip-tile" | "cool-flat";
  covering: RoofCovering;
  /** Ridge height above the eave; classic gables rise 1.08. */
  rise: number;
  hip: boolean;
  /** Projecting timber beam ends and sheet-metal rain spouts through an adobe parapet. */
  vigas: boolean;
}

/**
 * One piece of rooftop equipment. It stands on explicit roof cells (`gx,gy`, plus the next cell
 * along `axis` when `span` is 2) and rides their roof sections until they let go.
 */
export interface RooftopFixture {
  id: number;
  kind: RooftopKind;
  /** Bearing floor of the roof it stands on. */
  floor: number;
  gx: number;
  gy: number;
  span: 1 | 2;
  axis: RoofAxis;
  /** Heavy units drop storey by storey as a dead load; light ones tear off into debris. */
  heavy: boolean;
  mass: number;
  salvage?: SalvageKind;
  /** Scrap paid once, when the unit is destroyed. */
  value: number;
  state: "mounted" | "falling" | "gone";
  /** Storey the falling unit is dropping onto, and its progress through that storey. */
  fallFloor: number;
  fallT: number;
  /** Storeys already fallen: a longer drop hits harder. */
  fallen: number;
  seed: number;
}

export interface Cell {
  silo?: {id:string;cx:number;cy:number;radius:number;angle:number};
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
  /** Original tooth boundaries survive structural/panel clipping. */
  tooth?: { axis: RoofAxis; minX: number; maxX: number; minY: number; maxY: number; eaveZ: number };
  /** Industrial panels share a bearing bay, but have independent covering/animation. */
  bay?: { id: number; minX: number; maxX: number; minY: number; maxY: number };
  /** Generated once, indexed by actual shared coverage edges. Values are roof array indices. */
  neighbors?: Partial<Record<"minX" | "maxX" | "minY" | "maxY", number[]>>;
  floor: number;
  /** A hipped plane: the roof closes its own ends, so no gable wall rises under it. */
  hip?: boolean;
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
  landingSupport?: { floor:number; gx:number; gy:number }[];
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
  silos?: import('./silos').SiloState[];
  openDecks?: boolean;
  canopy?: boolean;
  elevatedTank?: import('./elevatedTank').ElevatedTankState;
  facadeDetails: import('./facadeDetails').FacadeDetailDef[];
  /** Regional dress from the map's climate zone (`stampRegionalExterior`); absent on yards and legacy maps. */
  region?: import("./regionalExterior").RegionalExterior;
  /** Regional roof silhouette; set with `region`, never on legacy maps. */
  roofForm?: RoofForm;
  /** Rooftop equipment standing on this building's roofs (`generateRooftop`). */
  rooftop: RooftopFixture[];
  /** Which visible face fronts the lot's street (`stampStreetFaces`); absent on yards and legacy maps. */
  streetFace?: import("./facadeTrim").StreetFace;
  /** Brand trim: flat/canopy roof eaves and awnings. Stamping it after creation must bump `visualRevision`. */
  fasciaColor?: number;
  /** Regional brand skin id, recorded as a Trophy Lot souvenir when the building falls. */
  brandId?: string;
  coreCollapse?: import("./coreCollapse").CoreCollapseState;
  visualRevision: number;
  retired: boolean;
  settledAwayTime: number;
  construction: import("./construction").ConstructionDef;
  layout: import("./construction").LayoutDef;
  lotId: string | null;
  campaignLandmark?: boolean;
  /** Regional signature label; pays SIGNATURE_BONUS on top of the collapse bonus. */
  regionalSignature?: string;
  /** How far the HUD has called the signature out: first hit, then collapse. */
  signatureNoticed?: 'hit' | 'down';
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
  /** Envelope occupancy retained for roof generation; this location has no physical slab. */
  void?: boolean;
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
export type GroundKind = "chip" | "splinter" | "dust" | "glass" | "scrape" | "oil" | "crack" | "tire" | "season-track";

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
  /** Surface colour override, e.g. churned mud under a tread. */
  tint?: number;
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
  /** Campaign urban geography. Absent on Sandbox lots. */
  urbanBand?: string;
  districtRole?: string;
  cornerLot?: boolean;
  openSpaceName?: string;
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
  poly?: { x: number; y: number }[];
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

export type ParticleKind = "brick" | "concrete" | "wood" | "glass" | "metal" | "dust" | "crop" | "spark" | "steam" | "soot" | "arc";

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
  tint?: number;
}

export interface WorldEvent {
  kind: "bowling-strike" | "chip" | "breach" | "collapse" | "impact" | "cash" | "snap" | "bird" | "scrape" | "crush" | "spark" | "blast" | "blade-drop" | "track-bind" | "machine-break";
  x: number;
  y: number;
  z: number;
  mag: number;
  material?: Material;
  cash?: number;
  /** The cash is scrap from a wrecked machine and pops up labelled as this kind. */
  salvage?: SalvageKind;
  /** Which burst and sound a `machine-break` plays. */
  fx?: MachineFx;
  /** World-space direction into an impact (the inverse of the contact normal), for a directional camera jolt. */
  dirX?: number;
  dirY?: number;
  /** How heavy the struck structure is (see impactHeft): light timber chatters, dense concrete heaves. */
  heft?: number;
}

export function materialHp(material: Material): number { return MATERIALS[material].hp; }
export function beamSpan(material: Material): number { return MATERIALS[material].beamSpan; }

export function cellPresent(cell: Cell): boolean {
  return cell.state === "intact" || cell.state === "cracked";
}

export function cellWorldBox(b: Building, cell: Cell): { x: number; y: number; w: number; d: number } {
  if(cell.silo) {
    const s=cell.silo,angles=[s.angle-Math.PI/8,s.angle,s.angle+Math.PI/8];
    const xs=angles.map(a=>b.x+s.cx+Math.cos(a)*s.radius),ys=angles.map(a=>b.y+s.cy+Math.sin(a)*s.radius);
    const x=Math.min(...xs)-.09,y=Math.min(...ys)-.09;
    return {x,y,w:Math.max(...xs)+.09-x,d:Math.max(...ys)+.09-y};
  }
  {
    const cs = b.cellSize, thick = .18;
    let x = b.x + cell.gx * cs, y = b.y + cell.gy * cs;
    if (b.elevatedTank || b.canopy || b.openDecks) return { x: x + cs * .5 - .16, y: y + cs * .5 - .16, w: .32, d: .32 };
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
