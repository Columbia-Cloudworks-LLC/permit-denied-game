import { TIMBER_HOUSE, BRICK_MIXED_USE, STEEL_HALL, type ConstructionDef } from "../structure/construction";
import type {
  BuildingFeatureSpec,
  BuildingKind,
  FacadeTheme,
  LotZone,
  Material,
  RoofAxis,
  RoofStyle,
} from "../structure/types";

export type ArchetypeId =
  | "ranch"
  | "rivertown"
  | "steel-warehouse"
  | "cottage"
  | "colonial"
  | "walkup"
  | "porch-house"
  | "storefront"
  | "corner-shop"
  | "civic"
  | "warehouse";

export interface Archetype {
  construction?: ConstructionDef;
  id: ArchetypeId;
  kind: BuildingKind;
  label: string;
  w: number;
  d: number;
  floors: number;
  material: Material;
  secondary: Material;
  roof: RoofStyle;
  roofAxis?: RoofAxis;
  theme: FacadeTheme;
  windowStride: number;
  door: "center-s" | "offset-s";
  loading: boolean;
  features: BuildingFeatureSpec;
  zones: Record<LotZone, number>;
  mask?: (w: number, d: number, floors: number) => boolean[][][];
}

export function fullMask(floors: number, w: number, d: number): boolean[][][] {
  const mask: boolean[][][] = [];
  for (let floor = 0; floor < floors; floor++) {
    const layer: boolean[][] = [];
    for (let gx = 0; gx < w; gx++) {
      const col: boolean[] = [];
      for (let gy = 0; gy < d; gy++) col.push(true);
      layer.push(col);
    }
    mask.push(layer);
  }
  return mask;
}

function garageHouseMask(w: number, d: number, floors: number, garageW = 2): boolean[][][] {
  const mask = fullMask(floors, w, d);
  const houseW = Math.max(1, w - garageW);
  for (let floor = 1; floor < floors; floor++) {
    for (let gx = houseW; gx < w; gx++) {
      for (let gy = 0; gy < d; gy++) mask[floor]![gx]![gy] = false;
    }
  }
  return mask;
}

