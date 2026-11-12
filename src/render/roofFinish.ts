import type { Graphics } from "pixi.js";
import { mixSeed, Rng } from "../game/rng";
import { rooftopBox, rooftopKit, rooftopSeed } from "../structure/rooftop";
import type { Building, RoofFinish } from "../structure/types";
import type { DeckEdgeRun, FlatDeck } from "./buildingSurfaces";
import { cellColors, drawIsoBox, drawWorldPoly } from "./drawIso";
import { PAL, shade } from "./palette";

type Side = "north" | "south" | "east" | "west";

/** Roof slab thickness under a deck; matches the per-panel slab in `roofDraw.ts`. */
const DECK_THICK = 0.14;
const PARAPET_THICK = 0.13;
const PARAPET_H = 0.27;
const COPING_H = 0.045;

/**
 * The membrane a building's flat roofs wear, fixed for the building: regional adobe and cool
 * roofs first, then occupancy (cold chain and modern retail lay bright TPO, towers and industry
 * dark EPDM), then the walls (old brick and timber carry tar and gravel).
 */
export function roofFinishFor(b: Building): RoofFinish {
  if (b.roofForm?.id === "adobe-flat") return "adobe";
  if (b.roofForm?.id === "cool-flat") return "tpo";
  const kit = rooftopKit(b);
  if (kit === "cold" || kit === "retail") return "tpo";
  if (b.floors >= 4 || kit === "office") return b.theme === "civic" && b.floors < 4 ? "bur" : "epdm";
  if (b.kind === "industrial") return b.construction.skin === "metal" ? "tpo" : "epdm";
  const skin = b.construction.skin;
  if (skin === "brick" || skin === "wood") return "bur";
  return skin === "concrete" && b.theme !== "civic" ? "tpo" : "bur";
}

export interface FinishTone { top: number; edge: number }

const FINISH_TONE: Record<RoofFinish, FinishTone> = {
  tpo: { top: PAL.roofTpo, edge: PAL.roofTpoSeam },
  bur: { top: PAL.roofBur, edge: PAL.roofBurDark },
  epdm: { top: PAL.roofEpdm, edge: PAL.metalDark },
  adobe: { top: PAL.roofAdobe, edge: shade(PAL.roofAdobe, 0.72) },
};

/** Deck and slab-edge colour of a flat roof, snow-capped or bare. */
export function flatRoofTone(b: Building, snow: boolean): FinishTone {
  if (snow) return { top: PAL.roofSnowFlat, edge: 0x8e989e };
  return FINISH_TONE[roofFinishFor(b)];
}

/** Whether this building's flat roofs sit inside a raised curb. */
function hasParapet(b: Building): boolean {
  return b.features.parapet || b.roofForm?.id === "adobe-flat";
}

interface ParapetTone { body: { top: number; left: number; right: number }; coping: number }

/** Parapet body in the wall's own material, capped in sheet metal, precast stone or brick. */
function parapetTone(b: Building): ParapetTone {
  if (b.roofForm?.id === "adobe-flat") {
    return { body: { top: PAL.roofAdobeLight, left: shade(PAL.roofAdobe, 0.78), right: shade(PAL.roofAdobe, 0.9) }, coping: PAL.roofAdobeLight };
  }
  const skin = b.construction.skin === "glass" ? "concrete" : b.construction.skin;
  const body = cellColors(skin, false);
  const coping = skin === "brick"
    ? (mixSeed(rooftopSeed(b)) & 3) === 0 ? PAL.copingBrick : PAL.copingStone
    : skin === "concrete" && b.theme === "civic" ? PAL.copingStone : PAL.copingMetal;
  return { body, coping };
}

const SIDE_OF: Record<Side, { alongX: boolean; far: boolean }> = {
  north: { alongX: true, far: false },
  south: { alongX: true, far: true },
  west: { alongX: false, far: false },
  east: { alongX: false, far: true },
};

