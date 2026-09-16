import { aabbOverlap, distToSegment, len, pointInAabb, pointInPoly } from "../game/math";
import { Rng } from "../game/rng";
import type { Building, GroundPatch, Lot, Prop } from "../structure/types";
import type { FieldCropId, FieldState, BiomeProfile } from "./biomes";
import { getAsset, spawnAsset } from "./catalog";
import { drivewayPatch, lotAxisSizes, lotLocalToWorld } from "./dressing";
import { derivedRoadBoxes, pointOnRoad, type RoadNetwork } from "./roads";

export const WATER_SALT = 0xa7e2;
export const FOREST_SALT = 0xf02e57;
export const FIELD_SALT = 0xf1e1d;
export const EDGE_SALT = 0xed9e;

export type TraversalKind = "open" | "water" | "forest-core";

export interface ForestFeature {
  kind: "forest";
  id: string;
  cx: number;
  cy: number;
  coreR: number;
  canopyR: number;
  seed: number;
}

export interface BasinFeature {
  kind: "pond" | "lake";
  id: string;
  poly: { x: number; y: number }[];
  seed: number;
}

export interface RiverFeature {
  kind: "river";
  id: string;
  path: { x: number; y: number }[];
  halfWidth: number;
  seed: number;
}

export interface FieldFeature {
  kind: "field";
  id: string;
  x: number;
  y: number;
  w: number;
  d: number;
  heading: number;
  crop: FieldCropId;
  state: FieldState;
  seed: number;
  lotId?: string;
  cell: number;
  cols: number;
  rows: number;
  churn: Uint8Array;
}

export type TerrainFeature = ForestFeature | BasinFeature | RiverFeature | FieldFeature;

export interface FeatureContext {
  biome: BiomeProfile;
  seed: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  network: RoadNetwork;
  lots: readonly Lot[];
  buildings: readonly Building[];
  props: Prop[];
  ground: GroundPatch[];
  spawnX: number;
  spawnY: number;
  roadSpawnX: number;
  roadSpawnY: number;
  propBudget: number;
}

const ROAD_MARGIN = 4.2;
const LOT_MARGIN = 1.6;
const BUILDING_MARGIN = 1.4;
const SPAWN_CLEAR = 4.2;

export function terrainTraversalAt(features: readonly TerrainFeature[] | undefined, x: number, y: number): TraversalKind {
  if (!features?.length) return "open";
  for (const feature of features) {
    switch (feature.kind) {
      case "forest":
        if (len(x - feature.cx, y - feature.cy) <= feature.coreR) return "forest-core";
        break;
      case "pond":
      case "lake":
        if (pointInPoly(x, y, feature.poly)) return "water";
        break;
      case "river":
        if (pointOnRiver(feature, x, y)) return "water";
        break;
      case "field":
        break;
      default: {
        const _never: never = feature;
        return _never;
      }
    }
  }
  return "open";
}

export function pointOnRiver(feature: RiverFeature, x: number, y: number): boolean {
  for (let i = 1; i < feature.path.length; i++) {
    const a = feature.path[i - 1]!;
    const b = feature.path[i]!;
    if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= feature.halfWidth) return true;
  }
  return false;
}

export function featureBounds(feature: TerrainFeature): { x: number; y: number; w: number; d: number } {
  switch (feature.kind) {
    case "forest":
      return {
        x: feature.cx - feature.canopyR,
        y: feature.cy - feature.canopyR,
        w: feature.canopyR * 2,
        d: feature.canopyR * 2,
      };
    case "pond":
    case "lake": {
      const xs = feature.poly.map((p) => p.x);
      const ys = feature.poly.map((p) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, d: Math.max(...ys) - y };
    }
    case "river": {
      const xs = feature.path.map((p) => p.x);
      const ys = feature.path.map((p) => p.y);
      const pad = feature.halfWidth;
      const x = Math.min(...xs) - pad;
      const y = Math.min(...ys) - pad;
      return { x, y, w: Math.max(...xs) - x + pad * 2, d: Math.max(...ys) - y + pad * 2 };
    }
    case "field":
      return { x: feature.x, y: feature.y, w: feature.w, d: feature.d };
    default: {
      const _never: never = feature;
      return _never;
    }
  }
}

