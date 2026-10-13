import type { Graphics } from "pixi.js";
import type { BiomeProfile } from "../world/biomes";
import type { SeasonId } from "../world/season";
import { Rng } from "../game/rng";
import { forEachSurfaceCell, SURFACE_CHUNK, SURFACE_ID, type SurfaceGrid } from "../world/terrain";
import { drawOrientedIsoBox, headingOffset } from "./drawIso";
import { shade } from "./palette";

export const FOREST_GARNISH_CHUNK_CAP = 140;

export type ForestSpecies = "oak" | "pine" | "oak-sapling" | "pine-sapling" | "oak-shrub" | "pine-shrub";
export type ForestForm = "interior" | "edge" | "understory";

export interface ForestGarnish {
  x: number;
  y: number;
  heading: number;
  species: ForestSpecies;
  form: ForestForm;
  scale: number;
  tint: number;
  seed: number;
  phenology: SeasonId;
}

const OAK_FOL = [
  { t: 0x54863a, l: 0x2a4c20, r: 0x3e6828 },
  { t: 0x4a7a32, l: 0x24441c, r: 0x365e22 },
  { t: 0x5e9244, l: 0x305624, r: 0x487630 },
] as const;
const OAK_CROWN = [
  { t: 0x5e9042, l: 0x305824, r: 0x46742c },
  { t: 0x6a9c4c, l: 0x386028, r: 0x528034 },
  { t: 0x54863a, l: 0x2a4c1e, r: 0x426828 },
] as const;
const OAK_TRUNK = { t: 0x9a6a38, l: 0x5a3818, r: 0x7a4e28 };
const PINE_FOL = [
  { t: 0x347850, l: 0x1a4230, r: 0x265c3c },
  { t: 0x2c6c48, l: 0x163828, r: 0x205234 },
  { t: 0x3e8660, l: 0x1e4a34, r: 0x2e6a46 },
] as const;
const PINE_NEEDLE = [
  { t: 0x428858, l: 0x204c34, r: 0x326a44 },
  { t: 0x4a9462, l: 0x265838, r: 0x387850 },
  { t: 0x3a7e52, l: 0x1a4430, r: 0x2a6240 },
] as const;
const PINE_TRUNK = { t: 0x6a4a32, l: 0x3a2818, r: 0x523828 };
const SHRUB_FOL = [
  { t: 0x4a7634, l: 0x26421c, r: 0x365c28 },
  { t: 0x3e6a38, l: 0x1e4028, r: 0x2e5430 },
  { t: 0x567c3c, l: 0x2c4c20, r: 0x406830 },
] as const;
const SPRING_FOL = [
  { t: 0x8cbc62, l: 0x4e7434, r: 0x6a9448 },
  { t: 0x98c86e, l: 0x567c3c, r: 0x74a050 },
  { t: 0x7eb056, l: 0x466830, r: 0x5e8c40 },
] as const;
const AUTUMN_FOL = [
  { t: 0xc45a28, l: 0x7a3018, r: 0xa04420 },
  { t: 0xd4a024, l: 0x8a6414, r: 0xb4841c },
  { t: 0x8a3c22, l: 0x4a2014, r: 0x6a3020 },
] as const;
const AUTUMN_CROWN = [
  { t: 0xe0b040, l: 0x8a6418, r: 0xc48c28 },
  { t: 0xc46830, l: 0x7a3818, r: 0xa45024 },
  { t: 0xa84828, l: 0x642818, r: 0x883820 },
] as const;
const BLOSSOM = { t: 0xf2d0dc, l: 0xc890a4, r: 0xe0b0c0 };