/** World box of one edge run's parapet, sitting on the deck just inside its rim. */
function runBox(b: Building, deck: FlatDeck, side: Side, run: DeckEdgeRun): { x: number; y: number; w: number; d: number } {
  const cs = b.cellSize, { alongX, far } = SIDE_OF[side];
  const from = alongX ? deck.gx0 : deck.gy0, to = alongX ? deck.gx1 : deck.gy1;
  const lo = alongX ? deck.x0 : deck.y0, hi = alongX ? deck.x1 : deck.y1;
  const origin = alongX ? b.x : b.y;
  // The first and last cells of a side run out to the deck's own corner, overhang included.
  const a = run.a === from ? lo : origin + run.a * cs;
  const z = run.b === to ? hi : origin + (run.b + 1) * cs;
  if (alongX) return { x: a, y: far ? deck.y1 - PARAPET_THICK : deck.y0, w: z - a, d: PARAPET_THICK };
  return { x: far ? deck.x1 - PARAPET_THICK : deck.x0, y: a, w: PARAPET_THICK, d: z - a };
}

function drawParapetRun(g: Graphics, b: Building, deck: FlatDeck, side: Side, run: DeckEdgeRun, tone: ParapetTone, alpha: number, detail: boolean, snow: boolean): void {
  const box = runBox(b, deck, side, run);
  const height = b.roofForm?.id === "adobe-flat" ? PARAPET_H + 0.08 : PARAPET_H;
  drawIsoBox(g, box.x, box.y, box.w, box.d, deck.z, height, tone.body.top, tone.body.left, tone.body.right, alpha);
  const lip = 0.025, cap = snow ? PAL.roofSnow : tone.coping;
  drawIsoBox(g, box.x - lip, box.y - lip, box.w + lip * 2, box.d + lip * 2, deck.z + height, COPING_H, cap, shade(cap, 0.66), shade(cap, 0.82), alpha);
  if (!detail || (side !== "south" && side !== "east")) return;
  const { alongX } = SIDE_OF[side], length = alongX ? box.w : box.d;
  const point = (t: number, z: number) => alongX
    ? { x: box.x + length * t, y: box.y + box.d + 0.004, z }
    : { x: box.x + box.w + 0.004, y: box.y + length * t, z };
  const slot = (t: number, half: number, z0: number, z1: number, color: number) =>
    drawWorldPoly(g, [point(t - half / length, z1), point(t + half / length, z1), point(t + half / length, z0), point(t - half / length, z0)], color, alpha);
  if (b.roofForm?.vigas) {
    // Timber beam ends through the adobe wall, and one sheet-metal rain spout per run.
    const count = Math.max(1, Math.round(length / (b.cellSize * 0.5)));
    for (let i = 0; i < count; i++) slot((i + 0.5) / count, 0.045, deck.z - 0.16, deck.z - 0.07, PAL.viga);
    slot(0.5, 0.06, deck.z + 0.02, deck.z + 0.08, PAL.galvMid);
    return;
  }
  // Scuppers at the quarter points, where the facade's downspouts hang; each drains into a conductor head.
  if (length < b.cellSize * 1.5) return;
  for (const t of [0.25, 0.75]) {
    slot(t, 0.07, deck.z + 0.015, deck.z + 0.085, PAL.roofMastic);
    slot(t, 0.085, deck.z - 0.13, deck.z - 0.02, PAL.galvMid);
  }
}

/** A flat strip on the deck, in deck-local world coordinates. */
function strip(g: Graphics, deck: FlatDeck, x0: number, y0: number, x1: number, y1: number, color: number, alpha: number): void {
  const z = deck.z + 0.004;
  const cx = (v: number) => Math.max(deck.x0, Math.min(deck.x1, v)), cy = (v: number) => Math.max(deck.y0, Math.min(deck.y1, v));
  const ax = cx(x0), bx = cx(x1), ay = cy(y0), by = cy(y1);
  if (bx - ax < 1e-3 || by - ay < 1e-3) return;
  drawWorldPoly(g, [{ x: ax, y: ay, z }, { x: bx, y: ay, z }, { x: bx, y: by, z }, { x: ax, y: by, z }], color, alpha);
}

const openRuns = (deck: FlatDeck, side: Side): DeckEdgeRun[] => deck.edges[side].filter(run => run.kind === "parapet");

/** Long roll-weld seams across a bright membrane, one sheet width apart. */
function drawTpoSeams(g: Graphics, deck: FlatDeck, alpha: number): void {
  const alongX = deck.x1 - deck.x0 >= deck.y1 - deck.y0, sheet = 1.05;
  if (alongX) for (let y = deck.y0 + sheet; y < deck.y1 - 0.2; y += sheet) strip(g, deck, deck.x0, y, deck.x1, y + 0.02, PAL.roofTpoSeam, alpha);
  else for (let x = deck.x0 + sheet; x < deck.x1 - 0.2; x += sheet) strip(g, deck, x, deck.y0, x + 0.02, deck.y1, PAL.roofTpoSeam, alpha);
}