export function pointInField(feature: FieldFeature, x: number, y: number): boolean {
  const fx = Math.cos(feature.heading);
  const fy = Math.sin(feature.heading);
  const cx = feature.x + feature.w * 0.5;
  const cy = feature.y + feature.d * 0.5;
  const dx = x - cx;
  const dy = y - cy;
  const along = dx * fx + dy * fy;
  const across = -dx * fy + dy * fx;
  return Math.abs(along) <= feature.w * 0.5 && Math.abs(across) <= feature.d * 0.5;
}

export function churnFieldsUnder(
  features: TerrainFeature[] | undefined,
  points: readonly { x: number; y: number }[],
  radius: number,
): number {
  if (!features?.length) return 0;
  let marked = 0;
  for (const feature of features) {
    if (feature.kind !== "field") continue;
    for (const point of points) {
      marked += churnFieldAt(feature, point.x, point.y, radius);
    }
  }
  return marked;
}

export function churnFieldAt(feature: FieldFeature, x: number, y: number, radius: number): number {
  if (!pointInField(feature, x, y) && !pointInAabb(x, y, feature.x - radius, feature.y - radius, feature.w + radius * 2, feature.d + radius * 2)) {
    return 0;
  }
  const fx = Math.cos(feature.heading);
  const fy = Math.sin(feature.heading);
  const cx = feature.x + feature.w * 0.5;
  const cy = feature.y + feature.d * 0.5;
  let marked = 0;
  const reach = Math.max(1, Math.ceil(radius / feature.cell));
  const along = (x - cx) * fx + (y - cy) * fy + feature.w * 0.5;
  const across = -(x - cx) * fy + (y - cy) * fx + feature.d * 0.5;
  const col = Math.round(along / feature.cell);
  const row = Math.round(across / feature.cell);
  for (let iy = row - reach; iy <= row + reach; iy++) {
    for (let ix = col - reach; ix <= col + reach; ix++) {
      if (ix < 0 || iy < 0 || ix >= feature.cols || iy >= feature.rows) continue;
      const wx = cx + fx * ((ix + 0.5) * feature.cell - feature.w * 0.5) - fy * ((iy + 0.5) * feature.cell - feature.d * 0.5);
      const wy = cy + fy * ((ix + 0.5) * feature.cell - feature.w * 0.5) + fx * ((iy + 0.5) * feature.cell - feature.d * 0.5);
      if (len(wx - x, wy - y) > radius) continue;
      const index = iy * feature.cols + ix;
      if (feature.churn[index]) continue;
      feature.churn[index] = 1;
      marked++;
    }
  }
  return marked;
}

export function resolveTraversal(
  x: number,
  y: number,
  startX: number,
  startY: number,
  features: readonly TerrainFeature[] | undefined,
): { x: number; y: number; blocked: boolean } {
  if (terrainTraversalAt(features, x, y) === "open") return { x, y, blocked: false };
  if (terrainTraversalAt(features, x, startY) === "open") return { x, y: startY, blocked: true };
  if (terrainTraversalAt(features, startX, y) === "open") return { x: startX, y, blocked: true };
  if (terrainTraversalAt(features, startX, startY) === "open") return { x: startX, y: startY, blocked: true };
  const escaped = pushOutOfTerrain(features, startX, startY) ?? pushOutOfTerrain(features, x, y);
  if (escaped) return { ...escaped, blocked: true };
  return { x: startX, y: startY, blocked: true };
}

