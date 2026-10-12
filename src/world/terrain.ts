import type { GroundPatch, Lot, LotIdentity } from "../structure/types";
import { pointInPoly } from "../game/math";
import type { BiomeProfile } from "./biomes";
import { pointOnRoad, polylineLength, samplePolyline, type RoadNetwork, type RoadSegment } from "./roads";

export const TERRAIN_GEN_VERSION = 1;
const SURFACE_CELL = 1;
export const SURFACE_CHUNK = 16;
const SURFACE_MAX = 512;
export const FOREST_DEVELOPMENT_CLEAR = 1.6;

const TERRAIN_SURFACES = [
  "grass",
  "scrub",
  "dirt",
  "prairie",
  "duff",
  "leaf-litter",
  "gravel",
  "forest-floor",
  "forest-core",
  "field",
  "wet-edge",
  "water",
  "developed",
] as const;

export type TerrainSurface = (typeof TERRAIN_SURFACES)[number];

export const SURFACE_ID: Record<TerrainSurface, number> = {
  grass: 0,
  scrub: 1,
  dirt: 2,
  prairie: 3,
  duff: 4,
  "leaf-litter": 5,
  gravel: 6,
  "forest-floor": 7,
  "forest-core": 8,
  field: 9,
  "wet-edge": 10,
  water: 11,
  developed: 12,
};

export const SURFACE_FROM_ID: readonly TerrainSurface[] = TERRAIN_SURFACES;

const BASE_NATURAL: readonly TerrainSurface[] = [
  "grass",
  "scrub",
  "dirt",
  "prairie",
  "duff",
  "leaf-litter",
  "gravel",
];

export interface SurfaceGrid {
  ox: number;
  oy: number;
  cell: typeof SURFACE_CELL;
  cols: number;
  rows: number;
  surface: Uint8Array;
  variant: Uint8Array;
  stampRevision: number;
}

export interface TerrainBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GenerateSurfaceOpts {
  seed: number;
  biome: BiomeProfile;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  spawnBand?: { x: number; y: number; w: number; d: number };
  /** Urban and estate levels skip biome-wide crop sheets. */
  openFields?: boolean;
}

/** Rural road grid (east-west by north-south blocks) sized for `count` buildings. */
export function ruralGridDims(count: number): { ew: number; ns: number } {
  const minSlots = count <= 12 ? count * 2.2 : count <= 36 ? count * 2.0 : count * 2.15;
  const target = count <= 12 ? count * 2.6 : count * 2.3;
  let best = { ew: 2, ns: 2 };
  let bestScore = Infinity;
  for (let ew = 2; ew <= 7; ew++) {
    for (let ns = 2; ns <= 7; ns++) {
      const segs = ew * ns + (ns + 1) * (ew - 1);
      const slots = segs * 6;
      if (slots < minSlots) continue;
      const score = Math.abs(slots - target) + Math.abs(ew - ns) * 3 + ew * ns * 0.15;
      if (score < bestScore) {
        best = { ew, ns };
        bestScore = score;
      }
    }
  }
  return best;
}

export function estimateRuralSurfaceBounds(
  count: number,
  originX: number,
  originY: number,
  blockW = 40,
  blockD = 36,
  margin = 12,
): TerrainBounds {
  const { ew, ns } = ruralGridDims(count);
  const minX = Math.floor(originX - margin);
  const minY = Math.floor(originY - margin);
  const maxX = Math.ceil(originX + 2 + ns * blockW + (blockW >= 34 ? 18 : 0) + margin);
  const maxY = Math.ceil(originY + 12 + Math.max(0, ew - 1) * blockD + margin);
  return { minX, minY, maxX, maxY };
}

export function createSurfaceGrid(ox: number, oy: number, cols: number, rows: number, fill: TerrainSurface = "grass"): SurfaceGrid {
  const cap = SURFACE_MAX * SURFACE_MAX;
  let c = Math.max(1, Math.floor(cols));
  let r = Math.max(1, Math.floor(rows));
  if (c * r > cap) {
    const scale = Math.sqrt(cap / (c * r));
    c = Math.max(1, Math.floor(c * scale));
    r = Math.max(1, Math.floor(r * scale));
  }
  const n = c * r;
  const surface = new Uint8Array(n);
  surface.fill(SURFACE_ID[fill]);
  return {
    ox,
    oy,
    cell: SURFACE_CELL,
    cols: c,
    rows: r,
    surface,
    variant: new Uint8Array(n),
    stampRevision: 0,
  };
}

export function emptyGrassGrid(minX: number, minY: number, maxX: number, maxY: number): SurfaceGrid {
  const cols = Math.max(1, Math.ceil(maxX - minX));
  const rows = Math.max(1, Math.ceil(maxY - minY));
  return createSurfaceGrid(minX, minY, cols, rows, "grass");
}

export function cellIndex(grid: SurfaceGrid, ix: number, iy: number): number {
  if (ix < 0 || iy < 0 || ix >= grid.cols || iy >= grid.rows) return -1;
  return iy * grid.cols + ix;
}

const NEIGHBORS_4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** In-grid edge neighbours of cell `i`. */
export function neighbors4(grid: SurfaceGrid, i: number): number[] {
  const ix = i % grid.cols;
  const iy = (i / grid.cols) | 0;
  const out: number[] = [];
  for (const [dx, dy] of NEIGHBORS_4) {
    const j = cellIndex(grid, ix + dx, iy + dy);
    if (j >= 0) out.push(j);
  }
  return out;
}

