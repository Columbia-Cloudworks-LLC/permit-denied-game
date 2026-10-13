import type { Graphics } from "pixi.js";
import type { FieldCropId } from "../world/biomes";
import { CHURN_SWATH, CHURN_TRACK, fieldRunCenter, forEachFieldRun } from "../world/fields";
import type { GroundCondition } from "../world/groundCondition";
import { seasonTrackColor, type SeasonId } from "../world/season";
import { groundPatchContains } from "../world/terrain";
import type { FieldFeature, TerrainFeature } from "../world/terrainFeatures";
import type { Material } from "../structure/materials";
import type { CollapsedSite, GroundKind, GroundMark, GroundPatch, SiteMarkKind } from "../structure/types";
import { coverColor, coverDark } from "./coverPalette";
import { drawGroundPoly, drawIsoBox, drawOrientedGround, drawOrientedIsoBox, drawWorldPoly, PAL } from "./drawIso";
import { worldToScreen } from "../world/iso";

const SITE_MARK_STYLE: Record<SiteMarkKind, { color: number; alpha: number }> = {
  dirt: { color: PAL.lotDark, alpha: 0.4 },
  slab: { color: PAL.concrete, alpha: 0.62 },
  crack: { color: PAL.crack, alpha: 0.55 },
  outline: { color: PAL.foundation, alpha: 0.7 },
  ridge: { color: PAL.concreteDark, alpha: 0.62 },
  remnant: { color: PAL.brickDark, alpha: 0.62 },
};

export function drawCollapsedSite(g: Graphics, site: CollapsedSite): void {
  drawGroundPoly(g, site.x + 0.04, site.y + 0.04, site.w - 0.08, site.d - 0.08, PAL.lotDark, 0.28);
  for (const mark of site.marks) {
    const { color, alpha } = SITE_MARK_STYLE[mark.kind];
    if (mark.kind === "ridge" || mark.kind === "remnant") {
      drawIsoBox(g, mark.x, mark.y, mark.w, mark.d, 0, mark.z, color, PAL.concreteDark, color, alpha);
    } else {
      drawGroundPoly(g, mark.x, mark.y, mark.w, mark.d, color, alpha);
    }
  }
}

export function drawCover(g: Graphics, patch: GroundPatch, condition: GroundCondition, season: SeasonId = "summer"): void {
  drawCoverFill(g, patch, coverColor(patch.cover, condition, season));
  if (patch.cover.startsWith("field-")) {
    drawFieldRows(g, patch, condition, season);
    return;
  }
  if (patch.cover === "water") {
    if (condition === "snow" || season === "winter") drawIceCracks(g, patch);
    return;
  }
  if (patch.cover === "forest-floor") return;
  drawCoverSpeckle(g, patch, coverDark(patch.cover, condition, season));
}

function drawCoverFill(g: Graphics, patch: GroundPatch, color: number): void {
  if (patch.poly && patch.poly.length >= 3) {
    drawWorldPoly(g, patch.poly.map((p) => ({ x: p.x, y: p.y, z: patch.z })), color, 1);
  } else if (Math.abs(patch.heading) > 0.05) {
    drawOrientedGround(g, patch.x + patch.w * 0.5, patch.y + patch.d * 0.5, patch.heading, patch.w, patch.d, color, 1, patch.z);
  } else {
    drawGroundPoly(g, patch.x, patch.y, patch.w, patch.d, color, 1, patch.z);
  }
}

function drawCoverSpeckle(g: Graphics, patch: GroundPatch, dark: number): void {
  const speckle = patch.z < 0 ? 1 : Math.min(40, Math.max(4, Math.floor((patch.w * patch.d) / 18)));
  for (let i = 0; i < speckle; i++) {
    const gx = patch.x + ((i * 17 + (patch.seed % 13)) % 97) * 0.12 * (patch.w / 8);
    const gy = patch.y + ((i * 29 + (patch.seed % 17)) % 89) * 0.1 * (patch.d / 8);
    if (gx > patch.x + patch.w || gy > patch.y + patch.d) continue;
    if (!groundPatchContains(patch, gx + 0.16, gy + 0.13)) continue;
    drawGroundPoly(g, gx, gy, 0.32, 0.26, dark, 0.2, patch.z);
  }
}

