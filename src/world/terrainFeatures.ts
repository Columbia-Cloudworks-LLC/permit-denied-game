import { aabbOverlap, distToSegment, len, orientedRect, pointBounds, pointInAabb, pointInPoly } from "../game/math";
import { Rng } from "../game/rng";
import type { Building, GroundPatch, Lot, Prop } from "../structure/types";
import type { FieldCropId, FieldState, BiomeProfile } from "./biomes";
import { permittedFieldStates, standingCrop, type SeasonId } from "./season";
import { getAsset, spawnAsset } from "./catalog";
import {
  FIELD_CELL,
  FIELD_FARM_RANGE,
  fieldCellWorld,
  fieldFrame,
  forEachFieldRun,
  fieldValidCount,
  fieldValue,
  fieldWorldBox,
  isPrimaryField,
} from "./fields";
import { derivedRoadBoxes, pointOnRoad, type RoadNetwork } from "./roads";
import { neighbors4, SURFACE_ID, traversalAt, type SurfaceGrid } from "./terrain";

const FIELD_SALT = 0xf1e1d;
const EDGE_SALT = 0xed9e;

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
  mask?: Uint8Array;
  valid?: number;
  value?: number;
  paid?: number;
  cleared?: boolean;
  primary?: boolean;
  noticed?: boolean;
  clearedAnnounced?: boolean;
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
  surface: SurfaceGrid;
  season?: SeasonId;
}

const LOT_MARGIN = 1.6;
const BUILDING_MARGIN = 1.4;
const SPAWN_CLEAR = 4.2;

export function terrainTraversalAt(
  features: readonly TerrainFeature[] | undefined,
  x: number,
  y: number,
  grid?: SurfaceGrid | null,
): TraversalKind {
  if (grid) return traversalAt(grid, x, y);
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

function pointOnRiver(feature: RiverFeature, x: number, y: number): boolean {
  for (let i = 1; i < feature.path.length; i++) {
    const a = feature.path[i - 1]!;
    const b = feature.path[i]!;
    if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= feature.halfWidth) return true;
  }
  return false;
}

function featureBounds(feature: TerrainFeature): { x: number; y: number; w: number; d: number } {
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
      return fieldWorldBox(feature);
    default: {
      const _never: never = feature;
      return _never;
    }
  }
}

function pointInField(feature: FieldFeature, x: number, y: number): boolean {
  const { fx, fy, cx, cy } = fieldFrame(feature);
  const dx = x - cx;
  const dy = y - cy;
  const along = dx * fx + dy * fy;
  const across = -dx * fy + dy * fx;
  return Math.abs(along) <= feature.w * 0.5 && Math.abs(across) <= feature.d * 0.5;
}

export function churnFieldAt(feature: FieldFeature, x: number, y: number, radius: number, mark = 1): number {
  const box = fieldWorldBox(feature);
  if (!pointInField(feature, x, y) && !pointInAabb(x, y, box.x - radius, box.y - radius, box.w + radius * 2, box.d + radius * 2)) {
    return 0;
  }
  const { fx, fy, cx, cy } = fieldFrame(feature);
  let marked = 0;
  const reach = Math.max(1, Math.ceil(radius / feature.cell));
  const along = (x - cx) * fx + (y - cy) * fy + feature.w * 0.5;
  const across = -(x - cx) * fy + (y - cy) * fx + feature.d * 0.5;
  const col = Math.round(along / feature.cell);
  const row = Math.round(across / feature.cell);
  for (let iy = row - reach; iy <= row + reach; iy++) {
    for (let ix = col - reach; ix <= col + reach; ix++) marked += churnCell(feature, ix, iy, x, y, radius, mark);
  }
  return marked;
}

/** Raise one in-range field cell to `mark`; returns 1 only when the cell was untouched. */
function churnCell(feature: FieldFeature, ix: number, iy: number, x: number, y: number, radius: number, mark: number): number {
  if (ix < 0 || iy < 0 || ix >= feature.cols || iy >= feature.rows) return 0;
  const cell = fieldCellWorld(feature, ix, iy);
  if (len(cell.x - x, cell.y - y) > radius) return 0;
  const index = iy * feature.cols + ix;
  if (feature.mask && !feature.mask[index]) return 0;
  const prev = feature.churn[index]!;
  if (!prev) {
    feature.churn[index] = mark;
    return 1;
  }
  if (mark > prev) feature.churn[index] = mark;
  return 0;
}

