import { Graphics } from "pixi.js";
import { FLOOR_Z } from "../game/constants";
import { gableEndCaps, gableWallVerts, shedWallVerts } from "../structure/roof";
import { cellWorldBox, type Building, type Cell } from "../structure/types";
import type { WallSpan } from "./buildingSurfaces";
import { southFacadeCells } from "./buildingSurfaces";
import { drawFaceWindow, drawIsoBox, drawShadow, drawWorldPoly } from "./drawIso";
import { drawThickBrokenWall } from "./interiorDraw";
import { topFaceColor, wallFaceColor } from "./lighting";
import { PAL } from "./palette";
import { worldToScreen } from "../world/iso";

const STORY_H = FLOOR_Z;

export function drawWallSpan(g: Graphics, b: Building, span: WallSpan, alpha: number): void {
  if (b.construction.skin === 'glass') {
    drawGlassWallSpan(g, b, span, alpha);
    return;
  }
  const mat = span.dir === "south" && span.floor === 0 ? span.facadeMaterial : span.material;
  const color = wallFaceColor(mat, span.dir, span.visual !== "intact");
  if (span.dir === "south") drawSouthWall(g, b, span, mat, color, alpha);
  else drawEastWall(g, b, span, mat, color, alpha);
}

/** A broken edge pulls the face in a little to show the wall's cut thickness. */
const brokenInset = (span: WallSpan) => span.visual === "broken-edge" ? 0.06 : 0;

function drawSouthWall(g: Graphics, b: Building, span: WallSpan, mat: Cell["material"], color: number, alpha: number): void {
  const cs = b.cellSize;
  const z0 = span.floor * FLOOR_Z;
  const z1 = z0 + STORY_H;
  const x0 = b.x + span.gx0 * cs;
  const y1 = b.y + (span.gy0 + 1) * cs - brokenInset(span);
  const w = (span.gx1 - span.gx0 + 1) * cs;
  if (!drawPitchedWall(g, b, span, color, alpha, z0, x0, x0 + w, y1)) {
    drawFaceWindow(g, x0, y1, x0 + w, y1, z0, z1, 0, 1, 0, 1, color, alpha);
  }
  drawSurfacePattern(g, mat, x0, y1, x0 + w, y1, z0, z1, alpha);
  if (span.floor === 0) {
    drawFaceWindow(g, x0, y1, x0 + w, y1, z0, z1, 0, 1, 0, 0.1, PAL.foundation, alpha * 0.65);
  }
  if (span.visual === "cracked") drawFaceCracks(g, span.gx1 - span.gx0 + 1, b.id * 31 + span.gx0 * 7 + span.floor, x0, y1, x0 + w, y1, z0, z1, alpha);
  if (span.visual === "broken-edge") {
    drawThickBrokenWall(g, b, "south", x0, y1, w, z0, mat, alpha);
  }
  drawSouthFacadeDecor(g, b, span, alpha);
}

