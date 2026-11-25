import { FLOOR_Z, ISO_H, ISO_W, ISO_Z } from '../game/constants';
import type { ParticlePool } from '../fx/particles';
import { cellPresent, type Building, type WorldEvent } from './types';
import type { StructureStepResult } from './building';

/**
 * A monument is a drawn figure standing on an ordinary destructible plinth. The plinth is a normal
 * building of cells; the figure has no cells of its own. It stands while enough of every storey's
 * walls is whole, then leans toward the missing side and comes down the way its `fall` says:
 * it topples like a felled tree, crumbles where it stands, or breaks loose and rolls.
 */
export const MONUMENT_FIGURES = ['liberty', 'lattice-tower', 'wheel', 'sign', 'sphere', 'sphinx'] as const;
export type MonumentFigure = typeof MONUMENT_FIGURES[number];
/**
 * How the figure comes down. `topple`: over like a felled tree, striking the line it lands on.
 * `crumble`: sinks in place and breaks up around the plinth. `roll`: drops off the plinth and
 * rolls `reach` units toward the lost wall, crushing what it crosses, then bursts.
 */
export const MONUMENT_FALLS = ['topple', 'crumble', 'roll'] as const;
export type MonumentFall = typeof MONUMENT_FALLS[number];

export interface MonumentDef {
  figure: MonumentFigure;
  /** Absent topples. */
  fall?: MonumentFall;
  /** How far a rolling figure travels before it bursts, in world units; absent is twice its height. */
  reach?: number;
  /** Figure height above the plinth, in world units. A rolling figure is a ball of this diameter. */
  height: number;
  /** Share of a storey's wall cells that must stand; when any storey drops below it the statue goes over. */
  minimumSupport: number;
  warningDuration: number;
  fallDuration: number;
  /** One-time payout when the statue shatters. */
  bonus: number;
  /** Statue metal: its drawn colour and the tint of its wreckage. */
  color: number;
}

export interface MonumentState {
  definition: MonumentDef;
  phase: 'standing' | 'warning' | 'falling' | 'gone';
  elapsed: number;
  progress: number;
  /** Unit direction of the fall. */
  dx: number;
  dy: number;
  /** Standing share of the weakest storey's walls, 0..1. */
  support: number;
  /** Every wall cell of the foundation: the statue rests on all of its storeys. */
  columns: { gx: number; gy: number; floor: number }[];
  /** Where a rolling figure was last step, and whether it has already run the dozer down. */
  rollX?: number;
  rollY?: number;
  struck?: boolean;
}

/**
 * Where a figure struck: the line a toppled one lies along (feet to crown), the spot a crumbled or
 * burst one came down on (a zero-length line), or the stretch a rolling one covered this step.
 */
export interface MonumentImpact {
  building: Building;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Half-width of the strike along that line. */
  radius: number;
  /** A figure still rolling: sent every step it is on the ground, and it hits the dozer once. */
  rolling?: boolean;
}

/** The figure's rigid pose: feet, lean from upright toward (`dx`, `dy`), and how far it has rolled or sunk. */
export interface MonumentPose {
  x: number;
  y: number;
  z: number;
  theta: number;
  dx: number;
  dy: number;
  height: number;
  /** Radians a rolling figure has turned about its own centre. */
  spin: number;
  /** 0 standing to 1 flattened, for a crumbling figure. */
  squash: number;
}

/**
 * A ball's radius on the ground as a share of half its height. Heights are drawn taller than
 * widths, so a figure that looks round stands narrower than it is tall by this much.
 */
export const MONUMENT_BALL_GIRTH = ISO_Z / (Math.SQRT2 * Math.sqrt(ISO_W * ISO_W - ISO_H * ISO_H));
/** Ground radius of a rolling figure. */
export const monumentBallRadius = (def: MonumentDef): number => def.height / 2 * MONUMENT_BALL_GIRTH;

export const monumentFall = (def: MonumentDef): MonumentFall => def.fall ?? 'topple';
export const monumentReach = (def: MonumentDef): number => def.reach ?? def.height * 2;
/** How far beyond its plinth a falling figure can be seen or come to rest. */
export const monumentSweep = (def: MonumentDef): number => (monumentFall(def) === 'roll' ? monumentReach(def) + def.height : def.height) + 2;

export function initializeMonument(b: Building, definition: MonumentDef): void {
  const columns: MonumentState['columns'] = b.cells.filter(cellPresent).map(cell => ({ gx: cell.gx, gy: cell.gy, floor: cell.floor }));
  b.monument = { definition, phase: 'standing', elapsed: 0, progress: 0, dx: 0, dy: 1, support: 1, columns };
}

const columnStands = (b: Building, column: MonumentState['columns'][number]): boolean => {
  const cell = b.grid[column.floor]?.[column.gx]?.[column.gy];
  return !!cell && cellPresent(cell);
};

/**
 * The weakest storey governs: the share of its wall cells still standing, and which ones are lost.
 * The dozer reaches only the ground storey, so in play that is the star fort's outer wall.
 */