/** Row-major walk over every surface cell. */
export function forEachSurfaceCell(grid: SurfaceGrid, visit: (i: number, ix: number, iy: number, id: number) => void): void {
  for (let iy = 0; iy < grid.rows; iy++) {
    for (let ix = 0; ix < grid.cols; ix++) {
      const i = iy * grid.cols + ix;
      visit(i, ix, iy, grid.surface[i]!);
    }
  }
}

/** Cells scoring above `min`, best first. A negative score skips the cell. */
function scoreCells(
  grid: SurfaceGrid,
  min: number,
  score: (i: number, ix: number, iy: number, id: number) => number,
): { i: number; s: number }[] {
  const scores: { i: number; s: number }[] = [];
  forEachSurfaceCell(grid, (i, ix, iy, id) => {
    const s = score(i, ix, iy, id);
    if (s > min) scores.push({ i, s });
  });
  return scores.sort((a, b) => b.s - a.s);
}

/** Connected cells sharing the surface id at `start`; marks them in `seen`. */
function floodSurface(grid: SurfaceGrid, start: number, seen: Uint8Array): number[] {
  const id = grid.surface[start]!;
  const cells: number[] = [];
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const i = q.pop()!;
    cells.push(i);
    for (const j of neighbors4(grid, i)) {
      if (seen[j] || grid.surface[j] !== id) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return cells;
}

function worldToCell(grid: SurfaceGrid, x: number, y: number): { ix: number; iy: number } {
  return {
    ix: Math.floor((x - grid.ox) / grid.cell),
    iy: Math.floor((y - grid.oy) / grid.cell),
  };
}

function surfaceIdAt(grid: SurfaceGrid, x: number, y: number): number {
  const { ix, iy } = worldToCell(grid, x, y);
  const i = cellIndex(grid, ix, iy);
  return i < 0 ? SURFACE_ID.grass : grid.surface[i]!;
}

export function surfaceAt(grid: SurfaceGrid, x: number, y: number): TerrainSurface {
  return SURFACE_FROM_ID[surfaceIdAt(grid, x, y)] ?? "grass";
}

export function roadCostAt(grid: SurfaceGrid, x: number, y: number): number {
  const surface = surfaceAt(grid, x, y);
  switch (surface) {
    case "grass":
      return 1;
    case "scrub":
      return 1.15;
    case "dirt":
      return 1;
    case "prairie":
      return 1.3;
    case "duff":
      return 1.4;
    case "leaf-litter":
      return 1.2;
    case "gravel":
      return 0.85;
    case "forest-floor":
      return 2.8;
    case "forest-core":
      return Infinity;
    case "field":
      return 2.2;
    case "wet-edge":
      return 3.5;
    case "water":
      return Infinity;
    case "developed":
      return 0.5;
    default: {
      const _never: never = surface;
      return _never;
    }
  }
}

export function lotCostAt(grid: SurfaceGrid, x: number, y: number, identity: LotIdentity): number {
  const surface = surfaceAt(grid, x, y);
  switch (surface) {
    case "grass":
    case "scrub":
    case "dirt":
    case "duff":
    case "leaf-litter":
    case "gravel":
      return 1;
    case "prairie":
      return identity === "farm" ? 0.9 : 1;
    case "forest-floor":
      return 4;
    case "forest-core":
    case "water":
    case "wet-edge":
      return Infinity;
    case "field":
      return identity === "farm" ? 0.8 : Infinity;
    case "developed":
      return 1;
    default: {
      const _never: never = surface;
      return _never;
    }
  }
}

export function traversalAt(grid: SurfaceGrid, x: number, y: number): "open" | "water" | "forest-core" {
  const id = surfaceIdAt(grid, x, y);
  if (id === SURFACE_ID.water) return "water";
  if (id === SURFACE_ID["forest-core"]) return "forest-core";
  return "open";
}

export function hashSurfaceBytes(data: Uint8Array): string {
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i]!, 16777619);
  return (h >>> 0).toString(16);
}

export function generateSurfaceGrid(opts: GenerateSurfaceOpts): SurfaceGrid {
  const cols = Math.max(1, Math.ceil(opts.maxX - opts.minX));
  const rows = Math.max(1, Math.ceil(opts.maxY - opts.minY));
  const grid = createSurfaceGrid(opts.minX, opts.minY, cols, rows, opts.biome.groundCover[0] ?? "grass");
  const seed = (opts.seed ^ TERRAIN_GEN_VERSION) >>> 0;
  classifyBases(grid, opts.biome, seed);
  reserveWater(grid, opts.biome, seed, opts.spawnBand);
  reserveForest(grid, opts.biome, seed);
  if (opts.openFields !== false) reserveFields(grid, opts.biome, seed);
  majorityFilter(grid, 2);
  dropSmallComponents(grid, 8);
  paintWetEdge(grid);
  ensureLandCorridor(grid, opts.spawnBand);
  paintWetEdge(grid);
  ensureBiomeThirds(grid, opts.biome, seed);
  dropSmallComponents(grid, 8);
  paintWetEdge(grid);
  dropSmallComponents(grid, 8);
  fillVariants(grid, seed);
  return grid;
}