export function planForestGarnish(grid: SurfaceGrid, biome: BiomeProfile, seed: number, season: SeasonId = "summer"): ForestGarnish[] {
  const buckets = new Map<number, { core: { ix: number; iy: number }[]; floor: { ix: number; iy: number }[] }>();
  forEachSurfaceCell(grid, (_i, ix, iy, id) => {
    if (id !== SURFACE_ID["forest-core"] && id !== SURFACE_ID["forest-floor"]) return;
    const cx = (ix / SURFACE_CHUNK) | 0;
    const cy = (iy / SURFACE_CHUNK) | 0;
    const key = cy * 1024 + cx;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { core: [], floor: [] };
      buckets.set(key, bucket);
    }
    if (id === SURFACE_ID["forest-core"]) bucket.core.push({ ix, iy });
    else bucket.floor.push({ ix, iy });
  });
  const out: ForestGarnish[] = [];
  for (const cells of buckets.values()) {
    for (const picked of pickChunkCells(grid, cells.core, cells.floor, seed)) {
      const salt = hashCell(picked.ix, picked.iy, seed);
      const rng = new Rng(salt);
      const species = speciesFor(biome, salt, picked.form);
      const jitter = picked.form === "interior" ? 0.22 : picked.form === "edge" ? 0.38 : 0.3;
      out.push({
        x: grid.ox + (picked.ix + 0.5) * grid.cell + rng.range(-jitter, jitter),
        y: grid.oy + (picked.iy + 0.5) * grid.cell + rng.range(-jitter, jitter),
        heading: rng.range(-0.45, 0.45),
        species,
        form: picked.form,
        scale: scaleFor(picked.form, species, rng),
        tint: salt % 3,
        seed: salt,
        phenology: season,
      });
    }
  }
  return out;
}

export function drawForestGarnish(g: Graphics, tree: ForestGarnish, alpha = 1): void {
  switch (tree.species) {
    case "oak":
      drawOak(g, tree, 1, alpha);
      return;
    case "oak-sapling":
      drawOak(g, tree, 0.62, alpha);
      return;
    case "oak-shrub":
      drawShrub(g, tree, false, alpha);
      return;
    case "pine":
      drawPine(g, tree, 1, alpha);
      return;
    case "pine-sapling":
      drawPine(g, tree, 0.58, alpha);
      return;
    case "pine-shrub":
      drawShrub(g, tree, true, alpha);
      return;
    default: {
      const _never: never = tree.species;
      return _never;
    }
  }
}

function drawOak(g: Graphics, tree: ForestGarnish, mul: number, alpha: number): void {
  if (tree.phenology === "winter") {
    drawBareOak(g, tree, mul, alpha);
    return;
  }
  const s = tree.scale * mul * (tree.phenology === "spring" ? 0.72 : 1);
  const fol = tree.phenology === "autumn" ? AUTUMN_FOL[tree.tint]! : tree.phenology === "spring" ? SPRING_FOL[tree.tint]! : OAK_FOL[tree.tint]!;
  const crown = tree.phenology === "autumn" ? AUTUMN_CROWN[tree.tint]! : tree.phenology === "spring" ? SPRING_FOL[tree.tint]! : OAK_CROWN[tree.tint]!;
  const trunk = tone(OAK_TRUNK, tree.tint);
  if (tree.form === "interior") {
    drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 1.72 * s, 1.55 * s, 0.85 * s, 1.15 * s, fol.t, fol.l, fol.r, alpha);
    const top = headingOffset(tree.x, tree.y, tree.heading, 0.12 * s, 0.08 * s);
    drawOrientedIsoBox(g, top.x, top.y, tree.heading + 0.2, 1.05 * s, 0.92 * s, 1.55 * s, 0.72 * s, crown.t, crown.l, crown.r, alpha);
    drawBlossom(g, tree, s, alpha);
    return;
  }
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.4 * s, 0.4 * s, 0, 1.45 * s, trunk.t, trunk.l, trunk.r, alpha);
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 1.48 * s, 1.32 * s, 1.12 * s, 1.15 * s, fol.t, fol.l, fol.r, alpha);
  const side = headingOffset(tree.x, tree.y, tree.heading, 0.28 * s, 0.18 * s);
  drawOrientedIsoBox(g, side.x, side.y, tree.heading - 0.35, 0.95 * s, 0.88 * s, 1.35 * s, 0.82 * s, shade(fol.t, 0.92), fol.l, fol.r, alpha);
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading + 0.15, 0.88 * s, 0.78 * s, 1.95 * s, 0.7 * s, crown.t, crown.l, crown.r, alpha);
  drawBlossom(g, tree, s, alpha);
}