function drawIceCracks(g: Graphics, patch: GroundPatch): void {
  const cracks = 3 + (patch.seed % 3);
  for (let i = 0; i < cracks; i++) {
    const ox = ((patch.seed * (i + 3)) % 97) / 97;
    const oy = ((patch.seed * (i + 5)) % 89) / 89;
    drawGroundPoly(g, patch.x + ox * patch.w * 0.7, patch.y + oy * patch.d * 0.7, patch.w * 0.28, 0.06, 0x4a6274, 0.45, patch.z + 0.01);
  }
}

const FIELD_ROW_THICKNESS: Partial<Record<GroundPatch["cover"], number>> = { "field-tilled": 0.1, "field-stubble": 0.08, "field-mature": 0.12 };

function drawFieldRows(g: Graphics, patch: GroundPatch, condition: GroundCondition, season: SeasonId): void {
  if (patch.poly && patch.poly.length >= 3) return;
  const gap = patch.cover === "field-mature" ? 1.35 : 1.05;
  const rows = Math.min(7, Math.max(3, Math.floor(patch.d / gap)));
  const color = coverDark(patch.cover, condition, season);
  const thick = FIELD_ROW_THICKNESS[patch.cover] ?? 0.1;
  const z = patch.z + 0.006;
  for (let i = 0; i < rows; i++) {
    const t = (i + 0.5) / rows - 0.5;
    const fx = Math.cos(patch.heading);
    const fy = Math.sin(patch.heading);
    const cx = patch.x + patch.w * 0.5 - fy * t * patch.d;
    const cy = patch.y + patch.d * 0.5 + fx * t * patch.d;
    drawOrientedGround(g, cx, cy, patch.heading, patch.w * 0.9, thick, color, patch.cover === "field-tilled" ? 0.28 : 0.36, z);
  }
}

export function drawTerrainFeatures(g: Graphics, features: readonly TerrainFeature[], condition: GroundCondition, season: SeasonId): void {
  for (const feature of features) {
    switch (feature.kind) {
      case "forest":
        break;
      case "field":
        drawFieldCrops(g, feature, condition, season);
        drawFieldChurn(g, feature);
        break;
      case "pond":
      case "lake":
      case "river":
        break;
      default: {
        const _never: never = feature;
        return _never;
      }
    }
  }
}

interface CropRowStyle { top: number; left: number; right: number; h: number; thick: number }
/** Growth stage as rows read on screen; autumn turns a mature crop to its harvest colour. */
type CropStage = "harvest" | "mature" | "short" | "bare";
/** Side colours and thickness come in [grown, young] pairs; a harvest crop counts as grown. */
interface CropPalette { top: Record<CropStage, number>; h: Record<CropStage, number>; left: [number, number]; right: [number, number]; thick: [number, number] }

const CROP_PALETTES: Record<FieldCropId, CropPalette> = {
  corn: {
    top: { harvest: 0xc4a024, mature: 0x6f9a38, short: 0x5a8a34, bare: 0x6a5a30 },
    h: { harvest: 0.36, mature: 0.28, short: 0.12, bare: 0.04 },
    left: [0x4a5a1c, 0x2e3c16], right: [0x627428, 0x3e4c1c], thick: [0.18, 0.14],
  },
  wheat: {
    top: { harvest: 0xe2c56a, mature: 0xa89448, short: 0x6e8a38, bare: 0x7a6840 },
    h: { harvest: 0.26, mature: 0.2, short: 0.1, bare: 0.04 },
    left: [0x6a5420, 0x3a3a18], right: [0x8a7030, 0x4a4a1e], thick: [0.16, 0.14],
  },
  soy: {
    top: { harvest: 0xc6a04a, mature: 0x3e7432, short: 0x4a8240, bare: 0x6a5030 },
    h: { harvest: 0.24, mature: 0.18, short: 0.1, bare: 0.04 },
    left: [0x1e401c, 0x303016], right: [0x2e5a28, 0x3e3c1c], thick: [0.18, 0.14],
  },
};

const WINTER_ROW_HEIGHT: Record<FieldFeature["state"], number> = { mature: 0.12, stubble: 0.12, short: 0.08, tilled: 0.04 };

function cropRowStyle(feature: FieldFeature, condition: GroundCondition, season: SeasonId): CropRowStyle {
  if (condition === "snow" || season === "winter") {
    return { top: 0xd0d8de, left: 0x8a9094, right: 0xa0a8ac, h: WINTER_ROW_HEIGHT[feature.state], thick: 0.2 };
  }
  const stage = cropStage(feature, season);
  const palette = CROP_PALETTES[feature.crop];
  const grown = stage === "harvest" || stage === "mature" ? 0 : 1;
  return { top: palette.top[stage], left: palette.left[grown], right: palette.right[grown], h: palette.h[stage], thick: palette.thick[grown] };
}

