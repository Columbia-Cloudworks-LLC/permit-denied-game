import { Graphics } from "pixi.js";
import { DOZER, FLOOR_Z } from "../game/constants";
import type { DebugView } from "../debug/view";
import { cellPresent, cellWorldBox } from "../structure/types";
import { fixtureSolid, fixtureWorldBox } from "../structure/interior";
import type { Town } from "../world/town";
import type { Dozer } from "../vehicle/dozer";
import { worldToScreen } from "../world/iso";

export interface DebugLine { points: { x: number; y: number; z?: number }[]; color: number }
function box(x: number, y: number, w: number, d: number, z = .05): DebugLine["points"] {
  return [{ x, y, z }, { x: x + w, y, z }, { x: x + w, y: y + d, z }, { x, y: y + d, z }, { x, y, z }];
}

/** Geometry comes from live collision/support data, independent of visibility switches. */
export function debugLines(town: Town, dozer: Dozer, view: DebugView): DebugLine[] {
  const lines: DebugLine[] = [];
  if (view.paths) for (const segment of town.network.segments) {
    lines.push({ points: segment.points.map(p => ({ x: p.x, y: p.y, z: p.elev + .08 })),
      color: town.roadCar?.route.includes(segment.id) ? 0xffd24a : segment.roadClass === "driveway" ? 0xffb347 : 0x7ec8ff });
  }
  for (const lot of town.lots) {
    if (view.lots && lot.boundary.length) lines.push({ points: [...lot.boundary, lot.boundary[0]!], color: 0x5ad68a });
    if (view.buildable && lot.buildable) {
      const r = lot.buildable;
      lines.push({ points: box(r.x, r.y, r.w, r.d), color: 0xe07cff });
    }
  }
  for (const b of town.buildings) {
    if (view.rooms) for (const room of b.layout.rooms) {
      if (room.floor >= b.floors || room.floor > view.maxFloor) continue;
      const w = b.w * b.cellSize, d = b.d * b.cellSize;
      lines.push({ points: box(b.x + room.x * w, b.y + room.y * d, room.w * w, room.d * d, room.floor * FLOOR_Z + .15), color: 0xf6d677 });
    }
    for (const cell of b.cells) {
      if (cell.floor > view.maxFloor) continue;
      if (view.collision && cell.floor === 0 && cellPresent(cell)) {
        const r = cellWorldBox(b, cell);
        lines.push({ points: box(r.x, r.y, r.w, r.d), color: 0xff697c });
      }
      if (view.supports && cell.isSupport && cell.state !== "gone") {
        const x = b.x + (cell.gx + .5) * b.cellSize, y = b.y + (cell.gy + .5) * b.cellSize;
        lines.push({ points: [{ x, y, z: cell.floor * FLOOR_Z }, { x, y, z: (cell.floor + 1) * FLOOR_Z }],
          color: cellPresent(cell) ? 0x53efb2 : 0xff697c });
      }
    }
    if (view.collision) for (const fixture of b.fixtures) {
      if (!fixtureSolid(b, fixture)) continue;
      const r = fixtureWorldBox(fixture);
      lines.push({ points: box(r.x, r.y, r.w, r.d), color: 0xffb347 });
    }
  }
  if (view.collision) {
    for (const p of town.props) if (!p.broken) lines.push({ points: box(p.x, p.y, p.w, p.d), color: 0xffb347 });
    const ring = Array.from({ length: 25 }, (_, i) => ({ x: dozer.x + Math.cos(i * Math.PI / 12) * DOZER.radius, y: dozer.y + Math.sin(i * Math.PI / 12) * DOZER.radius, z: .1 }));
    lines.push({ points: ring, color: 0xffffff });
  }
  return lines;
}

export function drawDebugOverlay(g: Graphics, town: Town, dozer: Dozer, view: DebugView): void {
  g.clear();
  if (![view.paths, view.lots, view.buildable, view.rooms, view.collision, view.supports].some(Boolean)) return;
  for (const line of debugLines(town, dozer, view)) {
    if (line.points.length < 2) continue;
    line.points.forEach((p, i) => {
      const s = worldToScreen(p.x, p.y, p.z ?? .08);
      if (i === 0) g.moveTo(s.x, s.y); else g.lineTo(s.x, s.y);
    });
    g.stroke({ color: line.color, width: 1.4, alpha: .9 });
  }
}
