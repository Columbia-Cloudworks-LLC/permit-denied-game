import { Graphics } from "pixi.js";
import { FLOOR_Z } from "../game/constants";
import { isoQuad, worldToScreen } from "../world/iso";
import { PAL, matColors } from "./palette";

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

export function cellColors(material: string, cracked: boolean): { top: number; left: number; right: number } {
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

export { PAL, matColors };
