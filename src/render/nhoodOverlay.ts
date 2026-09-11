import { Graphics, Text } from "pixi.js";
import { worldToScreen } from "../world/iso";
import type { Town } from "../world/town";

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

export function drawNhoodOverlay(g: Graphics, labels: Text[], town: Town): void {
  g.clear();
  for (const t of labels) t.destroy();
  labels.length = 0;

  for (const node of town.network.nodes) {
    const s = worldToScreen(node.x, node.y, node.elev + 0.05);
    g.circle(s.x, s.y, node.segmentIds.length >= 3 ? 3.4 : 2.2);
    g.fill({ color: node.segmentIds.length >= 3 ? 0xffd24a : 0x9ad1ff, alpha: 0.95 });
  }

  for (const seg of town.network.segments) {
    const color = seg.roadClass === "driveway" ? 0xc4a574 : 0x7ec8ff;
    line(g, seg.points, color, seg.roadClass === "driveway" ? 0.95 : 0.7, seg.points[0]!.elev + 0.03);
    const mid = seg.points[Math.floor(seg.points.length / 2)] ?? seg.points[0]!;
    const p = worldToScreen(mid.x, mid.y, mid.elev + 0.08);
    const label = new Text({
      text: seg.id,
      style: { fill: 0xf4f0e4, fontSize: 9, fontFamily: "monospace" },
    });
    label.x = p.x + 3;
    label.y = p.y - 8;
    labels.push(label);
  }

  for (const lot of town.lots) {
    if (lot.boundary?.length) ring(g, lot.boundary, 0x5ad68a, 0.8);
    if (lot.frontage?.segmentId) {
      const seg = town.network.segments.find((s) => s.id === lot.frontage.segmentId);
      if (seg) {
        const a = lot.boundary[0];
        const b = lot.boundary[1];
        if (a && b) line(g, [a, b], 0x3cff8a, 1, 0.06);
      }
    }
    if (lot.buildable) {
      ring(
        g,
        [
          { x: lot.buildable.x, y: lot.buildable.y },
          { x: lot.buildable.x + lot.buildable.w, y: lot.buildable.y },
          { x: lot.buildable.x + lot.buildable.w, y: lot.buildable.y + lot.buildable.d },
          { x: lot.buildable.x, y: lot.buildable.y + lot.buildable.d },
        ],
        0xe07cff,
        0.75,
      );
    }
  }

  for (const lot of town.lots) {
    if (!lot.drivewayId) continue;
    const drive = town.network.segments.find((s) => s.id === lot.drivewayId);
    if (drive) line(g, drive.points, 0xffb347, 1, 0.07);
  }

  for (const reject of town.nhood?.rejected ?? []) {
    if (reject.points.length >= 2) ring(g, reject.points, 0xff4d4d, 0.45);
    const p = reject.points[0];
    if (!p) continue;
    const s = worldToScreen(p.x, p.y, 0.1);
    const label = new Text({
      text: reject.reason,
      style: { fill: 0xff8a8a, fontSize: 8, fontFamily: "monospace" },
    });
    label.x = s.x;
    label.y = s.y;
    labels.push(label);
  }
}
