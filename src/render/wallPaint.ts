import { trimRoll } from "../structure/facadeTrim";
import type { Building, Material } from "../structure/types";
import type { WallRegion } from "../world/climate";
import { getBuildingSurfaces, type WallSpan } from "./buildingSurfaces";
import { wallFaceColor, type WallFace } from "./lighting";
import { wallSpanFadeRuns, type OccludeDozer } from "./occlusion";
import { matColors, shade } from "./palette";

/** One cell per command so a long east/south run cannot sort behind a nearer floor tile. */
function splitWallSpan(span: WallSpan): WallSpan[] {
  const count = span.dir === "south" ? span.gx1 - span.gx0 + 1 : span.gy1 - span.gy0 + 1;
  if (count <= 1) return [span];
  return Array.from({ length: count }, (_, i) => ({
    ...span,
    gx0: span.gx0 + (span.dir === "south" ? i : 0),
    gx1: span.gx0 + (span.dir === "south" ? i : 0),
    gy0: span.gy0 + (span.dir === "east" ? i : 0),
    gy1: span.gy0 + (span.dir === "east" ? i : 0),
  }));
}

export function wallPaintSpans(b: Building, split = true): WallSpan[] {
  const walls = getBuildingSurfaces(b).walls;
  return split ? walls.flatMap(splitWallSpan) : walls;
}

/** Painter depths the shared wall path actually submits, including fade-run face depth. */
export function wallPaintDepths(b: Building, dozer: OccludeDozer): { span: WallSpan; depth: number; fade: number }[] {
  const out: { span: WallSpan; depth: number; fade: number }[] = [];
  for (const span of wallPaintSpans(b)) {
    for (const run of wallSpanFadeRuns(b, span, dozer)) {
      out.push({ span: run.span, depth: run.span.depth, fade: run.fade });
    }
  }
  return out;
}

/** How a wall face is finished, which decides its surface pattern. */
export type WallFinish =
  | "brick" | "stucco" | "adobe" | "sandstone" | "limestone" | "clapboard"
  | "cmu" | "ribbed" | "tiltup" | "timber" | "shingle" | "plain";

/** One building's regional finish for one wall material. `tone` is the sunlit colour; shaded faces derive from it. */
export interface WallPaint { finish: WallFinish; tone: number; trim: number }

type Swatch = readonly [finish: WallFinish, tone: number, weight: number];

const LIMESTONE = 0xc4baa0;
/** Ribbed steel and stained tilt-up read the same in every region. */
const RIBBED_STEEL: readonly Swatch[] = [
  ["ribbed", 0x6d7270, 3], ["ribbed", 0xb5a684, 2], ["ribbed", 0x4f6a52, 1.5], ["ribbed", 0x5f7486, 1.5],
  ["ribbed", 0x8a4638, 1], ["ribbed", 0xc2c2b8, 1.5],
];
const TILT_UP: readonly Swatch[] = [["tiltup", 0x8a8778, 3], ["tiltup", 0xa39c88, 2], ["tiltup", 0x8c8c84, 2], ["tiltup", 0xb0a890, 1.5]];

type Category = "brick" | "wood" | "concrete" | "civic";
/** Wall palettes by region, then by what the wall is built of. Civic masonry takes the region's dressed stone. */
const REGION_SWATCHES: Record<WallRegion, Record<Category, readonly Swatch[]>> = {
  "brick-belt": {
    brick: [["brick", 0x8a3a32, 4], ["brick", 0x7a3a2a, 2], ["brick", 0x9a4a38, 1.5], ["brick", 0x6e3d30, 1.5]],
    wood: [["clapboard", 0xb8733a, 2], ["clapboard", 0xd8d2c0, 3], ["clapboard", 0xc9c2a0, 2], ["clapboard", 0x8a9aa0, 1.5], ["clapboard", 0xa8b09a, 1], ["clapboard", 0x9a5a48, 1]],
    concrete: [["plain", 0x8a8778, 3], ["limestone", 0xb5ad94, 2], ["plain", 0x9a968a, 1.5]],
    civic: [["limestone", 0xb5ad94, 3], ["brick", 0x8a3a32, 2], ["limestone", LIMESTONE, 1.5]],
  },
  southwest: {
    brick: [["stucco", 0xd9b98a, 3], ["adobe", 0xc98e62, 3], ["adobe", 0xb86a48, 2], ["stucco", 0xe4d4b4, 1.5], ["brick", 0xa8623e, 1]],
    wood: [["stucco", 0xd9b98a, 3], ["adobe", 0xc98e62, 2], ["stucco", 0xe4d4b4, 2], ["clapboard", 0xc8ad84, 1]],
    concrete: [["stucco", 0xd8c49a, 3], ["adobe", 0xb86a48, 1.5], ["stucco", 0xe4d4b4, 2], ["cmu", 0xc4b494, 1.5]],
    civic: [["sandstone", 0xd8c49a, 4], ["adobe", 0xc98e62, 2], ["sandstone", 0xc9a878, 2]],
  },
  gulf: {
    brick: [["stucco", 0xe8d9b0, 2], ["stucco", 0xbfd8c8, 1.5], ["stucco", 0xe6b8a0, 1.5], ["brick", 0xd8ccb8, 1.5], ["brick", 0x9a4a38, 1]],
    wood: [["clapboard", 0xf0e8d8, 3], ["clapboard", 0xb8d0e0, 2], ["clapboard", 0xe8d9b0, 2], ["clapboard", 0xbfd8c8, 1.5], ["clapboard", 0xe6b8a0, 1]],
    concrete: [["cmu", 0xe8d9b0, 2], ["cmu", 0xb8d0e0, 2], ["cmu", 0xbfd8c8, 1.5], ["stucco", 0xf0e8d8, 2], ["cmu", 0xe6b8a0, 1]],
    civic: [["stucco", 0xf0e8d8, 3], ["limestone", LIMESTONE, 2], ["stucco", 0xe8d9b0, 1.5]],
  },
  mountain: {
    brick: [["brick", 0x7a3a2a, 2], ["sandstone", 0x8c8070, 2], ["brick", 0x6e3d30, 1.5]],
    wood: [["timber", 0x8a5a30, 3], ["timber", 0x7a4a24, 2], ["timber", 0x6a4a34, 2], ["clapboard", 0x5c6a50, 1], ["timber", 0x9a6a3a, 1.5]],
    concrete: [["sandstone", 0x8c8478, 3], ["plain", 0x8a8778, 2]],
    civic: [["sandstone", 0x9a8e7c, 3], ["brick", 0x7a3a2a, 1.5]],
  },
  pacific: {
    brick: [["brick", 0x7c4438, 2], ["brick", 0xb8b0a0, 1.5], ["stucco", 0xc8c4b4, 1.5]],
    wood: [["shingle", 0x8a8478, 3], ["shingle", 0x9a7a58, 2], ["clapboard", 0x6a7a70, 2], ["clapboard", 0x5f7486, 1.5], ["clapboard", 0xd0ccc0, 1.5]],
    concrete: [["plain", 0x9a9c94, 3], ["stucco", 0xc8c4b4, 2]],
    civic: [["limestone", 0xa8a698, 3], ["plain", 0x9a9c94, 1.5]],
  },
};

