import type { Graphics } from 'pixi.js';
import { ISO_W, ISO_Z } from '../game/constants';
import { RAIL_BED, type CityPlanCanopy, type CityPlanFountain, type CityPlanRail } from '../world/cityPlan';
import { depthKey } from '../world/iso';
import { drawWorldPoly } from './drawIso';
import { shade } from './palette';

/**
 * Drawn-only dressing a city plan asks for: fountain jets playing on its water and a vaulted
 * canopy over a street. Neither has a body in the simulation.
 */
type Cmd = { depth: number; run: (g: Graphics) => void };
type Point = { x: number; y: number; z: number };

const DIAG = Math.SQRT1_2;
/** World distance along the screen's horizontal that draws as long as one unit of height. */
const FACE = ISO_Z / (ISO_W * Math.SQRT2);
const WATER = 0xdff2fb;
const SPRAY = 0xffffff;

/** Height of jet `i` of `jets` at `time`, as a share of the fountain's full height: a wave run along the row over a slow swell. */
export function fountainJetShare(i: number, jets: number, time: number): number {
  const along = jets > 1 ? i / (jets - 1) : 0.5;
  const wave = Math.sin(time * 2.1 - along * Math.PI * 2.5) * 0.5 + 0.5;
  const swell = Math.sin(time * 0.45) * 0.5 + 0.5;
  // The middle of the row plays tallest.
  const crown = 0.65 + 0.35 * Math.sin(along * Math.PI);
  return (0.22 + 0.78 * wave * (0.35 + 0.65 * swell)) * crown;
}

/** One command per jet: a tapered plume facing the camera, a plume head of spray, and a ring where it falls back. */
export function fountainCommands(fountain: CityPlanFountain, time: number): Cmd[] {
  const cmds: Cmd[] = [];
  for (let i = 0; i < fountain.jets; i++) {
    const t = fountain.jets > 1 ? i / (fountain.jets - 1) : 0.5;
    const x = fountain.x0 + (fountain.x1 - fountain.x0) * t, y = fountain.y0 + (fountain.y1 - fountain.y0) * t;
    const top = fountain.height * fountainJetShare(i, fountain.jets, time);
    const girth = 0.16 + fountain.height * 0.018;
    // Screen-right is world (+x, -y).
    const at = (side: number, z: number): Point => ({ x: x + side * DIAG, y: y - side * DIAG, z });
    cmds.push({
      depth: depthKey(x, y, top),
      run: g => {
        drawWorldPoly(g, ring(x, y, 0.05, girth * 3.2, 8), WATER, 0.35);
        drawWorldPoly(g, [at(-girth, 0.05), at(girth, 0.05), at(girth * 0.45, top), at(-girth * 0.45, top)], WATER, 0.7);
        drawWorldPoly(g, [at(-girth * 0.4, 0.05), at(girth * 0.4, 0.05), at(girth * 0.15, top), at(-girth * 0.15, top)], SPRAY, 0.85);
        drawWorldPoly(g, Array.from({ length: 8 }, (_, k) => {
          const a = k / 8 * Math.PI * 2;
          return at(Math.cos(a) * girth * 1.5 * FACE * 2, top + Math.sin(a) * girth * 1.5);
        }), SPRAY, 0.55);
      },
    });
  }
  return cmds;
}

function ring(x: number, y: number, z: number, r: number, sides: number): Point[] {
  return Array.from({ length: sides }, (_, k) => ({ x: x + Math.cos(k / sides * Math.PI * 2) * r, y: y + Math.sin(k / sides * Math.PI * 2) * r, z }));
}

const RAIL_CHUNK = 6;
const RAIL_GAUGE = 0.52;
const RAIL_STEEL = 0x8f959c;
const RAIL_TIE = 0x4a3a2c;
const RAIL_BALLAST = 0x8d877c;

/** A rail line cut into short lengths along its run, each with the box it covers, so the track culls and sorts piecewise. */
export function railChunks(rail: CityPlanRail): { from: number; to: number; x: number; y: number; w: number; d: number }[] {
  const count = Math.max(1, Math.ceil((rail.to - rail.from) / RAIL_CHUNK)), step = (rail.to - rail.from) / count;
  return Array.from({ length: count }, (_, i) => {
    const from = rail.from + i * step, to = from + step;
    return rail.axis === 'x'
      ? { from, to, x: from, y: rail.at - RAIL_BED.half, w: step, d: RAIL_BED.half * 2 }
      : { from, to, x: rail.at - RAIL_BED.half, y: from, w: RAIL_BED.half * 2, d: step };
  });
}