function drawBareOak(g: Graphics, tree: ForestGarnish, mul: number, alpha: number): void {
  const s = tree.scale * mul;
  const trunk = tone(OAK_TRUNK, tree.tint);
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.28 * s, 0.28 * s, 0, 1.7 * s, trunk.t, trunk.l, trunk.r, alpha);
  const arm = headingOffset(tree.x, tree.y, tree.heading, 0.22 * s, 0.05 * s);
  drawOrientedIsoBox(g, arm.x, arm.y, tree.heading + 0.7, 0.72 * s, 0.12 * s, 1.15 * s, 0.12 * s, trunk.t, trunk.l, trunk.r, alpha);
  const other = headingOffset(tree.x, tree.y, tree.heading, -0.16 * s, 0.1 * s);
  drawOrientedIsoBox(g, other.x, other.y, tree.heading - 0.55, 0.58 * s, 0.1 * s, 1.35 * s, 0.1 * s, trunk.r, trunk.l, trunk.t, alpha);
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.16 * s, 0.16 * s, 1.55 * s, 0.55 * s, trunk.t, trunk.l, trunk.r, alpha);
}

function drawBlossom(g: Graphics, tree: ForestGarnish, s: number, alpha: number): void {
  if (tree.phenology !== "spring" || tree.seed % 5 !== 0) return;
  const spot = headingOffset(tree.x, tree.y, tree.heading, 0.2 * s, -0.08 * s);
  drawOrientedIsoBox(g, spot.x, spot.y, tree.heading, 0.28 * s, 0.22 * s, 1.7 * s, 0.18 * s, BLOSSOM.t, BLOSSOM.l, BLOSSOM.r, alpha);
}

function drawPine(g: Graphics, tree: ForestGarnish, mul: number, alpha: number): void {
  const s = tree.scale * mul;
  const fol = PINE_FOL[tree.tint]!;
  const needle = PINE_NEEDLE[tree.tint]!;
  const trunk = tone(PINE_TRUNK, tree.tint);
  if (tree.form === "interior") {
    drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 1.35 * s, 1.35 * s, 0.7 * s, 1.05 * s, fol.t, fol.l, fol.r, alpha);
    drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.85 * s, 0.85 * s, 1.45 * s, 0.95 * s, needle.t, needle.l, needle.r, alpha);
    return;
  }
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.3 * s, 0.3 * s, 0, 1.7 * s, trunk.t, trunk.l, trunk.r, alpha);
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 1.38 * s, 1.38 * s, 0.72 * s, 0.88 * s, fol.t, fol.l, fol.r, alpha);
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 1.02 * s, 1.02 * s, 1.42 * s, 0.82 * s, needle.t, needle.l, needle.r, alpha);
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.68 * s, 0.68 * s, 2.05 * s, 0.78 * s, fol.t, fol.l, fol.r, alpha);
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.4 * s, 0.4 * s, 2.55 * s, 0.55 * s, needle.t, needle.l, needle.r, alpha);
  if (tree.phenology === "winter") {
    drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.28 * s, 0.28 * s, 2.95 * s, 0.16 * s, 0xe4eef4, 0xb7c6d0, 0xd0dce6, alpha);
  }
}

function drawShrub(g: Graphics, tree: ForestGarnish, pine: boolean, alpha: number): void {
  const s = tree.scale;
  if (!pine && tree.phenology === "winter") {
    const trunk = tone(OAK_TRUNK, tree.tint);
    drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.16 * s, 0.16 * s, 0, 0.42 * s, trunk.t, trunk.l, trunk.r, alpha);
    return;
  }
  const fol = pine
    ? PINE_FOL[tree.tint]!
    : tree.phenology === "autumn"
      ? AUTUMN_FOL[tree.tint]!
      : tree.phenology === "spring"
        ? SPRING_FOL[tree.tint]!
        : SHRUB_FOL[tree.tint]!;
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.95 * s, 0.82 * s, 0, 0.55 * s, fol.t, fol.l, fol.r, alpha);
  const bump = headingOffset(tree.x, tree.y, tree.heading, 0.16 * s, -0.12 * s);
  drawOrientedIsoBox(g, bump.x, bump.y, tree.heading + 0.4, 0.62 * s, 0.55 * s, 0.28 * s, 0.42 * s, shade(fol.t, 1.08), fol.l, fol.r, alpha);
}