/** Stable 0..1 jitter for a crack vertex, so cached facades redraw the same fracture. */
const crackJitter = (seed: number, i: number) => {
  const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * A stressed wall shows a fracture per cell: a jagged run from an upper impact point
 * down the face, with one branch, over a darker spall where the blow landed.
 */
export function drawFaceCracks(
  g: Graphics, cells: number, seed: number,
  x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, alpha: number,
): void {
  const at = (u: number, v: number) => worldToScreen(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, z0 + (z1 - z0) * v);
  for (let cell = 0; cell < cells; cell++) {
    const s = seed + cell * 13, left = cell / cells, span = 1 / cells;
    const u0 = left + span * (0.3 + crackJitter(s, 0) * 0.4), v0 = 0.62 + crackJitter(s, 1) * 0.22;
    drawFaceWindow(g, x0, y0, x1, y1, z0, z1, u0 - span * 0.07, u0 + span * 0.07, v0 - 0.06, v0 + 0.06, PAL.crack, alpha * 0.3);
    const run = [at(u0, v0)];
    for (let i = 1; i <= 4; i++) run.push(at(u0 + (crackJitter(s, i + 1) - 0.5) * span * 0.34, v0 - i * (v0 - 0.08) / 4));
    g.poly(run.flatMap(p => [p.x, p.y]), false);
    const fork = run[2]!, tip = at(u0 + (crackJitter(s, 7) > 0.5 ? 1 : -1) * span * 0.28, v0 * 0.62 + 0.12);
    g.moveTo(fork.x, fork.y).lineTo(tip.x, tip.y);
    g.stroke({ color: PAL.crack, width: 1.3, alpha: alpha * 0.8, join: "miter" });
  }
}

function drawEastWall(g: Graphics, b: Building, span: WallSpan, mat: Cell["material"], color: number, alpha: number): void {
  const cs = b.cellSize;
  const z0 = span.floor * FLOOR_Z;
  const z1 = z0 + STORY_H;
  const x1 = b.x + (span.gx0 + 1) * cs - brokenInset(span);
  const y0 = b.y + span.gy0 * cs;
  const d = (span.gy1 - span.gy0 + 1) * cs;
  if (!drawPitchedWall(g, b, span, color, alpha, z0, y0, y0 + d, x1)) {
    drawFaceWindow(g, x1, y0, x1, y0 + d, z0, z1, 0, 1, 0, 1, color, alpha);
  }
  drawSurfacePattern(g, mat, x1, y0, x1, y0 + d, z0, z1, alpha);
  if (span.floor === 0) {
    drawFaceWindow(g, x1, y0, x1, y0 + d, z0, z1, 0, 1, 0, 0.1, PAL.foundation, alpha * 0.5);
  }
  if (span.visual === "cracked") drawFaceCracks(g, span.gy1 - span.gy0 + 1, b.id * 37 + span.gy0 * 11 + span.floor, x1, y0, x1, y0 + d, z0, z1, alpha);
  if (span.visual === "broken-edge") {
    drawThickBrokenWall(g, b, "east", x1, y0, d, z0, mat, alpha);
  }
  drawEastWindows(g, b, span, alpha, z0, z1);
}

function drawGlassWallSpan(g: Graphics, b: Building, span: WallSpan, alpha: number): void {
  const cs = b.cellSize, z0 = span.floor * STORY_H, z1 = z0 + STORY_H;
  const south = span.dir === 'south';
  const a = south ? b.x + span.gx0 * cs : b.y + span.gy0 * cs;
  const end = south ? b.x + (span.gx1 + 1) * cs : b.y + (span.gy1 + 1) * cs;
  const plane = south ? b.y + (span.gy0 + 1) * cs : b.x + (span.gx0 + 1) * cs;
  const ax = south ? a : plane, ay = south ? plane : a;
  const bx = south ? end : plane, by = south ? plane : end;
  if (!drawPitchedWall(g, b, span, PAL.glassLit, alpha * .28, z0, a, end, plane))
    drawFaceWindow(g, ax, ay, bx, by, z0, z1, 0, 1, 0, 1, PAL.glassLit, alpha * .28);
  const count = south ? span.gx1 - span.gx0 + 1 : span.gy1 - span.gy0 + 1;
  for (let i = 0; i <= count; i++) {
    const u = i / count, half = .035 / Math.max(cs, end - a);
    drawFaceWindow(g, ax, ay, bx, by, z0, z1, Math.max(0, u - half), Math.min(1, u + half), 0, 1, PAL.metal, alpha);
  }
  for (const v of [.03, .5, .97]) drawFaceWindow(g, ax, ay, bx, by, z0, z1, 0, 1, v, Math.min(1, v + .025), PAL.metal, alpha);
}

function drawSurfacePattern(g: Graphics, material: Cell["material"], ax: number, ay: number, bx: number, by: number, z0: number, z1: number, alpha: number): void {
  const length = Math.hypot(bx - ax, by - ay);
  if (material === "brick") {
    for (let row = 1; row < 8; row++) {
      const v = row / 8;
      drawFaceWindow(g, ax, ay, bx, by, z0, z1, 0, 1, v, v + .008, PAL.frame, alpha * .15);
      for (let along = (row % 2) * .32; along < length; along += .64) {
        const u = along / length;
        drawFaceWindow(g, ax, ay, bx, by, z0, z1, u, Math.min(1, u + .012 / length), v, v + .12, PAL.frame, alpha * .13);
      }
    }
  } else if (material === "metal") {
    for (let along = .35; along < length; along += .35) {
      const u = along / length;
      drawFaceWindow(g, ax, ay, bx, by, z0, z1, u, Math.min(1, u + .018 / length), 0, 1, PAL.metalTop, alpha * .22);
    }
  }
}

function drawPitchedWall(
  g: Graphics,
  b: Building,
  span: WallSpan,
  color: number,
  alpha: number,
  z0: number,
  along0: number,
  along1: number,
  plane: number,
): boolean {
  const cap = gableEndCaps(b, span.floor).find((c) => c.face === span.dir &&
    Math.abs((span.dir === 'south' ? c.a.y : c.a.x) - plane) < .2 &&
    along0 >= (span.dir === 'south' ? c.a.x : c.a.y) - .01 &&
    along1 <= (span.dir === 'south' ? c.b.x : c.b.y) + .01);
  if (cap) {
    drawWorldPoly(g, gableWallVerts(cap, along0, along1, plane, z0), color, alpha);
    return true;
  }
  const shed = shedWallVerts({ ...b, floors: span.floor + 1, roofs: b.roofs.filter(r => r.floor === span.floor) }, span.dir, along0, along1, plane, z0);
  if (!shed) return false;
  drawWorldPoly(g, shed, color, alpha);
  return true;
}

function drawEastWindows(
  g: Graphics,
  b: Building,
  span: WallSpan,
  alpha: number,
  z0: number,
  z1: number,
): void {
  const cs = b.cellSize;
  const x1 = b.x + (span.gx0 + 1) * cs;
  for (let gy = span.gy0; gy <= span.gy1; gy++) {
    const cell = b.grid[span.floor]![span.gx0]![gy]!;
    if (!cell.windowE) continue;
    const y0 = b.y + gy * cs;
    const glass = cell.state === "cracked" ? PAL.glass : PAL.glassLit;
    drawFaceWindow(g, x1, y0, x1, y0 + cs, z0, z1, 0.28, 0.72, 0.28, 0.72, glass, alpha);
  }
}

/** One story-high cell bay on a south facade. */
interface SouthBay { g: Graphics; x0: number; y1: number; cs: number; z0: number; alpha: number }

/** Paint a rectangle in bay-relative (u across, v up) coordinates. */
function bayRect(bay: SouthBay, u0: number, u1: number, v0: number, v1: number, color: number, alpha: number): void {
  drawFaceWindow(bay.g, bay.x0, bay.y1, bay.x0 + bay.cs, bay.y1, bay.z0, bay.z0 + STORY_H, u0, u1, v0, v1, color, alpha);
}

function bayFrame(bay: SouthBay, fill: number, u0: number, u1: number): void {
  drawFramedBay(bay.g, bay.x0, bay.y1, bay.cs, bay.z0, STORY_H, fill, PAL.frame, bay.alpha, u0, u1);
}

function drawSouthFacadeDecor(g: Graphics, b: Building, span: WallSpan, alpha: number): void {
  const cs = b.cellSize;
  const z0 = span.floor * FLOOR_Z;
  const y1 = b.y + (span.gy0 + 1) * cs;
  for (const cell of southFacadeCells(b, span)) drawSouthCell({ g, x0: b.x + cell.gx * cs, y1, cs, z0, alpha }, b, span, cell);
}

/** A loading bay or door fills its cell; otherwise a window, then a mid-height belt course on masonry looks. */
function drawSouthCell(bay: SouthBay, b: Building, span: WallSpan, cell: Cell): void {
  if (cell.loadingS) {
    bayFrame(bay, PAL.metalDark, 0.04, 0.9);
    bayRect(bay, 0.12, 0.88, 0.08, 0.78, PAL.metal, bay.alpha * 0.85);
    return;
  }
  if (cell.doorS) {
    drawDoorBay(bay, b, cell);
    return;
  }
  if (cell.windowS || (b.theme === "colonial" && span.floor > 0) || (b.construction.walls === "masonry" && span.floor === 0)) {
    drawSouthWindow(bay, b, span.floor, cell.state === "cracked" ? PAL.glass : PAL.glassLit);
  }
  if (span.material === "brick" || b.theme === "colonial" || b.theme === "corner") {
    bayRect(bay, 0, 1, 0.46, 0.54, wallFaceColor(span.facadeMaterial, "south"), bay.alpha * 0.22);
  }
}

/** Door bay by building: garage door, glazed shopfront, civic entry, or a plain house door. */
function drawDoorBay(bay: SouthBay, b: Building, cell: Cell): void {
  const { alpha } = bay;
  if (b.features.garage && cell.gx >= b.w - 2) {
    bayFrame(bay, PAL.woodDark, 0.05, 0.92);
    bayRect(bay, 0.1, 0.9, 0.1, 0.82, PAL.woodDark, alpha);
  } else if (b.theme === "storefront" || b.theme === "corner") {
    bayFrame(bay, PAL.glass, 0.08, 0.88);
    bayRect(bay, 0.12, 0.88, 0.05, 0.72, PAL.glassLit, alpha * 0.9);
  } else if (b.theme === "civic") {
    bayFrame(bay, PAL.concreteDark, 0.1, 0.85);
    bayRect(bay, 0.15, 0.85, 0.05, 0.7, PAL.concrete, alpha);
  } else {
    bayFrame(bay, PAL.woodDark, 0.28, 0.68);
    bayRect(bay, 0.32, 0.68, 0.02, 0.58, PAL.woodDark, alpha);
  }
  const { g, x0, y1, cs, z0 } = bay;
  if (b.features.awning) {
    drawIsoBox(g, x0 - 0.04, y1 - cs * 0.28, cs + 0.08, 0.38, z0 + STORY_H * 0.62, 0.1, PAL.awning, PAL.brickDark, PAL.awning, alpha);
  }
  if (b.features.porch) {
    drawIsoBox(g, x0 + cs * 0.15, y1 - cs * 0.18, cs * 0.7, 0.55, 0, 0.12, PAL.woodTop, PAL.woodDark, PAL.wood, alpha);
  }
}

/** Framed upper sash, colonial pair, shop glazing, civic or plain ground-floor window. */
function drawSouthWindow(bay: SouthBay, b: Building, floor: number, glass: number): void {
  const { alpha } = bay;
  if (floor > 0) {
    bayRect(bay, .22, .78, .25, .78, PAL.frame, alpha);
    bayRect(bay, .27, .73, .3, .73, glass, alpha);
  } else if (b.theme === "colonial") {
    bayRect(bay, 0.18, 0.46, 0.32, 0.7, glass, alpha);
    bayRect(bay, 0.54, 0.82, 0.32, 0.7, glass, alpha);
  } else if (b.theme === "storefront" || b.theme === "corner") {
    drawFramedBay(bay.g, bay.x0, bay.y1, bay.cs, bay.z0, STORY_H, glass, PAL.frame, alpha, 0.06, 0.88);
    bayRect(bay, 0.1, 0.9, 0.2, 0.78, glass, alpha * 0.92);
  } else if (b.theme === "civic") {
    bayRect(bay, 0.2, 0.8, 0.25, 0.72, glass, alpha);
  } else {
    bayRect(bay, 0.28, 0.72, 0.28, 0.72, glass, alpha);
  }
}

function drawFramedBay(
  g: Graphics,
  x0: number,
  y1: number,
  w: number,
  z0: number,
  h: number,
  fill: number,
  frame: number,
  alpha: number,
  u0: number,
  u1: number,
): void {
  drawFaceWindow(g, x0, y1, x0 + w, y1, z0, z0 + h, u0, u1, 0, 0.08, frame, alpha);
  drawFaceWindow(g, x0, y1, x0 + w, y1, z0, z0 + h, u0, u1, 0.92, 1, frame, alpha);
  drawFaceWindow(g, x0, y1, x0 + w, y1, z0, z0 + h, u0, u0 + 0.04, 0, 1, frame, alpha);
  drawFaceWindow(g, x0, y1, x0 + w, y1, z0, z0 + h, u1 - 0.04, u1, 0, 1, frame, alpha);
  drawFaceWindow(g, x0, y1, x0 + w, y1, z0, z0 + h, u0 + 0.04, u1 - 0.04, 0.08, 0.88, fill, alpha * 0.75);
}

export function drawFallingCell(g: Graphics, b: Building, cell: Cell, alpha: number): void {
  {
    const box = cellWorldBox(b, cell);
    const t = cell.fallT;
    const h = cell.role === "column" ? FLOOR_Z : FLOOR_Z * .8;
    drawIsoBox(g, box.x + cell.fallDx * t, box.y + cell.fallDy * t, box.w + t * .5, box.d + t * .35,
      Math.max(.08, cell.floor * FLOOR_Z * (1 - t)), h * (1 - t * .85),
      topFaceColor(cell.material, true), wallFaceColor(cell.material, "south", true), wallFaceColor(cell.material, "east", true), alpha);
  }
}

export function drawBuildingFootprintShadow(
  g: Graphics,
  footprint: { x: number; y: number; w: number; d: number },
  alpha: number,
): void {
  drawShadow(g, footprint.x, footprint.y, footprint.w, footprint.d, 0.2 * alpha);
}
