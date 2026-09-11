import { DRESSING } from "../game/constants";
import { aabbOverlap, pointInAabb } from "../game/math";
import type { DistrictId } from "../game/session";
import type { Building, Prop } from "../structure/types";
import { getAsset, validateCatalog } from "./catalog";
import { aabbContainedInBox, aabbContainedInPoly, convexOverlap, parcelHitsRoad } from "./parcels";
import { generateRuralLayout, type TopologyFamily } from "./rural";
import {
  aabbOverlapsRoad,
  findRoadRoute,
  indexNetwork,
  nearestLane,
  pointOnRoad,
  publicStreetsReachable,
  roadsConnected,
  validateRoadNetwork,
} from "./roads";
import type { Town } from "./town";

const FOOTPRINT_GAP = 0.85;

export interface DistrictIssue {
  code: string;
  detail: string;
}

export interface DistrictReport {
  ok: boolean;
  issues: DistrictIssue[];
}

export function generateDistrictLayout(
  id: Exclude<DistrictId, "classic">,
  seed: number,
  topology?: TopologyFamily,
): Omit<Town, "pile" | "rubble" | "marks" | "roadCar" | "visualRevision" | "collapsedSites" | "siteRevision"> {
  const rural = generateRuralLayout(id, seed, topology);
  return {
    buildings: rural.buildings,
    props: rural.props,
    spawnX: rural.spawnX,
    spawnY: rural.spawnY,
    spawnHeading: rural.spawnHeading,
    minX: rural.minX,
    minY: rural.minY,
    maxX: rural.maxX,
    maxY: rural.maxY,
    roads: rural.roads,
    lots: rural.lots,
    ground: rural.ground,
    network: rural.network,
    terrain: rural.terrain,
    district: rural.district,
    seed: rural.seed,
    roadSpawnX: rural.roadSpawnX,
    roadSpawnY: rural.roadSpawnY,
    roadSpawnHeading: rural.roadSpawnHeading,
    diagnostic: rural.diagnostic,
    nhood: rural.nhood,
    topology: rural.topology,
  };
}

export function buildingOccupyBoxes(building: Building): { x: number; y: number; w: number; d: number }[] {
  return [
    { x: building.x, y: building.y, w: building.w * building.cellSize, d: building.d * building.cellSize },
    ...building.decorBoxes.map((b) => ({ x: b.x, y: b.y, w: b.w, d: b.d })),
  ];
}