/** Winter ice is open for the dozer. Forest cores and warm-season water stay blocked. */
export function movementBlocked(kind: TraversalKind, season: SeasonId = "summer"): boolean {
  if (kind === "open") return false;
  if (kind === "water") return season !== "winter";
  return true;
}

export function resolveTraversal(
  x: number,
  y: number,
  startX: number,
  startY: number,
  features: readonly TerrainFeature[] | undefined,
  grid?: SurfaceGrid | null,
  season: SeasonId = "summer",
): { x: number; y: number; blocked: boolean } {
  const open = (px: number, py: number) => !movementBlocked(terrainTraversalAt(features, px, py, grid), season);
  if (open(x, y)) return { x, y, blocked: false };
  if (open(x, startY)) return { x, y: startY, blocked: true };
  if (open(startX, y)) return { x: startX, y, blocked: true };
  if (open(startX, startY)) return { x: startX, y: startY, blocked: true };
  const escaped = pushOutOfTerrain(features, startX, startY, grid) ?? pushOutOfTerrain(features, x, y, grid);
  if (escaped) return { ...escaped, blocked: true };
  return { x: startX, y: startY, blocked: true };
}

const ESCAPE_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]] as const;

function pushOutOfTerrain(
  features: readonly TerrainFeature[] | undefined,
  x: number,
  y: number,
  grid?: SurfaceGrid | null,
): { x: number; y: number } | undefined {
  if (grid) {
    for (const [dx, dy] of ESCAPE_STEPS) {
      const px = x + dx * 0.6;
      const py = y + dy * 0.6;
      if (traversalAt(grid, px, py) === "open") return { x: px, y: py };
    }
  }
  if (!features?.length) return undefined;
  for (const feature of features) {
    const escaped = escapeFeature(features, feature, x, y);
    if (escaped) return escaped;
  }
  return undefined;
}

/** The nearest open point just outside the feature that traps (x, y), if it does. */
function escapeFeature(features: readonly TerrainFeature[], feature: TerrainFeature, x: number, y: number): { x: number; y: number } | undefined {
  switch (feature.kind) {
    case "forest":
      return escapeForest(features, feature, x, y);
    case "pond":
    case "lake":
      return escapeBasin(features, feature, x, y);
    case "river":
      return escapeRiver(features, feature, x, y);
    case "field":
      return undefined;
    default: {
      const _never: never = feature;
      return _never;
    }
  }
}

const openAt = (features: readonly TerrainFeature[], px: number, py: number): { x: number; y: number } | undefined =>
  terrainTraversalAt(features, px, py) === "open" ? { x: px, y: py } : undefined;

function escapeForest(features: readonly TerrainFeature[], feature: ForestFeature, x: number, y: number): { x: number; y: number } | undefined {
  const dx = x - feature.cx;
  const dy = y - feature.cy;
  const dist = len(dx, dy);
  if (dist > feature.coreR) return undefined;
  const ux = dist > 1e-6 ? dx / dist : 1;
  const uy = dist > 1e-6 ? dy / dist : 0;
  return openAt(features, feature.cx + ux * (feature.coreR + 0.45), feature.cy + uy * (feature.coreR + 0.45));
}

/** Walk outward from the basin's centre in 15%-of-extent steps. */
function escapeBasin(features: readonly TerrainFeature[], feature: BasinFeature, x: number, y: number): { x: number; y: number } | undefined {
  if (!pointInPoly(x, y, feature.poly)) return undefined;
  const box = featureBounds(feature);
  const cx = box.x + box.w * 0.5;
  const cy = box.y + box.d * 0.5;
  const dx = x - cx;
  const dy = y - cy;
  const dist = len(dx, dy) || 0.001;
  for (let step = 1; step <= 8; step++) {
    const px = cx + (dx / dist) * (Math.max(box.w, box.d) * 0.15 * step);
    const py = cy + (dy / dist) * (Math.max(box.w, box.d) * 0.15 * step);
    const open = openAt(features, px, py);
    if (open) return open;
  }
  return undefined;
}

