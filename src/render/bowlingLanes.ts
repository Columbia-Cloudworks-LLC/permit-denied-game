import type { Graphics } from 'pixi.js';
import type { Building } from '../structure/types';
import type { InteriorFloorSpan } from '../structure/interior';
import { FLOOR_Z } from '../game/constants';
import { drawTopCap } from './drawIso';

/** Paint clipped into the slab, with no collision, health, mass or debris lifetime. */
export function drawBowlingLanes(g: Graphics, b: Building, span: InteriorFloorSpan, alpha: number): void {
  const cs = b.cellSize, bw = b.w * cs, bd = b.d * cs;
  for (const room of b.layout.rooms) {
    if (room.floor !== span.floor) continue;
    for (const lane of room.floorDesigns ?? []) {
      const x = b.x + (room.x + lane.x * room.w) * bw;
      const y = b.y + (room.y + lane.y * room.d) * bd;
      const w = lane.w * room.w * bw, d = lane.d * room.d * bd;
      const paint = (u: number, v: number, uw: number, vd: number, color: number) => {
        const left = Math.max(x + u*w, b.x + span.gx0*cs), right = Math.min(x + (u+uw)*w, b.x + (span.gx1+1)*cs);
        const top = Math.max(y + v*d, b.y + span.gy0*cs), bottom = Math.min(y + (v+vd)*d, b.y + (span.gy1+1)*cs);
        if (right > left && bottom > top) drawTopCap(g, left, top, right-left, bottom-top, span.floor*FLOOR_Z+.182, color, alpha);
      };
      paint(0,0,1,1,0x574533); paint(.09,0,.82,1,0xcda06b);
      for (const u of [.23,.36,.49,.62,.75]) paint(u,0,.008,1,0x9c744c);
      paint(.09,.89,.82,.012,0x49392f);
      for (let i=0;i<5;i++) paint(.26+i*.12,.68+Math.abs(i-2)*.018,.025,.014,0x49392f);
    }
  }
}
