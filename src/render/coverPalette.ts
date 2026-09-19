import type { CoverKind } from "../structure/types";
import type { GroundCondition } from "../world/groundCondition";
import { PAL } from "./palette";

export const SOFT_LOT_COVERS: readonly CoverKind[] = ["grass", "scrub", "dirt", "planted", "lot"];
export const HARD_LOT_COVERS: readonly CoverKind[] = ["driveway", "parking", "concrete", "gravel", "tracks"];

const COVER_PRESENT: Record<CoverKind, true> = {
  grass: true,
  scrub: true,
  dirt: true,
  gravel: true,
  tracks: true,
  concrete: true,
  parking: true,
  driveway: true,
  planted: true,
  lot: true,
  water: true,
  "forest-floor": true,
  "field-tilled": true,
  "field-short": true,
  "field-mature": true,
  "field-stubble": true,
};

export const COVER_KINDS: readonly CoverKind[] = Object.keys(COVER_PRESENT) as CoverKind[];

export function coverColor(cover: CoverKind, condition: GroundCondition = "clear"): number {
  return condition === "snow" ? winterCoverColor(cover) : clearCoverColor(cover);
}

export function coverDark(cover: CoverKind, condition: GroundCondition = "clear"): number {
  return condition === "snow" ? winterCoverDark(cover) : clearCoverDark(cover);
}

function clearCoverColor(cover: CoverKind): number {
  switch (cover) {
    case "grass":
      return PAL.grass;
    case "scrub":
      return PAL.grassDark;
    case "dirt":
      return PAL.dirt;
    case "gravel":
      return PAL.gravel;
    case "tracks":
      return PAL.lotDark;
    case "concrete":
    case "parking":
      return PAL.concrete;
    case "driveway":
      return 0x5a5248;
    case "planted":
      return PAL.planted;
    case "lot":
      return PAL.lot;
    case "water":
      return PAL.water;
    case "forest-floor":
      return PAL.forestFloor;
    case "field-tilled":
      return PAL.fieldTilled;
    case "field-short":
      return PAL.fieldShort;
    case "field-mature":
      return PAL.fieldMature;
    case "field-stubble":
      return PAL.fieldStubble;
    default: {
      const _never: never = cover;
      return _never;
    }
  }
}

function clearCoverDark(cover: CoverKind): number {
  switch (cover) {
    case "grass":
    case "scrub":
    case "planted":
      return PAL.grassDark;
    case "dirt":
    case "tracks":
    case "lot":
      return PAL.lotDark;
    case "gravel":
    case "driveway":
      return 0x5a5448;
    case "concrete":
    case "parking":
      return PAL.concreteDark;
    case "water":
      return PAL.waterDark;
    case "forest-floor":
    case "field-short":
    case "field-mature":
      return 0x1e381c;
    case "field-tilled":
    case "field-stubble":
      return 0x5a3a1c;
    default: {
      const _never: never = cover;
      return _never;
    }
  }
}

function winterCoverColor(cover: CoverKind): number {
  switch (cover) {
    case "grass":
      return 0xd6e2ee;
    case "scrub":
      return 0xc8d4e0;
    case "dirt":
      return 0xc4c8c0;
    case "planted":
      return 0x9aaca8;
    case "lot":
      return 0xd0d6dc;
    case "gravel":
      return 0x9aa0a4;
    case "tracks":
      return 0x8a8478;
    case "concrete":
    case "parking":
      return 0xa8a8a4;
    case "driveway":
      return 0x6a6864;
    case "water":
      return PAL.water;
    case "forest-floor":
      return 0xb8c4cc;
    case "field-tilled":
      return 0xb8b0a4;
    case "field-short":
      return 0xc8d4dc;
    case "field-mature":
      return 0xc0c8c0;
    case "field-stubble":
      return 0xc8c0b0;
    default: {
      const _never: never = cover;
      return _never;
    }
  }
}

function winterCoverDark(cover: CoverKind): number {
  switch (cover) {
    case "grass":
    case "scrub":
    case "lot":
      return 0xa8b8c4;
    case "dirt":
    case "tracks":
      return 0x6a6458;
    case "planted":
      return 0x6a7a72;
    case "gravel":
    case "driveway":
      return 0x5a5854;
    case "concrete":
    case "parking":
      return 0x7a7874;
    case "water":
      return PAL.waterDark;
    case "forest-floor":
    case "field-short":
    case "field-mature":
      return 0x8a949c;
    case "field-tilled":
    case "field-stubble":
      return 0x7a6a58;
    default: {
      const _never: never = cover;
      return _never;
    }
  }
}
