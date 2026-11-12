import { aabbOverlap, len } from "../game/math";
import { mixSeed, Rng } from "../game/rng";
import type { GroundPatch, Lot } from "../structure/types";
import { speciesCompatible } from "./biomes";
import { getAsset, spawnAsset } from "./catalog";
import { aridLandscape, type ClimateEnvelope, type ClimateId, type Landscape } from "./climate";
import { cellIndex, neighbors4, SURFACE_ID, traversalAt, type SurfaceGrid } from "./terrain";
import type { FeatureContext, MesaFeature, TerrainFeature } from "./terrainFeatures";

/**
 * Landscape-authentic natural features, placed once after roads, lots and buildings exist:
 * mesas, buttes and outcrops (solid `rock` cells ringed by drivable `talus`), boulder clusters,
 * regional flora, dry-wash tree pockets, and the dry-country rural land uses that replace row
 * crops. Forest and boreal landscapes get nothing from here, so their maps are untouched.
 */

const LANDFORM_SALT = 0x1a4df0;
const USE_SALT = 0x5c2ab;
/** Cells of open ground kept between standing rock and anything developed, wet or wooded. */
const ROCK_SETBACK = 5;
const TALUS_SETBACK = 4;
const SPAWN_KEEP = 6;

interface LandformPlan {
  form: MesaFeature["form"];
  /** Formations per 10,000 surface cells, then the clamp. */
  density: number;
  min: number;
  max: number;
  maxTier: number;
  tierHeight: number;
  radius: readonly [number, number];
  /** Boulder clusters and lone boulders per 10,000 cells. */
  clusters: number;
  loners: number;
  /** Flora groups per 10,000 cells. */
  flora: number;
}

const PLANS: Readonly<Record<Landscape, LandformPlan | undefined>> = {
  desert: { form: "butte", density: 1.1, min: 1, max: 3, maxTier: 2, tierHeight: 1.15, radius: [3, 5], clusters: 2.2, loners: 3, flora: 20 },
  canyonlands: { form: "mesa", density: 2.8, min: 2, max: 6, maxTier: 3, tierHeight: 1.5, radius: [4, 7.5], clusters: 3, loners: 4, flora: 13 },
  prairie: { form: "outcrop", density: 0.9, min: 1, max: 3, maxTier: 1, tierHeight: 0.5, radius: [1.5, 2.4], clusters: 0.4, loners: 1.2, flora: 0 },
  alpine: { form: "outcrop", density: 2.2, min: 2, max: 5, maxTier: 2, tierHeight: 0.85, radius: [1.8, 3.2], clusters: 3.5, loners: 4, flora: 0 },
  subtropical: { form: "outcrop", density: 0, min: 0, max: 0, maxTier: 1, tierHeight: 0.5, radius: [1, 1], clusters: 0, loners: 0, flora: 8 },
  forest: undefined,
  boreal: undefined,
};

type Weighted = readonly (readonly [string, number])[];

/** What grows wild in each dry zone: saguaros only in the Sonoran, Joshua trees only in the Mojave. */
const ARID_FLORA: Partial<Record<ClimateId, Weighted>> = {
  "sonoran-desert": [["saguaro-cactus", 3], ["prickly-pear", 2], ["creosote-bush", 4], ["agave", 1]],
  "mojave-desert": [["joshua-tree", 3], ["creosote-bush", 5], ["yucca-scrub", 1]],
  "chihuahuan-desert": [["agave", 3], ["yucca-scrub", 2], ["creosote-bush", 4], ["prickly-pear", 2]],
  canyonlands: [["sagebrush", 5], ["yucca-scrub", 2], ["prickly-pear", 1]],
  "great-basin": [["sagebrush", 6], ["creosote-bush", 1]],
};
const ARID_FALLBACK: Weighted = [["creosote-bush", 3], ["sagebrush", 3]];
const COAST_FLORA: Weighted = [["sabal-palm", 3], ["palmetto-scrub", 4], ["desert-palm", 1]];
const TALL_FLORA = new Set(["saguaro-cactus", "joshua-tree", "sabal-palm", "desert-palm", "mesquite"]);

