import { CELL } from "../game/constants";
import { aabbOverlap, pointInAabb } from "../game/math";
import { Rng } from "../game/rng";
import { DISTRICT_COUNTS, type DistrictId } from "../game/session";
import { createBuilding, type BuildingSpec } from "../structure/building";
import type { Building, Material, Prop } from "../structure/types";
import { BUILDING_FAMILIES, type BuildingFamily } from "./families";
import type { Town } from "./town";

const LOT_W = 10.6;
const LOT_D = 9.4;
const ROAD_W = 3.2;
const LOT_PAD = 2.05;
const FOOTPRINT_GAP = 0.85;

export interface DistrictIssue {
  code: string;
  detail: string;
}

export interface DistrictReport {
  ok: boolean;
  issues: DistrictIssue[];
}

function varyFamily(family: BuildingFamily, rng: Rng, index: number): BuildingSpec {
  let w = family.w;
  let d = family.d;
  let floors = family.floors;
  let material: Material = family.material;
  if (rng.chance(0.38)) {
    if (family.kind === "house") w = rng.int(2, 3);
    else if (family.kind === "shop") w = rng.int(3, 4);
    else w = rng.int(4, 5);
  }
  if (rng.chance(0.28)) {
    if (family.kind === "house") d = rng.int(2, 3);
    else if (family.kind === "shop") d = 3;
    else d = rng.int(3, 4);
  }
  if (family.kind !== "house" && rng.chance(0.32)) floors = rng.int(2, 3);
  if (rng.chance(0.22)) {
    if (family.kind === "house") material = rng.chance(0.55) ? "wood" : "brick";
    else if (family.kind === "shop") material = rng.chance(0.7) ? "brick" : "wood";
    else material = rng.chance(0.72) ? "concrete" : "brick";
  }
  return {
    kind: family.kind,
    name: `LOT ${index + 1} ${family.label}`,
    x: 0,
    y: 0,
    w,
    d,
    floors,
    material,
    roof: family.roof,
  };
}

export function generateDistrictLayout(
  id: Exclude<DistrictId, "classic">,
  seed: number,
  makeProp: (
    kind: Prop["kind"],
    x: number,
    y: number,
    w: number,
    d: number,
    hp: number,
    material: Prop["material"],
    heading?: number,
  ) => Prop,
): Omit<Town, "pile" | "rubble" | "marks" | "roadCar" | "visualRevision"> {
  const count = DISTRICT_COUNTS[id];
  const rng = new Rng(seed);
  const cols = Math.ceil(Math.sqrt(count * 1.15));
  const rows = Math.ceil(count / cols);
  const originX = 1;
  const originY = 1;
  const roads: Town["roads"] = [];
  const lots: Town["lots"] = [];

  for (let r = 0; r <= rows; r++) {
    const y = originY + r * (LOT_D + ROAD_W);
    const w = cols * LOT_W + (cols + 1) * ROAD_W;
    roads.push({ x: originX, y, w, d: ROAD_W });
  }
  for (let c = 0; c <= cols; c++) {
    const x = originX + c * (LOT_W + ROAD_W);
    const d = rows * LOT_D + (rows + 1) * ROAD_W;
    roads.push({ x, y: originY, w: ROAD_W, d });
  }

  const buildings: Building[] = [];
  let n = 0;
  for (let r = 0; r < rows && n < count; r++) {
    for (let c = 0; c < cols && n < count; c++) {
      const lx = originX + ROAD_W + c * (LOT_W + ROAD_W);
      const ly = originY + ROAD_W + r * (LOT_D + ROAD_W);
      lots.push({ x: lx, y: ly, w: LOT_W, d: LOT_D });
      const family = BUILDING_FAMILIES[n % BUILDING_FAMILIES.length]!;
      const spec = varyFamily(family, rng, n);
      const bw = spec.w * CELL;
      const bd = spec.d * CELL;
      const maxOx = Math.max(0, LOT_W - bw - LOT_PAD * 2);
      const maxOy = Math.max(0, LOT_D - bd - LOT_PAD * 2);
      spec.x = lx + LOT_PAD + (maxOx > 0 ? rng.range(0, maxOx) : 0);
      spec.y = ly + LOT_PAD + (maxOy > 0 ? rng.range(0, maxOy) : 0);
      buildings.push(createBuilding(spec));
      n++;
    }
  }

  const maxX = originX + cols * LOT_W + (cols + 1) * ROAD_W + 1;
  const maxY = originY + rows * LOT_D + (rows + 1) * ROAD_W + 1;
  const south = roads[rows]!;
  let spawnX = originX + (cols * LOT_W + (cols + 1) * ROAD_W) * 0.5;
  let spawnY = south.y + ROAD_W * 0.5;
  const spawnHeading = -Math.PI / 2;

  const mid = roads[Math.floor(rows / 2)]!;
  let roadSpawnX = mid.x + ROAD_W + 2.6;
  let roadSpawnY = mid.y + mid.d * 0.5;
  const roadSpawnHeading = 0;

  const props: Prop[] = [];
  for (let r = 0; r <= rows; r += 2) {
    for (let c = 0; c <= cols; c += 2) {
      const x = originX + c * (LOT_W + ROAD_W) + ROAD_W * 0.35;
      const y = originY + r * (LOT_D + ROAD_W) + ROAD_W * 0.35;
      props.push(makeProp("light", x, y, 0.28, 0.28, 14, "metal"));
    }
  }
  const carN = Math.min(14, Math.max(2, Math.floor(count / 8)));
  for (let i = 0; i < carN; i++) {
    const road = roads[rng.int(0, rows)]!;
    const t = rng.range(0.2, 0.8);
    const cx = road.x + road.w * t - 0.8;
    const cy = road.y + road.d * 0.28;
    if (Math.hypot(cx - spawnX, cy - spawnY) < 4 || Math.hypot(cx - roadSpawnX, cy - roadSpawnY) < 4) continue;
    props.push(
      makeProp(
        "car",
        cx,
        cy,
        1.65,
        0.82,
        26,
        "metal",
        road.w > road.d ? rng.range(-0.12, 0.12) : Math.PI / 2,
      ),
    );
  }
  const dumpN = Math.min(12, Math.max(1, Math.floor(count / 10)));
  for (let i = 0; i < dumpN; i++) {
    const lot = lots[rng.int(0, lots.length - 1)]!;
    props.push(makeProp("dumpster", lot.x + 0.35, lot.y + 0.35, 0.9, 0.7, 22, "metal"));
  }

  const cleared = clearSpawn(buildings, props, spawnX, spawnY, roads);
  spawnX = cleared.x;
  spawnY = cleared.y;
  const roadCleared = clearSpawn(buildings, props, roadSpawnX, roadSpawnY, roads);
  roadSpawnX = roadCleared.x;
  roadSpawnY = roadCleared.y;

  return {
    buildings,
    props,
    spawnX,
    spawnY,
    spawnHeading,
    minX: 1,
    minY: 1,
    maxX,
    maxY,
    roads,
    lots,
    district: id,
    seed,
    roadSpawnX,
    roadSpawnY,
    roadSpawnHeading,
  };
}