function pushOutOfTerrain(
  features: readonly TerrainFeature[] | undefined,
  x: number,
  y: number,
): { x: number; y: number } | undefined {
  if (!features?.length) return undefined;
  for (const feature of features) {
    switch (feature.kind) {
      case "forest": {
        const dx = x - feature.cx;
        const dy = y - feature.cy;
        const dist = len(dx, dy);
        if (dist > feature.coreR) break;
        const ux = dist > 1e-6 ? dx / dist : 1;
        const uy = dist > 1e-6 ? dy / dist : 0;
        const px = feature.cx + ux * (feature.coreR + 0.45);
        const py = feature.cy + uy * (feature.coreR + 0.45);
        if (terrainTraversalAt(features, px, py) === "open") return { x: px, y: py };
        break;
      }
      case "pond":
      case "lake": {
        if (!pointInPoly(x, y, feature.poly)) break;
        const box = featureBounds(feature);
        const cx = box.x + box.w * 0.5;
        const cy = box.y + box.d * 0.5;
        const dx = x - cx;
        const dy = y - cy;
        const dist = len(dx, dy) || 0.001;
        for (let step = 1; step <= 8; step++) {
          const px = cx + (dx / dist) * (Math.max(box.w, box.d) * 0.15 * step);
          const py = cy + (dy / dist) * (Math.max(box.w, box.d) * 0.15 * step);
          if (terrainTraversalAt(features, px, py) === "open") return { x: px, y: py };
        }
        break;
      }
      case "river": {
        if (!pointOnRiver(feature, x, y)) break;
        const nearest = nearestRiverPoint(feature, x, y);
        const dx = x - nearest.x;
        const dy = y - nearest.y;
        const dist = len(dx, dy) || 0.001;
        const px = nearest.x + (dx / dist) * (feature.halfWidth + 0.4);
        const py = nearest.y + (dy / dist) * (feature.halfWidth + 0.4);
        if (terrainTraversalAt(features, px, py) === "open") return { x: px, y: py };
        break;
      }
      case "field":
        break;
      default: {
        const _never: never = feature;
        return _never;
      }
    }
  }
  return undefined;
}

function nearestRiverPoint(feature: RiverFeature, x: number, y: number): { x: number; y: number } {
  let best = feature.path[0]!;
  let bestD = Infinity;
  for (let i = 1; i < feature.path.length; i++) {
    const a = feature.path[i - 1]!;
    const b = feature.path[i]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / (abx * abx + aby * aby + 1e-8)));
    const px = a.x + abx * t;
    const py = a.y + aby * t;
    const d = len(x - px, y - py);
    if (d < bestD) {
      bestD = d;
      best = { x: px, y: py };
    }
  }
  return best;
}

export function placeTerrainFeatures(ctx: FeatureContext): TerrainFeature[] {
  const features: TerrainFeature[] = [];
  placeWater(ctx, features);
  placeForests(ctx, features);
  placeFields(ctx, features);
  for (const feature of features) ctx.ground.push(...featurePatches(feature));
  placeEdgeTrees(ctx, features);
  return features;
}

function placeWater(ctx: FeatureContext, features: TerrainFeature[]): void {
  const rng = new Rng(ctx.seed ^ WATER_SALT);
  if (!rng.chance(Math.max(0.4, ctx.biome.waterLikelihood))) return;
  if ((ctx.biome.id === "mixed-woodland" || rng.chance(0.32)) && tryRiver(ctx, features, rng)) return;
  tryBasin(ctx, features, rng, rng.chance(0.38) ? "lake" : "pond");
}

function tryBasin(ctx: FeatureContext, features: TerrainFeature[], rng: Rng, kind: "pond" | "lake"): boolean {
  const rx = kind === "lake" ? rng.range(5.2, 7.4) : rng.range(3.2, 4.8);
  const ry = kind === "lake" ? rng.range(4.2, 6.2) : rng.range(2.6, 4.1);
  for (let attempt = 0; attempt < 28; attempt++) {
    const cx = rng.range(ctx.minX + rx + 1.5, ctx.maxX - rx - 1.5);
    const cy = rng.range(ctx.minY + ry + 1.5, ctx.maxY - ry - 1.5);
    const poly = irregularPoly(cx, cy, rx, ry, kind === "lake" ? 10 : 8, (ctx.seed ^ (attempt * 9973)) >>> 0);
    const box = polyBox(poly);
    if (blocked(ctx, features, box.x, box.y, box.w, box.d, ROAD_MARGIN + 1.2)) continue;
    if (poly.some((p) => pointNearRoad(ctx.network, p.x, p.y, ROAD_MARGIN))) continue;
    features.push({ kind, id: `${kind}-${features.length}`, poly, seed: rng.int(1, 1_000_000) });
    return true;
  }
  return false;
}