type LandUse = "rangeland" | "orchard" | "solar";
const LAND_USE: Partial<Record<ClimateId, Readonly<Record<LandUse, number>>>> = {
  "sonoran-desert": { rangeland: 2, orchard: 3, solar: 3 },
  "mojave-desert": { rangeland: 2, orchard: 1, solar: 5 },
  "chihuahuan-desert": { rangeland: 5, orchard: 1, solar: 2 },
  canyonlands: { rangeland: 5, orchard: 0.5, solar: 2 },
  "great-basin": { rangeland: 5, orchard: 0, solar: 2 },
};
const LAND_USE_FALLBACK: Readonly<Record<LandUse, number>> = { rangeland: 3, orchard: 1, solar: 2 };

/** Ground a landform may never cover, nor crowd. */
const BLOCKING: ReadonlySet<number> = new Set([
  SURFACE_ID.developed, SURFACE_ID.water, SURFACE_ID["wet-edge"], SURFACE_ID.wash, SURFACE_ID.field,
  SURFACE_ID["forest-floor"], SURFACE_ID["forest-core"], SURFACE_ID.rock, SURFACE_ID.talus,
]);

/** Terrace of the formation under a world point: 0 off the rock. */
export function mesaTierAt(feature: MesaFeature, x: number, y: number): number {
  const ix = Math.floor(x - feature.x);
  const iy = Math.floor(y - feature.y);
  if (ix < 0 || iy < 0 || ix >= feature.cols || iy >= feature.rows) return 0;
  return feature.tiers[iy * feature.cols + ix]!;
}

/** One generation pass: the grid, the prop budget still unspent, and the shared random stream. */
interface Land {
  ctx: FeatureContext;
  grid: SurfaceGrid;
  rng: Rng;
  budget: number;
  /** Cells to the nearest blocking cell (4-connected); rebuilt after each formation. */
  clear: Int16Array;
}

function pickWeighted(table: Weighted, rng: Rng): string | undefined {
  const total = table.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return undefined;
  let roll = rng.range(0, total);
  for (const [id, weight] of table) {
    roll -= weight;
    if (roll <= 0) return id;
  }
  return table[table.length - 1]![0];
}

const cellOf = (grid: SurfaceGrid, x: number, y: number): number => cellIndex(grid, Math.floor(x - grid.ox), Math.floor(y - grid.oy));

/** Distance in cells from every cell to the nearest blocking surface, building, prop, spawn or reserved space. */
function clearanceGrid(ctx: FeatureContext): Int16Array {
  const grid = ctx.surface;
  const clear = new Int16Array(grid.surface.length).fill(32767);
  const queue: number[] = [];
  const seed = (i: number): void => {
    if (i < 0 || clear[i] === 0) return;
    clear[i] = 0;
    queue.push(i);
  };
  const seedBox = (x: number, y: number, w: number, d: number, pad: number): void => {
    for (let iy = Math.floor(y - pad - grid.oy); iy <= Math.floor(y + d + pad - grid.oy); iy++) {
      for (let ix = Math.floor(x - pad - grid.ox); ix <= Math.floor(x + w + pad - grid.ox); ix++) seed(cellIndex(grid, ix, iy));
    }
  };
  for (let i = 0; i < grid.surface.length; i++) if (BLOCKING.has(grid.surface[i]!)) seed(i);
  for (const b of ctx.buildings) seedBox(b.x, b.y, b.w * b.cellSize, b.d * b.cellSize, 1.4);
  for (const lot of ctx.lots) seedBox(lot.x, lot.y, lot.w, lot.d, 0);
  for (const p of ctx.props) seedBox(p.x, p.y, p.w, p.d, 0.4);
  for (const box of ctx.reserved ?? []) seedBox(box.x, box.y, box.w, box.d, 0);
  seedBox(ctx.spawnX, ctx.spawnY, 0, 0, SPAWN_KEEP);
  seedBox(ctx.roadSpawnX, ctx.roadSpawnY, 0, 0, SPAWN_KEEP);
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const next = clear[i]! + 1;
    for (const j of neighbors4(grid, i)) {
      if (clear[j]! <= next) continue;
      clear[j] = next;
      queue.push(j);
    }
  }
  return clear;
}

