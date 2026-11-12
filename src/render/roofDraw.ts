import type { Graphics } from "pixi.js";
import { applyBrokenRoofEdge, displacedRoofVerts, roofHeightAt, sawtoothClosures, sectionOwnsRidge } from "../structure/roof";
import type { Building, RoofSection } from "../structure/types";
import { worldToScreen } from "../world/iso";
import { drawIsoBox, drawSlopedQuad, drawWorldPoly, PAL } from "./drawIso";
import { drawRoofFrame, roofShowsFrame } from "./interiorDraw";
import { roofSlopeLight } from "./lighting";
import { shade } from "./palette";
import { flatRoofTone } from "./roofFinish";

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

/** Clay barrel tile, standing-seam metal or shingle for a pitched roof; the membrane family for a flat one. */
function roofColors(b: Building, roof: RoofSection, verts: Vert[], snow: boolean): RoofColors {
  if (roof.material === 'glass') return { top: PAL.glassLit, edge: PAL.glass };
  if (roof.style === "flat" && !b.canopy && (!snow || roof.material !== "metal")) return flatRoofTone(b, snow);
  if (snow && roof.material !== "metal" && b.roof !== "shed") return { top: PAL.roofSnow, edge: 0x9aa6b0 };
  // Houses without a regional silhouette still roof in the local material: clay tile in the desert, light metal on the Gulf.
  const local = !b.roofForm && b.kind === "house" && roof.style === "gable" ? b.region?.roofs : undefined;
  const covering = b.roofForm?.covering ?? (local === "southwest" ? "barrel-tile" : local === "subtropical" ? "metal-seam" : undefined);
  if (covering === "barrel-tile" || covering === "metal-seam") {
    const [base, dark] = covering === "barrel-tile" ? [PAL.roofTile, PAL.roofTileDark] : [PAL.roofSeamMetal, PAL.roofSeamMetalDark];
    return { top: roofSlopeLight(verts) >= 0 ? base : shade(base, 0.8), edge: dark };
  }
  if (roof.material === "metal" || b.roof === "shed") return { top: PAL.roofMetal, edge: PAL.metalDark };
  if (b.roof === "flat") return { top: PAL.roofFelt, edge: PAL.metalDark };
  const lit = roofSlopeLight(verts);
  const top = lit >= 0 ? PAL.roofShingle : shade(PAL.roofShingle, 0.78);
  return { top, edge: PAL.roofShingleDark };
}

/** Tile courses or standing seams running from ridge to eave on a regional pitched roof. */
function drawCoveringRibs(g: Graphics, b: Building, verts: Vert[], edge: number, alpha: number): void {
  if (!b.roofForm || b.roofForm.covering === "shingle" || b.roofForm.covering === "adobe" || verts.length !== 4) return;
  const ranked = verts.map((v, i) => ({ v, i })).sort((a, c) => c.v.z - a.v.z);
  if (ranked[0]!.v.z - ranked[3]!.v.z < 0.05) return;
  const [r0, r1] = [ranked[0]!, ranked[1]!], [e0, e1] = [ranked[2]!, ranked[3]!];
  // Pair each ridge corner with the eave corner on its own side of the plane.
  const near = (a: Vert, c: Vert) => Math.hypot(a.x - c.x, a.y - c.y);
  const straight = near(r0.v, e0.v) + near(r1.v, e1.v) <= near(r0.v, e1.v) + near(r1.v, e0.v);
  const [ea, eb] = straight ? [e0.v, e1.v] : [e1.v, e0.v];
  const ribs = b.roofForm.covering === "barrel-tile" ? 4 : 2;
  for (let n = 1; n <= ribs; n++) {
    const t = n / (ribs + 1);
    const p = worldToScreen(r0.v.x + (r1.v.x - r0.v.x) * t, r0.v.y + (r1.v.y - r0.v.y) * t, r0.v.z + (r1.v.z - r0.v.z) * t);
    const q = worldToScreen(ea.x + (eb.x - ea.x) * t, ea.y + (eb.y - ea.y) * t, ea.z + (eb.z - ea.z) * t);
    g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: edge, width: 1, alpha: alpha * 0.55 });
  }
}

function ridgeKey(ridge: NonNullable<RoofSection["ridge"]>): string {
  return `${ridge.ax}:${ridge.ay}:${ridge.az}:${ridge.bx}:${ridge.by}:${ridge.bz}`;
}

/** One roof panel. `snow` caps it white: winter, in a climate that allows snow. `detail` adds tile courses and seams. */
export function drawRoofBay(g: Graphics, b: Building, roof: RoofSection, alpha: number, snow = false, detail = true): void {
  const drawn = new Set<string>();
  drawRoofSection(g, b, roof, alpha, drawn, snow, detail, () => {
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
  snow: boolean,
  detail: boolean,
  beforeCover?: () => void,
): void {
  const verts = applyBrokenRoofEdge(b, roof, displacedRoofVerts(roof));
  const cols = roofColors(b, roof, verts, snow);
  const faded = (roof.state === "falling" ? alpha * 0.9 : alpha) * (roof.material === 'glass' ? .28 : 1);
  // A brand fascia paints the eave band of a flat or canopy roof; the underside keeps the roof's own edge colour.
  const rim = roof.style === "flat" ? b.fasciaColor ?? cols.edge : cols.edge;
  drawSawtoothClosures(g, roof, cols.edge, faded);
  if (!roof.bay) {
    // A flat slab's underside draws slightly fainter than its edges.
    drawRoofSlab(g, verts, cols.edge, faded, faded * 0.95, rim);
    beforeCover?.();
    drawSlopedQuad(g, verts, cols.top, cols.edge, faded);
  } else if (verts.length === 4) {
    drawFoldedBay(g, b, roof, verts, cols, faded, beforeCover, rim);
  } else {
    drawSlopedQuad(g, verts, cols.top, cols.edge, faded);
  }
  if (detail && !snow && roof.state === "intact" && roof.sag === 0) drawCoveringRibs(g, b, verts, cols.edge, faded);
  drawRidgeCap(g, b, roof, cols.edge, faded, drawnRidges);
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
function drawRoofSlab(g: Graphics, face: Vert[], edge: number, alpha: number, underAlpha = alpha, rim = edge): void {
  const under = face.map((v) => ({ ...v, z: v.z - ROOF_THICK }));
  drawSlopedQuad(g, under.slice().reverse(), edge, edge, underAlpha);
  for (let i = 0; i < face.length; i++) {
    const n = (i + 1) % face.length;
    drawSlopedQuad(g, [face[i]!, face[n]!, under[n]!, under[i]!], rim, rim, alpha);
  }
}

/** A falling bay buckles along its middle into two folded halves. */
function drawFoldedBay(g: Graphics, b: Building, roof: RoofSection, verts: Vert[], cols: RoofColors, faded: number, beforeCover?: () => void, rim = cols.edge): void {
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
  for (const face of [[a, ab, dc, d], [ab, b0, c, dc]]) drawRoofSlab(g, face, cols.edge, faded, faded, rim);
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
