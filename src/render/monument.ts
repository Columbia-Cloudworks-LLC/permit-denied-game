import type { Graphics } from 'pixi.js';
import type { DebugView } from '../debug/view';
import { ISO_W, ISO_Z } from '../game/constants';
import { MONUMENT_BALL_GIRTH, monumentPose, monumentSeat, SPAN_LANDING, spanFall, spanPoint, type MonumentDef, type MonumentFigure } from '../structure/monument';
import type { Building } from '../structure/types';
import { depthKey } from '../world/iso';
import { drawWorldPoly } from './drawIso';
import { shade } from './palette';

type Point = { x: number; y: number; z: number };
type Cmd = { depth: number; run: (g: Graphics) => void };
/** A point in the statue's own frame: `side` to the viewer's right, `front` toward the viewer, `up`. */
type Local = { side: number; front: number; up: number };

const SIDES = 10;
const DIAG = Math.SQRT1_2;
const FLAME = 0xe9b949;
/** Width across the screen that draws as long as one unit of height: a flat shape facing the camera is this much narrower than tall. */
const FACE = ISO_Z / (ISO_W * Math.SQRT2);

/**
 * The statue as one painter-sorted assembly, drawn after its plinth. Every part is a stack of
 * tapered rings, so the same panels serve standing, leaning and falling: only the pose changes.
 */
export function monumentCommands(b: Building, view: DebugView): Cmd[] {
  const s = b.monument!;
  if (s.phase === 'gone' || !view.walls || view.maxFloor < b.floors - 1) return [];
  const seat = monumentSeat(b);
  const pose = monumentPose(b), cos = Math.cos(pose.theta), sin = Math.sin(pose.theta);
  // A crumbling figure sags and spreads; a rolling one turns about its own centre in the plane of travel.
  const sag = 1 - 0.88 * pose.squash, spread = 1 + 0.3 * pose.squash;
  // A ball is authored round and turned round, then narrowed to its girth on the ground.
  const ball = s.definition.figure === 'sphere';
  const spinCos = Math.cos(pose.spin), spinSin = Math.sin(pose.spin), centre = pose.height / 2;
  const girth = ball ? MONUMENT_BALL_GIRTH : 1;
  const place = (local: Local): Point => {
    const side = local.side * spread, front = local.front * spread;
    let up = local.up * sag;
    // Screen-right is world (+x, -y); toward the viewer is world (+x, +y).
    let ox = (side + front) * DIAG, oy = (front - side) * DIAG;
    let along = ox * pose.dx + oy * pose.dy;
    if (ball) {
      const turned = along * spinCos + (up - centre) * spinSin;
      up = centre + (up - centre) * spinCos - along * spinSin;
      ox = (ox + (turned - along) * pose.dx) * girth;
      oy = (oy + (turned - along) * pose.dy) * girth;
      along = turned * girth;
    }
    const swung = along * cos + up * sin;
    return {
      x: pose.x + ox - along * pose.dx + pose.dx * swung,
      y: pose.y + oy - along * pose.dy + pose.dy * swung,
      z: Math.max(0.08, pose.z + up * cos - along * sin),
    };
  };
  const panels: (Cmd & { order: number })[] = [];
  const add: Add = (points, color, order = 0) => {
    const world = points.map(place);
    panels.push({ order, depth: Math.max(...world.map(p => depthKey(p.x, p.y, p.z))), run: g => drawWorldPoly(g, world, color) });
  };
  // Parts that do not fall with the figure (a bridge's deck and river piers) keep the upright seat.
  const still: Add = (points, color, order = 0) => {
    const world = points.map(local => ({
      x: seat.x + (local.side + local.front) * DIAG, y: seat.y + (local.front - local.side) * DIAG, z: Math.max(0.05, seat.z + local.up),
    }));
    panels.push({ order, depth: Math.max(...world.map(p => depthKey(p.x, p.y, p.z))), run: g => drawWorldPoly(g, world, color) });
  };
  FIGURES[s.definition.figure](add, pose.height, s.definition.color, { definition: s.definition, still, fall: spanFall(s), standing: s.phase !== 'chain', drop: seat.z });
  // A figure's own layers first (a deck over the legs under it, features over a face), then back to front.
  panels.sort((a, c) => a.order - c.order || a.depth - c.depth);
  // One command, just past the near corner of the roof deck and its parapet, so the plinth never paints through the figure standing on it.
  const cx = b.x + b.w * b.cellSize, cy = b.y + b.d * b.cellSize;
  const depth = Math.max(depthKey(cx + 0.3, cy + 0.3, b.floors * 4) + 16, ...panels.map(p => p.depth));
  return [{ depth, run: g => { for (const panel of panels) panel.run(g); } }];
}

/**
 * Adds one panel. Depth alone cannot order panels that share a plane or stack up a tower, so a
 * figure may give a panel an `order`: higher orders paint over lower ones, whatever their depth.
 */
type Add = (points: Local[], color: number, order?: number) => void;
/** What a figure with parts of its own to animate is told: its definition, an `add` that stays put while the figure falls, how far its span has dropped, whether the figure itself still stands, and the plinth's height. */
interface FigureScene {
  definition: MonumentDef;
  still: Add;
  fall: ReturnType<typeof spanFall>;
  standing: boolean;
  drop: number;
}
/** The same `add`, with every panel on one layer. */
const layer = (add: Add, order: number): Add => (points, color) => add(points, color, order);
interface Ring { up: number; r: number; side?: number; front?: number }

