import type { Graphics } from "pixi.js";
import { FLOOR_Z } from "../game/constants";
import { awningStyled, faceWindowed, facadeTrimPlan, trimItemsAt, trimKey, trimRoll, type FacadeTrimPlan, type FaceSide, type TrimItemKind } from "../structure/facadeTrim";
import type { Building, Cell, Material } from "../structure/types";
import type { WallSpan } from "./buildingSurfaces";
import { drawFaceWindow, drawIsoBox, drawWorldPoly } from "./drawIso";
import { PAL, shade } from "./palette";
import { wallTone, wallTrimTone } from "./wallPaint";

/** One cell face: `a` to `b` along its foot, `u` across it, `v` up it, `out` away from the wall. */
interface FacePen {
  g: Graphics; side: FaceSide;
  ax: number; ay: number; bx: number; by: number;
  z0: number; alpha: number;
}

const STEEL = 0x8b908c, STEEL_DARK = 0x4e5452, LAMP = 0xf4e8b0, CONCRETE = 0xa8a494, CMU = 0x9c988a;
const SHUTTERS: readonly number[] = [0x2f4a3a, 0x2c3e55, 0x5c241f, 0x2a2a28, 0x6a5a40];
const AWNING_FABRIC: readonly number[] = [PAL.awning, 0x2f5a4a, 0x2c4a6e, 0xa8782a, 0x7a3a5a];
const AWNING_STRIPE = 0xe8dcc0;
const BLADE_SIGNS: readonly number[] = [0x8d4239, 0x2f5a4a, 0x2f4a6a, 0xb58a2e];

/** Flat colours on the shaded south face sit darker than on the sunlit east face. */
const faceTone = (pen: FacePen, color: number): number => shade(color, pen.side === "east" ? 0.92 : 0.64);

function rect(pen: FacePen, u0: number, u1: number, v0: number, v1: number, color: number, alpha = 1): void {
  drawFaceWindow(pen.g, pen.ax, pen.ay, pen.bx, pen.by, pen.z0, pen.z0 + FLOOR_Z, u0, u1, v0, v1, color, pen.alpha * alpha);
}

/** A block standing `out0`..`out1` off the wall. */
function box(pen: FacePen, u0: number, u1: number, out0: number, out1: number, v0: number, v1: number, color: number): void {
  const south = pen.side === "south";
  const along0 = (south ? pen.ax : pen.ay) + (south ? pen.bx - pen.ax : pen.by - pen.ay) * u0;
  const along = (south ? pen.bx - pen.ax : pen.by - pen.ay) * (u1 - u0);
  const x = south ? along0 : pen.ax + out0, y = south ? pen.ay + out0 : along0;
  drawIsoBox(pen.g, x, y, south ? along : out1 - out0, south ? out1 - out0 : along, pen.z0 + v0 * FLOOR_Z, (v1 - v0) * FLOOR_Z,
    color, shade(color, 0.62), shade(color, 0.84), pen.alpha);
}

/** A point `out` off the wall at face coordinates (u, v). */
function at(pen: FacePen, u: number, v: number, out: number): { x: number; y: number; z: number } {
  const south = pen.side === "south";
  return {
    x: pen.ax + (pen.bx - pen.ax) * u + (south ? 0 : out),
    y: pen.ay + (pen.by - pen.ay) * u + (south ? out : 0),
    z: pen.z0 + v * FLOOR_Z,
  };
}

/** The glazed opening the wall renderer draws on a windowed cell: u0, u1, v0, v1. */
function windowBox(b: Building, side: FaceSide, floor: number): readonly [number, number, number, number] {
  if (side === "east") return [0.28, 0.72, 0.28, 0.72];
  if (floor > 0) return [0.22, 0.78, 0.25, 0.78];
  if (b.theme === "colonial") return [0.18, 0.82, 0.32, 0.7];
  if (b.theme === "civic") return [0.2, 0.8, 0.25, 0.72];
  return [0.28, 0.72, 0.28, 0.72];
}

const shopfront = (b: Building): boolean => b.theme === "storefront" || b.theme === "corner";