export function validateTown(town: Town): DistrictReport {
  const issues: DistrictIssue[] = [];
  if (town.district === "classic") {
    if (town.buildings.length !== 7) {
      issues.push({ code: "count", detail: "classic fixture lost a building" });
    }
    if (!spawnClear(town.buildings, town.props, town.spawnX, town.spawnY)) {
      issues.push({ code: "spawn", detail: "dozer spawn is blocked" });
    }
    pushPileCoverage(town, issues);
    return { ok: issues.length === 0, issues };
  }

  const catalog = validateCatalog();
  for (const issue of catalog.issues) issues.push(issue);

  const expected = districtCount(town.district);
  if (town.buildings.length !== expected) {
    issues.push({
      code: "count",
      detail: `expected ${expected} buildings, got ${town.buildings.length}`,
    });
  }

  const ids = new Set<number>();
  for (const p of town.props) {
    if (ids.has(p.id)) issues.push({ code: "dup-prop", detail: `prop ${p.id}` });
    ids.add(p.id);
    try {
      getAsset(p.assetId);
    } catch {
      issues.push({ code: "asset", detail: `unknown ${p.assetId}` });
    }
    if (p.x < town.minX - 1 || p.y < town.minY - 1 || p.x > town.maxX + 1 || p.y > town.maxY + 1) {
      issues.push({ code: "bounds", detail: `${p.assetId} ${p.id} leaves world bounds` });
    }
  }

  const budget = DRESSING.districtMax[town.district];
  if (town.props.length > budget) {
    issues.push({ code: "density", detail: `${town.props.length} assets exceeds ${budget}` });
  }

  for (let i = 0; i < town.buildings.length; i++) {
    const a = town.buildings[i]!;
    for (const box of buildingOccupyBoxes(a)) {
      if (box.x < town.minX - 0.4 || box.y < town.minY - 0.4 || box.x + box.w > town.maxX + 0.4 || box.y + box.d > town.maxY + 0.4) {
        issues.push({ code: "bounds", detail: `${a.name} leaves world bounds` });
      }
    }
    const footprint = { x: a.x, y: a.y, w: a.w * a.cellSize, d: a.d * a.cellSize };
    if (aabbOverlapsRoad(town.network, footprint.x, footprint.y, footprint.w, footprint.d)) {
      issues.push({ code: "road", detail: `${a.name} overlaps a street` });
    }
    for (const box of buildingOccupyBoxes(a)) {
      if (aabbOverlapsRoad(town.network, box.x, box.y, box.w, box.d)) {
        issues.push({ code: "road", detail: `${a.name} decor overlaps a street` });
      }
    }
    const aw = a.w * a.cellSize;
    const ad = a.d * a.cellSize;
    for (let j = i + 1; j < town.buildings.length; j++) {
      const b = town.buildings[j]!;
      if (
        aabbOverlap(
          a.x - FOOTPRINT_GAP * 0.5,
          a.y - FOOTPRINT_GAP * 0.5,
          aw + FOOTPRINT_GAP,
          ad + FOOTPRINT_GAP,
          b.x,
          b.y,
          b.w * b.cellSize,
          b.d * b.cellSize,
        )
      ) {
        issues.push({ code: "overlap", detail: `${a.name} crowds ${b.name}` });
      }
    }
    for (const p of town.props) {
      if (p.broken) continue;
      for (const box of buildingOccupyBoxes(a)) {
        if (aabbOverlap(p.x, p.y, p.w, p.d, box.x, box.y, box.w, box.d)) {
          issues.push({ code: "prop-building", detail: `${p.assetId} intersects ${a.name}` });
        }
      }
    }
  }

  for (const p of town.props) {
    if (p.broken) continue;
    const def = getAsset(p.assetId);
    if (
      !def.roadsideOk &&
      pointOnRoad(town.network, p.x + p.w * 0.5, p.y + p.d * 0.5)
    ) {
      issues.push({ code: "prop-road", detail: `${p.assetId} sits on pavement` });
    }
  }

  if (!spawnClear(town.buildings, town.props, town.spawnX, town.spawnY)) {
    issues.push({ code: "spawn", detail: "dozer spawn is blocked" });
  }
  if (!spawnClear(town.buildings, town.props, town.roadSpawnX, town.roadSpawnY)) {
    issues.push({ code: "road-spawn", detail: "test car spawn is blocked" });
  }

  const onRoad =
    pointOnRoad(town.network, town.spawnX, town.spawnY) ||
    town.roads.some((road) => pointInAabb(town.spawnX, town.spawnY, road.x, road.y, road.w, road.d)) ||
    town.roads.some((road) =>
      aabbOverlap(town.spawnX - 0.4, town.spawnY - 0.4, 0.8, 0.8, road.x, road.y, road.w, road.d),
    );
  if (!onRoad) issues.push({ code: "spawn-road", detail: "dozer spawn is not on a street" });

  if (!roadsConnected(town.network) || !publicStreetsReachable(town.network, town.roadSpawnX, town.roadSpawnY)) {
    issues.push({ code: "streets", detail: "public streets are not reachable from the road spawn" });
  }

  const net = validateRoadNetwork(town.network);
  for (const issue of net.issues) {
    if (issue.code === "grade" || issue.code === "clearance") continue;
    issues.push({ code: issue.code, detail: issue.detail });
  }

  const lotIds = new Set(town.lots.map((l) => l.id));
  for (const acc of town.network.accesses) {
    if (!lotIds.has(acc.lotId)) issues.push({ code: "orphan-access", detail: `${acc.id} has no retained lot` });
    const seg = town.network.segments.find((s) => s.id === acc.segmentId);
    if (!seg) issues.push({ code: "dangle-access", detail: acc.id });
    else if (!seg.laneIds.includes(acc.laneId) && !town.network.lanes.some((l) => l.id === acc.laneId)) {
      issues.push({ code: "access-lane", detail: acc.id });
    }
  }

  for (let i = 0; i < town.lots.length; i++) {
    const lot = town.lots[i]!;
    if (!lot.frontage?.segmentId) {
      issues.push({ code: "frontage", detail: `${lot.id} missing frontage` });
    }
    if (lot.boundary?.length >= 3 && parcelHitsRoad(lot.boundary, town.network.segments.filter((s) => s.roadClass !== "driveway"))) {
      issues.push({ code: "parcel-road", detail: `${lot.id} occupies a road corridor` });
    }
    for (let j = i + 1; j < town.lots.length; j++) {
      const other = town.lots[j]!;
      if (lot.boundary?.length >= 3 && other.boundary?.length >= 3 && convexOverlap(lot.boundary, other.boundary)) {
        issues.push({ code: "parcel-overlap", detail: `${lot.id} overlaps ${other.id}` });
      }
    }
    const acc = town.network.accesses.find((a) => a.id === lot.accessId || a.lotId === lot.id);
    if (!acc) issues.push({ code: "access", detail: `${lot.id} missing road access` });
    if (!lot.drivewayId || !town.network.segments.some((s) => s.id === lot.drivewayId && s.roadClass === "driveway")) {
      issues.push({ code: "driveway", detail: `${lot.id} missing driveway geometry` });
    }
    if (lot.buildable && lot.boundary?.length >= 3 && !aabbContainedInPoly(lot.buildable, lot.boundary)) {
      issues.push({ code: "envelope", detail: `${lot.id} buildable leaves parcel` });
    }
    const building = town.buildings[i];
    if (building && lot.buildable) {
      for (const box of buildingOccupyBoxes(building)) {
        if (!aabbContainedInBox(box, lot.buildable, 0.05)) {
          issues.push({ code: "envelope", detail: `${building.name} leaves ${lot.id} buildable envelope` });
        }
        if (lot.boundary?.length >= 3 && !aabbContainedInPoly(box, lot.boundary)) {
          issues.push({ code: "parcel-contain", detail: `${building.name} is not inside ${lot.id}` });
        }
      }
    }
  }

  const start = nearestLane(town.network, town.roadSpawnX, town.roadSpawnY);
  const drive = town.network.lanes.find((l) => {
    const seg = indexNetwork(town.network).segmentById.get(l.segmentId);
    return seg?.roadClass === "driveway" && l.dir === 1;
  });
  if (start && drive && !findRoadRoute(town.network, start.id, drive.id)) {
    issues.push({ code: "driveway-route", detail: "no lane path from the road spawn into a driveway" });
  }

  for (const issue of town.diagnostic?.issues ?? []) {
    if (!issues.some((o) => o.code === issue.code && o.detail === issue.detail)) issues.push(issue);
  }

  pushPileCoverage(town, issues);
  return { ok: issues.length === 0, issues };
}

