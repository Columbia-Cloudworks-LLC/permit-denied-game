import type { Graphics } from "pixi.js";
import type { Bedrock } from "../world/climate";
import { worldToScreen } from "../world/iso";
import type { MesaFeature, TerrainFeature, WashFeature } from "../world/terrainFeatures";
import { drawGroundPoly, PAL } from "./drawIso";

/**
 * Mesas, buttes, outcrops and dry washes. A formation is drawn as stepped terraces: each exposed
 * south and east cliff face is a stack of sedimentary bands that line up across the whole rock,
 * under a harder caprock ledge, with a scree apron where the cliff meets the ground. Geometry
 * never changes, so every slice is one cached Graphics; the ground layer carries the cast shadow.
 */

const BAND = 0.3;
const SNOW_CAP = 0xe8eef4;

interface RockPalette {
  /** Strata, repeated up the cliff from the ground. */
  bands: readonly number[];
  cap: number;
  scree: number;
}

/** Red-rock and ochre banding for sandstone; other desert bedrock is a paler tan. Outcrops show the bare stone. */
const MESA_ROCK: Readonly<Record<Bedrock, RockPalette>> = {
  sandstone: { bands: [0xb5532e, 0xc8693a, 0xdc9150, 0xa84a2a, 0xcf7a44, 0xe2a866, 0xbd5c32], cap: 0xd89868, scree: 0xb87a52 },
  granite: { bands: [0xb09a80, 0xa48c72, 0xbfa98c, 0x988268, 0xb4a086], cap: 0xc8b89c, scree: 0xa8947a },
  limestone: { bands: [0xcabf9e, 0xb8ac8a, 0xd6ccb0, 0xa89c7c], cap: 0xdcd4b8, scree: 0xb8ac90 },
  volcanic: { bands: [0x6a524a, 0x7a6058, 0x58443e, 0x86685c], cap: 0x8a7468, scree: 0x70594e },
  alluvium: { bands: [0xc2a57c, 0xb4966c, 0xcdb38c, 0xa88a62], cap: 0xd2bc98, scree: 0xb09a76 },
};
const OUTCROP_ROCK: Readonly<Record<Bedrock, RockPalette>> = {
  ...MESA_ROCK,
  granite: { bands: [0x8f8f8a, 0x9c9a94, 0x82837e, 0xa6a49c], cap: 0xb0aea6, scree: 0x8a8882 },
  limestone: { bands: [0xc8c2ae, 0xb6b09c, 0xd4cebc], cap: 0xdad6c6, scree: 0xb4ae9c },
};

function rockPalette(feature: MesaFeature): RockPalette {
  return (feature.form === "outcrop" ? OUTCROP_ROCK : MESA_ROCK)[feature.bedrock];
}

/** Multiply a colour's channels: under 1 shades a face, over 1 lifts a sunlit top. */
function shade(color: number, k: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * k));
  const b = Math.min(255, Math.round((color & 255) * k));
  return (r << 16) | (g << 8) | b;
}