/**
 * Procedural trim for one wall run: masonry articulation, window dressing, door furniture and
 * mounted gear, cell by cell. Runs inside the wall's own draw command, so it is cached with the
 * wall and never outlives a cell: a run only holds standing, unbreached cells.
 */
export function drawSpanTrim(g: Graphics, b: Building, span: WallSpan, material: Material, alpha: number): void {
  const plan = facadeTrimPlan(b);
  const south = span.dir === "south", cs = b.cellSize;
  const wall = wallTone(b, material, span.dir), trim = wallTrimTone(b, material, span.dir);
  const count = south ? span.gx1 - span.gx0 + 1 : span.gy1 - span.gy0 + 1;
  for (let i = 0; i < count; i++) {
    const gx = span.gx0 + (south ? i : 0), gy = span.gy0 + (south ? 0 : i);
    const cell = b.grid[span.floor]?.[gx]?.[gy];
    if (!cell || plan.claimed.has(trimKey(span.dir, span.floor, gx, gy))) continue;
    const x = b.x + (gx + (south ? 0 : 1)) * cs, y = b.y + (gy + (south ? 1 : 0)) * cs;
    const pen: FacePen = { g, side: span.dir, ax: x, ay: y, bx: south ? x + cs : x, by: south ? y : y + cs, z0: span.floor * FLOOR_Z, alpha };
    drawMasonry(pen, b, plan, cell, wall, trim);
    if (faceWindowed(b, cell, span.dir) && !(south && cell.floor === 0 && shopfront(b))) drawWindowTrim(pen, b, plan, cell, wall, trim);
    if (cell.state !== "intact") continue;
    if (south && cell.doorS) drawDoorTrim(pen, b, plan, cell);
    for (const item of trimItemsAt(plan, cell, span.dir)) ITEM_PAINTERS[item](pen, b, plan, cell);
  }
}

/** Plinth, stringcourse, roofline frieze and corner dressing: part of the wall, so they stay on a cracked cell. */
function drawMasonry(pen: FacePen, b: Building, plan: FacadeTrimPlan, cell: Cell, wall: number, trim: number): void {
  const south = pen.side === "south";
  const opening = south && (cell.doorS || cell.loadingS || (cell.floor === 0 && shopfront(b) && faceWindowed(b, cell, "south")));
  if (plan.plinth !== "none" && cell.floor === 0 && !opening) {
    const stone = plan.plinth === "stone" ? trim : faceTone(pen, CMU);
    rect(pen, 0, 1, 0, 0.2, stone);
    rect(pen, 0, 1, 0.2, 0.225, shade(stone, 1.14));
    if (plan.plinth === "cmu") { rect(pen, 0, 1, 0.095, 0.105, PAL.frame, 0.3); rect(pen, 0.495, 0.505, 0, 0.2, PAL.frame, 0.3); }
  }
  const top = !b.grid[cell.floor + 1]?.[cell.gx]?.[cell.gy];
  if (plan.belt && !top) rect(pen, 0, 1, 0.945, 1, trim);
  if (top && plan.cornice === "corbel") {
    const band = shade(wall, 0.78);
    rect(pen, 0, 1, 0.88, 1, band);
    for (let k = 0; k < 3; k++) rect(pen, 0.08 + k * 0.33, 0.26 + k * 0.33, 0.835, 0.88, band);
  } else if (top && plan.cornice === "cornice") {
    rect(pen, 0, 1, 0.9, 1, trim);
    rect(pen, 0, 1, 0.875, 0.9, shade(trim, 0.7));
  }
  if (plan.corners === "none") return;
  const lead = south ? cell.exterior.west : cell.exterior.north, trail = south ? cell.exterior.east : cell.exterior.south;
  if (lead) drawCorner(pen, plan.corners, cell.floor, trim, false);
  if (trail) drawCorner(pen, plan.corners, cell.floor, trim, true);
}

