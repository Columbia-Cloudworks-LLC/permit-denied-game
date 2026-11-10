import { Graphics } from "pixi.js";
import { DOZER } from "../game/constants";
import type { Prop } from "../structure/types";
import type { Dozer } from "../vehicle/dozer";
import { depthKey } from "../world/iso";
import { drawOrientedIsoBox, headingOffset, PAL } from "./drawIso";

const CAR_BODY = [0x3d5c8a, 0x7a3a32, 0xc4bba4, 0x3a5a38] as const;
const CAR_DARK = [0x243850, 0x4a221c, 0x8a8270, 0x243824] as const;
const CAR_TOP = [0x4a74a4, 0x9a4a42, 0xd8d0b8, 0x4a7848] as const;

export function drawDozer(g: Graphics, d: Dozer, emphasis = false): void {
  const h = d.heading;
  const look = d.look;
  const [paint, dark, top] = liveryColors(look);
  const bladeZ = d.bladeDown ? 0.04 : 0.32;
  const reach = DOZER.bladeReach - 0.08 + (d.bladeDown ? 0.04 : 0);

  if (emphasis) {
    drawOrientedIsoBox(g, d.x, d.y, h, 3.6, 2.7, 0, 0.06, 0x1a140c, 0x1a140c, 0x1a140c, 0.85);
    drawOrientedIsoBox(g, d.x, d.y, h, 0.42, 0.42, 2.55, 1.05, 0xfff1b0, 0xc48a20, 0xffe08a, 1);
  }

  const shadow = headingOffset(d.x, d.y, h, 0.15, 0);
  drawOrientedIsoBox(g, shadow.x, shadow.y, h, 2.55, 1.72, 0, 0.02, PAL.shadow, PAL.shadow, PAL.shadow, 0.32);

  for (const side of [-1, 1]) {
    const track = headingOffset(d.x, d.y, h, -0.08, side * 0.62);
    drawOrientedIsoBox(g, track.x, track.y, h, 2.15, 0.4, 0.0, 0.3, PAL.dozerTrack, 0x151514, 0x33332e, 1);
    for (let i = 0; i < 6; i++) {
      const grouserAlong = -0.92 + i * 0.36 + ((d.odo * 0.55) % 0.36);
      if (Math.abs(grouserAlong) > 1.02) continue;
      const pad = headingOffset(track.x, track.y, h, grouserAlong, 0);
      drawOrientedIsoBox(g, pad.x, pad.y, h, 0.16, 0.44, 0.22, 0.1, 0x4a4a44, 0x1a1a18, 0x3a3a36, 1);
    }
    const idlerF = headingOffset(track.x, track.y, h, 0.88, 0);
    const idlerR = headingOffset(track.x, track.y, h, -0.88, 0);
    drawOrientedIsoBox(g, idlerF.x, idlerF.y, h, 0.28, 0.36, 0.08, 0.22, 0x5a5a54, 0x2a2a26, 0x44443e, 1);
    drawOrientedIsoBox(g, idlerR.x, idlerR.y, h, 0.28, 0.36, 0.08, 0.22, 0x5a5a54, 0x2a2a26, 0x44443e, 1);
  }

  // Hull pitch, roll and impact compression ride on the tracks; the tracks stay on the ground.
  const fx = Math.cos(h), fy = Math.sin(h), squash = d.lastImpact * 0.22;
  const zAt = (p: { x: number; y: number }, z: number) => {
    const dx = p.x - d.x, dy = p.y - d.y;
    return Math.max(0, z - d.pitch * (dx * fx + dy * fy) + d.roll * (dy * fx - dx * fy) - squash);
  };

  const belly = headingOffset(d.x, d.y, h, -0.12, 0);
  drawOrientedIsoBox(g, belly.x, belly.y, h, 1.55, 0.92, zAt(belly, 0.2), 0.22, dark, 0x6a5410, dark, 1);

  const engine = headingOffset(d.x, d.y, h, -0.52, 0.04);
  drawOrientedIsoBox(g, engine.x, engine.y, h, 1.05, 1.08, zAt(engine, 0.38), 0.58, paint, dark, top, 1);
  const grill = headingOffset(d.x, d.y, h, -1.02, 0.04);
  drawOrientedIsoBox(g, grill.x, grill.y, h, 0.12, 0.86, zAt(grill, 0.42), 0.42, 0x3a3a36, 0x1a1a18, 0x555550, 1);
  const stack = headingOffset(d.x, d.y, h, -0.72, 0.28);
  drawOrientedIsoBox(g, stack.x, stack.y, h, 0.12, 0.12, zAt(stack, 0.94), 0.55, 0x4a4844, 0x2a2824, 0x6a6864, 1);
  const cap = headingOffset(stack.x, stack.y, h, 0, 0);
  drawOrientedIsoBox(g, cap.x, cap.y, h, 0.18, 0.18, zAt(cap, 1.46), 0.08, 0x2a2824, 0x1a1814, 0x3a3834, 1);

  const ripper = headingOffset(d.x, d.y, h, -1.28, 0);
  if (look?.aux === 'seismic_ripper') {
    // A heavier shank; down, it bites into the ground.
    const down = !!look.auxActive;
    drawOrientedIsoBox(g, ripper.x, ripper.y, h, 0.3, 0.26, down ? 0 : zAt(ripper, 0.22), down ? 0.62 : 0.5, 0x8a3a20, 0x4a1e10, 0xc0582c, 1);
  } else drawOrientedIsoBox(g, ripper.x, ripper.y, h, 0.22, 0.18, zAt(ripper, 0.18), 0.42, PAL.blade, 0x4a4c50, 0x8a9094, 1);
  drawRearAttachment(g, d, h, zAt);

  const bladeCenter = headingOffset(d.x, d.y, h, reach, 0);
  const cabCenter = headingOffset(d.x, d.y, h, 0.02, -0.16);
  const bladeInFront = depthKey(bladeCenter.x, bladeCenter.y, 0.4) > depthKey(cabCenter.x, cabCenter.y, 0.9);

  const drawArmsAndBlade = () => {
    for (const side of [-1, 1]) {
      const root = headingOffset(d.x, d.y, h, 0.28, side * 0.42);
      const mid = headingOffset(d.x, d.y, h, 0.72, side * 0.5);
      drawOrientedIsoBox(g, root.x, root.y, h, 0.55, 0.13, zAt(root, 0.28), 0.16, dark, 0x6a5410, paint, 1);
      drawOrientedIsoBox(g, mid.x, mid.y, h, 0.7, 0.1, zAt(mid, bladeZ + 0.18), 0.12, PAL.blade, 0x4a4c50, 0x8a9094, 1);
    }
    for (let i = -2; i <= 2; i++) {
      const t = i / 2;
      const yaw = h + t * 0.38;
      const p = headingOffset(d.x, d.y, h, reach + Math.abs(t) * 0.14, t * DOZER.bladeHalf * 0.9);
      drawOrientedIsoBox(g, p.x, p.y, yaw, 0.2, DOZER.bladeHalf * 0.46, zAt(p, bladeZ), 0.58, PAL.blade, 0x4a4c50, 0xa8adb0, 1);
    }
    const lip = headingOffset(d.x, d.y, h, reach + 0.06, 0);
    drawOrientedIsoBox(g, lip.x, lip.y, h, 0.08, DOZER.bladeHalf * 1.72, zAt(lip, bladeZ + 0.5), 0.1, 0xb8bdc0, 0x6a6e72, PAL.blade, 1);
    if (look?.blade) {
      // Shaped-charge pucks along the blade top: cold while charging, hot orange when ready.
      const color = look.blade === 'armed' ? (look.flicker ? 0xfff2a0 : 0xff9a30) : look.blade === 'ready' ? 0xff7a1e : 0x5a4636;
      for (let i = -2; i <= 2; i++) {
        const puck = headingOffset(d.x, d.y, h, reach + 0.02, i * DOZER.bladeHalf * 0.36);
        drawOrientedIsoBox(g, puck.x, puck.y, h, 0.14, 0.16, zAt(puck, bladeZ + 0.6), 0.09, color, 0x2a1a10, color, 1);
      }
    }
  };

  const drawCab = () => {
    const cab = headingOffset(d.x, d.y, h, 0.02, -0.16);
    drawOrientedIsoBox(g, cab.x, cab.y, h, 0.78, 0.74, zAt(cab, 0.72), 0.7, PAL.dozerCabin, 0x1a2830, 0x3a5568, 1);
    const glass = headingOffset(d.x, d.y, h, 0.18, -0.16);
    drawOrientedIsoBox(g, glass.x, glass.y, h, 0.42, 0.62, zAt(glass, 0.92), 0.38, PAL.cabGlass, 0x1a3040, 0x4a7088, 0.92);
    const roof = headingOffset(d.x, d.y, h, 0.02, -0.16);
    drawOrientedIsoBox(g, roof.x, roof.y, h, 0.82, 0.78, zAt(roof, 1.38), 0.1, paint, dark, top, 1);
    const lightL = headingOffset(d.x, d.y, h, 0.42, -0.38);
    const lightR = headingOffset(d.x, d.y, h, 0.42, 0.08);
    drawOrientedIsoBox(g, lightL.x, lightL.y, h, 0.08, 0.1, zAt(lightL, 0.86), 0.1, PAL.asphaltLine, 0x8a7a30, 0xf0e080, 1);
    drawOrientedIsoBox(g, lightR.x, lightR.y, h, 0.08, 0.1, zAt(lightR, 0.86), 0.1, PAL.asphaltLine, 0x8a7a30, 0xf0e080, 1);
    if (look?.blade === 'ready' || look?.blade === 'armed') {
      // ROPS amber beacon.
      const lit = look.blade === 'ready' || look.flicker;
      drawOrientedIsoBox(g, roof.x, roof.y, h, 0.16, 0.16, zAt(roof, 1.48), 0.14, lit ? 0xffc030 : 0x7a5a10, 0x8a5a10, lit ? 0xffe080 : 0x9a7020, 1);
    }
  };

  if (bladeInFront) {
    drawCab();
    drawArmsAndBlade();
  } else {
    drawArmsAndBlade();
    drawCab();
  }
  if (look?.cable) drawCable(g, d, look.cable);
}