function tryRiver(ctx: FeatureContext, features: TerrainFeature[], rng: Rng): boolean {
  const halfWidth = rng.range(1.15, 1.55);
  if (tryPerimeterRiver(ctx, features, rng, halfWidth)) return true;
  const vertical = rng.chance(0.5);
  const start = vertical
    ? { x: rng.range(ctx.minX + 3, ctx.maxX - 3), y: ctx.minY }
    : { x: ctx.minX, y: rng.range(ctx.minY + 3, ctx.maxY - 3) };
  const end = vertical
    ? { x: rng.range(ctx.minX + 3, ctx.maxX - 3), y: ctx.maxY }
    : { x: ctx.maxX, y: rng.range(ctx.minY + 3, ctx.maxY - 3) };
  const midCount = 3;
  const path = [start];
  for (let i = 1; i <= midCount; i++) {
    const t = i / (midCount + 1);
    path.push({
      x: start.x + (end.x - start.x) * t + rng.range(-4, 4),
      y: start.y + (end.y - start.y) * t + rng.range(-4, 4),
    });
  }
  path.push(end);
  const box = polyBox(path, halfWidth);
  if (blocked(ctx, features, box.x, box.y, box.w, box.d, ROAD_MARGIN + 0.4)) return false;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const x = Math.min(a.x, b.x) - halfWidth;
    const y = Math.min(a.y, b.y) - halfWidth;
    const w = Math.abs(b.x - a.x) + halfWidth * 2;
    const d = Math.abs(b.y - a.y) + halfWidth * 2;
    if (blocked(ctx, features, x, y, w, d, ROAD_MARGIN)) return false;
  }
  features.push({ kind: "river", id: `river-${features.length}`, path, halfWidth, seed: rng.int(1, 1_000_000) });
  return true;
}

function tryPerimeterRiver(
  ctx: FeatureContext,
  features: TerrainFeature[],
  rng: Rng,
  halfWidth: number,
): boolean {
  const inset = 2.5 + halfWidth;
  const wobble = rng.range(-1.1, 1.1);
  const sides: { x: number; y: number }[][] = [
    [
      { x: ctx.minX, y: ctx.minY + inset + wobble },
      { x: (ctx.minX + ctx.maxX) * 0.5, y: ctx.minY + inset + wobble * 0.4 },
      { x: ctx.maxX, y: ctx.minY + inset - wobble },
    ],
    [
      { x: ctx.minX, y: ctx.maxY - inset + wobble },
      { x: (ctx.minX + ctx.maxX) * 0.5, y: ctx.maxY - inset },
      { x: ctx.maxX, y: ctx.maxY - inset - wobble },
    ],
    [
      { x: ctx.minX + inset + wobble, y: ctx.minY },
      { x: ctx.minX + inset, y: (ctx.minY + ctx.maxY) * 0.5 },
      { x: ctx.minX + inset - wobble, y: ctx.maxY },
    ],
    [
      { x: ctx.maxX - inset + wobble, y: ctx.minY },
      { x: ctx.maxX - inset, y: (ctx.minY + ctx.maxY) * 0.5 },
      { x: ctx.maxX - inset - wobble, y: ctx.maxY },
    ],
  ];
  for (const path of sides) {
    let clear = true;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const x = Math.min(a.x, b.x) - halfWidth;
      const y = Math.min(a.y, b.y) - halfWidth;
      const w = Math.abs(b.x - a.x) + halfWidth * 2;
      const d = Math.abs(b.y - a.y) + halfWidth * 2;
      if (blocked(ctx, features, x, y, w, d, ROAD_MARGIN)) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    features.push({ kind: "river", id: `river-${features.length}`, path, halfWidth, seed: rng.int(1, 1_000_000) });
    return true;
  }
  return false;
}

