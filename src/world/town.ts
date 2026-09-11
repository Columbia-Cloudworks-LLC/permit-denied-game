import { CELL } from "../game/constants";
import { Rng } from "../game/rng";
import { DEFAULT_DISTRICT_SEEDS, type DistrictId } from "../game/session";
import { resetDebrisSim } from "../sim/debris";
import { PileField } from "../sim/pile";
import { createBuildingFromArchetype, resetBuildingIds } from "../structure/building";
import type { Building, CollapsedSite, GroundMark, GroundPatch, Lot, Prop, RoadVehicle, Rubble } from "../structure/types";
import { resetPropIds, spawnAsset } from "./catalog";
import type { DistrictReport } from "./districts";
import { generateDistrictLayout } from "./districts";
import { buildingOccupy, dressLot, fillWorldGround, pickTemplate } from "./dressing";
import { CLASSIC_PLACEMENTS } from "./families";
import { completeLot, type NhoodDebug } from "./parcels";
import { linePoints, pt, RoadBuilder, emptyTerrain, type RoadNetwork, type TerrainField } from "./roads";
import type { TopologyFamily } from "./rural";

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
  lots: Lot[];
  ground: GroundPatch[];
  network: RoadNetwork;
  terrain: TerrainField;
  district: DistrictId;
  seed: number;
  roadSpawnX: number;
  roadSpawnY: number;
  roadSpawnHeading: number;
  visualRevision: number;
  collapsedSites: CollapsedSite[];
  siteRevision: number;
  diagnostic: DistrictReport;
  nhood: NhoodDebug;
  topology?: TopologyFamily;
}

export interface TownOptions {
  showcase?: boolean;
  district?: DistrictId;
  seed?: number;
  topology?: TopologyFamily;
}