function escapeRiver(features: readonly TerrainFeature[], feature: RiverFeature, x: number, y: number): { x: number; y: number } | undefined {
  if (!pointOnRiver(feature, x, y)) return undefined;
  const nearest = nearestRiverPoint(feature, x, y);
  const dx = x - nearest.x;
  const dy = y - nearest.y;
  const dist = len(dx, dy) || 0.001;
  return openAt(features, nearest.x + (dx / dist) * (feature.halfWidth + 0.4), nearest.y + (dy / dist) * (feature.halfWidth + 0.4));
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

export function deriveTerrainFeatures(ctx: FeatureContext): TerrainFeature[] {
  const grid = ctx.surface;
  const features: TerrainFeature[] = [];
  const seen = new Uint8Array(grid.surface.length);
  for (let i = 0; i < grid.surface.length; i++) {
    if (seen[i]) continue;
    const group = featureSurfaceGroup(grid.surface[i]!);
    if (!group) {
      seen[i] = 1;
      continue;
    }
    const feature = featureFromBlob(grid, grid.surface[i]!, floodIds(grid, i, group, seen), ctx, features.length);
    if (feature) features.push(feature);
  }
  promotePrimaryField(features, ctx);
  for (const feature of features) {
    if (feature.kind === "field") ctx.ground.push(...featurePatches(feature));
  }
  placeEdgeTrees(ctx, features);
  return features;
}

/** Surface ids that flood together into one feature, or undefined for ordinary ground. */
function featureSurfaceGroup(id: number): readonly number[] | undefined {
  if (id === SURFACE_ID.water) return [SURFACE_ID.water];
  if (id === SURFACE_ID.field) return [SURFACE_ID.field];
  if (id === SURFACE_ID["forest-floor"] || id === SURFACE_ID["forest-core"]) return [SURFACE_ID["forest-floor"], SURFACE_ID["forest-core"]];
  return undefined;
}

/** A flooded blob becomes water, a field, or a forest by the surface it started on. */
function featureFromBlob(grid: SurfaceGrid, id: number, cells: number[], ctx: FeatureContext, n: number): TerrainFeature | undefined {
  if (id === SURFACE_ID.water) return waterFromBlob(grid, cells, n);
  if (id === SURFACE_ID.field) return fieldFromBlob(grid, cells, ctx, n);
  return forestFromBlob(grid, cells, n);
}

function floodIds(grid: SurfaceGrid, start: number, ids: readonly number[], seen: Uint8Array): number[] {
  const want = new Set(ids);
  const q = [start];
  seen[start] = 1;
  const cells: number[] = [];
  while (q.length) {
    const i = q.pop()!;
    if (!want.has(grid.surface[i]!)) continue;
    cells.push(i);
    for (const j of neighbors4(grid, i)) {
      if (seen[j] || !want.has(grid.surface[j]!)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return cells;
}

function waterFromBlob(grid: SurfaceGrid, cells: number[], n: number): BasinFeature | RiverFeature | undefined {
  if (cells.length < 6) return undefined;
  const pts = cells.map((i) => ({
    x: grid.ox + (i % grid.cols) + 0.5,
    y: grid.oy + ((i / grid.cols) | 0) + 0.5,
  }));
  const { minX, minY, maxX, maxY } = pointBounds(pts);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const touchesW = minX <= grid.ox + 1.5;
  const touchesE = maxX >= grid.ox + grid.cols - 1.5;
  const touchesN = minY <= grid.oy + 1.5;
  const touchesS = maxY >= grid.oy + grid.rows - 1.5;
  const long = Math.max(maxX - minX, maxY - minY) > Math.min(maxX - minX, maxY - minY) * 2.4;
  if ((touchesW && touchesE) || (touchesN && touchesS) || long) {
    const vertical = maxY - minY >= maxX - minX;
    const path = [...pts].sort((a, b) => (vertical ? a.y - b.y : a.x - b.x)).filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 8)) === 0);
    if (path.length < 2) path.push(pts[0]!, pts[pts.length - 1]!);
    return { kind: "river", id: `river-${n}`, path, halfWidth: 1.25, seed: n * 9973 + cells.length };
  }
  const poly = outlineAround(pts, cx, cy);
  return {
    kind: cells.length > 70 ? "lake" : "pond",
    id: `${cells.length > 70 ? "lake" : "pond"}-${n}`,
    poly,
    seed: n * 7919 + cells.length,
  };
}

function forestFromBlob(grid: SurfaceGrid, cells: number[], n: number): ForestFeature | undefined {
  if (cells.length < 8) return undefined;
  let sx = 0;
  let sy = 0;
  const cores: { x: number; y: number }[] = [];
  const all: { x: number; y: number }[] = [];
  for (const i of cells) {
    const x = grid.ox + (i % grid.cols) + 0.5;
    const y = grid.oy + ((i / grid.cols) | 0) + 0.5;
    all.push({ x, y });
    sx += x;
    sy += y;
    if (grid.surface[i] === SURFACE_ID["forest-core"]) cores.push({ x, y });
  }
  const cx = sx / cells.length;
  const cy = sy / cells.length;
  let coreR = 1.2;
  for (const p of cores) coreR = Math.max(coreR, len(p.x - cx, p.y - cy));
  let canopyR = coreR + 2.2;
  for (const p of all) canopyR = Math.max(canopyR, len(p.x - cx, p.y - cy));
  return { kind: "forest", id: `forest-${n}`, cx, cy, coreR, canopyR, seed: n * 6271 + cells.length };
}

/** Roads, water, lots, and a 1.2-unit ring around buildings keep crops off a cell. */
function fieldCellBlocked(grid: SurfaceGrid, ctx: FeatureContext, x: number, y: number): boolean {
  if (pointOnRoad(ctx.network, x, y)) return true;
  if (traversalAt(grid, x, y) === "water") return true;
  if (ctx.lots.some((lot) => x >= lot.x && y >= lot.y && x <= lot.x + lot.w && y <= lot.y + lot.d)) return true;
  return ctx.buildings.some((building) => {
    const bw = building.w * building.cellSize;
    const bd = building.d * building.cellSize;
    return x >= building.x - 1.2 && y >= building.y - 1.2 && x <= building.x + bw + 1.2 && y <= building.y + bd + 1.2;
  });
}

/** Centres of field cells inside the world margin and not blocked. */
function openFieldCells(grid: SurfaceGrid, cells: readonly number[], ctx: FeatureContext): { x: number; y: number }[] {
  const open: { x: number; y: number }[] = [];
  for (const i of cells) {
    const x = grid.ox + (i % grid.cols) + 0.5;
    const y = grid.oy + ((i / grid.cols) | 0) + 0.5;
    if (x < ctx.minX + 1.2 || y < ctx.minY + 1.2 || x > ctx.maxX - 1.2 || y > ctx.maxY - 1.2) continue;
    if (grid.surface[i] !== SURFACE_ID.field) continue;
    if (!fieldCellBlocked(grid, ctx, x, y)) open.push({ x, y });
  }
  return open;
}

function fieldFromBlob(grid: SurfaceGrid, cells: number[], ctx: FeatureContext, n: number): FieldFeature | undefined {
  if (cells.length < 16) return undefined;
  const open = openFieldCells(grid, cells, ctx);
  if (open.length < 16) return undefined;
  const minX = Math.min(...open.map((p) => p.x)) - 0.5;
  const maxX = Math.max(...open.map((p) => p.x)) + 0.5;
  const minY = Math.min(...open.map((p) => p.y)) - 0.5;
  const maxY = Math.max(...open.map((p) => p.y)) + 0.5;
  const width = maxX - minX;
  const height = maxY - minY;
  const heading = width >= height ? 0 : Math.PI / 2;
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const w = heading === 0 ? width : height;
  const d = heading === 0 ? height : width;
  const rng = new Rng(ctx.seed ^ FIELD_SALT ^ (n * 13));
  const feature = makeField(cx - w * 0.5, cy - d * 0.5, w, d, heading, rng, ctx.biome, seasonOf(ctx), `field-${n}`);
  feature.mask = fieldMask(grid, ctx, feature, open, { cx, cy, w, d, heading });
  feature.valid = fieldValidCount(feature);
  if (feature.valid < 24) return undefined;
  feature.value = fieldValue(feature.valid * feature.cell * feature.cell);
  feature.primary = isPrimaryField(feature);
  const farms = ctx.lots.filter((lot) => lot.identity === "farm");
  const bestLot = nearestFarm(farms, { x: minX, y: minY, w: width, d: height });
  if (farms.length && !bestLot) return undefined;
  if (bestLot) feature.lotId = bestLot.id;
  if (ctx.biome.id === "agricultural-plain" && feature.primary) seedPrimaryCrop(feature, ctx, rng);
  syncFieldPay(feature);
  return feature;
}

/** Field grid cells whose centres land on an open blob cell. */
function fieldMask(grid: SurfaceGrid, ctx: FeatureContext, feature: FieldFeature, open: readonly { x: number; y: number }[], frame: { cx: number; cy: number; w: number; d: number; heading: number }): Uint8Array {
  const { cx, cy, w, d, heading } = frame;
  const occupied = new Set(open.map((p) => `${Math.floor(p.x)}:${Math.floor(p.y)}`));
  const mask = new Uint8Array(feature.cols * feature.rows);
  for (let row = 0; row < feature.rows; row++) {
    for (let col = 0; col < feature.cols; col++) {
      const px = cx + Math.cos(heading) * ((col + 0.5) * feature.cell - w * 0.5) - Math.sin(heading) * ((row + 0.5) * feature.cell - d * 0.5);
      const py = cy + Math.sin(heading) * ((col + 0.5) * feature.cell - w * 0.5) + Math.cos(heading) * ((row + 0.5) * feature.cell - d * 0.5);
      if (!fieldCellBlocked(grid, ctx, px, py) && occupied.has(`${Math.floor(px)}:${Math.floor(py)}`)) mask[row * feature.cols + col] = 1;
    }
  }
  return mask;
}

/** Closest farm lot within FIELD_FARM_RANGE of the blob, ties going to the later lot. */
function nearestFarm(farms: readonly Lot[], blobBox: { x: number; y: number; w: number; d: number }): Lot | undefined {
  let bestLot: Lot | undefined;
  let bestD = FIELD_FARM_RANGE;
  for (const lot of farms) {
    const dist = aabbGap(blobBox, lot);
    if (dist <= bestD) {
      bestD = dist;
      bestLot = lot;
    }
  }
  return bestLot;
}

/** The plain's main field starts growing (short) or ripe (mature) when the season allows both. */
function seedPrimaryCrop(feature: FieldFeature, ctx: FeatureContext, rng: Rng): void {
  const grow = rng.chance(0.35);
  const allowed = permittedFieldStates(seasonOf(ctx));
  if (allowed.includes("short") && allowed.includes("mature") && !allowed.includes("stubble")) {
    feature.state = grow ? "short" : "mature";
  }
}

function aabbGap(
  a: { x: number; y: number; w: number; d: number },
  b: { x: number; y: number; w: number; d: number },
): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.d), b.y - (a.y + a.d));
  return Math.hypot(dx, dy);
}

