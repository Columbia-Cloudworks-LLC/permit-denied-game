import { FLOOR_Z } from '../game/constants';
import type { ParticlePool } from '../fx/particles';
import { cellPresent, type Building, type WorldEvent } from './types';
import type { StructureStepResult } from './building';

/**
 * A monument is a statue standing on an ordinary destructible plinth. The plinth is a normal
 * building of cells; the statue is one drawn figure with no cells of its own. It stands while
 * enough of every storey's walls is whole, then leans toward the missing side, topples
 * like a felled tree and shatters where it lands.
 */
export const MONUMENT_FIGURES = ['liberty'] as const;
export type MonumentFigure = typeof MONUMENT_FIGURES[number];

export interface MonumentDef {
  figure: MonumentFigure;
  /** Statue height above the plinth, in world units. */
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
}

/** Where a fallen statue came to rest: a line from its feet to its crown. */
export interface MonumentImpact {
  building: Building;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Half-width of the strike along that line. */
  radius: number;
}

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
export function monumentPose(b: Building) {
  const s = b.monument!, centre = plinthCentre(b), top = b.floors * FLOOR_Z;
  if (s.phase === 'warning') {
    const lean = Math.min(1, s.elapsed / s.definition.warningDuration);
    return { x: centre.x, y: centre.y, z: top, theta: lean * 0.07 + Math.sin(s.elapsed * 17) * 0.018 * lean, dx: s.dx, dy: s.dy, height: s.definition.height };
  }
  if (s.phase === 'standing') return { x: centre.x, y: centre.y, z: top, theta: 0, dx: s.dx, dy: s.dy, height: s.definition.height };
  const p = s.progress, ease = p * p;
  const slide = (centre.half + 0.6) * Math.min(1, p * 1.6);
  return {
    x: centre.x + s.dx * slide,
    y: centre.y + s.dy * slide,
    z: Math.max(0.1, top * (1 - ease)),
    theta: 0.07 + (Math.PI / 2 - 0.07) * ease,
    dx: s.dx, dy: s.dy, height: s.definition.height,
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
  if (s.progress >= 1) land(b, result, particles, events);
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
