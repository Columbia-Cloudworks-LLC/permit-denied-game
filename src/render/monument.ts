import type { Graphics } from 'pixi.js';
import type { DebugView } from '../debug/view';
import { monumentPose } from '../structure/monument';
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

/**
 * The statue as one painter-sorted assembly, drawn after its plinth. Every part is a stack of
 * tapered rings, so the same panels serve standing, leaning and falling: only the pose changes.
 */
export function monumentCommands(b: Building, view: DebugView): Cmd[] {
  const s = b.monument!;
  if (s.phase === 'gone' || !view.walls || view.maxFloor < b.floors - 1) return [];
  const pose = monumentPose(b), cos = Math.cos(pose.theta), sin = Math.sin(pose.theta);
  const place = ({ side, front, up }: Local): Point => {
    // Screen-right is world (+x, -y); toward the viewer is world (+x, +y).
    const ox = (side + front) * DIAG, oy = (front - side) * DIAG;
    const along = ox * pose.dx + oy * pose.dy;
    const swung = along * cos + up * sin;
    return {
      x: pose.x + ox - along * pose.dx + pose.dx * swung,
      y: pose.y + oy - along * pose.dy + pose.dy * swung,
      z: Math.max(0.08, pose.z + up * cos - along * sin),
    };
  };
  const panels: Cmd[] = [];
  const add = (points: Local[], color: number) => {
    const world = points.map(place);
    panels.push({ depth: Math.max(...world.map(p => depthKey(p.x, p.y, p.z))), run: g => drawWorldPoly(g, world, color) });
  };
  libertyFigure(add, pose.height, s.definition.color);
  panels.sort((a, c) => a.depth - c.depth);
  // One command, so the plinth's own roof and walls never paint through the figure standing on them.
  const cx = b.x + b.w * b.cellSize, cy = b.y + b.d * b.cellSize;
  const depth = Math.max(depthKey(cx, cy, b.floors * 4) + 0.5, ...panels.map(p => p.depth));
  return [{ depth, run: g => { for (const panel of panels) panel.run(g); } }];
}

type Add = (points: Local[], color: number) => void;
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