function promotePrimaryField(features: TerrainFeature[], ctx: FeatureContext): void {
  if (ctx.biome.id !== "agricultural-plain") return;
  const fields = features.filter((f): f is FieldFeature => f.kind === "field");
  if (!fields.length) return;
  let best = fields[0]!;
  let bestArea = (best.valid ?? fieldValidCount(best)) * best.cell * best.cell;
  for (const field of fields) {
    const area = (field.valid ?? fieldValidCount(field)) * field.cell * field.cell;
    if (area > bestArea) {
      best = field;
      bestArea = area;
    }
  }
  best.primary = isPrimaryField(best) || best.primary;
  const allowed = permittedFieldStates(seasonOf(ctx));
  if (
    (best.state === "tilled" || best.state === "stubble") &&
    allowed.includes("mature") &&
    !allowed.includes("stubble") &&
    !allowed.includes("tilled")
  ) {
    best.state = "mature";
    syncFieldPay(best);
  }
}

function outlineAround(pts: { x: number; y: number }[], cx: number, cy: number): { x: number; y: number }[] {
  const unique = [...pts];
  unique.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const step = Math.max(1, Math.floor(unique.length / 12));
  const poly = unique.filter((_, i) => i % step === 0);
  return poly.length >= 3 ? poly : [
    { x: cx - 2, y: cy - 2 },
    { x: cx + 2, y: cy - 2 },
    { x: cx + 2, y: cy + 2 },
    { x: cx - 2, y: cy + 2 },
  ];
}

