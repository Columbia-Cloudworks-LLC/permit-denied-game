import type { Graphics } from 'pixi.js';
import { ISO_W, ISO_Z } from '../game/constants';
import { MONORAIL, monorailPoint, monorailSpanEnds, type MonorailState } from '../sim/monorail';
import { vehicleDefinition } from '../vehicle/definitions';
import { ferryLeadingSide } from '../vehicle/ferry';
import { FERRY } from '../vehicle/runtime';
import type { VehicleState } from '../vehicle/types';
import { MONORAIL_BEAM, RAIL_BED, type CityPlanCanopy, type CityPlanFountain, type CityPlanRail } from '../world/cityPlan';
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

const BEAM_CHUNK = 2.4;
const BEAM_CONCRETE = 0xcfcdc5;
const CAR_GLASS = 0x2c3e4c;

/** A drawn piece of a beamway with the ground box it stands over, for culling. */
export interface DecorPiece { x: number; y: number; w: number; d: number; h: number; cmd: Cmd }

/** A box on the world axes as the camera sees it: top, east face and south face. The top may slope along the line. */
function slab(g: Graphics, corners: readonly [Point, Point, Point, Point], depth: number, color: number, alpha: number): void {
  // Corners run north-west, north-east, south-east, south-west, each at its own top height.
  const [nw, ne, se, sw] = corners, under = (p: Point): Point => ({ ...p, z: Math.max(0.02, p.z - depth) });
  drawWorldPoly(g, [nw, ne, se, sw], shade(color, 1.08), alpha);
  drawWorldPoly(g, [under(ne), under(se), se, ne], shade(color, 0.9), alpha);
  drawWorldPoly(g, [under(sw), under(se), se, sw], shade(color, 0.72), alpha);
}

/**
 * A beamway's beams, cut into short lengths so each sorts against the buildings beside it, and
 * the cars still on it. A beam that has let go hangs from the end that still has a pylon, then
 * drops; a car on it is pitched off to its side. `near` thins the pieces over the dozer.
 */
export function monorailPieces(state: MonorailState, near: (x: number, y: number) => boolean): DecorPiece[] {
  const { line } = state, pieces: DecorPiece[] = [], half = MONORAIL_BEAM.half;
  const corners = (a0: number, a1: number, c0: number, c1: number, z0: number, z1: number): [Point, Point, Point, Point] => {
    const p = (along: number, across: number, z: number): Point => ({ ...monorailPoint(line, along, across), z });
    // `a0` is the north or west end of the piece and `c0` its north or west side.
    return line.axis === 'x' ? [p(a0, c0, z0), p(a1, c0, z1), p(a1, c1, z1), p(a0, c1, z0)] : [p(a0, c0, z0), p(a0, c1, z0), p(a1, c1, z1), p(a1, c0, z1)];
  };
  const box = (a0: number, a1: number, pad: number) => {
    const at = monorailPoint(line, a0, -pad);
    return line.axis === 'x' ? { x: at.x, y: at.y, w: a1 - a0, d: pad * 2 } : { x: at.x, y: at.y, w: pad * 2, d: a1 - a0 };
  };
  for (const span of state.spans) {
    if (span.phase === 'down') continue;
    const ends = monorailSpanEnds(span), count = Math.max(1, Math.ceil((span.to - span.from) / BEAM_CHUNK)), step = (span.to - span.from) / count;
    for (let i = 0; i < count; i++) {
      const a0 = span.from + i * step, a1 = a0 + step;
      const z0 = ends.low + (ends.high - ends.low) * (i / count), z1 = ends.low + (ends.high - ends.low) * ((i + 1) / count);
      const quad = corners(a0, a1, -half, half, z0, z1), far = quad[2], mid = monorailPoint(line, (a0 + a1) / 2);
      const alpha = near(mid.x, mid.y) ? 0.45 : 1;
      pieces.push({ ...box(a0, a1, half), h: MONORAIL_BEAM.height, cmd: { depth: depthKey(far.x, far.y, Math.max(z0, z1)), run: g => slab(g, quad, MONORAIL_BEAM.depth, BEAM_CONCRETE, alpha) } });
    }
  }
  const car = vehicleDefinition(MONORAIL.car), paint = car.paints[0], wide = car.width / 2, tall = car.height - 0.5;
  for (const riding of state.cars) {
    if (riding.phase === 'down') continue;
    const p = riding.phase === 'falling' ? Math.min(1, riding.t / MONORAIL.fall) : 0;
    const shift = riding.side * MONORAIL.offset * p, floor = MONORAIL_BEAM.height * (1 - p * p), top = floor + tall;
    const a0 = riding.along - riding.length / 2, a1 = riding.along + riding.length / 2, mid = monorailPoint(line, riding.along, shift);
    const body = corners(a0, a1, shift - wide, shift + wide, top, top), far = body[2];
    const band = corners(a0 + 0.5, a1 - 0.5, shift - wide - 0.01, shift + wide + 0.01, floor + tall * 0.78, floor + tall * 0.78);
    const alpha = near(mid.x, mid.y) ? 0.5 : 1;
    pieces.push({ ...box(a0, a1, wide + MONORAIL.offset), h: MONORAIL_BEAM.height + tall, cmd: {
      depth: depthKey(far.x, far.y, top) + 1,
      run: g => {
        // The skirts hang down either side of the beam; the glazing is a dark band along the body.
        slab(g, body, tall + 0.35, paint, alpha);
        const [, ne, se, sw] = band, drop = (q: Point): Point => ({ ...q, z: q.z - tall * 0.34 });
        drawWorldPoly(g, [drop(ne), drop(se), se, ne], CAR_GLASS, alpha);
        drawWorldPoly(g, [drop(sw), drop(se), se, sw], shade(CAR_GLASS, 0.8), alpha);
      },
    } });
  }
  return pieces;
}

