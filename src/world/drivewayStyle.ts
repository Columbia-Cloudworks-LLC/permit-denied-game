import type { CoverKind, LotIdentity, RoadSurfaceKind } from "../structure/types";

export interface DrivewayStyle {
  width: number;
  surface: RoadSurfaceKind;
  cover: CoverKind;
  shoulder: number;
}

/** Arid climates pave less: decomposed granite, caliche and gravel where wetter places pour concrete. Widths never change. */
const ARID_DRIVEWAYS: Partial<Record<LotIdentity, Pick<DrivewayStyle, "surface" | "cover">>> = {
  residence: { surface: "gravel", cover: "gravel" },
  farm: { surface: "dirt", cover: "caliche" },
  contractor: { surface: "gravel", cover: "caliche" },
  utility: { surface: "gravel", cover: "caliche" },
};

/** Lot-use driveway treatment. Collision still follows the returned width. */
export function drivewayStyle(identity: LotIdentity, arid = false): DrivewayStyle {
  const style = baseDrivewayStyle(identity);
  return arid ? { ...style, ...ARID_DRIVEWAYS[identity] } : style;
}

/** The lot cover a template's cover becomes in this climate: desert lots keep no turf lawns or planted beds. */
export function lotCover(cover: CoverKind, arid: boolean): CoverKind {
  if (!arid) return cover;
  return cover === "grass" || cover === "scrub" ? "xeriscape" : cover === "planted" ? "gravel" : cover === "dirt" ? "caliche" : cover;
}

function baseDrivewayStyle(identity: LotIdentity): DrivewayStyle {
  switch (identity) {
    case "residence":
      return { width: 1.95, surface: "concrete", cover: "concrete", shoulder: 0.1 };
    case "farm":
      return { width: 1.85, surface: "dirt", cover: "dirt", shoulder: 0.14 };
    case "shop":
      return { width: 2.15, surface: "concrete", cover: "parking", shoulder: 0.1 };
    case "service":
      return { width: 2.25, surface: "concrete", cover: "parking", shoulder: 0.1 };
    case "contractor":
      return { width: 2.4, surface: "gravel", cover: "gravel", shoulder: 0.14 };
    case "utility":
      return { width: 2.3, surface: "gravel", cover: "gravel", shoulder: 0.12 };
    default: {
      const _never: never = identity;
      return _never;
    }
  }
}

export function drivewayPavementColor(surface: RoadSurfaceKind): number {
  switch (surface) {
    case "dirt":
      return 0x6a5438;
    case "gravel":
      return 0x5a5248;
    case "concrete":
      return 0x7a7870;
    case "asphalt":
      return 0x3e3c3a;
    default: {
      const _never: never = surface;
      return _never;
    }
  }
}