type Box = { x: number; y: number; w: number; d: number };

const boxesOverlap = (a: Box, b: Box): boolean => aabbOverlap(a.x, a.y, a.w, a.d, b.x, b.y, b.w, b.d);
const buildingBox = (building: Building, pad: number): Box =>
  ({ x: building.x - pad, y: building.y - pad, w: building.w * building.cellSize + pad * 2, d: building.d * building.cellSize + pad * 2 });

function seasonOf(ctx: FeatureContext): SeasonId {
  return ctx.season ?? "summer";
}

function syncFieldPay(feature: FieldFeature): void {
  const area = (feature.valid ?? fieldValidCount(feature)) * feature.cell * feature.cell;
  feature.value = standingCrop(feature.state) ? fieldValue(area) : 0;
}

function makeField(
  x: number,
  y: number,
  w: number,
  d: number,
  heading: number,
  rng: Rng,
  biome: BiomeProfile,
  season: SeasonId,
  id: string,
  lotId?: string,
): FieldFeature {
  const cell = FIELD_CELL;
  const cols = Math.max(2, Math.ceil(w / cell));
  const rows = Math.max(2, Math.ceil(d / cell));
  const feature: FieldFeature = {
    kind: "field",
    id,
    x,
    y,
    w,
    d,
    heading,
    crop: rng.pick(biome.crops),
    state: rng.pick(permittedFieldStates(season)),
    seed: rng.int(1, 1_000_000),
    lotId,
    cell,
    cols,
    rows,
    churn: new Uint8Array(cols * rows),
    paid: 0,
    cleared: false,
  };
  feature.valid = fieldValidCount(feature);
  feature.primary = isPrimaryField(feature);
  syncFieldPay(feature);
  return feature;
}