export function createTown(options: TownOptions = {}): Town {
  const district = options.district ?? "classic";
  const seed = options.seed ?? DEFAULT_DISTRICT_SEEDS[district];
  resetBuildingIds();
  resetDebrisSim(seed);
  resetPropIds();

  if (district === "classic") return createClassicTown(seed, options.showcase);

  const layout = generateDistrictLayout(district, seed, options.topology);
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

function createClassicTown(seed: number, showcase = false): Town {
  const placements: typeof CLASSIC_PLACEMENTS = showcase ? [
    { archetypeId: "ranch", name: "TIMBER RANCH", x: 5, y: 8 },
    { archetypeId: "rivertown", name: "RIVER MERCANTILE", x: 16, y: 8 },
    { archetypeId: "steel-warehouse", name: "STEEL WORKSHOP", x: 28, y: 8 },
  ] : CLASSIC_PLACEMENTS;
  const buildings: Building[] = placements.map((place) =>
    createBuildingFromArchetype(place.archetypeId, place.name, place.x, place.y, {
      w: place.w,
      d: place.d,
    }),
  );

  const props: Prop[] = [
    spawnAsset("light", 16.2, 16.4),
    spawnAsset("light", 22.6, 16.4),
    spawnAsset("light", 18.4, 10.4),
    spawnAsset("light", 12.2, 16.4),
    spawnAsset("camera", 20.1, 15.6),
    spawnAsset("camera", 15.4, 8.6),
    spawnAsset("car", 21.6, 17.4, 0.1),
    spawnAsset("car", 13.4, 17.6, 3.2),
    spawnAsset("car", 28.4, 16.8, -0.2),
    spawnAsset("dumpster", 15.6, 20.2),
    spawnAsset("dumpster", 26.2, 19.4),
    spawnAsset("barricade", 19.2, 19.1, 0.05),
    spawnAsset("mailbox", 16.9, 21.1, 0),
    spawnAsset("trash-can", 15.1, 20.9),
    spawnAsset("shrub", 11.4, 12.2),
    spawnAsset("mature-tree", 27.8, 21.6),
    spawnAsset("fire-hydrant", 18.9, 19.6),
  ];

  for (let i = 0; i < 5; i++) {
    props.push(spawnAsset("fence", 16.6 + i * 1.05, 20.55, 0, 0, { w: 1.0, d: 0.16 }));
  }
  for (let i = 0; i < 4; i++) {
    props.push(spawnAsset("fence", 26.7, 19.2 + i * 1.05, Math.PI / 2, 0, { w: 0.16, d: 1.0 }));
  }

  if (showcase) props.length = 0;
  const b = new RoadBuilder();
  const west = b.node(1, 17.6, 0, "west");
  const east = b.node(38, 17.6, 0, "east");
  const north = b.node(19.75, 1, 0, "north");
  const south = b.node(19.75, 34, 0, "south");
  const center = b.node(19.75, 17.6, 0, "center");
  b.segment(west, center, linePoints(pt(west), pt(center)), { roadClass: "rural", width: 3.2 });
  b.segment(center, east, linePoints(pt(center), pt(east)), { roadClass: "rural", width: 3.2 });
  if (!showcase) {
    b.segment(north, center, linePoints(pt(north), pt(center)), { roadClass: "residential", width: 3.1 });
    b.segment(center, south, linePoints(pt(center), pt(south)), { roadClass: "residential", width: 3.1 });
  }
  const network = b.finish();

  const rng = new Rng(seed ^ 0x51a11);
  const occBoxes = buildings.flatMap(buildingOccupy);
  for (const p of props) occBoxes.push({ x: p.x, y: p.y, w: p.w, d: p.d });
  const lots: Lot[] = buildings.map((building, i) => {
    const bw = building.w * building.cellSize;
    const bd = building.d * building.cellSize;
    const padX = 3.4;
    const padY = 3.2;
    const identity = building.kind === "shop" ? "shop" : building.kind === "industrial" ? "contractor" : "residence";
    const mx = building.x + bw * 0.5 - 19.75;
    const my = building.y + bd * 0.5 - 17.6;
    const heading = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 0 : Math.PI) : my > 0 ? Math.PI / 2 : -Math.PI / 2;
    return completeLot({
      id: `classic${i}`,
      x: building.x - padX,
      y: building.y - padY,
      w: bw + padX * 2,
      d: bd + padY * 2,
      heading,
      zone: building.kind === "shop" ? "commercial" : building.kind === "industrial" ? "industrial" : "residential",
      identity,
      accessId: "",
      templateId: pickTemplate(identity, rng).id,
    });
  });
  const ground: GroundPatch[] = [
    ...fillWorldGround(1, 1, 38, 34, seed),
    { x: 12.2, y: 20.4, w: 4.2, d: 2.4, heading: 0, cover: "dirt", seed: seed ^ 5, z: 0.01 },
  ];
  for (let i = 0; i < lots.length; i++) {
    const dressed = dressLot(lots[i]!, buildings[i], rng, { boxes: occBoxes }, showcase ? 0 : 4);
    props.push(...dressed.props);
    ground.push(...dressed.patches);
    for (const p of dressed.props) occBoxes.push({ x: p.x, y: p.y, w: p.w, d: p.d });
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
      ...(!showcase ? [{ x: 18.2, y: 1, w: 3.1, d: 33 }] : []),
    ],
    lots,
    ground,
    network,
    terrain: emptyTerrain(0, 0, 40, 36),
    district: "classic",
    seed,
    roadSpawnX: 3.4,
    roadSpawnY: 17.6,
    roadSpawnHeading: 0,
    visualRevision: 1,
    collapsedSites: [],
    siteRevision: 1,
    diagnostic: { ok: true, issues: [] },
    nhood: { rejected: [] },
  };
}

export function townExtent(town?: Town): { w: number; d: number } {
  if (!town) return { w: 40 * CELL, d: 36 * CELL };
  return { w: (town.maxX - town.minX + 2) * CELL, d: (town.maxY - town.minY + 2) * CELL };
}

export function propById(town: Town, id: number): Prop | undefined {
  for (const p of town.props) if (p.id === id) return p;
  return undefined;
}