/** Light falls from the viewer's upper right: panels facing it are brightest. */
const lit = (color: number, i: number, sides: number): number =>
  shade(color, 0.6 + 0.38 * (Math.cos((i + 0.5) / sides * Math.PI * 2 - 0.9) + 1) / 2);

const ringPoint = (ring: Ring, i: number, sides: number): Local => ({
  side: (ring.side ?? 0) + Math.cos(i / sides * Math.PI * 2) * ring.r,
  front: (ring.front ?? 0) + Math.sin(i / sides * Math.PI * 2) * ring.r,
  up: ring.up,
});

/** A tapered tube between two rings, which may be offset from one another (an arm). */
function tube(add: Add, a: Ring, c: Ring, color: number, sides = SIDES): void {
  for (let i = 0; i < sides; i++) {
    add([ringPoint(a, i, sides), ringPoint(a, i + 1, sides), ringPoint(c, i + 1, sides), ringPoint(c, i, sides)], lit(color, i, sides));
  }
}

function cap(add: Add, ring: Ring, color: number, sides = SIDES): void {
  add(Array.from({ length: sides }, (_, i) => ringPoint(ring, i, sides)), color);
}

/** Robed figure, crowned head, tablet in the left arm and a torch held high in the right. */
function libertyFigure(add: Add, height: number, copper: number): void {
  const u = height / 14, at = (share: number) => height * share;
  const dark = shade(copper, 0.78), pale = shade(copper, 1.12);
  // Robe, waist and shoulders.
  tube(add, { up: 0, r: 1.3 * u }, { up: at(0.4), r: 0.98 * u }, copper);
  tube(add, { up: at(0.4), r: 0.98 * u }, { up: at(0.64), r: 0.86 * u }, copper);
  tube(add, { up: at(0.64), r: 0.86 * u }, { up: at(0.73), r: 0.98 * u }, pale);
  tube(add, { up: at(0.73), r: 0.98 * u }, { up: at(0.775), r: 0.34 * u }, pale);
  // Left arm cradling the tablet, on the viewer's right.
  tube(add, { up: at(0.5), r: 0.3 * u, side: 0.98 * u, front: 0.25 * u }, { up: at(0.7), r: 0.32 * u, side: 0.9 * u }, dark, 6);
  tube(add, { up: at(0.5), r: 0.44 * u, side: 1.12 * u, front: 0.5 * u }, { up: at(0.67), r: 0.44 * u, side: 1.12 * u, front: 0.5 * u }, pale, 4);
  cap(add, { up: at(0.67), r: 0.44 * u, side: 1.12 * u, front: 0.5 * u }, pale, 4);
  // Neck and head.
  tube(add, { up: at(0.775), r: 0.3 * u }, { up: at(0.8), r: 0.3 * u }, dark);
  tube(add, { up: at(0.8), r: 0.42 * u }, { up: at(0.845), r: 0.52 * u }, copper);
  tube(add, { up: at(0.845), r: 0.52 * u }, { up: at(0.885), r: 0.4 * u }, copper);
  cap(add, { up: at(0.885), r: 0.4 * u }, pale);
  // Seven rays of the crown, fanned over the brow.
  for (let ray = 0; ray < 7; ray++) {
    const a = Math.PI * (0.08 + 0.84 * ray / 6), w = 0.09;
    const root = (angle: number): Local => ({ side: Math.cos(angle) * 0.46 * u, front: Math.sin(angle) * 0.46 * u - 0.1 * u, up: at(0.87) });
    add([root(a - w), root(a + w), { side: Math.cos(a) * 1.05 * u, front: Math.sin(a) * 1.05 * u - 0.1 * u, up: at(0.925) }], pale);
  }
  // Right arm raised with the torch, on the viewer's left.
  const hand: Ring = { up: at(0.95), r: 0.2 * u, side: -1.3 * u };
  tube(add, { up: at(0.72), r: 0.3 * u, side: -0.85 * u }, hand, copper, 6);
  tube(add, hand, { up: at(0.985), r: 0.36 * u, side: -1.3 * u }, dark, 6);
  cap(add, { up: at(0.985), r: 0.36 * u, side: -1.3 * u }, dark, 6);
  tube(add, { up: at(0.985), r: 0.26 * u, side: -1.3 * u }, { up: at(1.06), r: 0.03 * u, side: -1.3 * u }, FLAME, 6);
}

/** World-axis offsets (east, south, up) in the figure's frame: for parts that must face a street. */
const w = (x: number, y: number, up: number): Local => ({ side: (x - y) * DIAG, front: (x + y) * DIAG, up });

type Rect = readonly [x0: number, y0: number, x1: number, y1: number];

/**
 * A block on the world axes whose top may be a different rectangle from its base (battered
 * flanks, a flaring headcloth), drawn as the three faces the camera sees: top, east and south.
 */
function frustum(add: Add, base: Rect, top: Rect, z0: number, z1: number, color: number): void {
  add([w(top[0], top[1], z1), w(top[2], top[1], z1), w(top[2], top[3], z1), w(top[0], top[3], z1)], shade(color, 1.08));
  add([w(base[2], base[1], z0), w(base[2], base[3], z0), w(top[2], top[3], z1), w(top[2], top[1], z1)], shade(color, 0.9));
  add([w(base[0], base[3], z0), w(base[2], base[3], z0), w(top[2], top[3], z1), w(top[0], top[3], z1)], shade(color, 0.72));
}