export function lotWaterShare(grid: SurfaceGrid, lot: { x: number; y: number; w: number; d: number; buildable?: Lot["buildable"] }): number {
  const env = lot.buildable ?? { x: lot.x, y: lot.y, w: lot.w, d: lot.d };
  let waterHits = 0;
  let total = 0;
  const x1 = env.x + env.w;
  const y1 = env.y + env.d;
  for (let y = env.y + 0.5; y < y1; y += 1) {
    for (let x = env.x + 0.5; x < x1; x += 1) {
      total++;
      if (surfaceAt(grid, x, y) === "water") waterHits++;
    }
  }
  return total > 0 ? waterHits / total : 0;
}

export function lotEnvelopeRejected(grid: SurfaceGrid, lot: { x: number; y: number; w: number; d: number; identity: LotIdentity; buildable?: Lot["buildable"] }): boolean {
  void lot.identity;
  return lotWaterShare(grid, lot) > 0.45;
}

export function meanRoadCost(grid: SurfaceGrid, points: readonly { x: number; y: number }[]): { mean: number; reject: number; samples: number } {
  let sum = 0;
  let reject = 0;
  let samples = 0;
  for (const p of points) {
    const cost = roadCostAt(grid, p.x, p.y);
    samples++;
    if (!Number.isFinite(cost)) reject++;
    else sum += cost;
  }
  const kept = samples - reject;
  return { mean: kept > 0 ? sum / kept : Infinity, reject, samples };
}