function weakestStorey(b: Building): { support: number; lost: MonumentState['columns'] } {
  let weakest = { support: 1, lost: [] as MonumentState['columns'] };
  for (let floor = 0; floor < b.floors; floor++) {
    const storey = b.monument!.columns.filter(column => column.floor === floor);
    if (!storey.length) continue;
    const lost = storey.filter(column => !columnStands(b, column));
    const support = 1 - lost.length / storey.length;
    if (support < weakest.support) weakest = { support, lost };
  }
  return weakest;
}

/** Centre of the plinth's top storey, where the statue stands, in world space. */
function plinthCentre(b: Building): { x: number; y: number; half: number } {
  const columns = b.monument!.columns.filter(column => column.floor === b.floors - 1);
  const xs = columns.map(c => c.gx), ys = columns.map(c => c.gy);
  const gx0 = Math.min(...xs), gx1 = Math.max(...xs) + 1, gy0 = Math.min(...ys), gy1 = Math.max(...ys) + 1;
  return {
    x: b.x + (gx0 + gx1) / 2 * b.cellSize,
    y: b.y + (gy0 + gy1) / 2 * b.cellSize,
    half: Math.max(gx1 - gx0, gy1 - gy0) * b.cellSize / 2,
  };
}

/**
 * The statue's rigid pose: its feet (`x`, `y`, `z`) and how far it has rotated from upright
 * toward (`dx`, `dy`). While it falls the feet slide off the plinth and drop to the ground.
 */
export function monumentPose(b: Building): MonumentPose {
  const s = b.monument!, def = s.definition, centre = plinthCentre(b), top = b.floors * FLOOR_Z;
  const upright: MonumentPose = { x: centre.x, y: centre.y, z: top, theta: 0, dx: s.dx, dy: s.dy, height: def.height, spin: 0, squash: 0 };
  if (s.phase === 'standing') return upright;
  const fall = monumentFall(def);
  if (s.phase === 'warning') {
    const lean = Math.min(1, s.elapsed / def.warningDuration);
    // A ball rocks on its seat and a crumbling figure only shudders; neither leans like a pole.
    const sway = fall === 'topple' ? lean * 0.07 : fall === 'roll' ? lean * 0.03 : 0;
    return { ...upright, theta: sway + Math.sin(s.elapsed * 17) * 0.018 * lean };
  }
  const p = s.progress, ease = p * p;
  if (fall === 'crumble') {
    const shake = Math.sin(s.elapsed * 31) * 0.09 * (1 - p);
    return { ...upright, x: centre.x + shake, y: centre.y - shake, squash: ease };
  }
  if (fall === 'roll') {
    // One long roll that runs out of speed: off the seat and down to the ground first, then its reach.
    const radius = monumentBallRadius(def), seat = centre.half + radius;
    const travel = (seat + monumentReach(def)) * (1 - (1 - p) * (1 - p)), off = Math.min(1, travel / seat);
    return { ...upright, x: centre.x + s.dx * travel, y: centre.y + s.dy * travel, z: top * (1 - off * off), spin: travel / radius };
  }
  const slide = (centre.half + 0.6) * Math.min(1, p * 1.6);
  return {
    ...upright,
    x: centre.x + s.dx * slide,
    y: centre.y + s.dy * slide,
    z: Math.max(0.1, top * (1 - ease)),
    theta: 0.07 + (Math.PI / 2 - 0.07) * ease,
  };
}

export function stepMonument(b: Building, dt: number, result: StructureStepResult, particles: ParticlePool, events: WorldEvent[]): void {
  const s = b.monument!, def = s.definition;
  if (s.phase === 'gone') return;
  if (s.phase === 'standing') {
    const { support, lost } = weakestStorey(b);
    s.support = support;
    if (support < def.minimumSupport) warn(b, lost, events);
    return;
  }
  s.elapsed += dt;
  b.visualRevision++;
  b.structureDirty = true;
  if (s.phase === 'warning') {
    if (s.elapsed < def.warningDuration) return;
    s.phase = 'falling';
    s.elapsed = 0;
    const pose = monumentPose(b);
    events.push({ kind: 'snap', x: pose.x, y: pose.y, z: pose.z, mag: 1.8, material: 'metal' });
    return;
  }
  s.progress = Math.min(1, s.elapsed / def.fallDuration);
  if (monumentFall(def) === 'roll') roll(b, result, particles);
  if (s.progress < 1) return;
  if (monumentFall(def) === 'topple') land(b, result, particles, events);
  else breakUp(b, result, particles, events);
}

/** A rolling figure sweeps the ground between where it was and where it is, once it is down off the plinth. */
function roll(b: Building, result: StructureStepResult, particles: ParticlePool): void {
  const s = b.monument!, pose = monumentPose(b), radius = monumentBallRadius(s.definition);
  const fromX = s.rollX ?? pose.x, fromY = s.rollY ?? pose.y;
  s.rollX = pose.x;
  s.rollY = pose.y;
  if (pose.z > 0) return;
  result.monumentImpacts.push({ building: b, x0: fromX, y0: fromY, x1: pose.x, y1: pose.y, radius, rolling: true });
  if (Math.hypot(pose.x - fromX, pose.y - fromY) > 0.02) particles.radialDust(pose.x, pose.y, radius * 0.6, 2);
}