function cropStage(feature: FieldFeature, season: SeasonId): CropStage {
  if (feature.state === "mature") return season === "autumn" ? "harvest" : "mature";
  return feature.state === "short" ? "short" : "bare";
}

function drawFieldCrops(g: Graphics, feature: FieldFeature, condition: GroundCondition, season: SeasonId): void {
  if (feature.state === "tilled") return;
  const style = cropRowStyle(feature, condition, season);
  const gap = Math.max(0.9, Math.min(1.2, feature.cell * 1.4));
  const stride = feature.rows > 7 ? 2 : 1;
  const live = (i: number): boolean => (!feature.mask || !!feature.mask[i]) && !feature.churn[i];
  forEachFieldRun(feature, stride, live, (_run, _row, span, center) => {
    drawOrientedIsoBox(
      g,
      center.x,
      center.y,
      feature.heading,
      span,
      Math.min(style.thick, gap * 0.72),
      0.012,
      style.h,
      style.top,
      style.left,
      style.right,
      feature.state === "stubble" ? 0.7 : 1,
    );
  });
}

/** Churn mark at a field cell; a masked-out cell or the column past the end reads as none. */
function churnMark(feature: FieldFeature, row: number, col: number): number {
  const i = row * feature.cols + col;
  return col < feature.cols && (!feature.mask || feature.mask[i]) ? feature.churn[i]! : 0;
}

function drawFieldChurn(g: Graphics, feature: FieldFeature): void {
  for (let row = 0; row < feature.rows; row++) {
    let run = -1;
    let mark = 0;
    for (let col = 0; col <= feature.cols; col++) {
      const cur = churnMark(feature, row, col);
      if (run >= 0 && cur === mark) continue;
      if (run >= 0) drawChurnRun(g, feature, row, run, col - 1, mark);
      run = cur ? col : -1;
      mark = cur;
    }
  }
}

function drawChurnRun(g: Graphics, feature: FieldFeature, row: number, start: number, end: number, mark: number): void {
  const span = (end - start + 1) * feature.cell;
  const { x: cx, y: cy } = fieldRunCenter(feature, start, end, row);
  const width = mark === CHURN_SWATH ? feature.cell * 1.02 : feature.cell * 0.62;
  drawOrientedGround(
    g,
    cx,
    cy,
    feature.heading,
    span + feature.cell * 0.08,
    width,
    mark === CHURN_TRACK ? 0x8a6a38 : PAL.fieldStubble,
    0.92,
    0.016,
  );
}

const MARK_COLORS: Record<Exclude<GroundKind, "chip" | "splinter" | "season-track">, number> = {
  scrape: 0x2a2418,
  tire: 0x2c281c,
  oil: 0x1a1814,
  crack: PAL.crack,
  dust: PAL.lotDark,
  glass: 0x8aa4b0,
};
const CHIP_MARK_COLORS: Partial<Record<Material, number>> = { wood: PAL.woodDark, brick: PAL.brickDark, metal: PAL.metalDark };

function markColor(mark: GroundMark, season: SeasonId = "summer"): number {
  if (mark.kind === "season-track") return seasonTrackColor(season);
  if (mark.kind === "chip" || mark.kind === "splinter") return CHIP_MARK_COLORS[mark.material] ?? PAL.concreteDark;
  return MARK_COLORS[mark.kind];
}

export function drawGroundMark(g: Graphics, mark: GroundMark, season: SeasonId = "summer"): void {
  const color = markColor(mark, season);
  const fx = Math.cos(mark.heading);
  const fy = Math.sin(mark.heading);
  const hx = mark.w * 0.5;
  const hy = mark.d * 0.5;
  const pts = [
    { x: mark.x + fx * hx - fy * hy, y: mark.y + fy * hx + fx * hy },
    { x: mark.x + fx * hx + fy * hy, y: mark.y + fy * hx - fx * hy },
    { x: mark.x - fx * hx + fy * hy, y: mark.y - fy * hx - fx * hy },
    { x: mark.x - fx * hx - fy * hy, y: mark.y - fy * hx + fx * hy },
  ];
  const q = pts.flatMap((p) => {
    const s = worldToScreen(p.x, p.y, 0);
    return [s.x, s.y];
  });
  g.poly(q);
  g.fill({ color, alpha: mark.alpha });
}
