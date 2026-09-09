import { Graphics } from "pixi.js";
import { FLOOR_Z } from "../game/constants";
import type { Material } from "../structure/types";
import { depthKey, isoQuad, worldToScreen } from "../world/iso";
import { PAL, matColors } from "./palette";

export function headingOffset(
  x: number,
  y: number,
  heading: number,
  along: number,
  across: number,
): { x: number; y: number } {
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  return { x: x + fx * along - fy * across, y: y + fy * along + fx * across };
}

export function drawGroundPoly(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  d: number,
  color: number,
  alpha = 1,
): void {
  const q = isoQuad(x, y, w, d, 0);
  g.poly(q);
  g.fill({ color, alpha });
}

export function drawOrientedIsoBox(
  g: Graphics,
  cx: number,
  cy: number,
  heading: number,
  length: number,
  width: number,
  z0: number,
  h: number,
  top: number,
  left: number,
  right: number,
  alpha = 1,
): void {
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  const rx = -fy;
  const ry = fx;
  const hl = length * 0.5;
  const hw = width * 0.5;
  const local = [
    { a: hl, c: -hw },
    { a: hl, c: hw },
    { a: -hl, c: hw },
    { a: -hl, c: -hw },
  ];
  const world = local.map((p) => ({
    x: cx + fx * p.a + rx * p.c,
    y: cy + fy * p.a + ry * p.c,
  }));
  const bot = world.map((p) => worldToScreen(p.x, p.y, z0));
  const lid = world.map((p) => worldToScreen(p.x, p.y, z0 + h));

  const faces: { depth: number; color: number; pts: number[] }[] = [];
  const edges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ] as const;
  for (const [i0, i1] of edges) {
    const ex = world[i1]!.x - world[i0]!.x;
    const ey = world[i1]!.y - world[i0]!.y;
    const nx = ey;
    const ny = -ex;
    if (nx + ny <= 0.001) continue;
    const nl = Math.hypot(nx, ny) || 1;
    const t = (nx / nl - ny / nl) * 0.5 + 0.5;
    faces.push({
      depth: depthKey((world[i0]!.x + world[i1]!.x) * 0.5, (world[i0]!.y + world[i1]!.y) * 0.5, z0 + h * 0.5),
      color: mixHex(left, right, t),
      pts: [lid[i0]!.x, lid[i0]!.y, lid[i1]!.x, lid[i1]!.y, bot[i1]!.x, bot[i1]!.y, bot[i0]!.x, bot[i0]!.y],
    });
  }
  faces.sort((a, b) => a.depth - b.depth);
  for (const face of faces) {
    g.poly(face.pts);
    g.fill({ color: face.color, alpha });
  }
  g.poly([lid[0]!.x, lid[0]!.y, lid[1]!.x, lid[1]!.y, lid[2]!.x, lid[2]!.y, lid[3]!.x, lid[3]!.y]);
  g.fill({ color: top, alpha });
}

export function drawIsoBox(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  d: number,
  z0: number,
  h: number,
  top: number,
  left: number,
  right: number,
  alpha = 1,
): void {
  const t00 = worldToScreen(x, y, z0 + h);
  const t10 = worldToScreen(x + w, y, z0 + h);
  const t11 = worldToScreen(x + w, y + d, z0 + h);
  const t01 = worldToScreen(x, y + d, z0 + h);
  const b10 = worldToScreen(x + w, y, z0);
  const b11 = worldToScreen(x + w, y + d, z0);
  const b01 = worldToScreen(x, y + d, z0);

  g.poly([t10.x, t10.y, t11.x, t11.y, b11.x, b11.y, b10.x, b10.y]);
  g.fill({ color: right, alpha });
  g.poly([t01.x, t01.y, t11.x, t11.y, b11.x, b11.y, b01.x, b01.y]);
  g.fill({ color: left, alpha });
  g.poly([t00.x, t00.y, t10.x, t10.y, t11.x, t11.y, t01.x, t01.y]);
  g.fill({ color: top, alpha });
}

export function drawFaceWindow(
  g: Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z0: number,
  z1: number,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  color: number,
  alpha: number,
): void {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const p = (u: number, v: number) => {
    const x = lerp(x0, x1, u);
    const y = lerp(y0, y1, u);
    const z = lerp(z0, z1, v);
    return worldToScreen(x, y, z);
  };
  const a = p(u0, v1);
  const b = p(u1, v1);
  const c = p(u1, v0);
  const e = p(u0, v0);
  g.poly([a.x, a.y, b.x, b.y, c.x, c.y, e.x, e.y]);
  g.fill({ color, alpha });
}

export function drawShadow(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  d: number,
  alpha = 0.28,
): void {
  drawGroundPoly(g, x, y, w, d, PAL.shadow, alpha);
}

export function floorZ(floor: number): number {
  return floor * FLOOR_Z;
}

export function cellColors(material: Material, cracked: boolean): { top: number; left: number; right: number } {
  const c = matColors(material);
  if (!cracked) return { top: c.top, left: c.dark, right: c.side };
  return {
    top: shade(c.top, 0.82),
    left: shade(c.dark, 0.85),
    right: shade(c.side, 0.85),
  };
}

function shade(color: number, mul: number): number {
  const r = Math.round(((color >> 16) & 255) * mul);
  const g = Math.round(((color >> 8) & 255) * mul);
  const b = Math.round((color & 255) * mul);
  return (r << 16) | (g << 8) | b;
}

function mixHex(a: number, b: number, t: number): number {
  const u = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * u) << 16) |
    (Math.round(ag + (bg - ag) * u) << 8) |
    Math.round(ab + (bb - ab) * u)
  );
}

export { PAL, matColors };