function placeForests(ctx: FeatureContext, features: TerrainFeature[]): void {
  const rng = new Rng(ctx.seed ^ FOREST_SALT);
  const area = Math.max(1, (ctx.maxX - ctx.minX) * (ctx.maxY - ctx.minY));
  const want = Math.max(ctx.biome.forestDensity > 0.2 ? 1 : 0, Math.min(3, Math.round(area / 2200 * ctx.biome.forestDensity)));
  for (let n = 0; n < want; n++) {
    const coreR = rng.range(3.4, 5.2);
    const canopyR = coreR + rng.range(2.6, 3.8);
    let placed = false;
    for (let attempt = 0; attempt < 24 && !placed; attempt++) {
      const cx = rng.range(ctx.minX + canopyR + 1, ctx.maxX - canopyR - 1);
      const cy = rng.range(ctx.minY + canopyR + 1, ctx.maxY - canopyR - 1);
      const x = cx - canopyR;
      const y = cy - canopyR;
      const w = canopyR * 2;
      const d = canopyR * 2;
      if (blocked(ctx, features, x, y, w, d, ROAD_MARGIN + 0.8)) continue;
      if (pointNearRoad(ctx.network, cx, cy, canopyR + ROAD_MARGIN)) continue;
      features.push({
        kind: "forest",
        id: `forest-${features.length}`,
        cx,
        cy,
        coreR,
        canopyR,
        seed: rng.int(1, 1_000_000),
      });
      placed = true;
    }
  }
}

function placeFields(ctx: FeatureContext, features: TerrainFeature[]): void {
  const rng = new Rng(ctx.seed ^ FIELD_SALT);
  const farms = ctx.lots.filter((lot) => lot.identity === "farm");
  for (const lot of farms) {
    const field = fieldOnLot(ctx, lot, rng) ?? fieldBesideLot(ctx, features, lot, rng);
    if (field) features.push(field);
  }
  const haveField = features.some((feature) => feature.kind === "field");
  if (ctx.biome.fieldDensity < 0.55 && haveField) return;
  const extra = !haveField
    ? 1
    : ctx.biome.id === "agricultural-plain"
      ? 1
      : Math.min(1, Math.max(0, Math.round(ctx.biome.fieldDensity)));
  for (let n = 0; n < extra; n++) {
    const w = rng.range(6.2, 9.5);
    const d = rng.range(4.8, 7.2);
    for (let attempt = 0; attempt < 28; attempt++) {
      const x = rng.range(ctx.minX + 1, ctx.maxX - w - 1);
      const y = rng.range(ctx.minY + 1, ctx.maxY - d - 1);
      if (blocked(ctx, features, x, y, w, d, ROAD_MARGIN, false, true)) continue;
      features.push(makeField(x, y, w, d, rng.pick([0, Math.PI / 2]), rng, ctx.biome, `field-open-${features.length}`));
      break;
    }
  }
}

function fieldOnLot(ctx: FeatureContext, lot: Lot, rng: Rng): FieldFeature | undefined {
  const building = ctx.buildings.find((b) => b.lotId === lot.id);
  const size = lotAxisSizes(lot);
  const along = Math.max(3.2, size.along * 0.36);
  const across = Math.max(2.8, size.across * 0.4);
  const tries = [
    { along: 0.74, across: 0.1 },
    { along: 0.68, across: -0.16 },
    { along: 0.8, across: 0.02 },
    { along: 0.58, across: 0.2 },
  ];
  const drive = drivewayPatch(lot);
  for (const tryAt of tries) {
    const center = lotLocalToWorld(lot, tryAt.along, tryAt.across);
    const x = center.x - along * 0.5;
    const y = center.y - across * 0.5;
    if (building) {
      const bw = building.w * building.cellSize;
      const bd = building.d * building.cellSize;
      if (aabbOverlap(x, y, along, across, building.x - 0.35, building.y - 0.35, bw + 0.7, bd + 0.7)) continue;
    }
    if (aabbOverlap(x, y, along, across, drive.x, drive.y, drive.w, drive.d)) continue;
    if (pointOnRoad(ctx.network, center.x, center.y)) continue;
    if (boxNearRoad(ctx.network, x, y, along, across, 0.15)) continue;
    return makeField(x, y, along, across, lot.heading, rng, ctx.biome, `field-${lot.id}`, lot.id);
  }
  const x = lot.x + lot.w * 0.1;
  const y = lot.y + lot.d * 0.52;
  const w = lot.w * 0.8;
  const d = lot.d * 0.36;
  if (building) {
    const bw = building.w * building.cellSize;
    const bd = building.d * building.cellSize;
    if (aabbOverlap(x, y, w, d, building.x, building.y, bw, bd)) return undefined;
  }
  if (aabbOverlap(x, y, w, d, drive.x, drive.y, drive.w, drive.d)) return undefined;
  if (pointOnRoad(ctx.network, x + w * 0.5, y + d * 0.5)) return undefined;
  return makeField(x, y, w, d, lot.heading, rng, ctx.biome, `field-${lot.id}`, lot.id);
}