/** Cells the dozer can reach from `start` over open ground; `rockOpen` pretends standing rock is not there. */
function floodOpen(grid: SurfaceGrid, start: number, rockOpen = false): Uint8Array {
  const seen = new Uint8Array(grid.surface.length);
  if (start < 0) return seen;
  const passable = (i: number): boolean => {
    const id = grid.surface[i]!;
    return id !== SURFACE_ID.water && id !== SURFACE_ID["forest-core"] && (rockOpen || id !== SURFACE_ID.rock);
  };
  if (!passable(start)) return seen;
  const queue = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    for (const j of neighbors4(grid, queue[head]!)) {
      if (seen[j] || !passable(j)) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return seen;
}

/** Rock footprint of one formation as cell offsets from its centre: a lobed, slightly stretched blob. */
function formationCells(rng: Rng, radius: number): { dx: number; dy: number }[] {
  const stretch = rng.range(0.82, 1.3);
  const p1 = rng.range(0, 6.28);
  const p2 = rng.range(0, 6.28);
  const reach = Math.ceil(radius * 1.5);
  const cells: { dx: number; dy: number }[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const angle = Math.atan2(dy, dx);
      const edge = radius * (0.8 + 0.2 * (Math.sin(angle * 3 + p1) * 0.6 + Math.sin(angle * 5 + p2) * 0.4));
      if (Math.hypot(dx / stretch, dy * stretch) < edge) cells.push({ dx, dy });
    }
  }
  return cells;
}

interface Formation {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  /** Row-major rock mask over the box, which includes a one-cell talus margin. */
  rock: Uint8Array;
}

/** The blob at (cx, cy) boxed with its talus margin, or undefined when any cell crowds a setback or leaves the grid. */
function fitFormation(land: Land, cx: number, cy: number, cells: readonly { dx: number; dy: number }[]): Formation | undefined {
  const { grid, clear } = land;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { dx, dy } of cells) {
    const i = cellIndex(grid, cx + dx, cy + dy);
    if (i < 0 || clear[i]! < ROCK_SETBACK) return undefined;
    minX = Math.min(minX, cx + dx); maxX = Math.max(maxX, cx + dx);
    minY = Math.min(minY, cy + dy); maxY = Math.max(maxY, cy + dy);
  }
  const x0 = minX - 1, y0 = minY - 1, cols = maxX - minX + 3, rows = maxY - minY + 3;
  const rock = new Uint8Array(cols * rows);
  for (const { dx, dy } of cells) rock[(cy + dy - y0) * cols + (cx + dx - x0)] = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rock[r * cols + c]) continue;
      const i = cellIndex(grid, x0 + c, y0 + r);
      // The margin may hang off the map edge, but on the map it needs its own setback.
      if (i >= 0 && clear[i]! < TALUS_SETBACK && touchesRock(rock, cols, rows, c, r)) return undefined;
    }
  }
  return { x0, y0, cols, rows, rock };
}

function touchesRock(rock: Uint8Array, cols: number, rows: number, c: number, r: number): boolean {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const cc = c + dc, rr = r + dr;
      if (cc >= 0 && rr >= 0 && cc < cols && rr < rows && rock[rr * cols + cc]) return true;
    }
  }
  return false;
}

/** Terraces: a rock cell's step rises with its distance in from the cliff edge, up to `maxTier`. */
function terraceTiers(shape: Formation, maxTier: number, step: number): Uint8Array {
  const { cols, rows, rock } = shape;
  const depth = new Int16Array(cols * rows);
  let frontier: number[] = [];
  for (let i = 0; i < rock.length; i++) if (!rock[i]) frontier.push(i);
  for (let d = 1; frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const c = i % cols, r = (i / cols) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = rr * cols + cc;
        if (!rock[j] || depth[j]) continue;
        depth[j] = d;
        next.push(j);
      }
    }
    frontier = next;
  }
  const tiers = new Uint8Array(cols * rows);
  for (let i = 0; i < rock.length; i++) if (rock[i]) tiers[i] = Math.min(maxTier, 1 + Math.floor((depth[i]! - 1) / step));
  return tiers;
}

/**
 * Stamp one formation onto the grid and keep it only if the dozer can still reach every cell it
 * could before, the rock itself aside. Returns the feature, or undefined with the grid restored.
 */