export function sampleSegmentCenterline(seg: RoadSegment, step = 1): { x: number; y: number }[] {
  const path = polylineLength(seg.points);
  const out: { x: number; y: number }[] = [];
  const n = Math.max(1, Math.ceil(path / step));
  for (let i = 0; i <= n; i++) {
    const p = samplePolyline(seg.points, i / n);
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

export function enforceOpenCorridors(
  grid: SurfaceGrid,
  network: RoadNetwork,
  lots: readonly Lot[],
  buildings: readonly { x: number; y: number; w: number; d: number; cellSize: number }[],
): void {
  const pad = FOREST_DEVELOPMENT_CLEAR;
  forEachSurfaceCell(grid, (i, ix, iy, id) => {
    const wooded = id === SURFACE_ID["forest-core"] || id === SURFACE_ID["forest-floor"];
    const water = id === SURFACE_ID.water;
    if (!wooded && !water) return;
    const x = grid.ox + (ix + 0.5) * grid.cell;
    const y = grid.oy + (iy + 0.5) * grid.cell;
    const jitter = wooded ? (hash2(ix, iy, 0xf02e57) - 0.5) * 0.55 : 0;
    const clear = wooded ? Math.max(0.85, pad + jitter) : 0;
    if (developmentNear(network, lots, buildings, x, y, wooded, clear)) grid.surface[i] = openReplacement(grid, i);
  });
  paintWetEdge(grid);
}

/** Roads clear wood and water; lots clear wood; buildings clear wood by `clear` and water by 0.35. */
function developmentNear(
  network: RoadNetwork,
  lots: readonly Lot[],
  buildings: readonly { x: number; y: number; w: number; d: number; cellSize: number }[],
  x: number,
  y: number,
  wooded: boolean,
  clear: number,
): boolean {
  if (nearRoad(network, x, y, clear)) return true;
  if (wooded && lots.some((lot) => inExpandedBox(x, y, lot.x, lot.y, lot.w, lot.d, clear))) return true;
  const buildPad = wooded ? clear : 0.35;
  return buildings.some((b) => inExpandedBox(x, y, b.x, b.y, b.w * b.cellSize, b.d * b.cellSize, buildPad));
}

export function lotFootprintContains(lot: Lot, x: number, y: number): boolean {
  if (lot.boundary.length >= 3) return pointInPoly(x, y, lot.boundary);
  return x >= lot.x && y >= lot.y && x <= lot.x + lot.w && y <= lot.y + lot.d;
}

export function groundPatchContains(patch: GroundPatch, x: number, y: number): boolean {
  if (patch.poly && patch.poly.length >= 3) return pointInPoly(x, y, patch.poly);
  return x >= patch.x && y >= patch.y && x <= patch.x + patch.w && y <= patch.y + patch.d;
}

export function stampDeveloped(
  grid: SurfaceGrid,
  network: RoadNetwork,
  lots: readonly Lot[],
  ground: readonly GroundPatch[],
): void {
  const developedPads = ground.filter((patch) => isDevelopedCover(patch.cover));
  forEachSurfaceCell(grid, (i, ix, iy, id) => {
    if (id === SURFACE_ID.water) return;
    const x = grid.ox + (ix + 0.5) * grid.cell;
    const y = grid.oy + (iy + 0.5) * grid.cell;
    let stamp = false;
    if (pointOnRoad(network, x, y)) stamp = true;
    else {
      for (const lot of lots) {
        if (lotFootprintContains(lot, x, y)) {
          stamp = true;
          break;
        }
      }
    }
    if (!stamp) {
      for (const pad of developedPads) {
        if (groundPatchContains(pad, x, y)) {
          stamp = true;
          break;
        }
      }
    }
    if (stamp) grid.surface[i] = SURFACE_ID.developed;
  });
  grid.stampRevision++;
}

export function finalizeStampedSurface(
  grid: SurfaceGrid,
  biome: BiomeProfile,
  seed: number,
  corridors?: {
    network: RoadNetwork;
    lots: readonly Lot[];
    buildings: readonly { x: number; y: number; w: number; d: number; cellSize: number }[];
  },
): void {
  ensureBiomeThirds(grid, biome, (seed ^ TERRAIN_GEN_VERSION) >>> 0);
  dropSmallComponents(grid, 8);
  paintWetEdge(grid);
  dropSmallComponents(grid, 8);
  if (corridors) enforceOpenCorridors(grid, corridors.network, corridors.lots, corridors.buildings);
  ensureBiomeThirds(grid, biome, (seed ^ 0x51a11 ^ TERRAIN_GEN_VERSION) >>> 0);
}

export function isolatedBaseCellCount(grid: SurfaceGrid): number {
  const seen = new Uint8Array(grid.surface.length);
  let isolated = 0;
  for (let i = 0; i < grid.surface.length; i++) {
    if (seen[i]) continue;
    const id = grid.surface[i]!;
    if (id === SURFACE_ID["wet-edge"] || id === SURFACE_ID.developed) {
      seen[i] = 1;
      continue;
    }
    const size = floodSurface(grid, i, seen).length;
    if (size === 1 && !adjacentToDeveloped(grid, i)) isolated++;
  }
  return isolated;
}

export function countNatural(grid: SurfaceGrid): Record<TerrainSurface, number> {
  const counts = Object.fromEntries(TERRAIN_SURFACES.map((s) => [s, 0])) as Record<TerrainSurface, number>;
  for (let i = 0; i < grid.surface.length; i++) {
    const name = SURFACE_FROM_ID[grid.surface[i]!] ?? "grass";
    counts[name]++;
  }
  return counts;
}

export function naturalCellTotal(grid: SurfaceGrid): number {
  let n = 0;
  for (let i = 0; i < grid.surface.length; i++) {
    if (grid.surface[i] !== SURFACE_ID.developed) n++;
  }
  return n;
}

function isDevelopedCover(cover: GroundPatch["cover"]): boolean {
  switch (cover) {
    case "grass":
    case "scrub":
    case "dirt":
    case "gravel":
    case "tracks":
    case "concrete":
    case "parking":
    case "driveway":
    case "planted":
    case "lot":
      return true;
    case "water":
    case "forest-floor":
    case "field-tilled":
    case "field-short":
    case "field-mature":
    case "field-stubble":
      return false;
    default: {
      const _never: never = cover;
      return _never;
    }
  }
}

function hash2(x: number, y: number, seed: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number, freq: number): number {
  const fx = x * freq;
  const fy = y * freq;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fade(fx - x0);
  const ty = fade(fy - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function fbm2(x: number, y: number, seed: number, freq: number): number {
  return valueNoise(x, y, seed, freq) * 0.65 + valueNoise(x, y, seed ^ 0x9e3779b9, freq * 2) * 0.35;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function classifyBases(grid: SurfaceGrid, biome: BiomeProfile, seed: number): void {
  const bases = biome.groundCover;
  const a = bases[0] ?? "grass";
  const b = bases[1] ?? a;
  const c = bases[2] ?? b;
  for (let iy = 0; iy < grid.rows; iy++) {
    for (let ix = 0; ix < grid.cols; ix++) {
      grid.surface[iy * grid.cols + ix] = SURFACE_ID[baseKind(grid, ix, iy, seed, a, b, c)];
    }
  }
}

/** Low, middle and high terrain noise pick the biome's three ground covers; 1% of natural cells turn to gravel. */
function baseKind(grid: SurfaceGrid, ix: number, iy: number, seed: number, a: TerrainSurface, b: TerrainSurface, c: TerrainSurface): TerrainSurface {
  const x = grid.ox + ix;
  const y = grid.oy + iy;
  const elev = fbm2(x, y, seed ^ 0x11, 0.032);
  const moist = fbm2(x, y, seed ^ 0x22, 0.038);
  const rough = fbm2(x, y, seed ^ 0x33, 0.05);
  const mix = elev * 0.34 + moist * 0.28 + rough * 0.38;
  const kind: TerrainSurface = mix < 0.34 ? a : mix < 0.66 ? b : c;
  return hash2(ix, iy, seed ^ 0x77) < 0.01 && BASE_NATURAL.includes(kind) ? "gravel" : kind;
}

function reserveWater(grid: SurfaceGrid, biome: BiomeProfile, seed: number, spawnBand?: GenerateSurfaceOpts["spawnBand"]): void {
  const waterChance = Math.max(0.35, biome.waterLikelihood);
  for (let iy = 0; iy < grid.rows; iy++) {
    for (let ix = 0; ix < grid.cols; ix++) {
      if (inSpawnBand(grid, ix, iy, spawnBand)) continue;
      const x = grid.ox + ix;
      const y = grid.oy + iy;
      const elev = fbm2(x, y, seed ^ 0x11, 0.032);
      const moist = fbm2(x, y, seed ^ 0x22, 0.038);
      if (moist > 0.78 - waterChance * 0.12 && elev < 0.32 + (1 - waterChance) * 0.08) {
        grid.surface[iy * grid.cols + ix] = SURFACE_ID.water;
      }
    }
  }
  rasterizeRiver(grid, biome, seed, spawnBand);
  growWater(grid, 1);
}

function rasterizeRiver(grid: SurfaceGrid, biome: BiomeProfile, seed: number, spawnBand?: GenerateSurfaceOpts["spawnBand"]): void {
  if (hash2(3, 7, seed ^ 0xa7e2) > biome.waterLikelihood) return;
  const vertical = hash2(1, 2, seed ^ 0xa7e2) > 0.5;
  const inset = 3;
  const wobble = (hash2(9, 4, seed) - 0.5) * 6;
  const half = biome.waterLikelihood > 0.7 ? 2 : 1;
  if (vertical) {
    const col = clampInt(Math.floor(grid.cols * 0.12 + wobble), inset, grid.cols - inset - 1);
    for (let iy = 0; iy < grid.rows; iy++) {
      const c = clampInt(col + Math.floor(Math.sin(iy * 0.18 + seed * 0.001) * 2), 1, grid.cols - 2);
      for (let dx = -half; dx <= half; dx++) wetRiverCell(grid, c + dx, iy, spawnBand);
    }
  } else {
    const row = clampInt(Math.floor(grid.rows * 0.14 + wobble), inset, grid.rows - inset - 1);
    for (let ix = 0; ix < grid.cols; ix++) {
      const r = clampInt(row + Math.floor(Math.sin(ix * 0.16 + seed * 0.001) * 2), 1, grid.rows - 2);
      for (let dy = -half; dy <= half; dy++) wetRiverCell(grid, ix, r + dy, spawnBand);
    }
  }
}

function wetRiverCell(grid: SurfaceGrid, ix: number, iy: number, spawnBand?: GenerateSurfaceOpts["spawnBand"]): void {
  if (ix < 0 || ix >= grid.cols || iy < 0 || iy >= grid.rows) return;
  if (inSpawnBand(grid, ix, iy, spawnBand)) return;
  grid.surface[iy * grid.cols + ix] = SURFACE_ID.water;
}

function growWater(grid: SurfaceGrid, passes: number): void {
  for (let p = 0; p < passes; p++) {
    const next = grid.surface.slice();
    forEachSurfaceCell(grid, (i, _ix, _iy, id) => {
      if (id === SURFACE_ID.water) return;
      const n = neighbors4(grid, i).filter((j) => grid.surface[j] === SURFACE_ID.water).length;
      if (n >= 3) next[i] = SURFACE_ID.water;
    });
    grid.surface.set(next);
  }
}

function reserveForest(grid: SurfaceGrid, biome: BiomeProfile, seed: number): void {
  const target = Math.floor(grid.cols * grid.rows * biome.forestDensity * 0.22);
  if (target < 12) return;
  const forestScore = (ix: number, iy: number): number => {
    const x = grid.ox + ix;
    const y = grid.oy + iy;
    return fbm2(x, y, seed ^ 0x33, 0.05) * 0.62 + fbm2(x, y, seed ^ 0x22, 0.038) * 0.38;
  };
  const scores = scoreCells(grid, 0.52, (_i, ix, iy, id) => (id === SURFACE_ID.water ? -1 : forestScore(ix, iy)));
  const marked = new Uint8Array(grid.surface.length);
  let placed = 0;
  for (const start of scores) {
    if (placed >= target) break;
    if (marked[start.i] || grid.surface[start.i] === SURFACE_ID.water) continue;
    const blob = forestBlob(grid, start.i, marked, Math.min(90, target - placed), forestScore);
    if (blob.length < 10) continue;
    for (const i of blob) grid.surface[i] = SURFACE_ID["forest-floor"];
    placed += blob.length;
  }
  paintForestCore(grid);
}

/** Breadth-first stand of up to `limit` dry cells scoring 0.48 or better, marking what it visits. */
function forestBlob(grid: SurfaceGrid, start: number, marked: Uint8Array, limit: number, forestScore: (ix: number, iy: number) => number): number[] {
  const q = [start];
  marked[start] = 1;
  let qi = 0;
  const blob: number[] = [];
  while (qi < q.length && blob.length < limit) {
    const i = q[qi++]!;
    blob.push(i);
    for (const j of neighbors4(grid, i)) {
      if (marked[j] || grid.surface[j] === SURFACE_ID.water) continue;
      if (forestScore(j % grid.cols, (j / grid.cols) | 0) < 0.48) continue;
      marked[j] = 1;
      q.push(j);
    }
  }
  return blob;
}

function paintForestCore(grid: SurfaceGrid): void {
  const dist = new Int16Array(grid.surface.length);
  dist.fill(99);
  const q: number[] = [];
  for (let i = 0; i < grid.surface.length; i++) {
    if (grid.surface[i] !== SURFACE_ID["forest-floor"] && grid.surface[i] !== SURFACE_ID["forest-core"]) {
      dist[i] = 0;
      q.push(i);
    }
  }
  let qi = 0;
  while (qi < q.length) {
    const i = q[qi++]!;
    const nd = dist[i]! + 1;
    for (const j of neighbors4(grid, i)) {
      if (nd >= dist[j]!) continue;
      dist[j] = nd;
      q.push(j);
    }
  }
  for (let i = 0; i < grid.surface.length; i++) {
    if (grid.surface[i] === SURFACE_ID["forest-floor"] && dist[i]! >= 2) {
      grid.surface[i] = SURFACE_ID["forest-core"];
    }
  }
}

function reserveFields(grid: SurfaceGrid, biome: BiomeProfile, seed: number): void {
  const agricultural = biome.id === "agricultural-plain";
  const share = agricultural ? 0.24 : biome.fieldDensity >= 0.3 ? 0.2 : Math.max(0.04, biome.fieldDensity * 0.45);
  const target = Math.floor(grid.cols * grid.rows * share);
  if (target < 8) return;
  const blocksField = (id: number): boolean =>
    id === SURFACE_ID.water || id === SURFACE_ID["forest-core"] || id === SURFACE_ID["forest-floor"];
  const scores = scoreCells(grid, 0.42, (_i, ix, iy, id) => {
    if (blocksField(id)) return -1;
    const x = grid.ox + ix;
    const y = grid.oy + iy;
    return (1 - fbm2(x, y, seed ^ 0x33, 0.05)) * 0.7 + fbm2(x, y, seed ^ 0x11, 0.032) * 0.3;
  });
  const fields: FieldPainter = { grid, marked: new Uint8Array(grid.surface.length), placed: 0, target, blocksField };
  // Farmland opens with one big anchor field before the ordinary strips.
  if (agricultural) paintFields(fields, scores, seed, { long: 30, short: 12, min: 240 }, true);
  paintFields(fields, scores, seed, agricultural ? { long: 26, short: 12, min: 80 } : { long: 18, short: 9, min: 28 }, false);
}

/** Paint strips from the best-scoring unclaimed cells until the target; `once` stops after the first strip that sticks. */
function paintFields(fields: FieldPainter, scores: readonly { i: number }[], seed: number, size: { long: number; short: number; min: number }, once: boolean): void {
  for (const start of scores) {
    if (fields.placed >= fields.target) break;
    if (fields.marked[start.i]) continue;
    const n = paintField(fields, start.i, fieldRunsVertical(fields.grid, start.i, seed), size.long, size.short, size.min);
    fields.placed += n;
    if (once && n) break;
  }
}

const fieldRunsVertical = (grid: SurfaceGrid, i: number, seed: number): boolean =>
  fbm2(grid.ox + (i % grid.cols), grid.oy + ((i / grid.cols) | 0), seed ^ 0x91, 0.04) > 0.5;

/** Field cells claimed so far; `placed` counts cells already painted toward `target`. */
interface FieldPainter {
  grid: SurfaceGrid;
  marked: Uint8Array;
  placed: number;
  target: number;
  blocksField: (id: number) => boolean;
}

/** Paint a field strip centred on `start`; strips under `minCells` are released and count 0. */
function paintField(fields: FieldPainter, start: number, vertical: boolean, longCells: number, shortCells: number, minCells: number): number {
  const { grid, marked } = fields;
  const ix0 = start % grid.cols;
  const iy0 = (start / grid.cols) | 0;
  const halfShort = Math.max(1, (shortCells / 2) | 0);
  const blob: number[] = [];
  const room = () => blob.length + fields.placed < fields.target;
  for (let t = 0; t < longCells && room(); t++) {
    for (let s = -halfShort; s <= halfShort && room(); s++) claimFieldPair(fields, blob, ix0, iy0, t, s, vertical);
  }
  if (blob.length < minCells) {
    for (const i of blob) marked[i] = 0;
    return 0;
  }
  for (const i of blob) {
    if (grid.surface[i] !== SURFACE_ID.water && grid.surface[i] !== SURFACE_ID["forest-core"]) {
      grid.surface[i] = SURFACE_ID.field;
    }
  }
  return blob.length;
}

/** Claim the cell `t` along and `s` across the strip, mirrored behind the start when `t` is not zero. */
function claimFieldPair(fields: FieldPainter, blob: number[], ix0: number, iy0: number, t: number, s: number, vertical: boolean): void {
  if (vertical) {
    claimFieldCell(fields, blob, ix0 + s, iy0 + t);
    if (t) claimFieldCell(fields, blob, ix0 + s, iy0 - t);
  } else {
    claimFieldCell(fields, blob, ix0 + t, iy0 + s);
    if (t) claimFieldCell(fields, blob, ix0 - t, iy0 + s);
  }
}

function claimFieldCell(fields: FieldPainter, blob: number[], ix: number, iy: number): void {
  const j = cellIndex(fields.grid, ix, iy);
  if (j < 0 || fields.marked[j] || fields.blocksField(fields.grid.surface[j]!)) return;
  fields.marked[j] = 1;
  blob.push(j);
}

function majorityFilter(grid: SurfaceGrid, passes: number): void {
  for (let p = 0; p < passes; p++) {
    const next = grid.surface.slice();
    const counts = new Uint16Array(TERRAIN_SURFACES.length);
    forEachSurfaceCell(grid, (i, ix, iy, self) => {
      if (self === SURFACE_ID["wet-edge"] || self === SURFACE_ID.field) return;
      countNeighbours(grid, ix, iy, self, counts);
      const best = dominantSurface(counts, self);
      if (counts[best]! >= 5) next[i] = best;
    });
    grid.surface.set(next);
  }
}

/** Surface ids of the eight neighbours, counting off-grid cells as `self`. */
function countNeighbours(grid: SurfaceGrid, ix: number, iy: number, self: number, counts: Uint16Array): void {
  counts.fill(0);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const j = cellIndex(grid, ix + dx, iy + dy);
      counts[j < 0 ? self : grid.surface[j]!]++;
    }
  }
}

/** Most common id other than wet edge; ties keep the lowest id. */
function dominantSurface(counts: Uint16Array, self: number): number {
  let best = self;
  let bestN = -1;
  for (let id = 0; id < counts.length; id++) {
    if (id === SURFACE_ID["wet-edge"]) continue;
    if (counts[id]! > bestN) {
      bestN = counts[id]!;
      best = id;
    }
  }
  return best;
}

function dropSmallComponents(grid: SurfaceGrid, minSize: number): void {
  const seen = new Uint8Array(grid.surface.length);
  for (let start = 0; start < grid.surface.length; start++) {
    if (seen[start]) continue;
    const id = grid.surface[start]!;
    if (id === SURFACE_ID["wet-edge"] || id === SURFACE_ID.developed) {
      seen[start] = 1;
      continue;
    }
    const fieldFloor = id === SURFACE_ID.field ? Math.max(minSize, 24) : minSize;
    const cells = floodSurface(grid, start, seen);
    if (cells.length >= fieldFloor) continue;
    const fill = neighborMajority(grid, cells, id);
    for (const i of cells) grid.surface[i] = fill;
  }
}

function neighborMajority(grid: SurfaceGrid, cells: readonly number[], skip: number): number {
  const counts = new Uint16Array(TERRAIN_SURFACES.length);
  const cellSet = new Set(cells);
  for (const i of cells) {
    for (const j of neighbors4(grid, i)) {
      if (cellSet.has(j)) continue;
      const id = grid.surface[j]!;
      if (id === skip || id === SURFACE_ID["wet-edge"]) continue;
      counts[id]++;
    }
  }
  let best = SURFACE_ID.grass;
  let bestN = -1;
  for (let id = 0; id < counts.length; id++) {
    if (counts[id]! > bestN) {
      bestN = counts[id]!;
      best = id;
    }
  }
  return bestN > 0 ? best : SURFACE_ID.grass;
}

function ensureBiomeThirds(grid: SurfaceGrid, biome: BiomeProfile, seed: number): void {
  const bases = biome.groundCover;
  const protectedIds = new Set<number>([
    SURFACE_ID.water,
    SURFACE_ID["forest-core"],
    SURFACE_ID["forest-floor"],
    SURFACE_ID.field,
    SURFACE_ID["wet-edge"],
    SURFACE_ID.developed,
  ]);
  const counts = new Uint32Array(TERRAIN_SURFACES.length);
  let natural = 0;
  for (let i = 0; i < grid.surface.length; i++) {
    const id = grid.surface[i]!;
    counts[id]++;
    if (id !== SURFACE_ID.developed) natural++;
  }
  const floor = Math.ceil(Math.max(1, natural) * 0.055);
  for (const base of bases) {
    const want = SURFACE_ID[base];
    if (counts[want]! >= floor) continue;
    growSurfaceToQuota(grid, want, floor - counts[want]!, floor, protectedIds, seed ^ (want * 0x9e3779b9), counts);
  }
}

/** Converting cells toward one surface's quota without starving any other surface below `keepFloor`. */
interface QuotaGrowth {
  grid: SurfaceGrid;
  want: number;
  keepFloor: number;
  protectedIds: ReadonlySet<number>;
  counts: Uint32Array;
  seen: Uint8Array;
  placed: number;
}

function growSurfaceToQuota(
  grid: SurfaceGrid,
  want: number,
  need: number,
  keepFloor: number,
  protectedIds: ReadonlySet<number>,
  seed: number,
  counts: Uint32Array,
): void {
  if (need <= 0) return;
  const growth: QuotaGrowth = { grid, want, keepFloor, protectedIds, counts, seen: new Uint8Array(grid.surface.length), placed: 0 };
  for (let i = 0; i < grid.surface.length && growth.placed < need; i++) {
    if (grid.surface[i] === want && !growth.seen[i]) floodQuota(growth, i, need);
  }
  while (growth.placed < need) {
    const best = quotaSeed(growth, seed ^ growth.placed);
    if (best < 0) break;
    floodQuota(growth, best, Math.max(need, growth.placed + 8));
    if (!growth.seen[best]) break;
  }
}

function quotaConvertible(growth: QuotaGrowth, id: number): boolean {
  if (id === growth.want || growth.protectedIds.has(id)) return false;
  if (id === SURFACE_ID.gravel) return true;
  return growth.counts[id]! > growth.keepFloor;
}

/** Unseen convertible cell with the lowest hash, or -1. */
function quotaSeed(growth: QuotaGrowth, seed: number): number {
  const { grid, seen } = growth;
  let best = -1;
  let bestH = 1;
  for (let i = 0; i < grid.surface.length; i++) {
    if (seen[i] || !quotaConvertible(growth, grid.surface[i]!)) continue;
    const h = hash2(i % grid.cols, (i / grid.cols) | 0, seed);
    if (h < bestH) {
      bestH = h;
      best = i;
    }
  }
  return best;
}

/** Flood from `start` through wanted and convertible cells, converting until `target` cells are placed. */
function floodQuota(growth: QuotaGrowth, start: number, target: number): void {
  const { grid, want, counts, seen } = growth;
  const q = [start];
  seen[start] = 1;
  let qi = 0;
  while (qi < q.length && growth.placed < target) {
    const i = q[qi++]!;
    const id = grid.surface[i]!;
    if (id !== want && quotaConvertible(growth, id)) {
      counts[id]!--;
      counts[want]++;
      grid.surface[i] = want;
      growth.placed++;
    }
    for (const j of neighbors4(grid, i)) {
      if (seen[j]) continue;
      seen[j] = 1;
      const nid = grid.surface[j]!;
      if (nid === want || quotaConvertible(growth, nid)) q.push(j);
    }
  }
}

function adjacentToDeveloped(grid: SurfaceGrid, i: number): boolean {
  const ix = i % grid.cols;
  const iy = (i / grid.cols) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const j = cellIndex(grid, ix + dx, iy + dy);
    if (j >= 0 && grid.surface[j] === SURFACE_ID.developed) return true;
  }
  return false;
}

function paintWetEdge(grid: SurfaceGrid): void {
  const next = grid.surface.slice();
  forEachSurfaceCell(grid, (i, _ix, _iy, id) => {
    if (id === SURFACE_ID.water || id === SURFACE_ID["forest-core"] || id === SURFACE_ID.developed) return;
    const wet = neighbors4(grid, i).some((j) => grid.surface[j] === SURFACE_ID.water);
    if (wet) next[i] = SURFACE_ID["wet-edge"];
    else if (id === SURFACE_ID["wet-edge"]) next[i] = SURFACE_ID.grass;
  });
  grid.surface.set(next);
}

function ensureLandCorridor(grid: SurfaceGrid, spawnBand?: GenerateSurfaceOpts["spawnBand"]): void {
  const start = spawnIndex(grid, spawnBand);
  const seen = new Uint8Array(grid.surface.length);
  const q = [start];
  seen[start] = 1;
  let qi = 0;
  while (qi < q.length) {
    const i = q[qi++]!;
    if (grid.surface[i] === SURFACE_ID.water || grid.surface[i] === SURFACE_ID["forest-core"]) continue;
    for (const j of neighbors4(grid, i)) {
      if (seen[j]) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  for (let i = 0; i < grid.surface.length; i++) {
    if (seen[i]) continue;
    if (grid.surface[i] !== SURFACE_ID.water && grid.surface[i] !== SURFACE_ID["forest-core"]) {
      punchCorridor(grid, start, i);
      return;
    }
  }
}

function punchCorridor(grid: SurfaceGrid, from: number, to: number): void {
  let ix = from % grid.cols;
  let iy = (from / grid.cols) | 0;
  const tx = to % grid.cols;
  const ty = (to / grid.cols) | 0;
  while (ix !== tx || iy !== ty) {
    clearCorridorCell(grid, ix, iy);
    if (ix !== tx) ix += ix < tx ? 1 : -1;
    else if (iy !== ty) iy += iy < ty ? 1 : -1;
  }
}

/** Grass over water, forest core and wet edge in the 3x3 around a corridor step. */
function clearCorridorCell(grid: SurfaceGrid, ix: number, iy: number): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const j = cellIndex(grid, ix + dx, iy + dy);
      const id = j < 0 ? -1 : grid.surface[j];
      if (id === SURFACE_ID.water || id === SURFACE_ID["forest-core"] || id === SURFACE_ID["wet-edge"]) {
        grid.surface[j] = SURFACE_ID.grass;
      }
    }
  }
}

function fillVariants(grid: SurfaceGrid, seed: number): void {
  for (let i = 0; i < grid.variant.length; i++) {
    const ix = i % grid.cols;
    const iy = (i / grid.cols) | 0;
    grid.variant[i] = Math.floor(hash2(ix, iy, seed ^ 0x51a11) * 3) as 0 | 1 | 2;
  }
}

function inSpawnBand(grid: SurfaceGrid, ix: number, iy: number, spawnBand?: GenerateSurfaceOpts["spawnBand"]): boolean {
  if (!spawnBand) return false;
  const x = grid.ox + ix + 0.5;
  const y = grid.oy + iy + 0.5;
  return x >= spawnBand.x && y >= spawnBand.y && x <= spawnBand.x + spawnBand.w && y <= spawnBand.y + spawnBand.d;
}

function spawnIndex(grid: SurfaceGrid, spawnBand?: GenerateSurfaceOpts["spawnBand"]): number {
  if (spawnBand) {
    const { ix, iy } = worldToCell(grid, spawnBand.x + spawnBand.w * 0.5, spawnBand.y + spawnBand.d * 0.5);
    const i = cellIndex(grid, clampInt(ix, 0, grid.cols - 1), clampInt(iy, 0, grid.rows - 1));
    if (i >= 0) return i;
  }
  return cellIndex(grid, Math.floor(grid.cols * 0.2), Math.floor(grid.rows * 0.2));
}

function nearRoad(network: RoadNetwork, x: number, y: number, pad: number): boolean {
  if (pointOnRoad(network, x, y)) return true;
  if (pad <= 0) return false;
  const d = pad * 0.7071;
  return (
    pointOnRoad(network, x + pad, y) ||
    pointOnRoad(network, x - pad, y) ||
    pointOnRoad(network, x, y + pad) ||
    pointOnRoad(network, x, y - pad) ||
    pointOnRoad(network, x + d, y + d) ||
    pointOnRoad(network, x + d, y - d) ||
    pointOnRoad(network, x - d, y + d) ||
    pointOnRoad(network, x - d, y - d)
  );
}

function openReplacement(grid: SurfaceGrid, i: number): number {
  const fill = neighborMajority(grid, [i], grid.surface[i]!);
  const name = SURFACE_FROM_ID[fill];
  if (name && BASE_NATURAL.includes(name)) return fill;
  return SURFACE_ID.grass;
}

function inExpandedBox(x: number, y: number, bx: number, by: number, bw: number, bd: number, pad: number): boolean {
  return x >= bx - pad && y >= by - pad && x <= bx + bw + pad && y <= by + bd + pad;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v | 0;
}