function fieldBesideLot(
  ctx: FeatureContext,
  features: TerrainFeature[],
  lot: Lot,
  rng: Rng,
): FieldFeature | undefined {
  const size = lotAxisSizes(lot);
  const w = Math.max(5.2, size.along * 0.55);
  const d = Math.max(3.8, size.across * 0.42);
  const rear = lotLocalToWorld(lot, 1.12, 0);
  const x = rear.x - w * 0.5;
  const y = rear.y - d * 0.5;
  if (blocked(ctx, features, x, y, w, d, 0.6, false, true)) return undefined;
  return makeField(x, y, w, d, lot.heading, rng, ctx.biome, `field-rear-${lot.id}`, lot.id);
}

function makeField(
  x: number,
  y: number,
  w: number,
  d: number,
  heading: number,
  rng: Rng,
  biome: BiomeProfile,
  id: string,
  lotId?: string,
): FieldFeature {
  const cell = 0.85;
  const cols = Math.max(2, Math.ceil(w / cell));
  const rows = Math.max(2, Math.ceil(d / cell));
  return {
    kind: "field",
    id,
    x,
    y,
    w,
    d,
    heading,
    crop: rng.pick(biome.crops),
    state:
      biome.id === "agricultural-plain"
        ? rng.pick(["mature", "mature", "short"])
        : rng.pick(["mature", "short", "tilled", "stubble"]),
    seed: rng.int(1, 1_000_000),
    lotId,
    cell,
    cols,
    rows,
    churn: new Uint8Array(cols * rows),
  };
}

function placeEdgeTrees(ctx: FeatureContext, features: TerrainFeature[]): void {
  const rng = new Rng(ctx.seed ^ EDGE_SALT);
  const remaining = Math.max(0, ctx.propBudget - ctx.props.length);
  const cap = Math.min(remaining, 4 + Math.floor(ctx.lots.length * 0.18));
  if (cap <= 0) return;
  let placed = 0;
  for (const feature of features) {
    if (feature.kind !== "forest" || placed >= cap) continue;
    const ring = feature.canopyR + 0.55;
    const count = Math.min(6, cap - placed);
    for (let i = 0; i < count + 4 && placed < cap; i++) {
      const a = (i / Math.max(1, count)) * Math.PI * 2 + rng.range(-0.12, 0.12);
      const r = ring + rng.range(-0.15, 0.55);
      const x = feature.cx + Math.cos(a) * r;
      const y = feature.cy + Math.sin(a) * r;
      if (len(x - feature.cx, y - feature.cy) <= feature.coreR + 0.35) continue;
      if (terrainTraversalAt(features, x, y) !== "open") continue;
      const pool = i % 5 === 0 ? ctx.biome.shrubs : i % 4 === 0 ? ctx.biome.saplings : ctx.biome.trees;
      const assetId = rng.pick(pool);
      const def = getAsset(assetId);
      const px = x - def.footprint.w * 0.5;
      const py = y - def.footprint.d * 0.5;
      if (blocked(ctx, features, px, py, def.footprint.w, def.footprint.d, 0.8, true)) continue;
      if (ctx.props.some((p) => aabbOverlap(px, py, def.footprint.w, def.footprint.d, p.x, p.y, p.w, p.d))) continue;
      const prop = spawnAsset(assetId, px, py, a + rng.range(-0.2, 0.2), rng.int(0, def.variants - 1));
      ctx.props.push(prop);
      placed++;
    }
  }
}