function stampFormation(land: Land, shape: Formation, plan: LandformPlan, radius: number, climate: ClimateEnvelope, reach: { seen: Uint8Array; count: number }, n: number): MesaFeature | undefined {
  const { grid, ctx } = land;
  const { x0, y0, cols, rows, rock } = shape;
  const saved: [number, number][] = [];
  let lost = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = cellIndex(grid, x0 + c, y0 + r);
      if (i < 0) continue;
      const isRock = rock[r * cols + c] === 1;
      if (!isRock && !touchesRock(rock, cols, rows, c, r)) continue;
      saved.push([i, grid.surface[i]!]);
      grid.surface[i] = isRock ? SURFACE_ID.rock : SURFACE_ID.talus;
      if (isRock && reach.seen[i]) lost++;
    }
  }
  const seen = floodOpen(grid, cellOf(grid, ctx.spawnX, ctx.spawnY));
  let count = 0;
  for (let i = 0; i < seen.length; i++) count += seen[i]!;
  if (count !== reach.count - lost) {
    for (const [i, id] of saved) grid.surface[i] = id;
    return undefined;
  }
  reach.seen = seen;
  reach.count = count;
  const step = Math.max(1, Math.round(radius / (plan.maxTier + 1)));
  return {
    kind: "mesa",
    id: `mesa-${n}`,
    form: plan.form === "mesa" && radius < 5 ? "butte" : plan.form,
    bedrock: climate.geography.bedrock,
    x: grid.ox + x0,
    y: grid.oy + y0,
    cols,
    rows,
    tiers: terraceTiers(shape, plan.maxTier, step),
    tierHeight: plan.tierHeight,
    seed: land.rng.int(1, 1_000_000),
  };
}

