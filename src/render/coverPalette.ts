import type { CoverKind } from "../structure/types";
import { aridLandscape, SOILS, type ClimateEnvelope, type SoilProfile } from "../world/climate";
import type { GroundCondition } from "../world/groundCondition";
import { ICE_COLOR, ICE_CRACK, type SeasonId } from "../world/season";
import { PAL, shade } from "./palette";

export const SOFT_LOT_COVERS: readonly CoverKind[] = ["grass", "scrub", "dirt", "planted", "lot", "xeriscape", "caliche"];
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
  xeriscape: true,
  caliche: true,
};

export const COVER_KINDS: readonly CoverKind[] = Object.keys(COVER_PRESENT) as CoverKind[];

/**
 * What the ground painters need beyond snow cover and paint season: whether water is ice, and
 * the zone's soil. One value per town; `key` goes in every ground cache key.
 */
export interface GroundTone {
  /** Ponds and rivers draw as cracked ice. */
  frozen: boolean;
  /** Desert and canyon country: bare ground reads as the soil, scrub as dormant tan. */
  arid: boolean;
  soil: SoilProfile;
  key: string;
}

export function groundTone(town: { frozen: boolean; climate: Pick<ClimateEnvelope, "landscape" | "soil"> }): GroundTone {
  const arid = aridLandscape(town.climate);
  return { frozen: town.frozen, arid, soil: SOILS[town.climate.soil], key: `${town.frozen ? "ice" : "open"}:${arid ? "arid" : "green"}:${town.climate.soil}` };
}

/** The legacy backdrop: deep meadow green beyond the map edge. */
export const BACKDROP_GREEN = 0x3e522c;

/**
 * What lies beyond the map edge: open desert in the zone's own soil, a snowfield under snow
 * cover, and the meadow green everywhere else.
 */
export function backdropColor(town: { groundCondition: GroundCondition; frozen: boolean; climate: Pick<ClimateEnvelope, "landscape" | "soil"> }): number {
  if (town.groundCondition === "snow") return 0xa9b4bb;
  const tone = groundTone(town);
  return tone.arid ? shade(tone.soil.verge, 0.6) : BACKDROP_GREEN;
}

/**
 * The palette season. Winter palettes are reachable only through snow cover: a calendar winter
 * that reaches here without snow paints dormant autumn (towns pass `Town.look`, which has
 * already borrowed the zone's `winterLook`).
 */
function paintSeason(condition: GroundCondition, season: SeasonId): SeasonId {
  if (condition === "snow") return "winter";
  return season === "winter" ? "autumn" : season;
}

/** `tone` absent keeps the legacy rule that snow cover means frozen water. */
function iced(cover: CoverKind, condition: GroundCondition, tone?: GroundTone): boolean {
  return cover === "water" && (tone ? tone.frozen : condition === "snow");
}

export function coverColor(cover: CoverKind, condition: GroundCondition = "clear", season: SeasonId = "summer", tone?: GroundTone): number {
  if (iced(cover, condition, tone)) return ICE_COLOR;
  const paint = paintSeason(condition, season);
  if (paint === "winter") return winterCoverColor(cover);
  const arid = tone?.arid ? aridCoverColor(cover, tone.soil, paint) : undefined;
  if (arid !== undefined) return arid;
  if (paint === "spring") return springCoverColor(cover);
  if (paint === "autumn") return autumnCoverColor(cover);
  return clearCoverColor(cover);
}

export function coverDark(cover: CoverKind, condition: GroundCondition = "clear", season: SeasonId = "summer", tone?: GroundTone): number {
  if (iced(cover, condition, tone)) return ICE_CRACK;
  const paint = paintSeason(condition, season);
  if (paint === "winter") return winterCoverDark(cover);
  if (tone?.arid && ARID_SOFT.has(cover)) return shade(tone.soil.track, 0.9);
  if (paint === "autumn") return autumnCoverDark(cover);
  return clearCoverDark(cover);
}

const ARID_SOFT: ReadonlySet<CoverKind> = new Set(["grass", "scrub", "dirt", "planted", "lot", "forest-floor", "xeriscape", "caliche"]);
/** Creosote and sage: grey-green after the spring rains, dormant tan the rest of the year. */
const ARID_SCRUB: Record<Exclude<SeasonId, "winter">, number> = { spring: 0x8f9460, summer: 0xa89868, autumn: 0xa48e60 };

/**
 * Desert and canyon ground: open covers take the soil's own ochre or sand, and what grows on
 * them is dry scrub. Hard covers, water and irrigated fields keep their own colours.
 */
function aridCoverColor(cover: CoverKind, soil: SoilProfile, season: Exclude<SeasonId, "winter">): number | undefined {
  switch (cover) {
    case "grass":
    case "lot":
      return soil.verge;
    case "dirt":
      return shade(soil.verge, 0.9);
    case "scrub":
    case "planted":
      return mixColor(ARID_SCRUB[season], soil.verge, 0.35);
    case "forest-floor":
      return shade(soil.track, 1.08);
    case "caliche":
      return shade(soil.verge, 1.05);
    case "xeriscape":
      // Decomposed granite raked over the native soil.
      return mixColor(DECOMPOSED_GRANITE, soil.verge, 0.45);
    default:
      return undefined;
  }
}

const DECOMPOSED_GRANITE = 0xb9a482;
const CALICHE = 0xcbbd98;

function mixColor(a: number, b: number, t: number): number {
  const mix = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) << shift;
  return mix(16) | mix(8) | mix(0);
}

function springCoverColor(cover: CoverKind): number {
  switch (cover) {
    case "grass":
    case "scrub":
      return 0x7aaa4c;
    case "dirt":
      return 0x5c4636;
    case "planted":
      return 0x6e9a46;
    case "lot":
      return 0x6f8f52;
    default:
      return clearCoverColor(cover);
  }
}

function autumnCoverColor(cover: CoverKind): number {
  switch (cover) {
    case "grass":
    case "scrub":
      return 0x7a7044;
    case "dirt":
      return 0x8a6840;
    case "planted":
      return 0x8a6230;
    case "lot":
      return 0x746848;
    case "forest-floor":
      return 0x6a4c30;
    default:
      return clearCoverColor(cover);
  }
}

function autumnCoverDark(cover: CoverKind): number {
  switch (cover) {
    case "grass":
    case "scrub":
    case "planted":
    case "lot":
      return 0x4e4428;
    default:
      return clearCoverDark(cover);
  }
}

function clearCoverColor(cover: CoverKind): number {
  switch (cover) {
    case "grass":
      return PAL.grass;
    case "scrub":
      return PAL.grassDark;
    case "dirt":
      return PAL.dirt;
    case "xeriscape":
      return DECOMPOSED_GRANITE;
    case "caliche":
      return CALICHE;
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
    case "xeriscape":
    case "caliche":
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
    case "xeriscape":
    case "caliche":
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
    case "xeriscape":
    case "caliche":
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