function cellHash(feature: MesaFeature, c: number, r: number): number {
  let n = Math.imul(c + 11, 374761393) ^ Math.imul(r + 7, 668265263) ^ feature.seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const tierAt = (feature: MesaFeature, c: number, r: number): number =>
  c < 0 || r < 0 || c >= feature.cols || r >= feature.rows ? 0 : feature.tiers[r * feature.cols + c]!;

/** Top of a rock cell. Mesas keep a flat caprock; an outcrop's blocks stand at ragged heights. */
export function mesaCellTop(feature: MesaFeature, c: number, r: number): number {
  const tier = tierAt(feature, c, r);
  if (!tier) return 0;
  const crag = feature.form === "outcrop" ? 0.55 + cellHash(feature, c, r) * 0.7 : 1;
  return tier * feature.tierHeight * crag;
}

/** Highest point of the formation, for culling and occlusion boxes. */
export function mesaHeight(feature: MesaFeature): number {
  let top = 0;
  for (let i = 0; i < feature.tiers.length; i++) top = Math.max(top, mesaCellTop(feature, i % feature.cols, (i / feature.cols) | 0));
  return top;
}

/** A painter-order strip of one formation: the rock cells on a few neighbouring depth diagonals. */
export interface MesaSlice {
  key: string;
  feature: MesaFeature;
  /** Cell indices, back to front. */
  cells: number[];
  /** World bounds of the strip and its height, for culling. */
  x: number;
  y: number;
  w: number;
  d: number;
  top: number;
  /** World point the strip depth-sorts at. */
  depthX: number;
  depthY: number;
}

const SLICE_DIAGONALS = 2;

/** Cut each formation into diagonal strips so a tall rock sorts against buildings, props and the dozer around it. */
export function planMesaSlices(features: readonly TerrainFeature[]): MesaSlice[] {
  const slices: MesaSlice[] = [];
  for (const feature of features) {
    if (feature.kind !== "mesa") continue;
    const bands = new Map<number, number[]>();
    for (let i = 0; i < feature.tiers.length; i++) {
      if (!feature.tiers[i]) continue;
      const band = Math.floor(((i % feature.cols) + ((i / feature.cols) | 0)) / SLICE_DIAGONALS);
      const list = bands.get(band);
      if (list) list.push(i);
      else bands.set(band, [i]);
    }
    for (const [band, cells] of [...bands].sort((a, b) => a[0] - b[0])) slices.push(mesaSlice(feature, band, cells));
  }
  return slices;
}

function mesaSlice(feature: MesaFeature, band: number, cells: number[]): MesaSlice {
  const diagonal = (i: number): number => (i % feature.cols) + ((i / feature.cols) | 0);
  cells.sort((a, b) => diagonal(a) - diagonal(b) || a - b);
  let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity, top = 0;
  for (const i of cells) {
    const c = i % feature.cols, r = (i / feature.cols) | 0;
    minC = Math.min(minC, c); maxC = Math.max(maxC, c);
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    top = Math.max(top, mesaCellTop(feature, c, r));
  }
  const front = cells[cells.length - 1]!;
  return {
    key: `${feature.id}:${band}`,
    feature,
    cells,
    // The scree apron reaches one cell past the rock on the two camera-facing sides.
    x: feature.x + minC,
    y: feature.y + minR,
    w: maxC - minC + 2,
    d: maxR - minR + 2,
    top,
    depthX: feature.x + (front % feature.cols) + 0.5,
    depthY: feature.y + ((front / feature.cols) | 0) + 0.5,
  };
}

function quad(g: Graphics, a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }, color: number, alpha: number): void {
  g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]);
  g.fill({ color, alpha });
}

/** One vertical cliff face from (x0, y0) to (x1, y1), between heights `z0` and `z1`, banded when `detail`. */
function cliffFace(g: Graphics, rock: RockPalette, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, light: number, phase: number, detail: boolean, alpha: number): void {
  if (z1 <= z0 + 0.01) return;
  if (!detail) {
    quad(g, worldToScreen(x0, y0, z1), worldToScreen(x1, y1, z1), worldToScreen(x1, y1, z0), worldToScreen(x0, y0, z0), shade(rock.bands[phase % rock.bands.length]!, light), alpha);
    return;
  }
  for (let band = Math.floor(z0 / BAND); band * BAND < z1; band++) {
    const lo = Math.max(z0, band * BAND);
    const hi = Math.min(z1, (band + 1) * BAND);
    quad(g, worldToScreen(x0, y0, hi), worldToScreen(x1, y1, hi), worldToScreen(x1, y1, lo), worldToScreen(x0, y0, lo), shade(rock.bands[(band + phase) % rock.bands.length]!, light), alpha);
  }
  // The caprock ledge: a darker, harder course along the rim.
  const ledge = Math.max(z0, z1 - 0.14);
  quad(g, worldToScreen(x0, y0, z1), worldToScreen(x1, y1, z1), worldToScreen(x1, y1, ledge), worldToScreen(x0, y0, ledge), shade(rock.cap, light * 0.78), alpha);
}