function drawCorner(pen: FacePen, kind: "quoins" | "pilasters", floor: number, trim: number, trailing: boolean): void {
  const edge = (w: number, v0: number, v1: number, color: number) => trailing ? rect(pen, 1 - w, 1, v0, v1, color) : rect(pen, 0, w, v0, v1, color);
  if (kind === "pilasters") {
    edge(0.13, 0, 1, trim);
    edge(0.17, 0.93, 1, shade(trim, 1.12));
    if (floor === 0) edge(0.17, 0, 0.06, shade(trim, 0.85));
    return;
  }
  for (let k = 0; k < 5; k++) edge((k + floor) % 2 ? 0.1 : 0.17, k * 0.2 + 0.012, k * 0.2 + 0.188, trim);
}

function drawWindowTrim(pen: FacePen, b: Building, plan: FacadeTrimPlan, cell: Cell, wall: number, trim: number): void {
  const [u0, u1, v0, v1] = windowBox(b, pen.side, cell.floor);
  if (plan.sills) rect(pen, u0 - 0.04, u1 + 0.04, v0 - 0.04, v0, trim);
  if (plan.lintels === "flat") rect(pen, u0 - 0.04, u1 + 0.04, v1, v1 + 0.055, trim);
  else if (plan.lintels === "soldier") rect(pen, u0 - 0.02, u1 + 0.02, v1, v1 + 0.07, shade(wall, 0.72));
  if (!plan.shutters) return;
  const color = faceTone(pen, SHUTTERS[Math.floor(trimRoll(plan.seed, 20) * SHUTTERS.length)]!);
  rect(pen, u0 - 0.12, u0 - 0.015, v0, v1, color);
  rect(pen, u1 + 0.015, u1 + 0.12, v0, v1, color);
}

/** Street-door furniture: the awning in its rolled style, plus a transom light and an entry lamp on a walk-in door. */
function drawDoorTrim(pen: FacePen, b: Building, plan: FacadeTrimPlan, cell: Cell): void {
  const wide = shopfront(b) || b.theme === "civic", garage = b.features.garage && cell.gx >= b.w - 2;
  if (plan.transom && !garage) {
    const [u0, u1, v0, v1] = wide ? [0.14, 0.86, 0.77, 0.89] : [0.3, 0.66, 0.61, 0.71];
    rect(pen, u0, u1, v0, v1, PAL.frame);
    rect(pen, u0 + 0.03, u1 - 0.03, v0 + 0.02, v1 - 0.02, PAL.glassLit);
    rect(pen, (u0 + u1) / 2 - 0.008, (u0 + u1) / 2 + 0.008, v0, v1, PAL.frame);
  }
  if (plan.entryLight && !garage) {
    const u = wide ? 0.9 : 0.74;
    rect(pen, u - 0.005, u + 0.065, 0.57, 0.6, LAMP, 0.9);
    box(pen, u, u + 0.06, 0, 0.07, 0.6, 0.67, STEEL_DARK);
  }
  if (awningStyled(b, plan, cell)) drawAwning(pen, b, plan);
}

/** Brand trim wins the awning colour; otherwise the building rolls a fabric. */
function drawAwning(pen: FacePen, b: Building, plan: FacadeTrimPlan): void {
  const color = b.fasciaColor ?? AWNING_FABRIC[Math.floor(trimRoll(plan.seed, 21) * AWNING_FABRIC.length)]!;
  if (plan.awning === "bullnose") {
    box(pen, -0.03, 1.03, 0, 0.3, 0.62, 0.74, color);
    box(pen, -0.03, 1.03, 0.3, 0.42, 0.6, 0.7, shade(color, 0.9));
    return;
  }
  if (plan.awning === "steel") {
    box(pen, -0.04, 1.04, 0, 0.55, 0.7, 0.735, STEEL);
    drawWorldPoly(pen.g, [at(pen, -0.04, 0.7, 0.552), at(pen, 1.04, 0.7, 0.552), at(pen, 1.04, 0.735, 0.552), at(pen, -0.04, 0.735, 0.552)], shade(color, 0.8), pen.alpha);
    return;
  }
  const reach = 0.45, stripes = 4;
  for (let k = 0; k < stripes; k++) {
    const u0 = -0.03 + k * 1.06 / stripes, u1 = u0 + 1.06 / stripes;
    drawWorldPoly(pen.g, [at(pen, u0, 0.75, 0), at(pen, u1, 0.75, 0), at(pen, u1, 0.63, reach), at(pen, u0, 0.63, reach)], k % 2 ? AWNING_STRIPE : color, pen.alpha);
  }
  drawWorldPoly(pen.g, [at(pen, -0.03, 0.63, reach), at(pen, 1.03, 0.63, reach), at(pen, 1.03, 0.585, reach), at(pen, -0.03, 0.585, reach)], shade(color, 0.72), pen.alpha);
}