export function featurePatches(feature: TerrainFeature): GroundPatch[] {
  switch (feature.kind) {
    case "forest": {
      const box = featureBounds(feature);
      const n = 10;
      const poly = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        const jitter = 0.88 + ((feature.seed >> (i % 8)) & 3) * 0.04;
        return {
          x: feature.cx + Math.cos(a) * feature.canopyR * jitter,
          y: feature.cy + Math.sin(a) * feature.canopyR * jitter,
        };
      });
      return [{
        x: box.x,
        y: box.y,
        w: box.w,
        d: box.d,
        heading: 0,
        cover: "forest-floor",
        seed: feature.seed,
        z: 0.006,
        poly,
      }];
    }
    case "pond":
    case "lake": {
      const box = featureBounds(feature);
      return [{
        x: box.x,
        y: box.y,
        w: box.w,
        d: box.d,
        heading: 0,
        cover: "water",
        seed: feature.seed,
        z: 0.008,
        poly: feature.poly,
      }];
    }
    case "river": {
      const box = featureBounds(feature);
      return [{
        x: box.x,
        y: box.y,
        w: box.w,
        d: box.d,
        heading: 0,
        cover: "water",
        seed: feature.seed,
        z: 0.008,
        poly: riverRibbon(feature),
      }];
    }
    case "field":
      return [{
        x: feature.x,
        y: feature.y,
        w: feature.w,
        d: feature.d,
        heading: feature.heading,
        cover: fieldCover(feature.state),
        seed: feature.seed,
        z: 0.014,
      }];
    default: {
      const _never: never = feature;
      return _never;
    }
  }
}

function fieldCover(state: FieldState): GroundPatch["cover"] {
  switch (state) {
    case "tilled":
      return "field-tilled";
    case "short":
      return "field-short";
    case "mature":
      return "field-mature";
    case "stubble":
      return "field-stubble";
    default: {
      const _never: never = state;
      return _never;
    }
  }
}

function riverRibbon(feature: RiverFeature): { x: number; y: number }[] {
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i < feature.path.length; i++) {
    const p = feature.path[i]!;
    const prev = feature.path[i - 1] ?? p;
    const next = feature.path[i + 1] ?? p;
    const [nx, ny] = normalize(next.x - prev.x, next.y - prev.y);
    left.push({ x: p.x - ny * feature.halfWidth, y: p.y + nx * feature.halfWidth });
    right.push({ x: p.x + ny * feature.halfWidth, y: p.y - nx * feature.halfWidth });
  }
  return [...left, ...right.reverse()];
}

function normalize(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y);
  if (l < 1e-8) return [1, 0];
  return [x / l, y / l];
}

function irregularPoly(cx: number, cy: number, rx: number, ry: number, n: number, seed: number): { x: number; y: number }[] {
  const verts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wobble = 0.72 + (((seed + i * 9973) >>> 0) % 100) / 180;
    verts.push({ x: cx + Math.cos(a) * rx * wobble, y: cy + Math.sin(a) * ry * wobble });
  }
  return verts;
}

function polyBox(poly: readonly { x: number; y: number }[], pad = 0): { x: number; y: number; w: number; d: number } {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) - x + pad, d: Math.max(...ys) - y + pad };
}

function blocked(
  ctx: FeatureContext,
  features: readonly TerrainFeature[],
  x: number,
  y: number,
  w: number,
  d: number,
  roadMargin: number,
  ignoreForest = false,
  ignoreLots = false,
): boolean {
  if (boxNearRoad(ctx.network, x, y, w, d, roadMargin)) return true;
  if (hitsSpawn(ctx, x, y, w, d)) return true;
  if (!ignoreLots) {
    for (const lot of ctx.lots) {
      if (aabbOverlap(x, y, w, d, lot.x - LOT_MARGIN, lot.y - LOT_MARGIN, lot.w + LOT_MARGIN * 2, lot.d + LOT_MARGIN * 2)) return true;
    }
  }
  for (const building of ctx.buildings) {
    const bw = building.w * building.cellSize;
    const bd = building.d * building.cellSize;
    if (aabbOverlap(x, y, w, d, building.x - BUILDING_MARGIN, building.y - BUILDING_MARGIN, bw + BUILDING_MARGIN * 2, bd + BUILDING_MARGIN * 2)) {
      return true;
    }
  }
  for (const feature of features) {
    if (ignoreForest && feature.kind === "forest") continue;
    if (feature.kind === "field") continue;
    const box = featureBounds(feature);
    if (aabbOverlap(x, y, w, d, box.x, box.y, box.w, box.d)) return true;
  }
  return false;
}

