import type { BuildingKind, Material, RoofStyle } from "../structure/types";

export interface BuildingFamily {
  kind: BuildingKind;
  label: string;
  w: number;
  d: number;
  floors: number;
  material: Material;
  roof: RoofStyle;
}

export const BUILDING_FAMILIES: readonly BuildingFamily[] = [
  { kind: "house", label: "COTTAGE", w: 3, d: 3, floors: 2, material: "wood", roof: "gable" },
  { kind: "industrial", label: "WORKS", w: 5, d: 4, floors: 3, material: "concrete", roof: "shed" },
  { kind: "shop", label: "LEDGER", w: 4, d: 3, floors: 2, material: "brick", roof: "flat" },
  { kind: "shop", label: "MART", w: 4, d: 3, floors: 2, material: "brick", roof: "flat" },
  { kind: "house", label: "WALK-UP", w: 2, d: 3, floors: 2, material: "wood", roof: "gable" },
  { kind: "shop", label: "SUPPLY", w: 3, d: 3, floors: 2, material: "brick", roof: "flat" },
  { kind: "industrial", label: "ANNEX", w: 4, d: 4, floors: 3, material: "concrete", roof: "flat" },
];

export const CLASSIC_PLACEMENTS: readonly {
  family: number;
  name: string;
  x: number;
  y: number;
}[] = [
  { family: 0, name: "LOT 4 COTTAGE", x: 17, y: 21 },
  { family: 1, name: "COUNTY WORKS", x: 4, y: 4 },
  { family: 2, name: "BRICK & LEDGER", x: 9.9, y: 4 },
  { family: 3, name: "CORNER MART", x: 24, y: 7 },
  { family: 4, name: "ALLEY WALK-UP", x: 27, y: 20 },
  { family: 5, name: "SOUTH SUPPLY", x: 6, y: 22.2 },
  { family: 6, name: "CIVIC ANNEX", x: 31, y: 3.5 },
];
