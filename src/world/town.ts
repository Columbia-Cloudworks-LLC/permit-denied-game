import { CELL } from "../game/constants";
import { DEFAULT_DISTRICT_SEEDS, type DistrictId } from "../game/session";
import { resetDebrisSim } from "../sim/debris";
import { PileField } from "../sim/pile";
import { createBuildingFromArchetype, resetBuildingIds } from "../structure/building";
import type { Building, CollapsedSite, GroundMark, Prop, RoadVehicle, Rubble } from "../structure/types";
import { generateDistrictLayout } from "./districts";
import { CLASSIC_PLACEMENTS } from "./families";

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
  district: DistrictId;
  seed: number;
  roadSpawnX: number;
  roadSpawnY: number;
  roadSpawnHeading: number;
  visualRevision: number;
  collapsedSites: CollapsedSite[];
  siteRevision: number;
}

export interface TownOptions {
  district?: DistrictId;
  seed?: number;
}

let propId = 1;

function makeProp(
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

export function createTown(options: TownOptions = {}): Town {
  const district = options.district ?? "classic";
  const seed = options.seed ?? DEFAULT_DISTRICT_SEEDS[district];
  resetBuildingIds();
  resetDebrisSim(seed);
  propId = 1;

  if (district === "classic") return createClassicTown(seed);

  const layout = generateDistrictLayout(district, seed, makeProp);
  const pileW = layout.maxX - layout.minX + 4;
  const pileD = layout.maxY - layout.minY + 4;
  return {
    ...layout,
    rubble: [],
    marks: [],
    pile: new PileField(layout.minX - 2, layout.minY - 2, pileW, pileD),
    roadCar: null,
    visualRevision: 1,
    collapsedSites: [],
    siteRevision: 1,
  };
}

function createClassicTown(seed: number): Town {
  const buildings: Building[] = CLASSIC_PLACEMENTS.map((place) =>
    createBuildingFromArchetype(place.archetypeId, place.name, place.x, place.y, {
      w: place.w,
      d: place.d,
    }),
  );

  const props: Prop[] = [
    makeProp("light", 16.2, 16.4, 0.28, 0.28, 14, "metal"),
    makeProp("light", 22.6, 16.4, 0.28, 0.28, 14, "metal"),
    makeProp("light", 18.4, 10.4, 0.28, 0.28, 14, "metal"),
    makeProp("light", 12.2, 16.4, 0.28, 0.28, 14, "metal"),
    makeProp("camera", 20.1, 15.6, 0.26, 0.26, 8, "metal"),
    makeProp("camera", 15.4, 8.6, 0.26, 0.26, 8, "metal"),
    makeProp("car", 21.6, 17.4, 1.7, 0.85, 28, "metal", 0.1),
    makeProp("car", 13.4, 17.6, 1.7, 0.85, 28, "metal", 3.2),
    makeProp("car", 28.4, 16.8, 1.6, 0.8, 26, "metal", -0.2),
    makeProp("dumpster", 15.6, 20.2, 0.9, 0.7, 22, "metal"),
    makeProp("dumpster", 26.2, 19.4, 0.9, 0.7, 22, "metal"),
    makeProp("barricade", 19.2, 19.1, 1.4, 0.28, 12, "wood", 0.05),
  ];

  for (let i = 0; i < 5; i++) {
    props.push(makeProp("fence", 16.6 + i * 1.05, 20.55, 1.0, 0.16, 9, "wood"));
  }
  for (let i = 0; i < 4; i++) {
    props.push(makeProp("fence", 26.7, 19.2 + i * 1.05, 0.16, 1.0, 9, "wood"));
  }

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
    lots: [{ x: 1, y: 1, w: 37, d: 33 }],
    district: "classic",
    seed,
    roadSpawnX: 3.4,
    roadSpawnY: 17.6,
    roadSpawnHeading: 0,
    visualRevision: 1,
    collapsedSites: [],
    siteRevision: 1,
  };
}

export function townExtent(town?: Town): { w: number; d: number } {
  if (!town) return { w: 40 * CELL, d: 36 * CELL };
  return { w: (town.maxX - town.minX + 2) * CELL, d: (town.maxY - town.minY + 2) * CELL };
}
