import { Graphics } from "pixi.js";
import { orientedRect } from "../game/math";
import type { Material } from "../structure/types";
import { ISO_H, ISO_W, ISO_Z } from "../game/constants";
import { depthKey, isoQuad, worldToScreen } from "../world/iso";
import { roofSlopeLight, shadowFill } from "./lighting";
import { PAL, matColors, shade } from "./palette";

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
  z = 0,
): void {
  const q = isoQuad(x, y, w, d, z);
  g.poly(q);
  g.fill({ color, alpha });
}

export function drawOrientedGround(
  g: Graphics,
  cx: number,
  cy: number,
  heading: number,
  length: number,
  width: number,
  color: number,
  alpha = 1,
  z = 0,
): void {
  const q = orientedRect(cx, cy, heading, length, width).flatMap((p) => {
    const s = worldToScreen(p.x, p.y, z);
    return [s.x, s.y];
  });
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
  slope = false,
): void {
  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  const rx = -fy;
  const ry = fx;
  const hl = length * 0.5;
  const hw = width * 0.5;
  // Corner k: world x/y, then screen x and bottom/lid y. Scratch is reused across calls.
  for (let k = 0; k < 4; k++) {
    const a = k < 2 ? hl : -hl;
    const c = k === 1 || k === 2 ? hw : -hw;
    const wx = cx + fx * a + rx * c;
    const wy = cy + fy * a + ry * c;
    BOX_WX[k] = wx;
    BOX_WY[k] = wy;
    BOX_SX[k] = (wx - wy) * ISO_W;
    BOX_BOT[k] = (wx + wy) * ISO_H - z0 * ISO_Z;
    BOX_LID[k] = (wx + wy) * ISO_H - (z0 + h * (slope ? (hw - c) / width : 1)) * ISO_Z;
  }
  boxSides(g, z0 + h * 0.5, left, right, alpha);
  g.poly([BOX_SX[0]!, BOX_LID[0]!, BOX_SX[1]!, BOX_LID[1]!, BOX_SX[2]!, BOX_LID[2]!, BOX_SX[3]!, BOX_LID[3]!]);
  g.fill({ color: top, alpha });
}

/** A box shows at most two side faces; paint the farther one first. */
function boxSides(g: Graphics, zMid: number, left: number, right: number, alpha: number): void {
  let first = -1, second = -1, firstDepth = 0;
  for (let i0 = 0; i0 < 4; i0++) {
    const i1 = (i0 + 1) & 3;
    // Outward normal of edge i0 -> i1; only faces turned toward the camera show.
    if (BOX_WY[i1]! - BOX_WY[i0]! - (BOX_WX[i1]! - BOX_WX[i0]!) <= 0.001) continue;
    const depth = depthKey((BOX_WX[i0]! + BOX_WX[i1]!) * 0.5, (BOX_WY[i0]! + BOX_WY[i1]!) * 0.5, zMid);
    if (first >= 0 && depth >= firstDepth) second = i0;
    else { second = first; first = i0; firstDepth = depth; }
  }
  if (first >= 0) boxFace(g, first, left, right, alpha);
  if (second >= 0) boxFace(g, second, left, right, alpha);
}

const BOX_WX = new Float64Array(4);
const BOX_WY = new Float64Array(4);
const BOX_SX = new Float64Array(4);
const BOX_BOT = new Float64Array(4);
const BOX_LID = new Float64Array(4);

/** One side face of the scratch box, from corner i0 to the next, shaded by how far it turns from the light. */
function boxFace(g: Graphics, i0: number, left: number, right: number, alpha: number): void {
  const i1 = (i0 + 1) & 3;
  const nx = BOX_WY[i1]! - BOX_WY[i0]!;
  const ny = -(BOX_WX[i1]! - BOX_WX[i0]!);
  const nl = Math.hypot(nx, ny) || 1;
  const t = (nx / nl - ny / nl) * 0.5 + 0.5;
  g.poly([BOX_SX[i0]!, BOX_LID[i0]!, BOX_SX[i1]!, BOX_LID[i1]!, BOX_SX[i1]!, BOX_BOT[i1]!, BOX_SX[i0]!, BOX_BOT[i0]!]);
  g.fill({ color: mixHex(left, right, t), alpha });
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
  drawTop = true,
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
  if (drawTop) {
    g.poly([t00.x, t00.y, t10.x, t10.y, t11.x, t11.y, t01.x, t01.y]);
    g.fill({ color: top, alpha });
  }
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

/** @deprecated Use roofSlopeLight — fixed sun, not camera facing. */
export function slopeFacingLight(verts: { x: number; y: number; z: number }[]): number {
  return roofSlopeLight(verts);
}

export function drawTopCap(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  d: number,
  z: number,
  color: number,
  alpha = 1,
): void {
  const t00 = worldToScreen(x, y, z);
  const t10 = worldToScreen(x + w, y, z);
  const t11 = worldToScreen(x + w, y + d, z);
  const t01 = worldToScreen(x, y + d, z);
  g.poly([t00.x, t00.y, t10.x, t10.y, t11.x, t11.y, t01.x, t01.y]);
  g.fill({ color, alpha });
}

export function drawWorldPoly(
  g: Graphics,
  verts: { x: number; y: number; z: number }[],
  fill: number,
  alpha = 1,
): void {
  if (verts.length < 3) return;
  const pts = verts.flatMap((v) => {
    const p = worldToScreen(v.x, v.y, v.z);
    return [p.x, p.y];
  });
  g.poly(pts);
  g.fill({ color: fill, alpha });
}

/** One projected polygon. No stroke or edge extrusion — those sit on top of the wall eave. */
export function drawSlopedQuad(
  g: Graphics,
  verts: { x: number; y: number; z: number }[],
  top: number,
  _edge: number,
  alpha = 1,
): void {
  if (verts.length < 3) return;
  const screen = verts.map((v) => worldToScreen(v.x, v.y, v.z));
  const pts = screen.flatMap((p) => [p.x, p.y]);
  g.poly(pts);
  g.fill({ color: top, alpha });
}

export function drawShadow(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  d: number,
  alpha = 0.28,
): void {
  const fill = shadowFill(alpha);
  drawGroundPoly(g, x, y, w, d, fill.color, fill.alpha);
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

export { PAL };