/** A flat strip between two points, `width` across, lying in the plane that faces the camera. */
function ribbon(add: Add, a: Local, c: Local, width: number, color: number): void {
  const ds = c.side - a.side, du = c.up - a.up, length = Math.hypot(ds, du) || 1;
  const ns = (-du / length) * width / 2, nu = (ds / length) * width / 2;
  add([
    { side: a.side + ns, front: a.front, up: a.up + nu }, { side: c.side + ns, front: c.front, up: c.up + nu },
    { side: c.side - ns, front: c.front, up: c.up - nu }, { side: a.side - ns, front: a.front, up: a.up - nu },
  ], color);
}

/** A flat regular polygon facing the camera, centred at (`side`, `up`). */
function disc(add: Add, side: number, up: number, front: number, r: number, color: number, sides = 10): void {
  add(Array.from({ length: sides }, (_, i) => {
    const a = i / sides * Math.PI * 2;
    return { side: side + Math.cos(a) * r * FACE, front, up: up + Math.sin(a) * r };
  }), color);
}

/** One level of a pylon: a square on the world axes, `half` wide either side of its centre. */
interface Station { x: number; y: number; half: number; up: number }
const SQUARE = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
const stationCorner = (station: Station, i: number): Local => {
  const [sx, sy] = SQUARE[i % 4]!;
  return w(station.x + sx * station.half, station.y + sy * station.half, station.up);
};
const stationBetween = (a: Station, c: Station, t: number): Station =>
  ({ x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t, half: a.half + (c.half - a.half) * t, up: a.up + (c.up - a.up) * t });

/**
 * An open lattice pylon between two stations: four corner chords, and on each face a cross
 * brace and a girt to the bay. Nothing is filled in, so the far faces show through the near ones.
 */
function pylon(add: Add, a: Station, c: Station, bays: number, chord: number, brace: number, iron: number): void {
  for (let i = 0; i < 4; i++) {
    // The east and south faces are toward the camera; the other two are seen through them, in shade.
    const near = i === 1 || i === 2, color = shade(iron, near ? 1 : 0.62);
    ribbon(add, stationCorner(a, i), stationCorner(c, i), chord, shade(iron, i === 2 ? 1.2 : i === 0 ? 0.7 : 0.95));
    for (let bay = 0; bay < bays; bay++) {
      const low = stationBetween(a, c, bay / bays), high = stationBetween(a, c, (bay + 1) / bays);
      ribbon(add, stationCorner(low, i), stationCorner(high, i + 1), brace, color);
      ribbon(add, stationCorner(low, i + 1), stationCorner(high, i), brace, color);
      ribbon(add, stationCorner(high, i), stationCorner(high, i + 1), brace, color);
    }
  }
}

const ARCH_STEPS = 6;

/**
 * Iron lattice tower: four splayed lattice legs joined by arches, a first deck, four more legs
 * to a second deck, then one tapering shaft to a cabin and mast. All of it is open framework;
 * each stage is a layer, so a deck paints over the legs below it and under the stage above.
 */
function latticeTowerFigure(add: Add, height: number, iron: number): void {
  const at = (share: number) => height * share;
  const dark = shade(iron, 0.7), pale = shade(iron, 1.25);
  const chord = height * 0.009, brace = height * 0.005;
  // Half-widths of the tower at the ground and at the two decks.
  const base = height * 0.155, first = height * 0.088, second = height * 0.046;
  const lower = layer(add, 0), upper = layer(add, 2), shaft = layer(add, 4);
  for (const [sx, sy] of SQUARE) {
    pylon(lower, { x: sx * base * 0.8, y: sy * base * 0.8, half: base * 0.2, up: 0 }, { x: sx * first * 0.72, y: sy * first * 0.72, half: first * 0.28, up: at(0.17) }, 3, chord, brace, iron);
    pylon(upper, { x: sx * first * 0.72, y: sy * first * 0.72, half: first * 0.26, up: at(0.19) }, { x: sx * second * 0.6, y: sy * second * 0.6, half: second * 0.4, up: at(0.35) }, 2, chord * 0.85, brace, iron);
  }
  // An arch between each pair of feet, springing from their inner edges.
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = SQUARE[i]!, [bx, by] = SQUARE[(i + 1) % 4]!;
    const reach = base * 0.8, inset = base * 0.6;
    // Along the face the feet are `inset` apart from centre; across it they stand at `reach`.
    const from = { x: ax === bx ? ax * reach : ax * inset, y: ay === by ? ay * reach : ay * inset };
    const to = { x: ax === bx ? bx * reach : bx * inset, y: ay === by ? by * reach : by * inset };
    const point = (step: number): Local => {
      const t = step / ARCH_STEPS;
      return w(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, at(0.045 + 0.1 * Math.sin(t * Math.PI)));
    };
    for (let step = 0; step < ARCH_STEPS; step++) ribbon(lower, point(step), point(step + 1), chord, i === 1 || i === 2 ? dark : shade(iron, 0.5));
  }
  const deck = (order: number, up: number, half: number) => {
    const on = layer(add, order);
    tube(on, { up, r: half * 1.5 }, { up: up + height * 0.018, r: half * 1.5 }, dark, 4);
    cap(on, { up: up + height * 0.018, r: half * 1.5 }, pale, 4);
  };
  deck(1, at(0.17), first);
  deck(3, at(0.35), second);
  pylon(shaft, { x: 0, y: 0, half: second * 0.95, up: at(0.368) }, { x: 0, y: 0, half: second * 0.5, up: at(0.6) }, 3, chord * 0.8, brace, iron);
  pylon(shaft, { x: 0, y: 0, half: second * 0.5, up: at(0.6) }, { x: 0, y: 0, half: second * 0.2, up: at(0.86) }, 4, chord * 0.7, brace * 0.9, iron);
  const top = layer(add, 5);
  tube(top, { up: at(0.86), r: second * 0.6 }, { up: at(0.89), r: second * 0.6 }, dark, 4);
  cap(top, { up: at(0.89), r: second * 0.6 }, pale, 4);
  tube(layer(add, 6), { up: at(0.89), r: second * 0.26 }, { up: height, r: second * 0.04 }, pale, 4);
}

