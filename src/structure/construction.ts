import type { Building, FloorFinish, Material, RoomKind, FixtureKind } from "./types";

/** Recipes use fractions of the occupied footprint; contents use fractions of their room. */
export interface ContentPlacement {
  kind: FixtureKind;
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
}

export interface RoomRecipe {
  kind: RoomKind;
  floor: number;
  x: number;
  y: number;
  w: number;
  d: number;
  finish: FloorFinish;
  contents: readonly ContentPlacement[];
}

export interface ConstructionDef {
  id: string;
  walls: "filled" | "masonry" | "frame";
  structure: Material;
  skin: Material;
  floor: Material;
  roof: Material;
  bays: boolean;
  /** Cell-supported preserves the original small-house demolition behavior. */
  floorSupport: "cell" | "independent";
  fallDuration: number;
  failureDelay: number;
  rooms: readonly RoomRecipe[];
  partitions?: boolean;
}

const kitchen: readonly ContentPlacement[] = [
  { kind: "counter", x: .04, y: .03, w: .92, d: .14, h: .4 },
  { kind: "cabinet", x: .03, y: .32, w: .15, d: .28, h: .82 },
  { kind: "table", x: .59, y: .38, w: .26, d: .2, h: .36 },
];
const living: readonly ContentPlacement[] = [
  { kind: "sofa", x: .04, y: .03, w: .89, d: .17, h: .38 },
  { kind: "table", x: .21, y: .4, w: .34, d: .2, h: .22 },
  { kind: "radiator", x: .64, y: .92, w: .26, d: .06, h: .3 },
];
const bathroom: readonly ContentPlacement[] = [
  { kind: "toilet", x: .32, y: .05, w: .36, d: .17, h: .4 },
  { kind: "cabinet", x: .7, y: .35, w: .28, d: .2, h: .68 },
];

export const TIMBER_HOUSE: ConstructionDef = {
  id: "timber-house", walls: "filled", structure: "wood", skin: "brick", floor: "wood", roof: "wood",
  bays: true, floorSupport: "cell", fallDuration: .42, failureDelay: .52,
  rooms: [
    { kind: "kitchen", floor: 0, x: 0, y: 0, w: .4, d: 1, finish: "linoleum", contents: kitchen },
    { kind: "living", floor: 0, x: .4, y: 0, w: .4, d: 1, finish: "plank", contents: living },
    { kind: "bathroom", floor: 0, x: .8, y: 0, w: .2, d: 1, finish: "tile", contents: bathroom },
  ],
};

export const BRICK_MIXED_USE: ConstructionDef = {
  partitions: true,
  id: "brick-mixed-use", walls: "masonry", structure: "brick", skin: "brick", floor: "wood", roof: "wood",
  bays: true, floorSupport: "independent", fallDuration: .5, failureDelay: .38,
  rooms: [
    { kind: "retail", floor: 0, x: 0, y: 0, w: .7, d: 1, finish: "tile", contents: [
      { kind: "shelf", x: .08, y: .15, w: .2, d: .5, h: 1.15 },
      { kind: "shelf", x: .64, y: .15, w: .2, d: .5, h: 1.15 },
      { kind: "counter", x: .04, y: .78, w: .27, d: .13, h: .65 },
    ] },
    { kind: "storage", floor: 0, x: .7, y: 0, w: .3, d: 1, finish: "concrete", contents: [
      { kind: "pallet", x: .13, y: .12, w: .72, d: .23, h: .6 },
      { kind: "fridge", x: .18, y: .52, w: .64, d: .2, h: 1.25 },
    ] },
    { kind: "kitchen", floor: 1, x: 0, y: 0, w: .4, d: .55, finish: "linoleum", contents: kitchen },
    { kind: "living", floor: 1, x: 0, y: .55, w: .6, d: .45, finish: "plank", contents: living },
    { kind: "bedroom", floor: 1, x: .4, y: 0, w: .6, d: .55, finish: "plank", contents: [
      { kind: "bed", x: .14, y: .12, w: .58, d: .66, h: .48 },
    ] },
    { kind: "bathroom", floor: 1, x: .6, y: .55, w: .4, d: .45, finish: "tile", contents: bathroom },
  ],
};

export const STEEL_HALL: ConstructionDef = {
  id: "steel-hall", walls: "frame", structure: "metal", skin: "metal", floor: "concrete", roof: "metal",
  bays: true, floorSupport: "independent", fallDuration: .65, failureDelay: .7,
  rooms: [
    { kind: "storage", floor: 0, x: 0, y: 0, w: .65, d: 1, finish: "concrete", contents: [
      { kind: "rack", x: .1, y: .12, w: .17, d: .55, h: 1.75 },
      { kind: "rack", x: .66, y: .12, w: .17, d: .55, h: 1.75 },
      { kind: "pallet", x: .08, y: .8, w: .2, d: .13, h: .55 },
      { kind: "pallet", x: .67, y: .8, w: .2, d: .13, h: .55 },
    ] },
    { kind: "production", floor: 0, x: .65, y: 0, w: .35, d: 1, finish: "concrete", contents: [
      { kind: "machine", x: .12, y: .12, w: .68, d: .28, h: 1.1 },
      { kind: "counter", x: .12, y: .57, w: .68, d: .12, h: .7 },
    ] },
  ],
};

export function independentFloors(b: Building): boolean {
  return b.construction?.floorSupport === "independent";
}

export function roomAt(b: Building, gx: number, gy: number, floor: number): RoomRecipe | undefined {
  const x = (gx + .5) / b.w;
  const y = (gy + .5) / b.d;
  return b.construction?.rooms.find(r => r.floor === floor && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.d);
}

/** Authoring errors must be visible before an invalid recipe reaches a generated district. */
export function validateConstruction(def: ConstructionDef): string[] {
  const issues: string[] = [];
  if (def.fallDuration <= 0 || def.failureDelay < 0) issues.push("Invalid collapse timing");
  const inside = (x: number, y: number, w: number, d: number) =>
    [x, y, w, d].every(Number.isFinite) && x >= 0 && y >= 0 && w > 0 && d > 0 && x + w <= 1.000001 && y + d <= 1.000001;
  for (const room of def.rooms) {
    if (!Number.isInteger(room.floor) || room.floor < 0 || !inside(room.x, room.y, room.w, room.d)) issues.push(`Invalid ${room.kind} room bounds`);
    for (const slot of room.contents) {
      if (!inside(slot.x, slot.y, slot.w, slot.d) || !Number.isFinite(slot.h) || slot.h <= 0) issues.push(`Invalid ${slot.kind} slot in ${room.kind}`);
    }
    for (let i = 0; i < room.contents.length; i++) for (let j = i + 1; j < room.contents.length; j++) {
      const a = room.contents[i]!, b = room.contents[j]!;
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.d && a.y + a.d > b.y) issues.push(`Overlapping ${a.kind}/${b.kind} in ${room.kind}`);
    }
  }
  for (let i = 0; i < def.rooms.length; i++) for (let j = i + 1; j < def.rooms.length; j++) {
    const a = def.rooms[i]!, b = def.rooms[j]!;
    if (a.floor === b.floor && a.x < b.x + b.w - 1e-6 && a.x + a.w > b.x + 1e-6 && a.y < b.y + b.d - 1e-6 && a.y + a.d > b.y + 1e-6)
      issues.push(`Overlapping ${a.kind}/${b.kind} rooms`);
  }
  return issues;
}