const LIVERIES: Record<string, readonly [number, number, number]> = {
  'livery:hazard': [0x24241f, 0x12120f, 0xf2c218],
  'livery:black-ops': [0x2c2f2c, 0x171917, 0x3e423e],
  'livery:chrome': [0xc2c7cc, 0x737a80, 0xf4f8fa],
  'livery:gold': [0xe2b02c, 0x8a6410, 0xffe27a],
};

function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return m(16) | m(8) | m(0);
}

/** Paint for the hull, its shaded side and its lit top, dulled by stage grime. */
function liveryColors(look: Dozer['look']): [number, number, number] {
  const base = (look && LIVERIES[look.livery]) ?? [PAL.dozer, PAL.dozerDark, 0xf0cc42];
  const grime = Math.max(0, Math.min(1, look?.wear ?? 0)) * 0.42;
  return [mix(base[0], 0x4a3d2a, grime), mix(base[1], 0x2a2218, grime), mix(base[2], 0x5a4a30, grime)];
}

/** Everything about the look that changes the drawing, for the render cache. */
export function lookKey(d: Dozer): string {
  const l = d.look;
  if (!l) return '';
  const c = l.cable;
  return [l.livery, Math.round(l.wear * 10), l.blade ?? '', l.aux ?? '', l.auxActive ? 1 : 0, l.blade === 'armed' && l.flicker ? 1 : 0,
    c ? `${c.x.toFixed(1)},${c.y.toFixed(1)}` : ''].join('/');
}