const WHEEL_ARCS = 32;

/** Observation wheel: a rim of cabins on thin spokes, facing the camera, on four raked legs. */
function wheelFigure(add: Add, height: number, steel: number): void {
  const radius = height * 0.46, hub = height * 0.52, thick = height * 0.014;
  const dark = shade(steel, 0.62), cabin = 0x8fd3f4;
  for (const side of [-1, 1]) for (const front of [-1, 1]) {
    tube(add, { up: 0, r: height * 0.02, side: side * height * 0.11, front: front * height * 0.12 }, { up: hub, r: height * 0.014, front: front * thick }, front < 0 ? dark : shade(steel, 0.8), 4);
  }
  const rim = (r: number, i: number, front: number): Local => ({ side: Math.cos(i / WHEEL_ARCS * Math.PI * 2) * r * FACE, front, up: hub + Math.sin(i / WHEEL_ARCS * Math.PI * 2) * r });
  for (const front of [-thick, thick]) {
    for (let i = 0; i < WHEEL_ARCS; i++) {
      add([rim(radius, i, front), rim(radius, i + 1, front), rim(radius * 0.94, i + 1, front), rim(radius * 0.94, i, front)], front < 0 ? dark : lit(steel, i, WHEEL_ARCS));
    }
    if (front > 0) continue;
    for (let i = 0; i < WHEEL_ARCS; i += 2) ribbon(add, { side: 0, front: 0, up: hub }, rim(radius * 0.94, i, 0), height * 0.007, shade(steel, 0.85));
  }
  for (let i = 0; i < WHEEL_ARCS; i += 2) {
    const c = rim(radius * 1.03, i, thick * 2);
    disc(add, c.side, c.up, c.front, radius * 0.052, cabin, 8);
  }
  disc(add, 0, hub, thick * 2, radius * 0.08, shade(steel, 1.1));
}

/** Roadside welcome sign: a stretched diamond board on two posts, lettered discs across the top, a star above. */
function signFigure(add: Add, height: number, face: number): void {
  const half = height * 0.85 * FACE, mid = height * 0.6, rise = height * 0.2;
  const RED = 0xcf2330, BLUE = 0x2b4fa6, GOLD = 0xf2c230, POST = 0xd9d6cf;
  // The posts stand behind the board and stop behind it: the board hangs on their near side.
  const post = height * 0.028, behind = -post * 2;
  for (const side of [-1, 1]) tube(add, { up: 0, r: post, side: side * half * 0.34, front: behind }, { up: mid, r: post, side: side * half * 0.34, front: behind }, POST, 4);
  const board = layer(add, 1);
  const outline = [[-1, 0], [-0.62, 1], [0.62, 1], [1, 0], [0.62, -1], [-0.62, -1]] as const;
  const plate = (scale: number, front: number): Local[] => outline.map(([s, u]) => ({ side: s * half * scale, front, up: mid + u * rise * scale }));
  board(plate(1.09, -0.03), GOLD);
  board(plate(1, 0), face);
  const bar = (s0: number, s1: number, u0: number, u1: number, color: number) => board([
    { side: s0 * half, front: 0.03, up: mid + u0 * rise }, { side: s1 * half, front: 0.03, up: mid + u0 * rise },
    { side: s1 * half, front: 0.03, up: mid + u1 * rise }, { side: s0 * half, front: 0.03, up: mid + u1 * rise },
  ], color);
  for (let i = 0; i < 7; i++) {
    const side = (i - 3) * half * 0.155;
    disc(board, side, mid + rise * 0.62, 0.03, height * 0.036, RED);
    disc(board, side, mid + rise * 0.62, 0.05, height * 0.026, 0xffffff);
  }
  bar(-0.28, 0.28, 0.12, 0.32, BLUE);
  bar(-0.66, 0.66, -0.48, 0.02, RED);
  bar(-0.26, 0.26, -0.8, -0.6, BLUE);
  // Eight-point star on a short mast above the board.
  const star = mid + rise + height * 0.13;
  ribbon(board, { side: 0, front: -0.02, up: mid + rise }, { side: 0, front: -0.02, up: star }, height * 0.02, POST);
  board(Array.from({ length: 16 }, (_, i) => {
    const a = i / 16 * Math.PI * 2 + Math.PI / 2, r = height * (i % 2 ? 0.045 : 0.115);
    return { side: Math.cos(a) * r * FACE, front: 0.03, up: star + Math.sin(a) * r };
  }), RED);
  disc(board, 0, star, 0.05, height * 0.035, GOLD, 8);
}