function tone(color: { t: number; l: number; r: number }, tint: number): { t: number; l: number; r: number } {
  const mul = 1 - tint * 0.04;
  return { t: shade(color.t, mul), l: shade(color.l, mul), r: shade(color.r, mul) };
}

function pickChunkCells(
  grid: SurfaceGrid,
  core: { ix: number; iy: number }[],
  floor: { ix: number; iy: number }[],
  seed: number,
): { ix: number; iy: number; form: ForestForm }[] {
  const edge: { ix: number; iy: number; form: ForestForm }[] = [];
  const interior: { ix: number; iy: number; form: ForestForm }[] = [];
  for (const cell of core) {
    if (coreIsEdge(grid, cell.ix, cell.iy)) edge.push({ ...cell, form: "edge" });
    else interior.push({ ...cell, form: "interior" });
  }
  hashOrder(edge, seed);
  hashOrder(interior, seed);
  // A long edge leaves about a third of its cells open, so the treeline reads ragged.
  const gapEdges = edge.length > 6;
  const under = hashOrder(floor
    .filter((cell) => hashCell(cell.ix, cell.iy, seed) % 100 < 58)
    .map((cell) => ({ ...cell, form: "understory" as const })), seed);
  // Edge trees first, then interior, then understory, until the chunk cap.
  return [
    ...edge.filter((cell) => !gapEdges || hashCell(cell.ix, cell.iy, seed) % 100 >= 34),
    ...interior,
    ...under,
  ].slice(0, FOREST_GARNISH_CHUNK_CAP);
}

/** Sort cells in place into a stable pseudo-random order for this seed. */
function hashOrder<T extends { ix: number; iy: number }>(cells: T[], seed: number): T[] {
  return cells.sort((a, b) => hashCell(a.ix, a.iy, seed) - hashCell(b.ix, b.iy, seed) || a.ix - b.ix || a.iy - b.iy);
}

function coreIsEdge(grid: SurfaceGrid, ix: number, iy: number): boolean {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = ix + dx;
    const ny = iy + dy;
    if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) return true;
    if (grid.surface[ny * grid.cols + nx] !== SURFACE_ID["forest-core"]) return true;
  }
  return false;
}

function speciesFor(biome: BiomeProfile, salt: number, form: ForestForm): ForestSpecies {
  const tree = forestTree(biome, salt);
  const growth = undergrowth(form, salt % 10);
  return growth ? `${tree}-${growth}` : tree;
}

/** A biome with one tree kind uses it; a mixed biome alternates by salt. */
function forestTree(biome: BiomeProfile, salt: number): "oak" | "pine" {
  const oak = biome.trees.includes("oak");
  const pine = biome.trees.includes("pine");
  if (pine !== oak) return pine ? "pine" : "oak";
  return (salt & 1) === 0 ? "oak" : "pine";
}

/** Understory is mostly shrubs and saplings; an edge is mostly full trees; the interior is all trees. */
function undergrowth(form: ForestForm, roll: number): "shrub" | "sapling" | undefined {
  if (form === "interior") return undefined;
  if (form === "understory") return roll < 5 ? "shrub" : roll < 8 ? "sapling" : undefined;
  return roll < 2 ? "sapling" : roll < 3 ? "shrub" : undefined;
}

function scaleFor(form: ForestForm, species: ForestSpecies, rng: Rng): number {
  if (form === "interior") return rng.range(0.72, 1.38);
  if (species.endsWith("shrub")) return rng.range(0.62, 1.08);
  if (species.endsWith("sapling")) return rng.range(0.58, 0.98);
  return rng.range(0.72, 1.22);
}

function hashCell(ix: number, iy: number, seed: number): number {
  return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ seed) >>> 0;
}

export interface ForestMass {
  species?: "oak" | "pine";
  x: number;
  y: number;
  w: number;
  d: number;
}

