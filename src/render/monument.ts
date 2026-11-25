import type { Graphics } from 'pixi.js';
import type { DebugView } from '../debug/view';
import { ISO_W, ISO_Z } from '../game/constants';
import { MONUMENT_BALL_GIRTH, monumentPose, type MonumentFigure } from '../structure/monument';
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
  FIGURES[s.definition.figure](add, pose.height, s.definition.color);
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

const FIGURES: Readonly<Record<MonumentFigure, (add: Add, height: number, color: number) => void>> = {
  liberty: libertyFigure,
  'lattice-tower': latticeTowerFigure,
  wheel: wheelFigure,
  sign: signFigure,
  sphere: sphereFigure,
  sphinx: sphinxFigure,
};