/** Rear slot hardware: JATO tubes (and flame), or the harpoon winch. */
function drawRearAttachment(g: Graphics, d: Dozer, h: number, zAt: (p: { x: number; y: number }, z: number) => number): void {
  const look = d.look;
  if (look?.aux === 'jato_thrusters') {
    for (const side of [-1, 1]) {
      const tube = headingOffset(d.x, d.y, h, -1.08, side * 0.46);
      drawOrientedIsoBox(g, tube.x, tube.y, h, 0.62, 0.2, zAt(tube, 0.78), 0.2, 0x6a6e72, 0x3a3c40, 0x9aa0a4, 1);
      if (!look.auxActive) continue;
      const flame = headingOffset(d.x, d.y, h, -1.62, side * 0.46);
      drawOrientedIsoBox(g, flame.x, flame.y, h, 0.6, 0.16, zAt(flame, 0.8), 0.16, 0xffe080, 0xff8a20, 0xfff4c0, 0.9);
    }
  } else if (look?.aux === 'wrecking_harpoon') {
    const drum = headingOffset(d.x, d.y, h, -1.02, -0.34);
    drawOrientedIsoBox(g, drum.x, drum.y, h, 0.3, 0.42, zAt(drum, 0.9), 0.3, 0x3a3a36, 0x1a1a18, 0x5a5a54, 1);
  }
}