/** The roomiest of a handful of random cells: formations settle on the open margins, not against the town. */
function roomiestCell(land: Land, samples: number): number {
  const { grid, clear, rng } = land;
  let best = -1;
  let bestScore = -1;
  for (let s = 0; s < samples; s++) {
    const i = rng.int(0, grid.surface.length - 1);
    const score = Math.min(clear[i]!, 24) + rng.range(0, 3);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function placeFormations(land: Land, features: TerrainFeature[], plan: LandformPlan, climate: ClimateEnvelope, area: number): void {
  const want = Math.max(plan.min, Math.min(plan.max, Math.round(area * plan.density)));
  if (want <= 0) return;
  const { grid, ctx, rng } = land;
  const seen = floodOpen(grid, cellOf(grid, ctx.spawnX, ctx.spawnY));
  const reach = { seen, count: seen.reduce((sum, v) => sum + v, 0) };
  let placed = 0;
  for (let attempt = 0; attempt < want * 14 && placed < want; attempt++) {
    const centre = roomiestCell(land, 18);
    const room = land.clear[centre]! - ROCK_SETBACK;
    let radius = Math.min(rng.range(plan.radius[0], plan.radius[1]), room);
    const cx = centre % grid.cols;
    const cy = (centre / grid.cols) | 0;
    for (let shrink = 0; shrink < 3 && radius >= plan.radius[0] * 0.75; shrink++, radius *= 0.8) {
      const cells = formationCells(rng, radius);
      const shape = cells.length >= (plan.form === "outcrop" ? 4 : 12) ? fitFormation(land, cx, cy, cells) : undefined;
      const feature = shape && stampFormation(land, shape, plan, radius, climate, reach, features.length);
      if (!feature) continue;
      features.push(feature);
      land.clear = clearanceGrid(ctx);
      placed++;
      break;
    }
  }
}

/** Centre a catalog prop on (x, y) when it has `need` cells of clearance, sits in bounds and overlaps no prop. */
function plant(land: Land, assetId: string, x: number, y: number, need: number): boolean {
  const { ctx, grid, rng } = land;
  if (land.budget <= 0) return false;
  const def = getAsset(assetId);
  const px = x - def.footprint.w * 0.5;
  const py = y - def.footprint.d * 0.5;
  if (px < ctx.minX + 0.5 || py < ctx.minY + 0.5 || px + def.footprint.w > ctx.maxX - 0.5 || py + def.footprint.d > ctx.maxY - 0.5) return false;
  for (const [sx, sy] of [[x, y], [px, py], [px + def.footprint.w, py + def.footprint.d], [px + def.footprint.w, py], [px, py + def.footprint.d]] as const) {
    const i = cellOf(grid, sx, sy);
    if (i < 0 || land.clear[i]! < need) return false;
  }
  const pad = def.minClear;
  if (ctx.props.some((p) => aabbOverlap(px - pad, py - pad, def.footprint.w + pad * 2, def.footprint.d + pad * 2, p.x, p.y, p.w, p.d))) return false;
  ctx.props.push(spawnAsset(assetId, px, py, rng.range(-Math.PI, Math.PI), rng.int(0, def.variants - 1)));
  land.budget--;
  return true;
}

function randomPoint(land: Land): { x: number; y: number } {
  const { grid, rng } = land;
  return { x: grid.ox + rng.range(1, grid.cols - 1), y: grid.oy + rng.range(1, grid.rows - 1) };
}

/** Boulder clusters (one fixed boulder with loose rock around it) and scattered loners. */
function scatterRocks(land: Land, plan: LandformPlan, climate: ClimateEnvelope, area: number): void {
  const { rng } = land;
  const stone = climate.geography.bedrock === "sandstone" ? "sandstone" : "granite";
  const clusters = Math.round(area * plan.clusters);
  for (let n = 0, tries = 0; n < clusters && tries < clusters * 8; tries++) {
    const at = randomPoint(land);
    if (!plant(land, `${stone}-boulder`, at.x, at.y, 3)) continue;
    n++;
    for (let k = rng.int(2, 4); k > 0; k--) {
      const angle = rng.range(0, 6.28);
      const out = rng.range(1.3, 2.4);
      plant(land, `${stone}-rock`, at.x + Math.cos(angle) * out, at.y + Math.sin(angle) * out, 2);
    }
  }
  const loners = Math.round(area * plan.loners);
  for (let n = 0, tries = 0; n < loners && tries < loners * 8; tries++) {
    const at = randomPoint(land);
    if (plant(land, rng.chance(0.3) ? `${stone}-boulder` : `${stone}-rock`, at.x, at.y, 3)) n++;
  }
}

/** Regional plants in loose groups: low scrub clumps two or three together, tall plants stand alone. */
function scatterFlora(land: Land, table: Weighted, groups: number): void {
  const { rng, ctx } = land;
  const legal = table.filter(([id]) => speciesCompatible(ctx.biome, id));
  if (!legal.length) return;
  for (let n = 0, tries = 0; n < groups && tries < groups * 6; tries++) {
    const id = pickWeighted(legal, rng)!;
    const at = randomPoint(land);
    if (!plant(land, id, at.x, at.y, 2)) continue;
    n++;
    for (let k = TALL_FLORA.has(id) ? 0 : rng.int(0, 2); k > 0; k--) {
      plant(land, id, at.x + rng.range(-1.6, 1.6), at.y + rng.range(-1.6, 1.6), 2);
    }
  }
}

function developedWithin(grid: SurfaceGrid, x: number, y: number, reach: number): boolean {
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const i = cellOf(grid, x + dx, y + dy);
      if (i >= 0 && grid.surface[i] === SURFACE_ID.developed) return true;
    }
  }
  return false;
}

/** The only desert trees: sparse mesquite, and a palm at real water, hugging a wash or shoreline. */
function plantWaterPockets(land: Land, features: readonly TerrainFeature[]): void {
  const { rng, grid, ctx } = land;
  const pocket = (x: number, y: number, wet: boolean): void => {
    const angle = rng.range(0, 6.28);
    const out = rng.range(2.4, 3.4);
    const px = x + Math.cos(angle) * out;
    const py = y + Math.sin(angle) * out;
    if (developedWithin(grid, px, py, 3)) return;
    const id = wet && rng.chance(0.4) ? "desert-palm" : "mesquite";
    if (speciesCompatible(ctx.biome, id)) plant(land, id, px, py, 1);
  };
  for (const feature of features) {
    const points = feature.kind === "wash" || feature.kind === "river" ? feature.path : feature.kind === "pond" || feature.kind === "lake" ? feature.poly : [];
    for (const p of points) if (rng.chance(feature.kind === "wash" ? 0.4 : 0.55)) pocket(p.x, p.y, feature.kind !== "wash");
  }
}