function clearSpawn(
  buildings: Building[],
  props: Prop[],
  x: number,
  y: number,
  roads: Town["roads"],
): { x: number; y: number } {
  if (spawnClear(buildings, props, x, y)) return { x, y };
  for (const road of roads) {
    if (road.w < road.d) continue;
    for (let t = 0.2; t <= 0.8; t += 0.08) {
      const sx = road.x + road.w * t;
      const sy = road.y + road.d * 0.5;
      if (spawnClear(buildings, props, sx, sy)) return { x: sx, y: sy };
    }
  }
  return { x, y };
}

function spawnClear(buildings: Building[], props: Prop[], x: number, y: number): boolean {
  const rad = 1.35;
  for (const b of buildings) {
    if (aabbOverlap(x - rad, y - rad, rad * 2, rad * 2, b.x, b.y, b.w * b.cellSize, b.d * b.cellSize)) {
      return false;
    }
  }
  for (const p of props) {
    if (aabbOverlap(x - rad, y - rad, rad * 2, rad * 2, p.x, p.y, p.w, p.d)) return false;
  }
  return true;
}

export function validateTown(town: Town): DistrictReport {
  const issues: DistrictIssue[] = [];
  if (town.district === "classic") {
    if (town.buildings.length !== DISTRICT_COUNTS.classic) {
      issues.push({ code: "count", detail: "classic fixture lost a building" });
    }
    if (!spawnClear(town.buildings, town.props, town.spawnX, town.spawnY)) {
      issues.push({ code: "spawn", detail: "dozer spawn is blocked" });
    }
    pushPileCoverage(town, issues);
    return { ok: issues.length === 0, issues };
  }
  const expected = DISTRICT_COUNTS[town.district];
  if (town.buildings.length !== expected) {
    issues.push({
      code: "count",
      detail: `expected ${expected} buildings, got ${town.buildings.length}`,
    });
  }

  for (let i = 0; i < town.buildings.length; i++) {
    const a = town.buildings[i]!;
    const aw = a.w * a.cellSize;
    const ad = a.d * a.cellSize;
    if (a.x < town.minX || a.y < town.minY || a.x + aw > town.maxX || a.y + ad > town.maxY) {
      issues.push({ code: "bounds", detail: `${a.name} leaves world bounds` });
    }
    for (const road of town.roads) {
      if (aabbOverlap(a.x, a.y, aw, ad, road.x, road.y, road.w, road.d)) {
        issues.push({ code: "road", detail: `${a.name} overlaps a street` });
      }
    }
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
  }

  if (!spawnClear(town.buildings, town.props, town.spawnX, town.spawnY)) {
    issues.push({ code: "spawn", detail: "dozer spawn is blocked" });
  }
  if (!spawnClear(town.buildings, town.props, town.roadSpawnX, town.roadSpawnY)) {
    issues.push({ code: "road-spawn", detail: "test car spawn is blocked" });
  }

  const onRoad =
    town.roads.some((road) => pointInAabb(town.spawnX, town.spawnY, road.x, road.y, road.w, road.d)) ||
    town.roads.some((road) =>
      aabbOverlap(town.spawnX - 0.4, town.spawnY - 0.4, 0.8, 0.8, road.x, road.y, road.w, road.d),
    );
  if (!onRoad) issues.push({ code: "spawn-road", detail: "dozer spawn is not on a street" });

  if (!roadsConnected(town)) {
    issues.push({ code: "streets", detail: "streets are not connected" });
  }

  pushPileCoverage(town, issues);
  return { ok: issues.length === 0, issues };
}

function pushPileCoverage(town: Town, issues: DistrictIssue[]): void {
  const pileMaxX = town.pile.ox + town.pile.cols * town.pile.cell;
  const pileMaxY = town.pile.oy + town.pile.rows * town.pile.cell;
  if (town.pile.ox > town.minX - 0.2 || town.pile.oy > town.minY - 0.2 || pileMaxX < town.maxX || pileMaxY < town.maxY) {
    issues.push({ code: "pile", detail: "pile field does not cover the district" });
  }
}

function roadsConnected(town: Town): boolean {
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