/** The harpoon's steel cable, as a run of thin links from the winch to its anchor. */
function drawCable(g: Graphics, d: Dozer, to: { x: number; y: number; z: number }): void {
  const from = headingOffset(d.x, d.y, d.heading, -1.02, -0.34);
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  const links = Math.max(2, Math.min(24, Math.ceil(length / 1.2)));
  const heading = Math.atan2(dy, dx);
  for (let i = 0; i < links; i++) {
    const t = (i + 0.5) / links;
    const sag = Math.sin(t * Math.PI) * 0.18;
    drawOrientedIsoBox(g, from.x + dx * t, from.y + dy * t, heading, length / links, 0.06, Math.max(0.05, 1.05 + (to.z - 1.05) * t - sag), 0.06, 0x2a2a28, 0x121210, 0x4a4a46, 1);
  }
}



export function drawCar(g: Graphics, p: Prop): void {
  const cx = p.x + p.w * 0.5;
  const cy = p.y + p.d * 0.5;
  const h = p.heading;
  const len = Math.max(p.w, p.d);
  const wid = Math.min(p.w, p.d);
  const idx = Math.abs(p.id) % CAR_BODY.length;
  const body = CAR_BODY[idx]!;
  const dark = CAR_DARK[idx]!;
  const top = CAR_TOP[idx]!;

  drawOrientedIsoBox(g, cx, cy, h, len, wid, 0, 0.02, PAL.shadow, PAL.shadow, PAL.shadow, 0.28);

  for (const along of [-len * 0.32, len * 0.3]) {
    for (const across of [-wid * 0.42, wid * 0.42]) {
      const w = headingOffset(cx, cy, h, along, across);
      drawOrientedIsoBox(g, w.x, w.y, h, 0.32, 0.16, 0.0, 0.22, 0x1a1a1c, 0x0c0c0e, 0x2a2a2e, 1);
    }
  }

  const hull = headingOffset(cx, cy, h, -0.02, 0);
  drawOrientedIsoBox(g, hull.x, hull.y, h, len * 0.92, wid * 0.78, 0.16, 0.28, top, dark, body, 1);
  const hood = headingOffset(cx, cy, h, len * 0.28, 0);
  drawOrientedIsoBox(g, hood.x, hood.y, h, len * 0.28, wid * 0.7, 0.4, 0.1, top, dark, body, 1);
  const cabin = headingOffset(cx, cy, h, -0.06, 0);
  drawOrientedIsoBox(g, cabin.x, cabin.y, h, len * 0.42, wid * 0.68, 0.42, 0.38, PAL.cabGlass, 0x1a2830, 0x3a5060, 1);
  const roof = headingOffset(cx, cy, h, -0.08, 0);
  drawOrientedIsoBox(g, roof.x, roof.y, h, len * 0.36, wid * 0.62, 0.78, 0.08, dark, 0x141820, body, 1);
  const bumper = headingOffset(cx, cy, h, len * 0.46, 0);
  drawOrientedIsoBox(g, bumper.x, bumper.y, h, 0.1, wid * 0.72, 0.18, 0.16, PAL.blade, 0x3a3c40, 0x8a9094, 1);
}
