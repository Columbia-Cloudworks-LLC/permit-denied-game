import type { Graphics } from "pixi.js";
import type { BiomeProfile } from "../world/biomes";
import { Rng } from "../game/rng";
import { SURFACE_CHUNK, SURFACE_ID, type SurfaceGrid } from "../world/terrain";
import { drawOrientedIsoBox } from "./drawIso";

export const FOREST_GARNISH_CHUNK_CAP = 48;

export type ForestSpecies = "oak" | "pine";

export interface ForestGarnish {
  x: number;
  y: number;
  heading: number;
  species: ForestSpecies;
  scale: number;
  seed: number;
}

const OAK_FOL = { t: 0x6aaa3a, l: 0x2e5a22, r: 0x4a7a28 };
const OAK_CROWN = { t: 0x7ab84a, l: 0x386828, r: 0x5a8a30 };
const OAK_TRUNK = { t: 0x9a6a38, l: 0x5a3818, r: 0x7a4e28 };
const PINE_FOL = { t: 0x3f8c58, l: 0x1c4a30, r: 0x2d6a40 };
const PINE_NEEDLE = { t: 0x52a468, l: 0x245838, r: 0x3a7a4c };
const PINE_TRUNK = { t: 0x6a4a32, l: 0x3a2818, r: 0x523828 };

export function planForestGarnish(grid: SurfaceGrid, biome: BiomeProfile, seed: number): ForestGarnish[] {
  const buckets = new Map<number, { ix: number; iy: number }[]>();
  for (let iy = 0; iy < grid.rows; iy++) {
    for (let ix = 0; ix < grid.cols; ix++) {
      const i = iy * grid.cols + ix;
      if (grid.surface[i] !== SURFACE_ID["forest-core"]) continue;
      const cx = (ix / SURFACE_CHUNK) | 0;
      const cy = (iy / SURFACE_CHUNK) | 0;
      const key = cy * 1024 + cx;
      const bucket = buckets.get(key);
      if (bucket) bucket.push({ ix, iy });
      else buckets.set(key, [{ ix, iy }]);
    }
  }
  const out: ForestGarnish[] = [];
  for (const cells of buckets.values()) {
    const picked = pickChunkCells(cells, seed);
    for (const cell of picked) {
      const salt = hashCell(cell.ix, cell.iy, seed);
      const rng = new Rng(salt);
      const species = speciesFor(biome, salt);
      out.push({
        x: grid.ox + (cell.ix + 0.5) * grid.cell + rng.range(-0.18, 0.18),
        y: grid.oy + (cell.iy + 0.5) * grid.cell + rng.range(-0.18, 0.18),
        heading: rng.range(-0.35, 0.35),
        species,
        scale: rng.range(0.82, 1.08),
        seed: salt,
      });
    }
  }
  return out;
}

export function drawForestGarnish(g: Graphics, tree: ForestGarnish): void {
  const s = tree.scale;
  if (tree.species === "pine") {
    drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.32 * s, 0.32 * s, 0, 1.85 * s, PINE_TRUNK.t, PINE_TRUNK.l, PINE_TRUNK.r);
    drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 1.42 * s, 1.42 * s, 0.9 * s, 0.95 * s, PINE_FOL.t, PINE_FOL.l, PINE_FOL.r);
    drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 1.02 * s, 1.02 * s, 1.55 * s, 0.78 * s, PINE_NEEDLE.t, PINE_NEEDLE.l, PINE_NEEDLE.r);
    drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.62 * s, 0.62 * s, 2.15 * s, 0.88 * s, PINE_FOL.t, PINE_FOL.l, PINE_FOL.r);
    return;
  }
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.42 * s, 0.42 * s, 0, 1.5 * s, OAK_TRUNK.t, OAK_TRUNK.l, OAK_TRUNK.r);
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 1.5 * s, 1.35 * s, 1.2 * s, 1.2 * s, OAK_FOL.t, OAK_FOL.l, OAK_FOL.r);
  drawOrientedIsoBox(g, tree.x, tree.y, tree.heading, 0.9 * s, 0.82 * s, 2.0 * s, 0.75 * s, OAK_CROWN.t, OAK_CROWN.l, OAK_CROWN.r);
}

function pickChunkCells(cells: { ix: number; iy: number }[], seed: number): { ix: number; iy: number }[] {
  if (cells.length <= FOREST_GARNISH_CHUNK_CAP) return cells;
  return [...cells]
    .sort((a, b) => hashCell(a.ix, a.iy, seed) - hashCell(b.ix, b.iy, seed) || a.ix - b.ix || a.iy - b.iy)
    .slice(0, FOREST_GARNISH_CHUNK_CAP);
}

function speciesFor(biome: BiomeProfile, salt: number): ForestSpecies {
  const oak = biome.trees.includes("oak");
  const pine = biome.trees.includes("pine");
  if (oak && pine) return (salt & 1) === 0 ? "oak" : "pine";
  if (pine) return "pine";
  return "oak";
}

function hashCell(ix: number, iy: number, seed: number): number {
  return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ seed) >>> 0;
}