type ItemPainter = (pen: FacePen, b: Building, plan: FacadeTrimPlan, cell: Cell) => void;

const ITEM_PAINTERS: Record<TrimItemKind, ItemPainter> = {
  "window-ac": (pen, b, _plan, cell) => {
    const [u0, u1, v0] = windowBox(b, pen.side, cell.floor);
    const mid = (u0 + u1) / 2;
    box(pen, mid - 0.13, mid + 0.13, 0, 0.2, v0, v0 + 0.13, 0xb8b4a4);
  },
  "meter-bank": (pen, _b, plan) => {
    const rows = Math.ceil(plan.meters / 2);
    rect(pen, 0.72, 0.98, 0.18, 0.245, faceTone(pen, STEEL_DARK));
    for (let i = 0; i < plan.meters; i++) {
      const u = 0.735 + (i % 2) * 0.125, v = 0.265 + (i >> 1) * 0.13;
      rect(pen, u, u + 0.1, v, v + 0.105, faceTone(pen, 0xc8ccc4));
    }
    rect(pen, 0.84, 0.866, 0.265 + rows * 0.13, 1, faceTone(pen, STEEL));
  },
  conduit: pen => rect(pen, 0.84, 0.866, 0, 1, faceTone(pen, STEEL)),
  "gas-meter": pen => {
    rect(pen, 0.15, 0.172, 0, 0.42, faceTone(pen, 0xc8b84a));
    box(pen, 0.09, 0.23, 0, 0.12, 0.12, 0.24, 0x9a9c94);
  },
  louver: pen => {
    rect(pen, 0.36, 0.64, 0.76, 0.9, faceTone(pen, STEEL_DARK));
    for (let k = 0; k < 3; k++) rect(pen, 0.38, 0.62, 0.785 + k * 0.038, 0.797 + k * 0.038, faceTone(pen, STEEL));
  },
  downspout: (pen, b, _plan, cell) => {
    rect(pen, 0, 0.045, 0, 1, faceTone(pen, STEEL));
    if (cell.floor === 0) box(pen, 0, 0.07, 0, 0.1, 0, 0.05, STEEL);
    if (!b.grid[cell.floor + 1]?.[cell.gx]?.[cell.gy]) rect(pen, 0, 0.085, 0.93, 1, faceTone(pen, STEEL_DARK));
  },
  "service-door": pen => {
    rect(pen, 0.3, 0.7, 0, 0.74, faceTone(pen, STEEL_DARK));
    rect(pen, 0.33, 0.67, 0, 0.71, faceTone(pen, 0x7c8480));
    rect(pen, 0.6, 0.63, 0.33, 0.37, faceTone(pen, 0x2a2a28));
    box(pen, 0.24, 0.76, 0, 0.34, 0, 0.05, CONCRETE);
    box(pen, 0.82, 0.9, 0.3, 0.39, 0, 0.36, 0xd8b83a);
  },
  "wall-pack": pen => {
    rect(pen, 0.125, 0.235, 0.775, 0.8, LAMP, 0.9);
    box(pen, 0.12, 0.24, 0, 0.07, 0.8, 0.86, STEEL_DARK);
  },
  "blade-sign": (pen, b, plan) => {
    const color = b.fasciaColor ?? BLADE_SIGNS[Math.floor(trimRoll(plan.seed, 22) * BLADE_SIGNS.length)]!;
    box(pen, 0.07, 0.09, 0, 0.62, 0.9, 0.92, STEEL_DARK);
    box(pen, 0.06, 0.1, 0.08, 0.6, 0.62, 0.9, color);
  },
};
