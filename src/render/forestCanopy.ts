import type { Graphics } from "pixi.js";
import type { BiomeProfile } from "../world/biomes";
import { Rng } from "../game/rng";
import { SURFACE_CHUNK, SURFACE_ID, type SurfaceGrid } from "../world/terrain";
import { drawOrientedIsoBox, headingOffset, shade } from "./drawIso";

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
}

const OAK_FOL = [
  { t: 0x6aaa3a, l: 0x2e5a22, r: 0x4a7a28 },
  { t: 0x5a9a32, l: 0x284c1c, r: 0x3e6e22 },
  { t: 0x7ab44a, l: 0x366428, r: 0x588a34 },
] as const;
const OAK_CROWN = [
  { t: 0x7ab84a, l: 0x386828, r: 0x5a8a30 },
  { t: 0x8ac85a, l: 0x407030, r: 0x649a3c },
  { t: 0x6aaa40, l: 0x305820, r: 0x4e7c28 },
] as const;
const OAK_TRUNK = { t: 0x9a6a38, l: 0x5a3818, r: 0x7a4e28 };
const PINE_FOL = [
  { t: 0x3f8c58, l: 0x1c4a30, r: 0x2d6a40 },
  { t: 0x348050, l: 0x184028, r: 0x245c38 },
  { t: 0x4a9a64, l: 0x225438, r: 0x38784c },
] as const;
const PINE_NEEDLE = [
  { t: 0x52a468, l: 0x245838, r: 0x3a7a4c },
  { t: 0x5cb074, l: 0x2a6440, r: 0x448858 },
  { t: 0x46985c, l: 0x1e4c30, r: 0x326e44 },
] as const;
const PINE_TRUNK = { t: 0x6a4a32, l: 0x3a2818, r: 0x523828 };
const SHRUB_FOL = [
  { t: 0x5a8a38, l: 0x2a4a1c, r: 0x3e6a28 },
  { t: 0x4a7a40, l: 0x224828, r: 0x365c30 },
  { t: 0x6a9444, l: 0x325420, r: 0x4c7630 },
] as const;

export function planForestGarnish(grid: SurfaceGrid, biome: BiomeProfile, seed: number): ForestGarnish[] {
  const buckets = new Map<number, { core: { ix: number; iy: number }[]; floor: { ix: number; iy: number }[] }>();
  for (let iy = 0; iy < grid.rows; iy++) {
    for (let ix = 0; ix < grid.cols; ix++) {
      const i = iy * grid.cols + ix;
      const id = grid.surface[i]!;
      if (id !== SURFACE_ID["forest-core"] && id !== SURFACE_ID["forest-floor"]) continue;
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
    }
  }
  const out: ForestGarnish[] = [];
  for (const cells of buckets.values()) {
    for (const picked of pickChunkCells(grid, cells.core, cells.floor, seed)) {
      const salt = hashCell(picked.ix, picked.iy, seed);
      const rng = new Rng(salt);
      const species = speciesFor(biome, salt, picked.form);
      const jitter = picked.form === "interior" ? 0.08 : 0.22;
      out.push({
        x: grid.ox + (picked.ix + 0.5) * grid.cell + rng.range(-jitter, jitter),
        y: grid.oy + (picked.iy + 0.5) * grid.cell + rng.range(-jitter, jitter),
        heading: rng.range(-0.45, 0.45),
        species,
        form: picked.form,
        scale: scaleFor(picked.form, species, rng),
        tint: salt % 3,
        seed: salt,
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
  const s = tree.scale * mul;
  const fol = OAK_FOL[tree.tint]!;
  const crown = OAK_CROWN[tree.tint]!;
  const trunk = tone(OAK_TRUNK, tree.tint);
  if (tree.form === "interior") {
    drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 1.72 * s, 1.55 * s, 0.85 * s, 1.15 * s, fol.t, fol.l, fol.r, alpha);
    const top = headingOffset(tree.x, tree.y, tree.heading, 0.12 * s, 0.08 * s);
    drawOrientedIsoBox(g, top.x, top.y, tree.heading + 0.2, 1.05 * s, 0.92 * s, 1.55 * s, 0.72 * s, crown.t, crown.l, crown.r, alpha);
    return;
  }
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.4 * s, 0.4 * s, 0, 1.45 * s, trunk.t, trunk.l, trunk.r, alpha);
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 1.48 * s, 1.32 * s, 1.12 * s, 1.15 * s, fol.t, fol.l, fol.r, alpha);
  const side = headingOffset(tree.x, tree.y, tree.heading, 0.28 * s, 0.18 * s);
  drawOrientedIsoBox(g, side.x, side.y, tree.heading - 0.35, 0.95 * s, 0.88 * s, 1.35 * s, 0.82 * s, shade(fol.t, 0.92), fol.l, fol.r, alpha);
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading + 0.15, 0.88 * s, 0.78 * s, 1.95 * s, 0.7 * s, crown.t, crown.l, crown.r, alpha);
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
}

