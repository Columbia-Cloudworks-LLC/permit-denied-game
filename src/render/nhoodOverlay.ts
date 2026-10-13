import { Container, Graphics, Text } from "pixi.js";
import { worldToScreen } from "../world/iso";
import type { Town } from "../world/town";
import { aabbCorners } from "../world/parcels";

function line(g: Graphics, points: readonly { x: number; y: number }[], color: number, alpha = 0.9, z = 0.04): void {
  if (points.length < 2) return;
  const first = worldToScreen(points[0]!.x, points[0]!.y, z);
  g.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i++) {
    const s = worldToScreen(points[i]!.x, points[i]!.y, z);
    g.lineTo(s.x, s.y);
  }
  g.stroke({ color, width: 1.4, alpha });
}

function ring(g: Graphics, points: readonly { x: number; y: number }[], color: number, alpha = 0.85): void {
  if (points.length < 2) return;
  line(g, [...points, points[0]!], color, alpha);
}

export function clearNhoodOverlay(g: Graphics, layer: Container): void {
  g.clear();
  for (const child of [...layer.children]) {
    if (child !== g) child.destroy();
  }
}

export function drawNhoodOverlay(g: Graphics, layer: Container, town: Town): void {
  clearNhoodOverlay(g, layer);
  for (const node of town.network.nodes) {
    const s = worldToScreen(node.x, node.y, node.elev + 0.05);
    const junction = node.segmentIds.length >= 3;
    g.circle(s.x, s.y, junction ? 3.4 : 2.2);
    g.fill({ color: junction ? 0xffd24a : 0x9ad1ff, alpha: 0.95 });
  }
  for (const seg of town.network.segments) drawSegment(g, layer, seg);
  for (const lot of town.lots) drawLot(g, layer, town, lot);
  for (const lot of town.lots) drawDriveway(g, town, lot);
  for (const reject of town.nhood?.rejected ?? []) drawRejected(g, layer, reject);
}

function drawDriveway(g: Graphics, town: Town, lot: Lot): void {
  if (!lot.drivewayId) return;
  const drive = town.network.segments.find((s) => s.id === lot.drivewayId);
  if (drive) line(g, drive.points, 0xffb347, 1, 0.07);
}

/** A candidate the neighborhood planner rejected, outlined in red with its reason. */
function drawRejected(g: Graphics, layer: Container, reject: NonNullable<Town["nhood"]>["rejected"][number]): void {
  if (reject.points.length >= 2) ring(g, reject.points, 0xff4d4d, 0.45);
  const p = reject.points[0];
  if (p) addLabel(layer, reject.reason, worldToScreen(p.x, p.y, 0.1), 0, 0, 0xff8a8a, 8);
}

type Segment = Town["network"]["segments"][number];
type Lot = Town["lots"][number];

function addLabel(layer: Container, text: string, at: { x: number; y: number }, dx: number, dy: number, fill: number, fontSize: number): void {
  const label = new Text({ text, style: { fill, fontSize, fontFamily: "monospace" } });
  label.x = at.x + dx;
  label.y = at.y + dy;
  layer.addChild(label);
}

/** Road centerline, with driveways drawn warmer, labelled by id at its midpoint. */
function drawSegment(g: Graphics, layer: Container, seg: Segment): void {
  const driveway = seg.roadClass === "driveway";
  line(g, seg.points, driveway ? 0xc4a574 : 0x7ec8ff, driveway ? 0.95 : 0.7, seg.points[0]!.elev + 0.03);
  const mid = seg.points[Math.floor(seg.points.length / 2)] ?? seg.points[0]!;
  addLabel(layer, seg.id, worldToScreen(mid.x, mid.y, mid.elev + 0.08), 3, -8, 0xf4f0e4, 9);
}

const BAND_COLORS: Record<string, number> = {
  rural: 0x8fbf6a,
  'village-main-street': 0xdfc786,
  suburban: 0x7ec8ff,
  'borough-mixed': 0x5ad68a,
  'downtown-core': 0xff6b4a,
  'downtown-transition': 0xffb347,
  'service-industrial': 0x9aa3ad,
  estate: 0xc9a0dc,
};

/** Lot boundary in its urban band colour, band label, road frontage edge, and buildable box. */
function drawLot(g: Graphics, layer: Container, town: Town, lot: Lot): void {
  if (lot.boundary?.length) ring(g, lot.boundary, BAND_COLORS[lot.urbanBand ?? ''] ?? 0x5ad68a, 0.8);
  if (lot.urbanBand) {
    const c = lot.boundary[0] ?? { x: lot.x, y: lot.y };
    addLabel(layer, lot.openSpaceName ?? `${lot.districtRole ?? ''}`, worldToScreen(c.x, c.y, 0.08), 2, -10, 0xf4f0e4, 8);
  }
  if (lot.frontage?.segmentId && town.network.segments.some((s) => s.id === lot.frontage.segmentId)) {
    const [a, b] = lot.boundary;
    if (a && b) line(g, [a, b], 0x3cff8a, 1, 0.06);
  }
  const box = lot.buildable;
  if (box) {
    ring(g, aabbCorners(box), 0xe07cff, 0.75);
  }
}