function placeEdgeTrees(ctx: FeatureContext, features: TerrainFeature[]): void {
  const rng = new Rng(ctx.seed ^ EDGE_SALT);
  const remaining = Math.max(0, ctx.propBudget - ctx.props.length);
  const cap = Math.min(remaining, 4 + Math.floor(ctx.lots.length * 0.18));
  if (cap <= 0) return;
  let placed = 0;
  for (const feature of features) {
    if (feature.kind !== "forest" || placed >= cap) continue;
    placed = ringForest(ctx, features, feature, rng, placed, cap);
  }
}

/** Saplings, shrubs and trees just outside one forest's canopy; returns the running placed count. */
function ringForest(ctx: FeatureContext, features: TerrainFeature[], feature: ForestFeature, rng: Rng, placed: number, cap: number): number {
  const ring = feature.canopyR + 0.55;
  const count = Math.min(6, cap - placed);
  for (let i = 0; i < count + 4 && placed < cap; i++) {
    const a = (i / Math.max(1, count)) * Math.PI * 2 + rng.range(-0.12, 0.12);
    const r = ring + rng.range(-0.15, 0.55);
    const x = feature.cx + Math.cos(a) * r;
    const y = feature.cy + Math.sin(a) * r;
    if (len(x - feature.cx, y - feature.cy) <= feature.coreR + 0.35) continue;
    if (terrainTraversalAt(features, x, y, ctx.surface) !== "open") continue;
    const pool = i % 5 === 0 ? ctx.biome.shrubs : i % 4 === 0 ? ctx.biome.saplings : ctx.biome.trees;
    if (edgeTree(ctx, features, rng.pick(pool), x, y, a, rng)) placed++;
  }
  return placed;
}

/** Plant one edge tree centred on (x, y) when it fits inside the world and clear of everything. */
function edgeTree(ctx: FeatureContext, features: TerrainFeature[], assetId: string, x: number, y: number, a: number, rng: Rng): boolean {
  const def = getAsset(assetId);
  const px = x - def.footprint.w * 0.5;
  const py = y - def.footprint.d * 0.5;
  if (px < ctx.minX || py < ctx.minY || px + def.footprint.w > ctx.maxX || py + def.footprint.d > ctx.maxY) return false;
  if (blocked(ctx, features, px, py, def.footprint.w, def.footprint.d, 0.8, true)) return false;
  if (ctx.props.some((p) => aabbOverlap(px, py, def.footprint.w, def.footprint.d, p.x, p.y, p.w, p.d))) return false;
  ctx.props.push(spawnAsset(assetId, px, py, a + rng.range(-0.2, 0.2), rng.int(0, def.variants - 1)));
  return true;
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
      return feature.mask ? fieldMaskPatches(feature) : [fieldRectPatch(feature)];
    default: {
      const _never: never = feature;
      return _never;
    }
  }
}

