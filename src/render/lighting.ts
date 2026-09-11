import type { FloorFinish, Material } from "../structure/types";
import { shade } from "./drawIso";
import { matColors, PAL } from "./palette";

/** Fixed isometric sun from upper-west (world −X, −Y). */
export const LIGHT_DIR = { x: -0.72, y: -0.68 };

export type WallFace = "south" | "east";

export function wallFaceShade(face: WallFace): number {
  const dot = face === "east" ? LIGHT_DIR.x : LIGHT_DIR.y;
  return dot > 0 ? 1.04 : 0.86;
}

export function wallFaceColor(material: Material, face: WallFace, damaged = false): number {
  const c = matColors(material);
  const base = face === "east" ? c.side : c.dark;
  const lit = shade(base, wallFaceShade(face));
  return damaged ? shade(lit, 0.9) : lit;
}

export function topFaceColor(material: Material, damaged = false): number {
  const c = matColors(material);
  const lit = shade(c.top, 1.06);
  return damaged ? shade(lit, 0.88) : lit;
}

export function interiorColor(): number {
  return PAL.plasterShadow;
}

export function plasterColor(occluded = false): number {
  return occluded ? PAL.plasterShadow : PAL.plaster;
}

export function floorFinishColor(finish: FloorFinish, edge = false): number {
  switch (finish) {
    case "concrete":
      return edge ? PAL.concreteDark : PAL.concrete;
    case "plank":
      return edge ? PAL.plankDark : PAL.plank;
    case "tile":
      return edge ? PAL.tileDark : PAL.tile;
    case "linoleum":
      return edge ? PAL.linoleumDark : PAL.linoleum;
    default: {
      const _never: never = finish;
      return _never;
    }
  }
}

export function brokenEdgeColor(material: Material): number {
  const c = matColors(material);
  return shade(c.dark, 0.72);
}

/** Roof slope brightness from fixed light, not camera facing. */
export function roofSlopeLight(verts: { x: number; y: number; z: number }[]): number {
  if (verts.length < 3) return 0;
  const a = verts[0]!;
  const b = verts[1]!;
  const c = verts[2]!;
  let nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
  let ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
  let nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (nz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return (nx * LIGHT_DIR.x + ny * LIGHT_DIR.y) / len;
}