/** Cheap canopy slabs for overview and low zoom. Merged runs keep interior mass without a tree per cell. */
export function planForestMasses(grid: SurfaceGrid, biome?: BiomeProfile, seed = 0): ForestMass[] {
  const runs: ForestMass[] = [];
  const cell = grid.cell;
  for (let iy = 0; iy < grid.rows; iy++) forEachWoodRun(grid, iy, (run, span) => {
    if (span < 2) return;
    const species = biome && speciesFor(biome, hashCell(Math.floor(run / SURFACE_CHUNK), Math.floor(iy / SURFACE_CHUNK), seed), "interior").startsWith("pine") ? "pine" as const : "oak" as const;
    addMassRow(runs, { species, x: grid.ox + run * cell, y: grid.oy + iy * cell, w: span * cell, d: cell });
  });
  return runs;
}

/** Each run of forest cells along one grid row, as its first column and length. */
function forEachWoodRun(grid: SurfaceGrid, iy: number, visit: (run: number, span: number) => void): void {
  let run = -1;
  for (let ix = 0; ix <= grid.cols; ix++) {
    const id = ix < grid.cols ? grid.surface[iy * grid.cols + ix] : -1;
    const wood = id === SURFACE_ID["forest-core"] || id === SURFACE_ID["forest-floor"];
    if (wood && run < 0) run = ix;
    if (wood && ix < grid.cols) continue;
    if (run >= 0) visit(run, ix - run);
    run = -1;
  }
}

/** A row run directly below a matching run deepens that mass instead of starting another. */
function addMassRow(runs: ForestMass[], mass: ForestMass): void {
  const prev = runs[runs.length - 1];
  if (prev && prev.species === mass.species && prev.x === mass.x && prev.w === mass.w && Math.abs(prev.y + prev.d - mass.y) < 0.01) prev.d += mass.d;
  else runs.push(mass);
}

export function drawForestMass(g: Graphics, mass: ForestMass, season: SeasonId = "summer"): void {
  const pine = mass.species === "pine";
  if (season === "winter" && !pine) {
    drawBareThicket(g, mass);
    return;
  }
  const color = pine ? (season === "winter" ? SNOWY_PINE_MASS : PINE_MASS) : BROADLEAF_MASS[season];
  // Spring broadleaf canopy is still thin, so the slab sits lower.
  const top = season === "spring" && !pine ? .72 : 1.15;
  drawOrientedIsoBox(g, mass.x + mass.w * 0.5, mass.y + mass.d * 0.5, 0, mass.w, mass.d, 0.35, top, color.t, color.l, color.r, 0.92);
}

/**
 * A dense low thicket preserves the blocked forest footprint; upright forks
 * identify bare broadleaf woods without a recolored summer canopy.
 */
function drawBareThicket(g: Graphics, mass: ForestMass): void {
  drawOrientedIsoBox(g, mass.x + mass.w / 2, mass.y + mass.d / 2, 0, mass.w, mass.d, 0.04, 0.18, 0x736757, 0x554b40, 0x65594a, .85);
  const count = Math.min(6, Math.max(2, Math.ceil(mass.w / 2)));
  for (let i = 0; i < count; i++) {
    const x = mass.x + (i + .5) * mass.w / count, y = mass.y + mass.d * .5;
    drawOrientedIsoBox(g, x, y, 0, .12, .12, .1, 1.25, 0x806c52, 0x4c4033, 0x62523f, 1);
    drawOrientedIsoBox(g, x, y, .55, .9, .1, .85, .96, 0x806c52, 0x4c4033, 0x62523f, 1);
    drawOrientedIsoBox(g, x, y, -.55, .65, .1, 1.08, 1.18, 0x806c52, 0x4c4033, 0x62523f, 1);
  }
}

const PINE_MASS = { t: 0x347850, l: 0x1a4230, r: 0x265c3c };
const SNOWY_PINE_MASS = { ...PINE_MASS, t: 0xb9c8c7 };
const BROADLEAF_MASS: Record<SeasonId, { t: number; l: number; r: number }> = {
  spring: { t: 0x6a9a44, l: 0x3a5c28, r: 0x4e7a34 },
  summer: { t: 0x3e6828, l: 0x24441c, r: 0x2a4c20 },
  autumn: { t: 0xa85a28, l: 0x6a3418, r: 0x8a4420 },
  winter: { t: 0x8a94a0, l: 0x5a646c, r: 0x6e7880 },
};