function boxNearRoad(network: RoadNetwork, x: number, y: number, w: number, d: number, margin: number): boolean {
  for (const box of derivedRoadBoxes(network)) {
    if (aabbOverlap(x - margin, y - margin, w + margin * 2, d + margin * 2, box.x, box.y, box.w, box.d)) return true;
  }
  const samples = [
    { x: x + w * 0.5, y: y + d * 0.5 },
    { x, y },
    { x: x + w, y },
    { x, y: y + d },
    { x: x + w, y: y + d },
  ];
  for (const sample of samples) {
    if (pointNearRoad(network, sample.x, sample.y, margin)) return true;
  }
  return false;
}

function pointNearRoad(network: RoadNetwork, x: number, y: number, clearance: number): boolean {
  if (pointOnRoad(network, x, y)) return true;
  for (const seg of network.segments) {
    if (seg.roadClass === "driveway" || seg.roadClass === "ramp") continue;
    for (let i = 1; i < seg.points.length; i++) {
      const a = seg.points[i - 1]!;
      const b = seg.points[i]!;
      if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= seg.width * 0.5 + clearance) return true;
    }
  }
  return false;
}

function hitsSpawn(ctx: FeatureContext, x: number, y: number, w: number, d: number): boolean {
  const r = SPAWN_CLEAR;
  if (aabbOverlap(x, y, w, d, ctx.spawnX - r, ctx.spawnY - r, r * 2, r * 2)) return true;
  return aabbOverlap(x, y, w, d, ctx.roadSpawnX - r, ctx.roadSpawnY - r, r * 2, r * 2);
}

export function validateFeatureLayout(
  features: readonly TerrainFeature[],
  network: RoadNetwork,
  buildings: readonly Building[],
  spawnX: number,
  spawnY: number,
  roadSpawnX: number,
  roadSpawnY: number,
): string[] {
  const issues: string[] = [];
  if (terrainTraversalAt(features, spawnX, spawnY) !== "open") issues.push("spawn blocked by terrain");
  if (terrainTraversalAt(features, roadSpawnX, roadSpawnY) !== "open") issues.push("road spawn blocked by terrain");
  for (const feature of features) {
    if (feature.kind === "field") continue;
    if (featureHitsRoad(feature, network)) issues.push(`${feature.id} overlaps a road`);
    for (const building of buildings) {
      const bw = building.w * building.cellSize;
      const bd = building.d * building.cellSize;
      if (featureHitsBox(feature, { x: building.x, y: building.y, w: bw, d: bd })) {
        issues.push(`${feature.id} overlaps ${building.name}`);
      }
    }
  }
  return issues;
}

function featureHitsRoad(feature: TerrainFeature, network: RoadNetwork): boolean {
  switch (feature.kind) {
    case "forest":
      return pointNearRoad(network, feature.cx, feature.cy, feature.canopyR + 0.25);
    case "pond":
    case "lake":
      return feature.poly.some((p) => pointNearRoad(network, p.x, p.y, 0.35))
        || boxNearRoad(network, ...boxArgs(featureBounds(feature)), 0.2);
    case "river":
      return feature.path.some((p) => pointNearRoad(network, p.x, p.y, feature.halfWidth + 0.2));
    case "field":
      return false;
    default: {
      const _never: never = feature;
      return _never;
    }
  }
}

function featureHitsBox(feature: TerrainFeature, box: { x: number; y: number; w: number; d: number }): boolean {
  switch (feature.kind) {
    case "forest": {
      const qx = Math.max(box.x, Math.min(feature.cx, box.x + box.w));
      const qy = Math.max(box.y, Math.min(feature.cy, box.y + box.d));
      return len(feature.cx - qx, feature.cy - qy) <= feature.canopyR;
    }
    case "pond":
    case "lake":
    case "river":
    case "field": {
      const bounds = featureBounds(feature);
      return aabbOverlap(bounds.x, bounds.y, bounds.w, bounds.d, box.x, box.y, box.w, box.d);
    }
    default: {
      const _never: never = feature;
      return _never;
    }
  }
}

function boxArgs(box: { x: number; y: number; w: number; d: number }): [number, number, number, number] {
  return [box.x, box.y, box.w, box.d];
}
