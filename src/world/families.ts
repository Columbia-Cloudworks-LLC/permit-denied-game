import type { BuildingKind, Material, RoofStyle } from "../structure/types";
import { ARCHETYPES, type ArchetypeId } from "./archetypes";

export interface BuildingFamily {
  kind: BuildingKind;
  label: string;
  w: number;
  d: number;
  floors: number;
  material: Material;
  roof: RoofStyle;
  archetypeId: ArchetypeId;
}

export const BUILDING_FAMILIES: readonly BuildingFamily[] = ARCHETYPES.map((a) => ({
  kind: a.kind,
  label: a.label,
  w: a.w,
  d: a.d,
  floors: a.floors,
  material: a.material,
  roof: a.roof,
  archetypeId: a.id,
}));

export const CLASSIC_PLACEMENTS: readonly {
  archetypeId: ArchetypeId;
  name: string;
  x: number;
  y: number;
  w?: number;
  d?: number;
}[] = [
  { archetypeId: "cottage", name: "LOT 4 COTTAGE", x: 17, y: 21 },
  { archetypeId: "warehouse", name: "COUNTY WORKS", x: 4, y: 4 },
  { archetypeId: "corner-shop", name: "BRICK & LEDGER", x: 9.9, y: 4 },
  { archetypeId: "storefront", name: "CORNER MART", x: 24, y: 7 },
  { archetypeId: "walkup", name: "ALLEY WALK-UP", x: 27, y: 20 },
  { archetypeId: "storefront", name: "SOUTH SUPPLY", x: 6, y: 22.2, w: 3, d: 3 },
  { archetypeId: "civic", name: "CIVIC ANNEX", x: 31, y: 3.5 },
];