export const ARCHETYPES: readonly Archetype[] = [
  {
    id: "rivertown", construction: BRICK_MIXED_USE, kind: "shop", label: "RIVER MERCANTILE",
    w: 5, d: 4, floors: 2, material: "brick", secondary: "brick", roof: "flat", roofAxis: "x",
    theme: "storefront", windowStride: 1, door: "center-s", loading: false,
    features: { porch: false, awning: true, parapet: true, chimney: false, garage: false },
    zones: { residential: 0, commercial: 4, industrial: 0 },
  },
  {
    id: "steel-warehouse", construction: STEEL_HALL, kind: "industrial", label: "STEEL WORKSHOP",
    w: 6, d: 5, floors: 1, material: "metal", secondary: "metal", roof: "shed", roofAxis: "y",
    theme: "warehouse", windowStride: 3, door: "center-s", loading: true,
    features: { porch: false, awning: false, parapet: false, chimney: false, garage: false },
    zones: { residential: 0, commercial: 0, industrial: 5 },
  },
  {
    id: "ranch",
    construction: TIMBER_HOUSE,
    kind: "house",
    label: "RANCH",
    w: 5,
    d: 3,
    floors: 1,
    material: "wood",
    secondary: "brick",
    roof: "gable",
    roofAxis: "x",
    theme: "ranch",
    windowStride: 2,
    door: "center-s",
    loading: false,
    features: { porch: false, awning: false, parapet: false, chimney: true, garage: false },
    zones: { residential: 8, commercial: 1, industrial: 0 },
  },
  {
    id: "cottage",
    kind: "house",
    label: "COTTAGE",
    w: 3,
    d: 3,
    floors: 2,
    material: "wood",
    secondary: "wood",
    roof: "gable",
    theme: "cottage",
    windowStride: 1,
    door: "center-s",
    loading: false,
    features: { porch: false, awning: false, parapet: false, chimney: true, garage: false },
    zones: { residential: 7, commercial: 1, industrial: 0 },
  },
  {
    id: "colonial",
    kind: "house",
    label: "COLONIAL",
    w: 4,
    d: 3,
    floors: 2,
    material: "brick",
    secondary: "wood",
    roof: "gable",
    roofAxis: "x",
    theme: "colonial",
    windowStride: 1,
    door: "center-s",
    loading: false,
    features: { porch: false, awning: false, parapet: false, chimney: true, garage: false },
    zones: { residential: 6, commercial: 1, industrial: 0 },
  },
  {
    id: "walkup",
    kind: "house",
    label: "WALK-UP",
    w: 2,
    d: 3,
    floors: 2,
    material: "wood",
    secondary: "brick",
    roof: "gable",
    roofAxis: "y",
    theme: "walkup",
    windowStride: 1,
    door: "offset-s",
    loading: false,
    features: { porch: false, awning: false, parapet: false, chimney: false, garage: false },
    zones: { residential: 5, commercial: 2, industrial: 0 },
  },
  {
    id: "porch-house",
    kind: "house",
    label: "PORCH",
    w: 4,
    d: 3,
    floors: 2,
    material: "wood",
    secondary: "wood",
    roof: "gable",
    theme: "porch",
    windowStride: 2,
    door: "center-s",
    loading: false,
    features: { porch: true, awning: false, parapet: false, chimney: true, garage: true },
    zones: { residential: 5, commercial: 0, industrial: 0 },
    mask: (w, d, floors) => garageHouseMask(w, d, floors, 1),
  },
  {
    id: "storefront",
    kind: "shop",
    label: "MART",
    w: 4,
    d: 3,
    floors: 2,
    material: "brick",
    secondary: "wood",
    roof: "flat",
    theme: "storefront",
    windowStride: 1,
    door: "center-s",
    loading: false,
    features: { porch: false, awning: true, parapet: true, chimney: false, garage: false },
    zones: { residential: 1, commercial: 8, industrial: 1 },
  },
  {
    id: "corner-shop",
    kind: "shop",
    label: "LEDGER",
    w: 4,
    d: 3,
    floors: 2,
    material: "brick",
    secondary: "concrete",
    roof: "flat",
    theme: "corner",
    windowStride: 1,
    door: "offset-s",
    loading: false,
    features: { porch: false, awning: true, parapet: true, chimney: false, garage: false },
    zones: { residential: 1, commercial: 7, industrial: 1 },
  },
  {
    id: "civic",
    kind: "industrial",
    label: "ANNEX",
    w: 4,
    d: 4,
    floors: 3,
    material: "concrete",
    secondary: "metal",
    roof: "flat",
    theme: "civic",
    windowStride: 2,
    door: "center-s",
    loading: false,
    features: { porch: false, awning: false, parapet: true, chimney: false, garage: false },
    zones: { residential: 0, commercial: 3, industrial: 4 },
  },
  {
    id: "warehouse",
    kind: "industrial",
    label: "WORKS",
    w: 5,
    d: 4,
    floors: 3,
    material: "concrete",
    secondary: "metal",
    roof: "shed",
    roofAxis: "y",
    theme: "warehouse",
    windowStride: 2,
    door: "center-s",
    loading: true,
    features: { porch: false, awning: false, parapet: false, chimney: false, garage: false },
    zones: { residential: 0, commercial: 2, industrial: 8 },
  },
];

const BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));

export function archetypeById(id: string): Archetype {
  const found = BY_ID.get(id as ArchetypeId);
  if (!found) throw new Error(`Unknown archetype ${id}`);
  return found;
}

export function pickArchetype(zone: LotZone, rng: { next(): number; range(a: number, b: number): number }): Archetype {
  const pool = ARCHETYPES.filter((a) => a.zones[zone] > 0);
  let total = 0;
  for (const a of pool) total += a.zones[zone];
  let pick = rng.range(0, total);
  for (const a of pool) {
    pick -= a.zones[zone];
    if (pick <= 0) return a;
  }
  return pool[pool.length - 1]!;
}

export function lotZoneFor(row: number, col: number, rows: number, cols: number): LotZone {
  if (row === 0 || col === 0) return col + row === 0 ? "commercial" : row === 0 ? "commercial" : "residential";
  if (row === rows - 1 && col >= cols - 2) return "industrial";
  if (row >= Math.max(1, rows - 2) && col >= Math.max(1, cols - 2)) return "industrial";
  if (col === cols - 1 && row <= 1) return "commercial";
  return "residential";
}

export function occupiedMask(archetype: Archetype, w = archetype.w, d = archetype.d, floors = archetype.floors): boolean[][][] {
  if (archetype.mask) return archetype.mask(w, d, floors);
  return fullMask(floors, w, d);
}