function districtCount(id: DistrictId): number {
  if (id === "classic") return 7;
  if (id === "d10") return 10;
  if (id === "d30") return 30;
  return 100;
}

function spawnClear(buildings: Building[], props: Prop[], x: number, y: number): boolean {
  const rad = 1.35;
  for (const b of buildings) {
    if (aabbOverlap(x - rad, y - rad, rad * 2, rad * 2, b.x, b.y, b.w * b.cellSize, b.d * b.cellSize)) {
      return false;
    }
  }
  for (const p of props) {
    if (p.broken) continue;
    if (aabbOverlap(x - rad, y - rad, rad * 2, rad * 2, p.x, p.y, p.w, p.d)) return false;
  }
  return true;
}

function pushPileCoverage(town: Town, issues: DistrictIssue[]): void {
  const pileMaxX = town.pile.ox + town.pile.cols * town.pile.cell;
  const pileMaxY = town.pile.oy + town.pile.rows * town.pile.cell;
  if (town.pile.ox > town.minX - 0.2 || town.pile.oy > town.minY - 0.2 || pileMaxX < town.maxX || pileMaxY < town.maxY) {
    issues.push({ code: "pile", detail: "pile field does not cover the district" });
  }
}

export function makeInvalidDisconnectedTown(base: Town): Town {
  const extra = {
    id: "orphan-seg",
    startId: "ghost-a",
    endId: "ghost-b",
    points: [
      { x: base.maxX + 40, y: base.maxY + 40, elev: 0 },
      { x: base.maxX + 52, y: base.maxY + 40, elev: 0 },
    ],
    roadClass: "residential" as const,
    surface: "asphalt" as const,
    width: 3.2,
    shoulder: 0.3,
    layer: 0,
    laneIds: ["orphan-lane"],
  };
  return {
    ...base,
    network: {
      ...base.network,
      nodes: [
        ...base.network.nodes,
        { id: "ghost-a", x: extra.points[0]!.x, y: extra.points[0]!.y, elev: 0, segmentIds: [extra.id], junction: "end" },
        { id: "ghost-b", x: extra.points[1]!.x, y: extra.points[1]!.y, elev: 0, segmentIds: [extra.id], junction: "end" },
      ],
      segments: [...base.network.segments, extra],
      lanes: [
        ...base.network.lanes,
        { id: "orphan-lane", segmentId: extra.id, dir: 1 as const, offset: 0, width: 1.2, speedClass: 1, next: [] },
      ],
    },
  };
}