/** Tar and gravel: ponding shade toward the scupper side, loose aggregate, and mastic repairs. */
function drawBurWear(g: Graphics, b: Building, deck: FlatDeck, alpha: number): void {
  const w = deck.x1 - deck.x0, d = deck.y1 - deck.y0;
  // Water runs to the south scuppers: the low third reads darker and damper.
  for (const [share, strength] of [[0.34, 0.1], [0.16, 0.12]] as const) strip(g, deck, deck.x0, deck.y1 - d * share, deck.x1, deck.y1, PAL.roofBurDark, alpha * strength);
  const rng = new Rng(mixSeed(rooftopSeed(b) ^ (deck.floor * 977 + deck.gx0 * 31 + deck.gy0)));
  const grains = Math.min(90, Math.round(w * d * 2.2));
  for (let i = 0; i < grains; i++) {
    const x = deck.x0 + rng.next() * w, y = deck.y0 + rng.next() * d, size = 0.035 + rng.next() * 0.04;
    strip(g, deck, x, y, x + size, y + size, rng.next() < 0.5 ? PAL.roofBurLight : PAL.roofBurDark, alpha * 0.7);
  }
  const patches = Math.min(4, Math.floor(w * d / 14));
  for (let i = 0; i < patches; i++) {
    const pw = 0.5 + rng.next() * 0.9, pd = 0.3 + rng.next() * 0.5;
    const x = deck.x0 + 0.3 + rng.next() * Math.max(0.1, w - pw - 0.6), y = deck.y0 + 0.3 + rng.next() * Math.max(0.1, d - pd - 0.6);
    strip(g, deck, x, y, x + pw, y + pd, PAL.roofMastic, alpha * 0.55);
  }
}

/** Sun-bleached lighter washes across hand-troweled stucco. */
function drawAdobeWash(g: Graphics, b: Building, deck: FlatDeck, alpha: number): void {
  const rng = new Rng(mixSeed(rooftopSeed(b) ^ (deck.gx0 * 131 + deck.gy0 * 17 + 5)));
  const w = deck.x1 - deck.x0, d = deck.y1 - deck.y0;
  for (let i = Math.min(5, Math.ceil(w * d / 8)); i > 0; i--) {
    const pw = 0.6 + rng.next() * 1.2, pd = 0.4 + rng.next() * 0.8;
    const x = deck.x0 + rng.next() * Math.max(0.1, w - pw), y = deck.y0 + rng.next() * Math.max(0.1, d - pd);
    strip(g, deck, x, y, x + pw, y + pd, PAL.roofAdobeLight, alpha * 0.35);
  }
}

/** Concrete service pavers from the deck's west edge to each machine standing on it. */
function drawPaverWalks(g: Graphics, b: Building, deck: FlatDeck, alpha: number): void {
  for (const fixture of b.rooftop) {
    if (fixture.state !== "mounted" || fixture.floor !== deck.floor || !fixture.heavy) continue;
    if (fixture.gx < deck.gx0 || fixture.gx > deck.gx1 || fixture.gy < deck.gy0 || fixture.gy > deck.gy1) continue;
    const box = rooftopBox(b, fixture), y = box.y + box.d / 2 - 0.16;
    for (let x = deck.x0 + 0.3; x + 0.3 < box.x; x += 0.36) strip(g, deck, x, y, x + 0.3, y + 0.32, PAL.roofPaver, alpha);
  }
}

/** Perimeter trim on the deck surface: flashing apron on gravel, termination bar on rubber. */
function drawPerimeterTrim(g: Graphics, b: Building, deck: FlatDeck, finish: RoofFinish, alpha: number): void {
  const inset = PARAPET_THICK, band = finish === "bur" ? 0.16 : 0.035;
  const color = finish === "bur" ? PAL.roofBurLight : PAL.roofEpdmBar;
  for (const side of ["north", "south", "east", "west"] as const) for (const run of openRuns(deck, side)) {
    const box = runBox(b, deck, side, run), { alongX, far } = SIDE_OF[side];
    if (alongX) strip(g, deck, box.x, far ? box.y - band : box.y + inset, box.x + box.w, far ? box.y : box.y + inset + band, color, alpha * 0.85);
    else strip(g, deck, far ? box.x - band : box.x + inset, box.y, far ? box.x : box.x + inset + band, box.y + box.d, color, alpha * 0.85);
  }
}