const SPHERE_BANDS = 9;
const SPHERE_SIDES = 14;
const SPHERE_GLOW = [0x39c6ff, 0xff5fb0, 0xffc247] as const;

/** A ball clad in screens: bands of panels with a swirl of lit ones, so it is seen to turn as it rolls. */
function sphereFigure(add: Add, height: number, skin: number): void {
  const r = height / 2;
  const ring = (band: number): Ring => {
    const phi = band / SPHERE_BANDS * Math.PI;
    return { up: r - Math.cos(phi) * r, r: Math.max(0.02, Math.sin(phi) * r) };
  };
  for (let band = 0; band < SPHERE_BANDS; band++) {
    const a = ring(band), c = ring(band + 1);
    for (let i = 0; i < SPHERE_SIDES; i++) {
      const swirl = (i + band * 2) % 7;
      const color = swirl === 0 ? SPHERE_GLOW[band % SPHERE_GLOW.length]! : swirl === 3 ? shade(skin, 1.7) : skin;
      add([ringPoint(a, i, SPHERE_SIDES), ringPoint(a, i + 1, SPHERE_SIDES), ringPoint(c, i + 1, SPHERE_SIDES), ringPoint(c, i, SPHERE_SIDES)], lit(color, i, SPHERE_SIDES));
    }
  }
}

const CLOTH_BANDS = 6;

/**
 * Couchant sphinx facing east: haunches, a long back, forelegs stretched out in front, a chest
 * rising to a face framed by a striped headcloth that flares to the shoulders.
 */
function sphinxFigure(add: Add, height: number, stone: number): void {
  const l = height * 0.93, at = (share: number) => height * share;
  const rect = (x0: number, y0: number, x1: number, y1: number): Rect => [x0 * l, y0 * l, x1 * l, y1 * l];
  const CLOTH = 0x2d5fb3, pale = shade(stone, 1.14), shadow = shade(stone, 0.86);
  // Haunches, back, and the two forelegs with their paws.
  frustum(add, rect(-0.5, -0.2, -0.2, 0.2), rect(-0.46, -0.15, -0.22, 0.15), 0, at(0.46), stone);
  frustum(add, rect(-0.22, -0.16, 0.08, 0.16), rect(-0.22, -0.12, 0.08, 0.12), 0, at(0.38), stone);
  for (const y of [-1, 1]) {
    const y0 = y < 0 ? -0.17 : 0.07, y1 = y < 0 ? -0.07 : 0.17;
    frustum(add, rect(0.08, y0, 0.44, y1), rect(0.08, y0, 0.44, y1), 0, at(0.13), shadow);
    frustum(add, rect(0.4, y0 - 0.01, 0.5, y1 + 0.01), rect(0.4, y0, 0.49, y1), 0, at(0.17), pale);
  }
  // Chest, rising between the forelegs to the neck.
  frustum(add, rect(0, -0.15, 0.2, 0.15), rect(0.02, -0.11, 0.16, 0.11), 0, at(0.52), stone);
  // Headcloth: bands of cloth and gold, wide at the shoulders and narrowing to the brow.
  for (let band = 0; band < CLOTH_BANDS; band++) {
    const half = (i: number) => 0.2 - 0.085 * i / CLOTH_BANDS;
    const z0 = at(0.52 + 0.07 * band), z1 = at(0.52 + 0.07 * (band + 1));
    frustum(add, rect(-0.04, -half(band), 0.12, half(band)), rect(-0.04, -half(band + 1), 0.12, half(band + 1)), z0, z1, band % 2 ? stone : CLOTH);
  }
  frustum(add, rect(-0.04, -0.115, 0.15, 0.115), rect(-0.01, -0.085, 0.13, 0.085), at(0.94), height, pale);
  // Head: a face proud of the cloth, its features on the east side, which is the one the camera sees.
  const front = 0.21, skin = shade(stone, 1.24), DARK = 0x2a2620;
  frustum(add, rect(0.12, -0.1, front, 0.1), rect(0.12, -0.095, front, 0.095), at(0.56), at(0.93), skin);
  frustum(add, rect(0.17, -0.022, front, 0.022), rect(0.17, -0.03, front, 0.03), at(0.45), at(0.56), CLOTH);
  const feature = layer(add, 1), on = front * l + 0.02;
  const mark = (y0: number, y1: number, z0: number, z1: number, color: number) =>
    feature([w(on, y0 * l, at(z0)), w(on, y1 * l, at(z0)), w(on, y1 * l, at(z1)), w(on, y0 * l, at(z1))], color);
  mark(-0.1, 0.1, 0.87, 0.93, CLOTH);
  for (const y of [-0.075, 0.025]) {
    mark(y, y + 0.05, 0.765, 0.825, 0xf6eed6);
    mark(y + 0.016, y + 0.036, 0.765, 0.825, DARK);
    mark(y - 0.005, y + 0.055, 0.825, 0.845, DARK);
  }
  mark(-0.014, 0.014, 0.675, 0.775, shade(skin, 0.78));
  mark(-0.045, 0.045, 0.62, 0.648, DARK);
}