const paints = new WeakMap<Building, { seed: number; walls: WallRegion; byMaterial: Map<Material, WallPaint | null> }>();

function pickSwatch(swatches: readonly Swatch[], roll: number): Swatch {
  let pick = roll * swatches.reduce((sum, s) => sum + s[2], 0);
  for (const swatch of swatches) { pick -= swatch[2]; if (pick <= 0) return swatch; }
  return swatches[swatches.length - 1]!;
}

function swatchesFor(b: Building, material: Material, walls: WallRegion): readonly Swatch[] | null {
  if (material === "glass") return null;
  const industrial = b.kind === "industrial" || b.theme === "warehouse";
  if (material === "metal") return RIBBED_STEEL;
  if (industrial && (material === "concrete" || (material === "brick" && walls !== "brick-belt"))) return TILT_UP;
  if (b.theme === "civic" && material !== "wood") return REGION_SWATCHES[walls].civic;
  return REGION_SWATCHES[walls][material];
}

/**
 * The regional finish of one wall material on one building, or `null` to keep the stock material
 * colours: buildings outside a climate zone (yards, legacy maps) and glass always do.
 * Stable for a building's regional seed; each material rolls independently.
 */
export function regionalWallPaint(b: Building, material: Material): WallPaint | null {
  const region = b.region;
  if (!region) return null;
  let hit = paints.get(b);
  if (!hit || hit.seed !== region.seed || hit.walls !== region.walls) {
    hit = { seed: region.seed, walls: region.walls, byMaterial: new Map() };
    paints.set(b, hit);
  }
  let paint = hit.byMaterial.get(material);
  if (paint === undefined) {
    const swatches = swatchesFor(b, material, region.walls);
    const swatch = swatches && pickSwatch(swatches, trimRoll(region.seed, 200 + material.length * 7 + material.charCodeAt(0)));
    const light = swatch ? luminance(swatch[1]) : 0;
    paint = swatch ? { finish: swatch[0], tone: swatch[1], trim: light > 150 ? shade(swatch[1], 0.78) : light > 95 ? shade(swatch[1], 1.22) : LIMESTONE } : null;
    hit.byMaterial.set(material, paint);
  }
  return paint;
}

const luminance = (color: number): number => ((color >> 16) & 255) * 0.3 + ((color >> 8) & 255) * 0.59 + (color & 255) * 0.11;

/** A shaded south face sits at this share of the sunlit tone, as the stock material ramps do. */
const SOUTH_TONE = 0.67;

/**
 * Wall face colour: the stock material ramp, retinted to the building's regional finish when it
 * has one. The retint keeps whatever light and damage the ramp applied.
 */
export function wallTone(b: Building, material: Material, face: WallFace, damaged = false): number {
  const lit = wallFaceColor(material, face, damaged);
  const paint = regionalWallPaint(b, material);
  if (!paint) return lit;
  const stock = matColors(material);
  const ramp = luminance(lit) / Math.max(1, luminance(face === "east" ? stock.side : stock.dark));
  return shade(paint.tone, ramp * (face === "east" ? 1 : SOUTH_TONE));
}

/** Accent colour for masonry trim on this wall: the regional paint's trim, or dressed limestone. */
export function wallTrimTone(b: Building, material: Material, face: WallFace): number {
  return shade(regionalWallPaint(b, material)?.trim ?? LIMESTONE, face === "east" ? 0.86 : 0.86 * SOUTH_TONE);
}

/** Surface pattern to draw: the regional finish, else the stock one for the material. */
export function wallFinish(b: Building, material: Material): WallFinish {
  return regionalWallPaint(b, material)?.finish ?? (material === "brick" ? "brick" : material === "metal" ? "ribbed" : "plain");
}