/** One length of track: a bed of ballast, timber ties across it and the two rails over them. It lies on the ground, so it sorts behind anything standing on it. */
export function railChunkCommand(rail: CityPlanRail, chunk: { from: number; to: number }): Cmd {
  const point = (along: number, across: number, z: number): Point => rail.axis === 'x' ? { x: along, y: rail.at + across, z } : { x: rail.at + across, y: along, z };
  const strip = (g: Graphics, a0: number, a1: number, c0: number, c1: number, z: number, color: number) =>
    drawWorldPoly(g, [point(a0, c0, z), point(a1, c0, z), point(a1, c1, z), point(a0, c1, z)], color, 1);
  const far = point(chunk.from, -RAIL_BED.half, 0);
  return {
    depth: depthKey(far.x, far.y, 0),
    run: g => {
      strip(g, chunk.from, chunk.to, -RAIL_BED.half, RAIL_BED.half, 0.015, RAIL_BALLAST);
      strip(g, chunk.from, chunk.to, -RAIL_BED.half * 0.72, RAIL_BED.half * 0.72, 0.02, shade(RAIL_BALLAST, 1.12));
      const ties = Math.max(1, Math.round((chunk.to - chunk.from) / 0.75)), pitch = (chunk.to - chunk.from) / ties;
      for (let i = 0; i < ties; i++) {
        const at = chunk.from + (i + 0.5) * pitch;
        strip(g, at - 0.13, at + 0.13, -RAIL_GAUGE - 0.24, RAIL_GAUGE + 0.24, 0.03, RAIL_TIE);
      }
      for (const side of [-1, 1]) {
        strip(g, chunk.from, chunk.to, side * RAIL_GAUGE - 0.06, side * RAIL_GAUGE + 0.06, 0.07, RAIL_STEEL);
        strip(g, chunk.from, chunk.to, side * RAIL_GAUGE - 0.06, side * RAIL_GAUGE - 0.01, 0.075, shade(RAIL_STEEL, 1.35));
      }
    },
  };
}

const BAY = 4;
const VAULT_STRIPS = 6;
const SCREEN_HUES = [0x49c8ff, 0xff6ec7, 0xffd24a, 0x8cff9e] as const;

/** Where a canopy stands: its length along the street cut into bays, each with the box it covers. */
export function canopyBays(canopy: CityPlanCanopy): { from: number; to: number; x: number; y: number; w: number; d: number }[] {
  const count = Math.max(1, Math.round((canopy.to - canopy.from) / BAY)), step = (canopy.to - canopy.from) / count;
  return Array.from({ length: count }, (_, i) => {
    const from = canopy.from + i * step, to = from + step;
    return canopy.axis === 'x'
      ? { from, to, x: from, y: canopy.at - canopy.halfWidth, w: step, d: canopy.halfWidth * 2 }
      : { from, to, x: canopy.at - canopy.halfWidth, y: from, w: canopy.halfWidth * 2, d: step };
  });
}

/**
 * One bay of the vault: a column at each kerb and a barrel of screen panels sprung between
 * them. `alpha` drops when the dozer is underneath so the street stays readable.
 */
export function canopyBayCommand(canopy: CityPlanCanopy, bay: { from: number; to: number }, index: number, alpha: number): Cmd {
  const spring = canopy.height * 0.55;
  const point = (along: number, across: number, z: number): Point => canopy.axis === 'x' ? { x: along, y: canopy.at + across, z } : { x: canopy.at + across, y: along, z };
  const vault = (strip: number): { across: number; z: number } => {
    const a = Math.PI * (1 - strip / VAULT_STRIPS);
    return { across: Math.cos(a) * canopy.halfWidth, z: spring + Math.sin(a) * (canopy.height - spring) };
  };
  const far = point(bay.to, canopy.halfWidth, 0);
  return {
    depth: depthKey(far.x, far.y, canopy.height),
    run: g => {
      for (const side of [-1, 1]) {
        const across = side * canopy.halfWidth, w = 0.16;
        drawWorldPoly(g, [point(bay.from, across - w, 0), point(bay.from, across + w, 0), point(bay.from, across + w, spring), point(bay.from, across - w, spring)], shade(canopy.color, 0.55), alpha + 0.3);
      }
      for (let strip = 0; strip < VAULT_STRIPS; strip++) {
        const a = vault(strip), c = vault(strip + 1);
        const lit = (strip + index) % 3 === 0 ? SCREEN_HUES[(strip + index * 3) % SCREEN_HUES.length]! : shade(canopy.color, 0.7 + 0.3 * Math.sin((strip + 0.5) / VAULT_STRIPS * Math.PI));
        drawWorldPoly(g, [point(bay.from, a.across, a.z), point(bay.to, a.across, a.z), point(bay.to, c.across, c.z), point(bay.from, c.across, c.z)], lit, alpha);
      }
      // The rib at the head of the bay.
      for (let strip = 0; strip < VAULT_STRIPS; strip++) {
        const a = vault(strip), c = vault(strip + 1);
        drawWorldPoly(g, [point(bay.from, a.across, a.z), point(bay.from + 0.14, a.across, a.z), point(bay.from + 0.14, c.across, c.z), point(bay.from, c.across, c.z)], shade(canopy.color, 0.5), Math.min(1, alpha + 0.3));
      }
    },
  };
}