const FOAM = 0xf2f8fb;
const SPRAY_PLUMES = 7;

/** A drifting hull's wash and the spray where it ran ashore, both flat on the water or facing the camera. Nothing for a moored hull at rest. */
export function ferryWaterCommands(v: VehicleState): Cmd[] {
  const seat = v.afloat;
  if (!seat) return [];
  const cmds: Cmd[] = [], speed = Math.hypot(v.vx, v.vy);
  if (!seat.moored && speed > 0.35) {
    const nx = v.vx / speed, ny = v.vy / speed, strength = Math.min(1, speed / 3.5);
    const lead = ferryLeadingSide(v, nx, ny, 0.15), trail = ferryLeadingSide(v, -nx, -ny, 0.1);
    const reach = 1.5 + speed * 1.3, flare = 0.3;
    const wx = (trail.x1 - trail.x0) * flare, wy = (trail.y1 - trail.y0) * flare;
    cmds.push({
      depth: depthKey(Math.min(trail.x0, trail.x1) - reach, Math.min(trail.y0, trail.y1) - reach, 0),
      run: g => {
        // The wash spreads astern of the side it is leaving; the bow wave piles up along the side it leads with.
        drawWorldPoly(g, [
          { x: trail.x0, y: trail.y0, z: 0.03 }, { x: trail.x1, y: trail.y1, z: 0.03 },
          { x: trail.x1 + wx - nx * reach, y: trail.y1 + wy - ny * reach, z: 0.03 }, { x: trail.x0 - wx - nx * reach, y: trail.y0 - wy - ny * reach, z: 0.03 },
        ], FOAM, 0.28 * strength);
        drawWorldPoly(g, [
          { x: lead.x0, y: lead.y0, z: 0.04 }, { x: lead.x1, y: lead.y1, z: 0.04 },
          { x: lead.x1 + nx * 0.7 * strength, y: lead.y1 + ny * 0.7 * strength, z: 0.04 }, { x: lead.x0 + nx * 0.7 * strength, y: lead.y0 + ny * 0.7 * strength, z: 0.04 },
        ], FOAM, 0.75 * strength);
      },
    });
  }
  const splash = seat.splash;
  if (splash) {
    const p = splash.t / FERRY.splash, rise = Math.sin(Math.min(1, p) * Math.PI);
    for (let i = 0; i < SPRAY_PLUMES; i++) {
      const t = (i + 0.5) / SPRAY_PLUMES, x = splash.x0 + (splash.x1 - splash.x0) * t, y = splash.y0 + (splash.y1 - splash.y0) * t;
      // The middle of the line goes highest, and no two plumes match.
      const top = (1.4 + 2.4 * Math.sin(t * Math.PI)) * (0.7 + 0.3 * Math.sin(i * 2.4)) * rise, girth = 0.5;
      const at = (side: number, z: number): Point => ({ x: x + side * DIAG, y: y - side * DIAG, z });
      cmds.push({
        depth: depthKey(x, y, top) + 4,
        run: g => {
          drawWorldPoly(g, ring(x, y, 0.05, 0.6 + p * 1.6, 8), FOAM, 0.4 * (1 - p));
          drawWorldPoly(g, [at(-girth, 0.05), at(girth, 0.05), at(girth * 0.5, top), at(-girth * 0.5, top)], WATER, 0.6 * (1 - p * 0.7));
          drawWorldPoly(g, Array.from({ length: 8 }, (_, k) => {
            const a = k / 8 * Math.PI * 2;
            return at(Math.cos(a) * girth * 1.3 * FACE * 2, top + Math.sin(a) * girth * 1.2);
          }), SPRAY, 0.7 * (1 - p));
        },
      });
    }
  }
  return cmds;
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
