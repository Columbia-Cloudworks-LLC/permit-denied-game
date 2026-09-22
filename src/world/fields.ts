import { CASH_TARGET } from "../game/constants";
import type { FieldCropId } from "./biomes";
import type { FieldFeature } from "./terrainFeatures";
import { SURFACE_ID, type SurfaceGrid } from "./terrain";

export const FIELD_CELL = 0.65;
export const FIELD_COMPLETE_RATIO = 0.9;
export const FIELD_VALUE_CAP = 350;
export const FIELD_COMPLETION_SHARE = 0.2;
export const FIELD_MIN_SHORT = 10;
export const FIELD_MIN_LONG = 24;
export const FIELD_MIN_AREA = 240;
export const FIELD_FARM_RANGE = 12;
export const FIELD_TRACK_RADIUS = 0.26;
export const FIELD_TRACK_SEP = 0.32;
export const FIELD_SWATH_RADIUS = 0.42;
export const FIELD_NOTICE_SECONDS = 2;
export const FIELD_CLEARED_SECONDS = 2.2;
export const CHURN_TRACK = 1;
export const CHURN_SWATH = 2;
export const FIELD_CROP_FRAGS_PER_TICK = 12;
export const FIELD_SOUNDS_PER_SEC = 6;

export function fieldValue(validArea: number, cashTarget = CASH_TARGET): number {
  const lo = cashTarget * 0.03;
  const hi = Math.min(FIELD_VALUE_CAP, cashTarget * 0.08);
  const scaled = (validArea / FIELD_MIN_AREA) * (cashTarget * 0.05);
  return Math.max(lo, Math.min(hi, Math.round(scaled)));
}

export function fieldValidCount(feature: FieldFeature): number {
  if (!feature.mask) return feature.cols * feature.rows;
  let n = 0;
  for (let i = 0; i < feature.mask.length; i++) if (feature.mask[i]) n++;
  return n;
}

export function fieldDamagedCount(feature: FieldFeature): number {
  let n = 0;
  for (let i = 0; i < feature.churn.length; i++) {
    if (feature.churn[i] && (!feature.mask || feature.mask[i])) n++;
  }
  return n;
}

export function fieldProgress(feature: FieldFeature): number {
  const valid = Math.max(1, feature.valid ?? fieldValidCount(feature));
  return fieldDamagedCount(feature) / valid;
}

export function cropLabel(crop: FieldCropId): string {
  switch (crop) {
    case "corn":
      return "CORN";
    case "wheat":
      return "WHEAT";
    case "soy":
      return "SOY";
    default: {
      const _never: never = crop;
      return _never;
    }
  }
}

export function cropFragmentColor(crop: FieldCropId): number {
  switch (crop) {
    case "corn":
      return 0xd4c44a;
    case "wheat":
      return 0xe2c456;
    case "soy":
      return 0x4a8a38;
    default: {
      const _never: never = crop;
      return _never;
    }
  }
}

export function isPrimaryField(feature: FieldFeature): boolean {
  const short = Math.min(feature.w, feature.d);
  const long = Math.max(feature.w, feature.d);
  const area = (feature.valid ?? fieldValidCount(feature)) * feature.cell * feature.cell;
  return short >= FIELD_MIN_SHORT - 0.05 && long >= FIELD_MIN_LONG - 0.05 && area >= FIELD_MIN_AREA - 0.5;
}

export function fieldNoticeText(feature: FieldFeature, intro: boolean): string {
  if (feature.cleared) return "FIELD CLEARED";
  const name = cropLabel(feature.crop);
  if (intro) return `${name} FIELD`;
  return `${name} ${Math.floor(fieldProgress(feature) * 100)}%`;
}

export function fieldCellWorld(feature: FieldFeature, col: number, row: number): { x: number; y: number } {
  const fx = Math.cos(feature.heading);
  const fy = Math.sin(feature.heading);
  const cx = feature.x + feature.w * 0.5;
  const cy = feature.y + feature.d * 0.5;
  return {
    x: cx + fx * ((col + 0.5) * feature.cell - feature.w * 0.5) - fy * ((row + 0.5) * feature.cell - feature.d * 0.5),
    y: cy + fy * ((col + 0.5) * feature.cell - feature.w * 0.5) + fx * ((row + 0.5) * feature.cell - feature.d * 0.5),
  };
}

export function fieldWorldBox(feature: FieldFeature): { x: number; y: number; w: number; d: number } {
  const fx = Math.cos(feature.heading);
  const fy = Math.sin(feature.heading);
  const cx = feature.x + feature.w * 0.5;
  const cy = feature.y + feature.d * 0.5;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      const lx = sx * feature.w * 0.5;
      const ly = sy * feature.d * 0.5;
      const x = cx + fx * lx - fy * ly;
      const y = cy + fy * lx + fx * ly;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, d: maxY - minY };
}

export function payFieldDamage(feature: FieldFeature, newly: number): number {
  if (newly <= 0 || feature.state === "tilled" || feature.state === "stubble") return 0;
  const valid = Math.max(1, feature.valid ?? fieldValidCount(feature));
  const value = feature.value ?? fieldValue(valid * feature.cell * feature.cell);
  feature.value = value;
  const before = feature.paid ?? 0;
  feature.paid = before + newly * ((value * (1 - FIELD_COMPLETION_SHARE)) / valid);
  if (!feature.cleared && fieldProgress(feature) >= FIELD_COMPLETE_RATIO) {
    feature.cleared = true;
    feature.paid = value;
  }
  return Math.floor(feature.paid) - Math.floor(before);
}

export function undevelopedFieldShare(grid: SurfaceGrid): number {
  let field = 0;
  let undeveloped = 0;
  for (let i = 0; i < grid.surface.length; i++) {
    const id = grid.surface[i]!;
    if (id === SURFACE_ID.water || id === SURFACE_ID["forest-core"] || id === SURFACE_ID.developed) continue;
    undeveloped++;
    if (id === SURFACE_ID.field) field++;
  }
  return field / Math.max(1, undeveloped);
}

export function fieldChurnSpan(feature: FieldFeature): number {
  const fx = Math.cos(feature.heading);
  const fy = Math.sin(feature.heading);
  let minAcross = Infinity;
  let maxAcross = -Infinity;
  const cx = feature.x + feature.w * 0.5;
  const cy = feature.y + feature.d * 0.5;
  for (let iy = 0; iy < feature.rows; iy++) {
    for (let ix = 0; ix < feature.cols; ix++) {
      if (!feature.churn[iy * feature.cols + ix]) continue;
      const p = fieldCellWorld(feature, ix, iy);
      const across = -(p.x - cx) * fy + (p.y - cy) * fx;
      minAcross = Math.min(minAcross, across);
      maxAcross = Math.max(maxAcross, across);
    }
  }
  if (!Number.isFinite(minAcross)) return 0;
  return maxAcross - minAcross;
}