/** Mesas, boulders and native flora for the map's climate; a no-op for forest and boreal landscapes. */
export function placeLandforms(ctx: FeatureContext, features: TerrainFeature[], climate: ClimateEnvelope): void {
  const plan = PLANS[climate.landscape];
  if (!plan) return;
  const grid = ctx.surface;
  const land: Land = {
    ctx,
    grid,
    rng: new Rng(mixSeed((ctx.seed ^ LANDFORM_SALT) >>> 0)),
    budget: Math.max(0, ctx.propBudget - ctx.props.length),
    clear: clearanceGrid(ctx),
  };
  const area = (grid.cols * grid.rows) / 10_000;
  placeFormations(land, features, plan, climate, area);
  // Rock first, then at most half of what is left for boulders, so flora always gets a share.
  const flora = land.budget;
  land.budget = Math.ceil(flora * 0.45);
  scatterRocks(land, plan, climate, area);
  land.budget = flora - (Math.ceil(flora * 0.45) - land.budget);
  if (aridLandscape(climate)) {
    plantWaterPockets(land, features);
    scatterFlora(land, ARID_FLORA[climate.id] ?? ARID_FALLBACK, Math.round(area * plan.flora));
  } else if (climate.landscape === "subtropical") {
    scatterFlora(land, COAST_FLORA, Math.round(area * plan.flora));
  }
}

type Point = { x: number; y: number };

/** Row and column positions `pitch` apart across the open cells' bounding box, kept where `fits`. */
function gridSites(open: readonly Point[], pitchX: number, pitchY: number, fits: (x: number, y: number) => boolean): Point[][] {
  const minX = Math.min(...open.map((p) => p.x)), maxX = Math.max(...open.map((p) => p.x));
  const minY = Math.min(...open.map((p) => p.y)), maxY = Math.max(...open.map((p) => p.y));
  const rows: Point[][] = [];
  for (let y = minY + pitchY * 0.5; y <= maxY; y += pitchY) {
    const row: Point[] = [];
    for (let x = minX + pitchX * 0.5; x <= maxX; x += pitchX) if (fits(x, y)) row.push({ x, y });
    if (row.length) rows.push(row);
  }
  return rows;
}

/**
 * Desert ground the generator set aside for fields is never planted to rain-fed row crops. Each
 * such block becomes scrub rangeland with a windpump and stock tank, an irrigated citrus orchard,
 * or a ground-mount solar array, picked by seed and weighted by climate zone.
 */
