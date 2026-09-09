import { CELL } from "../game/constants";
import { Rng } from "../game/rng";
import { resetDebrisIds } from "../sim/debris";
import { PileField } from "../sim/pile";
import { createBuilding, resetBuildingIds } from "../structure/building";
import type { Building, GroundMark, Prop, RoadVehicle, Rubble } from "../structure/types";

export interface Town {
  buildings: Building[];
  props: Prop[];
  rubble: Rubble[];
  marks: GroundMark[];
  pile: PileField;
  roadCar: RoadVehicle | null;
  spawnX: number;
  spawnY: number;
  spawnHeading: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  roads: { x: number; y: number; w: number; d: number }[];
  lots: { x: number; y: number; w: number; d: number }[];
}

let propId = 1;

function prop(
  kind: Prop["kind"],
  x: number,
  y: number,
  w: number,
  d: number,
  hp: number,
  material: Prop["material"],
  heading = 0,
): Prop {
  return {
    id: propId++,
    kind,
    x,
    y,
    w,
    d,
    hp,
    maxHp: hp,
    heading,
    broken: false,
    material,
  };
}

export function createTown(): Town {
  resetBuildingIds();
  resetDebrisIds();
  propId = 1;
  const rng = new Rng(0x0ddba11);

  const buildings: Building[] = [
    createBuilding({
      kind: "house",
      name: "LOT 4 COTTAGE",
      x: 17,
      y: 21,
      w: 3,
      d: 3,
      floors: 2,
      material: "wood",
      roof: "gable",
    }),
    createBuilding({
      kind: "industrial",
      name: "COUNTY WORKS",
      x: 4,
      y: 4,
      w: 5,
      d: 4,
      floors: 3,
      material: "concrete",
      roof: "shed",
    }),
    createBuilding({
      kind: "shop",
      name: "BRICK & LEDGER",
      x: 9.9,
      y: 4,
      w: 4,
      d: 3,
      floors: 2,
      material: "brick",
      roof: "flat",
    }),
    createBuilding({
      kind: "shop",
      name: "CORNER MART",
      x: 24,
      y: 7,
      w: 4,
      d: 3,
      floors: 2,
      material: "brick",
      roof: "flat",
    }),
    createBuilding({
      kind: "house",
      name: "ALLEY WALK-UP",
      x: 27,
      y: 20,
      w: 2,
      d: 3,
      floors: 2,
      material: "wood",
      roof: "gable",
    }),
    createBuilding({
      kind: "shop",
      name: "SOUTH SUPPLY",
      x: 6,
      y: 22.2,
      w: 3,
      d: 3,
      floors: 2,
      material: "brick",
      roof: "flat",
    }),
    createBuilding({
      kind: "industrial",
      name: "CIVIC ANNEX",
      x: 31,
      y: 3.5,
      w: 4,
      d: 4,
      floors: 3,
      material: "concrete",
      roof: "flat",
    }),
  ];

  const props: Prop[] = [
    prop("light", 16.2, 16.4, 0.28, 0.28, 14, "metal"),
    prop("light", 22.6, 16.4, 0.28, 0.28, 14, "metal"),
    prop("light", 18.4, 10.4, 0.28, 0.28, 14, "metal"),
    prop("light", 12.2, 16.4, 0.28, 0.28, 14, "metal"),
    prop("camera", 20.1, 15.6, 0.26, 0.26, 8, "metal"),
    prop("camera", 15.4, 8.6, 0.26, 0.26, 8, "metal"),
    prop("car", 21.6, 17.4, 1.7, 0.85, 28, "metal", 0.1),
    prop("car", 13.4, 17.6, 1.7, 0.85, 28, "metal", 3.2),
    prop("car", 28.4, 16.8, 1.6, 0.8, 26, "metal", -0.2),
    prop("dumpster", 15.6, 20.2, 0.9, 0.7, 22, "metal"),
    prop("dumpster", 26.2, 19.4, 0.9, 0.7, 22, "metal"),
    prop("barricade", 19.2, 19.1, 1.4, 0.28, 12, "wood", 0.05),
  ];

  for (let i = 0; i < 5; i++) {
    props.push(prop("fence", 16.6 + i * 1.05, 20.55, 1.0, 0.16, 9, "wood"));
  }
  for (let i = 0; i < 4; i++) {
    props.push(prop("fence", 26.7, 19.2 + i * 1.05, 0.16, 1.0, 9, "wood"));
  }
  void rng;

  return {
    buildings,
    props,
    rubble: [],
    marks: [],
    pile: new PileField(0, 0, 40, 36),
    roadCar: null,
    spawnX: 20.6,
    spawnY: 27.2,
    spawnHeading: -Math.PI / 2,
    minX: 1,
    minY: 1,
    maxX: 38,
    maxY: 34,
    roads: [
      { x: 1, y: 16, w: 37, d: 3.2 },
      { x: 18.2, y: 1, w: 3.1, d: 33 },
    ],
    lots: [
      { x: 1, y: 1, w: 37, d: 33 },
    ],
  };
}

export function townExtent(): { w: number; d: number } {
  return { w: 40 * CELL, d: 36 * CELL };
}