const WING_FINS = 13;
const GLASS = 0xbcdde6;

/**
 * Lakefront museum sunshade: a glass vault with a ridge running toward the viewer, and from the
 * ridge two wings of thin white fins raised to either side, longest amidships. A raked mast and
 * its stays stand at the near end.
 */
function sunshadeWingsFigure(add: Add, height: number, white: number): void {
  const ridge = height * 0.24, half = height * 0.5, base = height * 0.13, reach = height * 1.45 * FACE;
  const vault = layer(add, 0), fins = layer(add, 1), rig = layer(add, 2);
  const foot = (side: number, front: number): Local => ({ side: side * base, front, up: 0 });
  const crest = (front: number): Local => ({ side: 0, front, up: ridge });
  vault([foot(-1, -half), foot(-1, half), crest(half), crest(-half)], shade(GLASS, 0.74));
  vault([foot(1, -half), foot(1, half), crest(half), crest(-half)], shade(GLASS, 1.08));
  vault([foot(-1, half), foot(1, half), crest(half)], shade(GLASS, 0.9));
  for (const side of [-1, 1]) {
    const color = shade(white, side < 0 ? 0.84 : 1);
    let last: Local | undefined;
    for (let i = 0; i < WING_FINS; i++) {
      const t = i / (WING_FINS - 1), front = (t * 2 - 1) * half * 0.94;
      // Short at the ends of the ridge, full length in the middle: the outline of a wing.
      const length = 0.34 + 0.66 * Math.sin(Math.PI * (0.08 + 0.84 * t));
      const tip: Local = { side: side * reach * length, front, up: ridge + (height - ridge) * length };
      ribbon(fins, crest(front), tip, height * 0.022, color);
      if (last) ribbon(fins, last, tip, height * 0.012, shade(white, 0.7));
      last = tip;
    }
  }
  const head: Local = { side: 0, front: half * 1.5, up: height * 0.62 };
  ribbon(rig, { side: 0, front: half, up: 0 }, head, height * 0.03, white);
  for (const share of [0.25, 0.55, 0.85]) ribbon(rig, head, { side: 0, front: half * (1.5 + share), up: 0 }, height * 0.008, shade(white, 0.8));
}

const FAN_RIBS = 4;
const FAN_STEPS = 9;
/** Half the ballpark's width for each unit of roof height: the figure is sized by its height alone. */
const FAN_ROOF_HALF_SPAN = 1.24;

/**
 * Ballpark fan roof, parked open: from a pivot behind home plate (the north-west corner) two
 * stacks of arched panels sweep out over the grandstands, one along the north side and one along
 * the west, leaving the field between them open to the sky. White ribs carry green panels.
 */
function fanRoofFigure(add: Add, height: number, green: number): void {
  const half = height * FAN_ROOF_HALF_SPAN, reach = half * 1.96, steel = 0xe8ebe6;
  const panels = layer(add, 0), ribs = layer(add, 1), hub = layer(add, 2);
  // `turn` is the rib's angle off its own stand's outer wall; the north wing sweeps from +x, the west from +y.
  const rib = (wing: number, turn: number, lift: number) => (step: number): Local => {
    const t = step / FAN_STEPS, along = reach * (0.04 + 0.96 * t) * (1 - 0.14 * turn);
    const u = Math.cos(turn) * along, v = Math.sin(turn) * along;
    const up = height * (0.1 + lift * Math.sin(Math.PI * t) ** 0.75);
    return wing === 0 ? w(-half + u, -half + v, up) : w(-half + v, -half + u, up);
  };
  for (const wing of [0, 1]) {
    const lines = Array.from({ length: FAN_RIBS }, (_, i) => rib(wing, 0.02 + i * 0.15, 0.9 - i * 0.13));
    for (let i = 0; i < FAN_RIBS - 1; i++) for (let step = 0; step < FAN_STEPS; step++) {
      const tone = shade(green, (wing ? 0.78 : 1) * (0.82 + 0.3 * step / FAN_STEPS) * (i % 2 ? 0.9 : 1));
      panels([lines[i]!(step), lines[i]!(step + 1), lines[i + 1]!(step + 1), lines[i + 1]!(step)], tone);
    }
    for (const line of lines) for (let step = 0; step < FAN_STEPS; step++) ribbon(ribs, line(step), line(step + 1), height * 0.022, shade(steel, wing ? 0.85 : 1));
  }
  const pin = (up: number, r: number): Ring => ({ ...w(-half * 0.96, -half * 0.96, up), r });
  tube(hub, pin(0, height * 0.07), pin(height * 0.16, height * 0.05), steel, 6);
  cap(hub, pin(height * 0.16, height * 0.05), shade(steel, 1.1), 6);
}

const STAY_CABLES = 7;
const STAY_FAN = 0.19;
const DECK_STEP = 0.04;

/** A world-axis box drawn as its top, east and south faces, each corner passed through `move`. */
function crate(add: Add, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, color: number, move: (x: number, y: number, up: number) => Local): void {
  add([move(x0, y0, z1), move(x1, y0, z1), move(x1, y1, z1), move(x0, y1, z1)], shade(color, 1.08));
  add([move(x1, y0, z0), move(x1, y1, z0), move(x1, y1, z1), move(x1, y0, z1)], shade(color, 0.9));
  add([move(x0, y1, z0), move(x1, y1, z0), move(x1, y1, z1), move(x0, y1, z1)], shade(color, 0.72));
}