/** Scree sloping from a third of the way up a ground-level cliff out to one cell in front of it. */
function screeApron(g: Graphics, rock: RockPalette, x0: number, y0: number, x1: number, y1: number, outX: number, outY: number, height: number, light: number, alpha: number): void {
  const up = Math.min(0.7, height * 0.36);
  quad(g, worldToScreen(x0, y0, up), worldToScreen(x1, y1, up), worldToScreen(x1 + outX * 0.8, y1 + outY * 0.8, 0), worldToScreen(x0 + outX * 0.8, y0 + outY * 0.8, 0), shade(rock.scree, light), alpha);
}

/**
 * Draw one strip back to front. `detail` false is the overview silhouette: one flat tone per face,
 * no banding, ledge or scree. `snow` whitens the tops only.
 */
export function drawMesaSlice(g: Graphics, slice: MesaSlice, snow: boolean, detail: boolean, alpha = 1): void {
  const { feature } = slice;
  const rock = rockPalette(feature);
  const phase = feature.seed % rock.bands.length;
  for (const i of slice.cells) {
    const c = i % feature.cols, r = (i / feature.cols) | 0;
    const x = feature.x + c, y = feature.y + r;
    const top = mesaCellTop(feature, c, r);
    const south = mesaCellTop(feature, c, r + 1);
    const east = mesaCellTop(feature, c + 1, r);
    if (east < top) cliffFace(g, rock, x + 1, y, x + 1, y + 1, east, top, 0.94, phase, detail, alpha);
    if (south < top) cliffFace(g, rock, x, y + 1, x + 1, y + 1, south, top, 0.7, phase, detail, alpha);
    if (detail && !tierAt(feature, c + 1, r)) screeApron(g, rock, x + 1, y, x + 1, y + 1, 1, 0, top, 0.9, alpha);
    if (detail && !tierAt(feature, c, r + 1)) screeApron(g, rock, x, y + 1, x + 1, y + 1, 0, 1, top, 0.72, alpha);
    const cap = snow ? SNOW_CAP : shade(rock.cap, 0.96 + cellHash(feature, c, r) * 0.1);
    quad(g, worldToScreen(x, y, top), worldToScreen(x + 1, y, top), worldToScreen(x + 1, y + 1, top), worldToScreen(x, y + 1, top), cap, alpha);
  }
}

/** Cast shadow on the ground layer: each rock cell throws east by its height, drawn once per shaded cell. */
export function drawMesaShadow(g: Graphics, feature: MesaFeature): void {
  const shaded = new Set<number>();
  for (let i = 0; i < feature.tiers.length; i++) {
    if (!feature.tiers[i]) continue;
    const c = i % feature.cols, r = (i / feature.cols) | 0;
    const reach = Math.ceil(mesaCellTop(feature, c, r) * 0.8);
    for (let k = 1; k <= reach; k++) {
      if (!tierAt(feature, c + k, r)) shaded.add(r * 4096 + c + k);
      if (k * 2 <= reach && !tierAt(feature, c + k, r + 1)) shaded.add((r + 1) * 4096 + c + k);
    }
  }
  for (const key of shaded) drawGroundPoly(g, feature.x + (key % 4096), feature.y + ((key / 4096) | 0), 1, 1, PAL.shadow, 0.24);
}

/** Cobbles and a paler sand thread down a dry wash, over its atlas tiles. */
export function drawWash(g: Graphics, feature: WashFeature, snow: boolean): void {
  if (snow) return;
  for (let i = 1; i < feature.path.length; i++) {
    const a = feature.path[i - 1]!;
    const b = feature.path[i]!;
    const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 1.4));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const n = Math.imul(feature.seed + i * 131 + s * 17, 2654435761) >>> 0;
      const x = a.x + (b.x - a.x) * t + ((n & 255) / 255 - 0.5) * feature.halfWidth;
      const y = a.y + (b.y - a.y) * t + (((n >> 8) & 255) / 255 - 0.5) * feature.halfWidth;
      const size = 0.16 + ((n >> 16) & 7) * 0.03;
      drawGroundPoly(g, x, y, size, size * 0.8, (n >> 20) & 1 ? 0x9a8a72 : 0xe6d8b4, 0.85);
    }
  }
}