function drawShrub(g: Graphics, tree: ForestGarnish, pine: boolean, alpha: number): void {
  const s = tree.scale;
  const fol = pine ? PINE_FOL[tree.tint]! : SHRUB_FOL[tree.tint]!;
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
  edge.sort((a, b) => hashCell(a.ix, a.iy, seed) - hashCell(b.ix, b.iy, seed) || a.ix - b.ix || a.iy - b.iy);
  interior.sort((a, b) => hashCell(a.ix, a.iy, seed) - hashCell(b.ix, b.iy, seed) || a.ix - b.ix || a.iy - b.iy);
  const out: { ix: number; iy: number; form: ForestForm }[] = [];
  for (const cell of edge) {
    if (out.length >= FOREST_GARNISH_CHUNK_CAP) return out;
    out.push(cell);
  }
  for (const cell of interior) {
    if (out.length >= FOREST_GARNISH_CHUNK_CAP) return out;
    out.push(cell);
  }
  const under: { ix: number; iy: number; form: ForestForm }[] = floor
    .filter((cell) => hashCell(cell.ix, cell.iy, seed) % 100 < 42)
    .map((cell) => ({ ...cell, form: "understory" as const }))
    .sort((a, b) => hashCell(a.ix, a.iy, seed) - hashCell(b.ix, b.iy, seed) || a.ix - b.ix || a.iy - b.iy);
  for (const cell of under) {
    if (out.length >= FOREST_GARNISH_CHUNK_CAP) return out;
    out.push(cell);
  }
  return out;
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
  const oak = biome.trees.includes("oak");
  const pine = biome.trees.includes("pine");
  const conifer = pine && !oak ? "pine" : oak && !pine ? "oak" : (salt & 1) === 0 ? "oak" : "pine";
  if (form === "understory") {
    const roll = salt % 10;
    if (roll < 5) return conifer === "pine" ? "pine-shrub" : "oak-shrub";
    if (roll < 8) return conifer === "pine" ? "pine-sapling" : "oak-sapling";
    return conifer;
  }
  if (form === "interior") return conifer;
  const roll = salt % 10;
  if (roll < 2) return conifer === "pine" ? "pine-sapling" : "oak-sapling";
  if (roll < 3) return conifer === "pine" ? "pine-shrub" : "oak-shrub";
  return conifer;
}

function scaleFor(form: ForestForm, species: ForestSpecies, rng: Rng): number {
  if (form === "interior") return rng.range(0.92, 1.18);
  if (species.endsWith("shrub")) return rng.range(0.72, 1.05);
  if (species.endsWith("sapling")) return rng.range(0.7, 0.95);
  return rng.range(0.84, 1.16);
}

function hashCell(ix: number, iy: number, seed: number): number {
  return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ seed) >>> 0;
}