/**
 * Cable-stayed footbridge. A tapering mast stands on the plinth with a fan of stays to a deck that
 * passes south of it: a short landing to the west and, with a `span`, a long sweep east over the
 * water on river piers, one of which is a second mast with its own stays. The mast and its stays
 * fall with the figure. The deck and the piers stay where they are until the chain takes them: each
 * pier leans and goes under in turn, and the deck beyond it drops into the water.
 */
function cableStayFigure(add: Add, height: number, concrete: number, scene?: FigureScene): void {
  const at = (share: number) => height * share;
  const def = scene?.definition, span = def?.span;
  const reach = span?.reach ?? height * 0.95, west = span ? -SPAN_LANDING : -0.4;
  const centre = (t: number) => def && span ? spanPoint(def, t) : { x: t * reach, y: height * 0.1 + Math.sin(t * Math.PI) * height * 0.07 };
  const up = at(0.13), half = height * 0.04, sink = up + (scene?.drop ?? 0) + 1.2;
  const steel = 0xe4e9ee, dark = shade(concrete, 0.68), pale = shade(concrete, 1.08);
  const still = scene?.still ?? add, fall = scene?.fall;
  const piers = layer(still, 0), deck = layer(still, 1), far = layer(still, 2);
  // A part that has fallen share `p` of the way: leaning south about its foot and sinking.
  const sunk = (p: number, footY: number, lean: number) => (x: number, y: number, z: number): Local => {
    const a = p * lean, rise = z + (scene?.drop ?? 0);
    return w(x, footY + (y - footY) * Math.cos(a) + rise * Math.sin(a), rise * Math.cos(a) - (scene?.drop ?? 0) - p * p * sink);
  };
  // The deck, in short lengths; each stretch between two supports drops as one, its near end first.
  const stations = [west, 0, ...(span?.piers ?? []), 1];
  for (let s = 0; s + 1 < stations.length; s++) {
    const from = stations[s]!, to = stations[s + 1]!;
    const p = !fall ? 0 : s === 0 ? fall.landing : fall.decks[s - 1]!;
    if (p >= 1) continue;
    const count = Math.max(1, Math.round((to - from) / DECK_STEP));
    for (let i = 0; i < count; i++) {
      const t0 = from + (to - from) * i / count, t1 = from + (to - from) * (i + 1) / count, a = centre(t0), c = centre(t1);
      // The landing hinges on the bank at its west end; every other stretch lets go at the end nearer the bank.
      const lag = (t: number) => s === 0 ? (t - from) / (to - from) : 1 - 0.45 * (t - from) / (to - from);
      const z0 = up - p * p * sink * lag(t0), z1 = up - p * p * sink * lag(t1);
      deck([w(a.x, a.y - half, z0), w(c.x, c.y - half, z1), w(c.x, c.y + half, z1), w(a.x, a.y + half, z0)], pale);
      deck([w(a.x, a.y + half, z0), w(c.x, c.y + half, z1), w(c.x, c.y + half, z1 - height * 0.022), w(a.x, a.y + half, z0 - height * 0.022)], dark);
      ribbon(deck, w(a.x, a.y + half, z0 + height * 0.02), w(c.x, c.y + half, z1 + height * 0.02), height * 0.004, steel);
    }
  }
  const mastAt = (on: Add, x: number, y: number, move: (x: number, y: number, up: number) => Local) => {
    const levels = [[0, 0.052], [0.62, 0.034], [1, 0.015]] as const;
    for (let i = 0; i + 1 < levels.length; i++) {
      const [u0, r0] = levels[i]!, [u1, r1] = levels[i + 1]!;
      const ring = (u: number, r: number) => SQUARE.map(([sx, sy]) => move(x + sx * height * r, y + sy * height * r, at(u)));
      const low = ring(u0, r0), high = ring(u1, r1);
      for (let side = 0; side < 4; side++) on([low[side]!, low[(side + 1) % 4]!, high[(side + 1) % 4]!, high[side]!], lit(concrete, side * 2.5, 10));
    }
  };
  const stays = (on: Add, x: number, y: number, t: number, move: (x: number, y: number, up: number) => Local, held: (t: number) => boolean) => {
    for (const dir of [-1, 1]) for (let i = 1; i <= STAY_CABLES; i++) {
      const to = t + dir * i / STAY_CABLES * STAY_FAN;
      if (to < west || to > 1 || !held(to)) continue;
      const foot = centre(to);
      // The outermost stay is anchored highest on the mast.
      ribbon(on, move(x, y, at(0.64 + 0.33 * i / STAY_CABLES)), move(foot.x, foot.y, up + height * 0.01), height * 0.0055, steel);
    }
  };
  // River piers, and the far mast among them.
  (span?.piers ?? (scene ? [] : [0.5, 1])).forEach((t, k) => {
    const p = fall?.piers[k] ?? 0;
    if (p >= 1) return;
    const foot = centre(t), isMast = span?.mast === k;
    if (!isMast) {
      crate(piers, foot.x - half * 0.5, foot.y - half * 0.5, foot.x + half * 0.5, foot.y + half * 0.5, -(scene?.drop ?? height), up, dark, sunk(p, foot.y, 0.5));
      return;
    }
    // It stands in the river north of the deck, on a footing at the waterline, and goes over to the south.
    const y = foot.y - height * 0.1, move = sunk(p, y, Math.PI / 2 * 0.9), raised = (mx: number, my: number, mz: number) => move(mx, my, mz);
    crate(piers, foot.x - half, y - half, foot.x + half, y + half, -(scene?.drop ?? height), 0, dark, raised);
    mastAt(far, foot.x, y, raised);
    stays(layer(still, 3), foot.x, y, t, raised, () => p === 0);
  });
  if (!span && !scene) crate(piers, centre(west).x - half * 0.5, centre(west).y - half * 0.5, centre(west).x + half * 0.5, centre(west).y + half * 0.5, -height, up, dark, w);
  if (scene && !scene.standing) return;
  // The mast on the plinth and its stays: these fall with the figure.
  mastAt(layer(add, 4), 0, 0, w);
  stays(layer(add, 5), 0, 0, 0, w, () => true);
}