function fieldRectPatch(feature: FieldFeature): GroundPatch {
  return {
    x: feature.x,
    y: feature.y,
    w: feature.w,
    d: feature.d,
    heading: feature.heading,
    cover: fieldCover(feature.state),
    seed: feature.seed,
    z: 0.014,
  };
}

function fieldMaskPatches(feature: FieldFeature): GroundPatch[] {
  const mask = feature.mask;
  if (!mask) return [fieldRectPatch(feature)];
  const patches: GroundPatch[] = [];
  forEachFieldRun(feature, 1, (i) => mask[i] === 1, (run, row, span, center) => {
    const poly = orientedRect(center.x, center.y, feature.heading, span, feature.cell);
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    patches.push({
      x: minX,
      y: minY,
      w: Math.max(...xs) - minX,
      d: Math.max(...ys) - minY,
      heading: feature.heading,
      cover: fieldCover(feature.state),
      seed: feature.seed + row * 17 + run,
      z: 0.014,
      poly,
    });
  });
  return patches.length ? patches : [fieldRectPatch(feature)];
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
  const box = { x, y, w, d };
  if (!ignoreLots && ctx.lots.some((lot) => boxesOverlap(box, { x: lot.x - LOT_MARGIN, y: lot.y - LOT_MARGIN, w: lot.w + LOT_MARGIN * 2, d: lot.d + LOT_MARGIN * 2 }))) return true;
  if (ctx.buildings.some((building) => boxesOverlap(box, buildingBox(building, BUILDING_MARGIN)))) return true;
  return features.some((feature) => !(ignoreForest && feature.kind === "forest") && feature.kind !== "field" && boxesOverlap(box, featureBounds(feature)));
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
  grid: SurfaceGrid,
  lots: readonly Lot[] = [],
  season: SeasonId = "summer",
): string[] {
  const issues: string[] = [];
  if (movementBlocked(terrainTraversalAt(features, spawnX, spawnY, grid), season)) issues.push("spawn blocked by terrain");
  if (terrainTraversalAt(features, roadSpawnX, roadSpawnY, grid) !== "open") issues.push("road spawn blocked by terrain");
  const report = new Set<string>();
  for (let iy = 0; iy < grid.rows; iy++) {
    for (let ix = 0; ix < grid.cols; ix++) surfaceCellOverlaps(grid, ix, iy, network, buildings, lots, report);
  }
  issues.push(...report);
  return issues;
}

const pointInBox = (x: number, y: number, box: Box): boolean => x >= box.x && y >= box.y && x <= box.x + box.w && y <= box.y + box.d;

/** Water and forest cells may not sit on roads or buildings, and forest may not sit on lots; each message once. */
function surfaceCellOverlaps(grid: SurfaceGrid, ix: number, iy: number, network: RoadNetwork, buildings: readonly Building[], lots: readonly Lot[], report: Set<string>): void {
  const id = grid.surface[iy * grid.cols + ix]!;
  if (id !== SURFACE_ID.water && id !== SURFACE_ID["forest-core"] && id !== SURFACE_ID["forest-floor"]) return;
  const x = grid.ox + (ix + 0.5) * grid.cell;
  const y = grid.oy + (iy + 0.5) * grid.cell;
  const label = id === SURFACE_ID.water ? "water" : id === SURFACE_ID["forest-core"] ? "forest-core" : "forest-floor";
  if (pointOnRoad(network, x, y)) report.add(`${label} overlaps a road`);
  for (const building of buildings) {
    if (pointInBox(x, y, buildingBox(building, 0))) report.add(`${label} overlaps ${building.name}`);
  }
  if (id === SURFACE_ID.water) return;
  for (const lot of lots) {
    if (pointInBox(x, y, lot)) report.add(`${label} overlaps lot ${lot.id}`);
  }
}

