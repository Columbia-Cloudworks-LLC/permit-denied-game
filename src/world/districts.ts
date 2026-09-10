import { DRESSING } from "../game/constants";
import { aabbOverlap, pointInAabb } from "../game/math";
import type { DistrictId } from "../game/session";
import type { Building, Prop } from "../structure/types";
import { getAsset, validateCatalog } from "./catalog";
import { generateRuralLayout } from "./rural";
import { pointOnRoad, roadsConnected, validateRoadNetwork } from "./roads";
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
): Omit<Town, "pile" | "rubble" | "marks" | "roadCar" | "visualRevision" | "collapsedSites" | "siteRevision"> {
  const rural = generateRuralLayout(id, seed);
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
    if (overlapsPavementCore(town, footprint)) {
      issues.push({ code: "road", detail: `${a.name} overlaps a street` });
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

  if (!roadsConnected(town.network) && !legacyRoadsConnected(town)) {
    issues.push({ code: "streets", detail: "streets are not connected" });
  }

  const net = validateRoadNetwork(town.network);
  for (const issue of net.issues) {
    if (issue.code === "grade" || issue.code === "clearance") continue;
    issues.push({ code: issue.code, detail: issue.detail });
  }

  for (const lot of town.lots) {
    if (lot.accessId && !town.network.accesses.some((a) => a.id === lot.accessId || a.lotId === lot.id)) {
      issues.push({ code: "access", detail: `${lot.id} missing road access` });
    }
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

function overlapsPavementCore(town: Town, box: { x: number; y: number; w: number; d: number }): boolean {
  const cx = box.x + box.w * 0.5;
  const cy = box.y + box.d * 0.5;
  return pointOnRoad(town.network, cx, cy);
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

function legacyRoadsConnected(town: Town): boolean {
  if (town.roads.length === 0) return false;
  const seen = new Set<number>();
  const stack = [0];
  seen.add(0);
  while (stack.length) {
    const i = stack.pop()!;
    const a = town.roads[i]!;
    for (let j = 0; j < town.roads.length; j++) {
      if (seen.has(j)) continue;
      const b = town.roads[j]!;
      if (aabbOverlap(a.x - 0.05, a.y - 0.05, a.w + 0.1, a.d + 0.1, b.x, b.y, b.w, b.d)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size === town.roads.length;
}