/** The shadow a north or west parapet throws across the deck under the upper-west sun. */
function drawParapetShadow(g: Graphics, b: Building, deck: FlatDeck, alpha: number): void {
  const reach = 0.24;
  for (const side of ["north", "west"] as const) for (const run of openRuns(deck, side)) {
    const box = runBox(b, deck, side, run);
    if (side === "north") strip(g, deck, box.x, box.y + box.d, box.x + box.w, box.y + box.d + reach, 0x000000, alpha * 0.26);
    else strip(g, deck, box.x + box.w, box.y, box.x + box.w + reach, box.y + box.d, 0x000000, alpha * 0.26);
  }
}

/** A ragged dark seam where the deck meets a panel that is sagging away. */
function drawBreachSeams(g: Graphics, b: Building, deck: FlatDeck, alpha: number): void {
  for (const side of ["north", "south", "east", "west"] as const) for (const run of deck.edges[side]) {
    if (run.kind !== "breach") continue;
    const box = runBox(b, deck, side, run), { alongX } = SIDE_OF[side];
    if (alongX) strip(g, deck, box.x, box.y + box.d / 2 - 0.03, box.x + box.w, box.y + box.d / 2 + 0.03, PAL.roofMastic, alpha * 0.8);
    else strip(g, deck, box.x + box.w / 2 - 0.03, box.y, box.x + box.w / 2 + 0.03, box.y + box.d, PAL.roofMastic, alpha * 0.8);
  }
}

export interface DeckDrawOptions {
  alpha: number;
  /** Fine surface detail: weld seams, aggregate, pavers, scuppers. Off at overview zoom. */
  detail: boolean;
  snow: boolean;
}

/**
 * One merged flat-roof deck: slab, membrane, surface wear and the parapets on its far (north and
 * west) sides. Nothing here draws a line between the cells it covers.
 */
export function drawFlatDeck(g: Graphics, b: Building, deck: FlatDeck, { alpha, detail, snow }: DeckDrawOptions): void {
  const finish = roofFinishFor(b), tone = flatRoofTone(b, snow);
  const rim = b.fasciaColor ?? tone.edge;
  // The slab's visible south and east faces; a parapet, where there is one, stands on top of them.
  drawIsoBox(g, deck.x0, deck.y0, deck.x1 - deck.x0, deck.y1 - deck.y0, deck.z - DECK_THICK, DECK_THICK, tone.top, shade(rim, 0.82), rim, alpha);
  if (!snow && detail) {
    if (finish === "tpo") drawTpoSeams(g, deck, alpha);
    else if (finish === "bur") drawBurWear(g, b, deck, alpha);
    else if (finish === "adobe") drawAdobeWash(g, b, deck, alpha);
    else drawPaverWalks(g, b, deck, alpha);
  }
  drawBreachSeams(g, b, deck, alpha);
  if (!hasParapet(b)) return;
  if (!snow && detail && (finish === "bur" || finish === "epdm")) drawPerimeterTrim(g, b, deck, finish, alpha);
  drawParapetShadow(g, b, deck, alpha);
  const parapet = parapetTone(b);
  for (const side of ["north", "west"] as const) for (const run of openRuns(deck, side)) drawParapetRun(g, b, deck, side, run, parapet, alpha, detail, snow);
}

/** Whether the deck has a near (south or east) parapet to draw after whatever stands on it. */
export function deckHasFrontParapet(b: Building, deck: FlatDeck): boolean {
  return hasParapet(b) && (openRuns(deck, "south").length > 0 || openRuns(deck, "east").length > 0);
}

/** The deck's near parapets, with their scuppers or vigas; painted after the gear standing behind them. */
export function drawDeckFrontParapet(g: Graphics, b: Building, deck: FlatDeck, { alpha, detail, snow }: DeckDrawOptions): void {
  const parapet = parapetTone(b);
  for (const side of ["east", "south"] as const) for (const run of openRuns(deck, side)) drawParapetRun(g, b, deck, side, run, parapet, alpha, detail, snow);
}