/** A crumbled or burst figure comes apart where it is: plates thrown in a ring, and a round strike. */
function breakUp(b: Building, result: StructureStepResult, particles: ParticlePool, events: WorldEvent[]): void {
  const s = b.monument!, def = s.definition, pose = monumentPose(b);
  s.phase = 'gone';
  const rolled = monumentFall(def) === 'roll';
  // A crumbled figure lies around its plinth; a burst ball covers its own shadow.
  const inner = rolled ? 0 : plinthCentre(b).half, spread = inner + def.height * (rolled ? 0.3 : 0.4);
  for (let i = 0; i < PIECES; i++) {
    const angle = i * 2.399963229728653, r = inner + (spread - inner) * Math.sqrt((i + 0.5) / PIECES);
    const ux = Math.cos(angle), uy = Math.sin(angle), x = pose.x + ux * r, y = pose.y + uy * r;
    const size = Math.max(0.8, def.height * (0.16 - 0.06 * (i / PIECES)));
    result.rubbleSpawns.push({
      x, y, dx: ux, dy: uy,
      material: 'metal', floor: 0, cellSize: b.cellSize, tint: def.color,
      source: 'roof', panelW: size * 1.4, panelD: size, heading: angle,
    });
    particles.radialDust(x, y, size + 0.6, 6);
  }
  events.push({ kind: 'collapse', x: pose.x, y: pose.y, z: 0, mag: 2.4 });
  events.push({ kind: 'snap', x: pose.x, y: pose.y, z: 0, mag: 2.2, material: 'metal' });
  result.cash += def.bonus;
  events.push({ kind: 'cash', x: pose.x, y: pose.y, z: 2, mag: 2.6, cash: def.bonus });
  result.monumentImpacts.push({ building: b, x0: pose.x, y0: pose.y, x1: pose.x, y1: pose.y, radius: spread + 0.8 });
}

/** Too little left underneath: lean toward the side that was eaten away. */
function warn(b: Building, lost: MonumentState['columns'], events: WorldEvent[]): void {
  const s = b.monument!, centre = plinthCentre(b);
  s.phase = 'warning';
  s.elapsed = 0;
  let dx = 0, dy = 0;
  for (const column of lost) {
    dx += b.x + (column.gx + 0.5) * b.cellSize - centre.x;
    dy += b.y + (column.gy + 0.5) * b.cellSize - centre.y;
  }
  const length = Math.hypot(dx, dy);
  s.dx = length > 1e-6 ? dx / length : 0;
  s.dy = length > 1e-6 ? dy / length : 1;
  events.push({ kind: 'snap', x: centre.x, y: centre.y, z: b.floors * FLOOR_Z, mag: 1.2, material: 'metal' });
}

const PIECES = 14;

/** The statue hits the ground along its length and breaks into copper plate. */
function land(b: Building, result: StructureStepResult, particles: ParticlePool, events: WorldEvent[]): void {
  const s = b.monument!, def = s.definition, pose = monumentPose(b);
  s.phase = 'gone';
  const tipX = pose.x + s.dx * def.height, tipY = pose.y + s.dy * def.height;
  for (let i = 0; i < PIECES; i++) {
    const t = (i + 0.5) / PIECES;
    // Robe plates low on the figure are the widest; the arm and torch break small.
    const girth = def.height * (0.2 - 0.11 * t);
    const side = i % 2 ? 1 : -1;
    const x = pose.x + s.dx * def.height * t - s.dy * side * girth * 0.35;
    const y = pose.y + s.dy * def.height * t + s.dx * side * girth * 0.35;
    result.rubbleSpawns.push({
      x, y, dx: s.dx * 0.6 - s.dy * side, dy: s.dy * 0.6 + s.dx * side,
      material: 'metal', floor: 0, cellSize: b.cellSize, tint: def.color,
      // Torn sheet: each piece lands as a curved plate of the statue's skin.
      source: 'roof', panelW: Math.max(0.9, girth * 1.5), panelD: Math.max(0.7, girth * 1.05), heading: Math.atan2(s.dy, s.dx) + (i * 2.4) % Math.PI,
    });
    particles.radialDust(x, y, girth + 0.6, 6);
  }
  events.push({ kind: 'collapse', x: (pose.x + tipX) / 2, y: (pose.y + tipY) / 2, z: 0, mag: 2.4 });
  events.push({ kind: 'snap', x: tipX, y: tipY, z: 0, mag: 2.2, material: 'metal' });
  result.cash += def.bonus;
  events.push({ kind: 'cash', x: (pose.x + tipX) / 2, y: (pose.y + tipY) / 2, z: 2, mag: 2.6, cash: def.bonus });
  result.monumentImpacts.push({ building: b, x0: pose.x, y0: pose.y, x1: tipX, y1: tipY, radius: def.height * 0.16 + 0.8 });
}