export function aridLandUse(ctx: FeatureContext, climate: ClimateEnvelope, cells: readonly number[], open: readonly Point[], n: number): void {
  const grid = ctx.surface;
  const rng = new Rng(mixSeed((ctx.seed ^ USE_SALT ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0));
  const weights = LAND_USE[climate.id] ?? LAND_USE_FALLBACK;
  const pick = pickWeighted((Object.keys(weights) as LandUse[]).map((use) => [use, weights[use]] as const), rng) as LandUse;
  const occupied = new Set(open.map((p) => `${Math.floor(p.x)}:${Math.floor(p.y)}`));
  const inBlock = (x: number, y: number): boolean => occupied.has(`${Math.floor(x)}:${Math.floor(y)}`);
  const clearOfSpawn = (x: number, y: number): boolean =>
    len(x - ctx.spawnX, y - ctx.spawnY) > SPAWN_KEEP && len(x - ctx.roadSpawnX, y - ctx.roadSpawnY) > SPAWN_KEEP;
  const room = (): number => ctx.propBudget - ctx.props.length;
  const put = (assetId: string, x: number, y: number, heading = 0): boolean => {
    const def = getAsset(assetId);
    const px = x - def.footprint.w * 0.5, py = y - def.footprint.d * 0.5;
    if (room() <= 0 || ctx.props.some((p) => aabbOverlap(px, py, def.footprint.w, def.footprint.d, p.x, p.y, p.w, p.d))) return false;
    ctx.props.push(spawnAsset(assetId, px, py, heading, rng.int(0, def.variants - 1)));
    return true;
  };
  const repaint = (id: number): void => {
    for (const i of cells) if (grid.surface[i] === SURFACE_ID.field) grid.surface[i] = id;
  };

  if (pick === "solar" && open.length >= 24) {
    const rows = gridSites(open, 2.8, 2.4, (x, y) => inBlock(x - 1, y) && inBlock(x + 1, y) && clearOfSpawn(x, y));
    const sites = rows.flat().slice(0, Math.min(18, Math.floor(room() * 0.5)));
    if (sites.length >= 4) {
      repaint(SURFACE_ID.gravel);
      for (const site of sites) put("solar-panel", site.x, site.y);
      return;
    }
  }
  if (pick === "orchard" && open.length >= 24) {
    const rows = gridSites(open, 2.6, 2.6, (x, y) => inBlock(x, y) && clearOfSpawn(x, y));
    let left = Math.min(16, Math.floor(room() * 0.5));
    if (rows.flat().length >= 4 && left >= 4) {
      repaint(SURFACE_ID.dirt);
      for (const row of rows) {
        const kept = row.slice(0, left).filter((site) => put("citrus-tree", site.x, site.y, rng.range(-0.3, 0.3)));
        left -= kept.length;
        if (kept.length >= 2) ctx.ground.push(furrow(kept[0]!, kept[kept.length - 1]!, rng.int(1, 1_000_000)));
      }
      return;
    }
  }
  repaint(SURFACE_ID.scrub);
  const cx = open.reduce((sum, p) => sum + p.x, 0) / Math.max(1, open.length);
  const cy = open.reduce((sum, p) => sum + p.y, 0) / Math.max(1, open.length);
  const home = [...open].sort((a, b) => len(a.x - cx, a.y - cy) - len(b.x - cx, b.y - cy)).find((p) => clearOfSpawn(p.x, p.y) && inBlock(p.x + 2, p.y));
  if (!home) return;
  if (put("windpump", home.x, home.y)) put("stock-tank", home.x + 2, home.y);
}

/** The irrigation furrow run beside one orchard row. */
function furrow(first: Point, last: Point, seed: number): GroundPatch {
  return { x: first.x - 1, y: first.y + 0.95, w: last.x - first.x + 2, d: 0.5, heading: 0, cover: "field-tilled", seed, z: 0.014 };
}

/**
 * Landform invariants for `validateTown`: every formation is solid on the grid, and standing rock
 * cuts no lot, road or spawn off from the dozer (compared with the same map without its rock).
 */
export function landformIssues(
  features: readonly TerrainFeature[],
  grid: SurfaceGrid,
  lots: readonly Lot[],
  spawnX: number,
  spawnY: number,
  roadSpawnX: number,
  roadSpawnY: number,
): string[] {
  const mesas = features.filter((feature): feature is MesaFeature => feature.kind === "mesa");
  if (!mesas.length) return [];
  const issues: string[] = [];
  for (const mesa of mesas) {
    for (let i = 0; i < mesa.tiers.length; i++) {
      if (!mesa.tiers[i]) continue;
      if (traversalAt(grid, mesa.x + (i % mesa.cols) + 0.5, mesa.y + ((i / mesa.cols) | 0) + 0.5) === "rock") continue;
      issues.push(`${mesa.id} is not solid rock`);
      break;
    }
  }
  const start = cellOf(grid, spawnX, spawnY);
  const real = floodOpen(grid, start);
  const bare = floodOpen(grid, start, true);
  const cut = (i: number): boolean => i >= 0 && bare[i] === 1 && real[i] === 0 && grid.surface[i] !== SURFACE_ID.rock;
  if (cut(cellOf(grid, roadSpawnX, roadSpawnY))) issues.push("rock isolates the road spawn");
  for (const lot of lots) {
    if (cut(cellOf(grid, lot.x + lot.w * 0.5, lot.y + lot.d * 0.5))) issues.push(`rock isolates lot ${lot.id}`);
  }
  for (let i = 0; i < grid.surface.length; i++) {
    if (grid.surface[i] === SURFACE_ID.developed && cut(i)) {
      issues.push("rock isolates developed ground");
      break;
    }
  }
  return issues;
}