const NEEDLE_LEGS = 3;

/**
 * Saucer-topped observation tower: three pairs of legs that pinch to a waist and flare again
 * under the tophouse, a core between them, a low ring, the saucer with its halo, and a spire.
 */
function spaceNeedleFigure(add: Add, height: number, white: number): void {
  const at = (share: number) => height * share;
  const dark = shade(white, 0.72), halo = 0xe2a13a, glass = 0x9fc4d6;
  const legs = layer(add, 0), house = layer(add, 2), crown = layer(add, 3);
  tube(legs, { up: 0, r: at(0.016) }, { up: at(0.78), r: at(0.014) }, dark, 6);
  for (let leg = 0; leg < NEEDLE_LEGS; leg++) {
    const a = leg / NEEDLE_LEGS * Math.PI * 2 + 0.5;
    for (const twin of [-0.16, 0.16]) {
      const foot = (r: number, up: number, girth: number): Ring => ({ up, r: girth, side: Math.cos(a + twin * r / at(0.1)) * r, front: Math.sin(a + twin * r / at(0.1)) * r });
      const ground = foot(at(0.1), 0, at(0.011)), waist = foot(at(0.026), at(0.5), at(0.008)), top = foot(at(0.07), at(0.78), at(0.009));
      tube(legs, ground, waist, white, 5);
      tube(legs, waist, top, white, 5);
    }
  }
  // The low ring, a third of the way up.
  const ring = layer(add, 1);
  tube(ring, { up: at(0.19), r: at(0.062) }, { up: at(0.205), r: at(0.066) }, dark);
  cap(ring, { up: at(0.205), r: at(0.066) }, white);
  // The tophouse: a flaring underside, a band of glass, the halo, and a shallow roof.
  tube(house, { up: at(0.775), r: at(0.05) }, { up: at(0.815), r: at(0.135) }, white, 14);
  tube(house, { up: at(0.815), r: at(0.135) }, { up: at(0.835), r: at(0.135) }, glass, 14);
  tube(house, { up: at(0.835), r: at(0.16) }, { up: at(0.845), r: at(0.16) }, halo, 14);
  cap(house, { up: at(0.845), r: at(0.16) }, shade(halo, 0.85), 14);
  tube(crown, { up: at(0.845), r: at(0.125) }, { up: at(0.885), r: at(0.04) }, white, 14);
  tube(crown, { up: at(0.885), r: at(0.04) }, { up: at(0.905), r: at(0.022) }, dark, 8);
  tube(layer(add, 4), { up: at(0.905), r: at(0.008) }, { up: height, r: at(0.002) }, white, 4);
}

const ARCH_ROW = 5;
const ARCH_RIB = 7;

/** A row of tall open arches: each a pointed vault of four thin ribs on splayed feet, the middle one tallest. */
function archesFigure(add: Add, height: number, white: number): void {
  const pitch = height * 0.115, foot = height * 0.05, rib = height * 0.011;
  for (let arch = 0; arch < ARCH_ROW; arch++) {
    const x = (arch - (ARCH_ROW - 1) / 2) * pitch * 2, top = height * (1 - 0.1 * Math.abs(arch - (ARCH_ROW - 1) / 2));
    // Far ribs first, in shade; the two toward the camera over them.
    for (const [index, [sx, sy]] of SQUARE.entries()) {
      const near = index === 1 || index === 2 || index === 3, on = layer(add, arch * 2 + (sx + sy > 0 ? 1 : 0));
      const point = (step: number): Local => {
        const t = step / ARCH_RIB, out = Math.pow(1 - t, 0.55);
        return w(x + sx * foot * out, sy * foot * out, top * Math.sin(t * Math.PI / 2));
      };
      for (let step = 0; step < ARCH_RIB; step++) ribbon(on, point(step), point(step + 1), rib, shade(white, near ? 1 - 0.12 * (index % 2) : 0.66));
    }
  }
}

const FIGURES: Readonly<Record<MonumentFigure, (add: Add, height: number, color: number, scene?: FigureScene) => void>> = {
  'sunshade-wings': sunshadeWingsFigure,
  'fan-roof': fanRoofFigure,
  liberty: libertyFigure,
  'lattice-tower': latticeTowerFigure,
  wheel: wheelFigure,
  sign: signFigure,
  sphere: sphereFigure,
  sphinx: sphinxFigure,
  'cable-stay': cableStayFigure,
  'space-needle': spaceNeedleFigure,
  arches: archesFigure,
};
