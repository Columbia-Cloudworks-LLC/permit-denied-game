import type { Graphics } from "pixi.js";
import { applyBrokenRoofEdge, displacedRoofVerts, roofHeightAt, sawtoothClosures, sectionOwnsRidge } from "../structure/roof";
import type { Building, RoofSection } from "../structure/types";
import { worldToScreen } from "../world/iso";
import type { SeasonId } from "../world/season";
import { drawIsoBox, drawSlopedQuad, drawWorldPoly, PAL } from "./drawIso";
import { drawRoofFrame, roofShowsFrame } from "./interiorDraw";
import { roofSlopeLight } from "./lighting";
import { shade } from "./palette";

type Vert = { x: number; y: number; z: number };
interface RoofColors { top: number; edge: number }

/** Roof slab thickness: the underside and the edges hang this far below the covering. */
const ROOF_THICK = 0.14;

export function chimneyWorld(b: Building): Vert | null {
  const live = b.roofs.some((r) => r.state === "intact" || r.state === "sagging");
  if (!live) return null;
  const cs = b.cellSize;
  const w = 0.32;
  const d = 0.32;
  const x = b.x + (b.w - 0.55) * cs;
  const y = b.y + 0.12;
  const samples = [
    roofHeightAt(b, x, y),
    roofHeightAt(b, x + w, y),
    roofHeightAt(b, x + w, y + d),
    roofHeightAt(b, x, y + d),
  ].filter((z): z is number => z != null);
  if (samples.length === 0) return null;
  return { x, y, z: Math.min(...samples) - 0.03 };
}

export function drawChimney(g: Graphics, ch: Vert, alpha: number): void {
  drawIsoBox(g, ch.x, ch.y, 0.32, 0.32, ch.z, 0.85, PAL.brick, PAL.brickDark, PAL.brick, alpha);
}

function roofColors(b: Building, roof: RoofSection, verts: Vert[], season: SeasonId = "summer"): RoofColors {
  if (roof.material === 'glass') return { top: PAL.glassLit, edge: PAL.glass };
  if (season === "winter" && roof.material !== "metal" && b.roof !== "shed") {
    return b.roof === "flat"
      ? { top: 0xc5ced6, edge: 0x8e989e }
      : { top: 0xd5e0e8, edge: 0x9aa6b0 };
  }
  if (roof.material === "metal" || b.roof === "shed") return { top: PAL.roofMetal, edge: PAL.metalDark };
  if (b.roof === "flat") return { top: PAL.roofFelt, edge: PAL.metalDark };
  const lit = roofSlopeLight(verts);
  const top = lit >= 0 ? PAL.roofShingle : shade(PAL.roofShingle, 0.78);
  return { top, edge: PAL.roofShingleDark };
}

function ridgeKey(ridge: NonNullable<RoofSection["ridge"]>): string {
  return `${ridge.ax}:${ridge.ay}:${ridge.az}:${ridge.bx}:${ridge.by}:${ridge.bz}`;
}

export function drawRoofBay(g: Graphics, b: Building, roof: RoofSection, alpha: number, season: SeasonId = "summer"): void {
  const drawn = new Set<string>();
  drawRoofSection(g, b, roof, alpha, drawn, season, () => {
    if (roof.material === 'glass' || roofShowsFrame(b, roof)) {
      drawRoofFrame(g, b, roof, alpha * 0.92);
    }
  });
}

function drawRoofSection(
  g: Graphics,
  b: Building,
  roof: RoofSection,
  alpha: number,
  drawnRidges: Set<string>,
  season: SeasonId = "summer",
  beforeCover?: () => void,
): void {
  const verts = applyBrokenRoofEdge(b, roof, displacedRoofVerts(roof));
  const cols = roofColors(b, roof, verts, season);
  const faded = (roof.state === "falling" ? alpha * 0.9 : alpha) * (roof.material === 'glass' ? .28 : 1);
  drawSawtoothClosures(g, roof, cols.edge, faded);
  if (!roof.bay) {
    // A flat slab's underside draws slightly fainter than its edges.
    drawRoofSlab(g, verts, cols.edge, faded, faded * 0.95);
    beforeCover?.();
    drawSlopedQuad(g, verts, cols.top, cols.edge, faded);
  } else if (verts.length === 4) {
    drawFoldedBay(g, b, roof, verts, cols, faded, beforeCover);
  } else {
    drawSlopedQuad(g, verts, cols.top, cols.edge, faded);
  }
  drawRidgeCap(g, b, roof, cols.edge, faded, drawnRidges);
  if (b.features.parapet && roof.style === "flat" && roof.state === "intact") drawParapet(g, verts, faded);
}

/** Sawtooth end closures, with mullions across the glazed ones. */
function drawSawtoothClosures(g: Graphics, roof: RoofSection, edge: number, faded: number): void {
  for (const closure of sawtoothClosures(roof)) {
    drawWorldPoly(g, closure.verts, closure.glass ? PAL.glassLit : edge, faded);
    if (!closure.glass) continue;
    const [a, b0, c, d] = closure.verts;
    for (const t of [.25, .5, .75]) {
      const p = worldToScreen(a!.x + (b0!.x - a!.x) * t, a!.y + (b0!.y - a!.y) * t, a!.z + (b0!.z - a!.z) * t);
      const q = worldToScreen(d!.x + (c!.x - d!.x) * t, d!.y + (c!.y - d!.y) * t, d!.z + (c!.z - d!.z) * t);
      g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: PAL.frame, width: 1, alpha: faded });
    }
  }
}

/** Underside and edge faces of a roof face, so it reads as a slab rather than a sheet. */
function drawRoofSlab(g: Graphics, face: Vert[], edge: number, alpha: number, underAlpha = alpha): void {
  const under = face.map((v) => ({ ...v, z: v.z - ROOF_THICK }));
  drawSlopedQuad(g, under.slice().reverse(), edge, edge, underAlpha);
  for (let i = 0; i < face.length; i++) {
    const n = (i + 1) % face.length;
    drawSlopedQuad(g, [face[i]!, face[n]!, under[n]!, under[i]!], edge, edge, alpha);
  }
}

/** A falling bay buckles along its middle into two folded halves. */
function drawFoldedBay(g: Graphics, b: Building, roof: RoofSection, verts: Vert[], cols: RoofColors, faded: number, beforeCover?: () => void): void {
  // Shrinking the torn covering slightly reveals the short steel members underneath.
  const cx = verts.reduce((s, v) => s + v.x, 0) / 4;
  const cy = verts.reduce((s, v) => s + v.y, 0) / 4;
  const exposed = roofShowsFrame(b, roof);
  const inset = exposed ? .055 * (1 - roof.fallT) : 0;
  const cover = verts.map(v => ({ ...v, x: v.x + (cx - v.x) * inset, y: v.y + (cy - v.y) * inset }));
  const [a, b0, c, d] = cover as [Vert, Vert, Vert, Vert];
  const buckle = (roof.sag * .22 + Math.sin(roof.fallT * Math.PI) * .18) * (1 - roof.fallT);
  const mid = (p: Vert, q: Vert) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: Math.max(.16, (p.z + q.z) / 2 - buckle) });
  const ab = mid(a, b0), dc = mid(d, c);
  // Give each folded half its own underside, rather than a rigid slab across the crease.
  for (const face of [[a, ab, dc, d], [ab, b0, c, dc]]) drawRoofSlab(g, face, cols.edge, faded);
  beforeCover?.();
  drawSlopedQuad(g, [a, ab, dc, d], cols.top, cols.top, faded);
  drawSlopedQuad(g, [ab, b0, c, dc], shade(cols.top, 1 - buckle * .2), cols.top, faded);
  const p = worldToScreen(ab.x, ab.y, ab.z), q = worldToScreen(dc.x, dc.y, dc.z);
  g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: cols.edge, width: .6, alpha: faded * .25 });
}

/** A shared ridge is capped once, by the section that owns it. */
function drawRidgeCap(g: Graphics, b: Building, roof: RoofSection, edge: number, faded: number, drawnRidges: Set<string>): void {
  const r = roof.ridge;
  if (!r || roof.state === "falling" || !sectionOwnsRidge(b, roof)) return;
  const key = ridgeKey(r);
  if (drawnRidges.has(key)) return;
  drawnRidges.add(key);
  const sag = roof.sag * 0.35;
  drawSlopedQuad(
    g,
    [
      { x: r.ax, y: r.ay, z: r.az + 0.05 - sag },
      { x: r.bx, y: r.by, z: r.bz + 0.05 - sag },
      { x: r.bx, y: r.by, z: r.bz - 0.02 - sag },
      { x: r.ax, y: r.ay, z: r.az - 0.02 - sag },
    ],
    edge,
    edge,
    faded,
  );
}

function drawParapet(g: Graphics, verts: Vert[], faded: number): void {
  const z = verts[0]!.z;
  const xs = verts.map((v) => v.x);
  const ys = verts.map((v) => v.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  drawIsoBox(g, x0, y0, x1 - x0, 0.08, z, 0.22, PAL.concrete, PAL.concreteDark, PAL.concrete, faded);
  drawIsoBox(g, x0, y1 - 0.08, x1 - x0, 0.08, z, 0.22, PAL.concrete, PAL.concreteDark, PAL.concrete, faded);
}
