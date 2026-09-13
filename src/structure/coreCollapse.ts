import { siloAt } from './silos';
import type { ParticlePool } from '../fx/particles';
import { FLOOR_Z } from '../game/constants';
import { MATERIALS } from './materials';
import { cellPresent, type Building, type Material, type WorldEvent } from './types';
import { cashFor, type StructureStepResult } from './building';

function siloFootprint(b: Building, x: number, y: number): boolean {
  return !!siloAt((b.silos ?? []).map(s => s.definition), x, y);
}

/** Authored gameplay capacity, not an engineering stability calculation. */
export interface CoreCollapseDef {
  supports: { x: number; y: number; weight: number }[];
  capacityThreshold: number;
  warningDuration: number;
  duration: number;
}
export interface CoreCollapseState {
  definition: CoreCollapseDef;
  phase: 'standing' | 'warning' | 'falling' | 'settled';
  capacity: number;
  elapsed: number;
  drop: number;
  pulses: number;
  mass: Partial<Record<Material, number>>;
  floors: { x: number; y: number; w: number; d: number; floor: number }[];
}
export interface CoreImpact {
  building: Building;
  pulse: number;
  mass: Partial<Record<Material, number>>;
}
/** All tall buildings share the bounded collapse path; authored cores retain their tuning. */
export const DETAILED_FLOORS = 3;
export function automaticCore(b: Building): CoreCollapseDef {
  const supports = b.cells.filter(c => c.floor === 0 && !c.silo && c.isSupport && cellPresent(c));
  const bearing = supports.length ? supports : b.cells.filter(c => c.floor === 0 && !c.silo && cellPresent(c));
  return {
    supports: bearing.map(c => ({ x: c.gx, y: c.gy, weight: 1 })),
    capacityThreshold: .5, warningDuration: 1.2, duration: Math.min(6, Math.max(2, b.floors * .25)),
  };
}
export function isCoreBearing(b: Building, x: number, y: number): boolean {
  return b.coreCollapse?.definition.supports.some(p => p.x === x && p.y === y) ?? false;
}
export function initializeCore(b: Building, definition: CoreCollapseDef): void {
  // Merge occupied rows once; collapse geometry costs depend on floors/sections,
  // not on the number of cells or broken facade panels.
  const floors: CoreCollapseState['floors'] = [];
  for (let f = 0; f < b.floors; f++) {
    const tiles = b.floorTiles.filter(t => t.floor === f && !siloFootprint(b, t.gx, t.gy));
    for (let y = 0; y < b.d; y++) {
      const xs = tiles.filter(t => t.gy === y).map(t => t.gx).sort((a, c) => a - c);
      for (let i = 0; i < xs.length;) {
        const x = xs[i]!; let w = 1; i++;
        while (xs[i] === x + w) { w++; i++; }
        const prior = floors.find(r => r.floor === f && r.x === x && r.w === w && r.y + r.d === y);
        if (prior) prior.d++; else floors.push({ x, y, w, d: 1, floor: f });
      }
    }
  }
  b.coreCollapse = { definition, phase: 'standing', capacity: 1, elapsed: 0, drop: 0, pulses: 0, mass: {}, floors };
}

export function stepCoreCollapse(b: Building, dt: number, result: StructureStepResult, particles: ParticlePool, events: WorldEvent[]): void {
  const s = b.coreCollapse!, def = s.definition;
  // Local damage does not sever the load path of the entire facade above it.
  for (const c of b.cells) if (c.state === 'breached') {
    result.cash += cashFor(c, 'collapse');
    c.state = 'gone'; b.visualRevision++; b.collisionDirty = true;
    result.rubbleSpawns.push({ x: b.x + (c.gx + .5) * b.cellSize, y: b.y + (c.gy + .5) * b.cellSize,
      aggregate: true, dx: c.lastHitNx, dy: c.lastHitNy, material: c.material, floor: c.floor, cellSize: b.cellSize });
  }
  if (s.phase === 'settled') { b.structureDirty = false; return; }
  const capacity = def.supports.reduce((n, p) => n + (cellPresent(b.grid[0]![p.x]![p.y]!) ? p.weight : 0), 0);
  s.capacity = capacity / def.supports.reduce((n, p) => n + p.weight, 0);
  if (s.phase === 'standing' && s.capacity < def.capacityThreshold) {
    s.phase = 'warning'; s.elapsed = 0;
    const x = b.x + b.w * b.cellSize / 2, y = b.y + b.d * b.cellSize / 2;
    particles.radialDust(x, y, b.w * b.cellSize * .35, 16);
    events.push({ kind: 'snap', x, y, z: 1, mag: 1.2, material: b.construction.structure });
  }
  if (s.phase === 'standing' || s.phase === 'warning') {
    b.structureDirty = false; b.roofDirty = false;
    if (s.phase === 'standing') return;
    s.elapsed += dt;
    if (s.elapsed < def.warningDuration) return;
    s.phase = 'falling'; s.elapsed = 0;
    const add = (m: Material, amount: number) => { s.mass[m] = (s.mass[m] ?? 0) + amount; };
    for (const c of b.cells) if (c.state !== 'gone' && !c.silo) {
      result.cash += cashFor(c, 'collapse');
      add(c.material, b.cellSize ** 2 * 1.85 * MATERIALS[c.material].density);
      c.state = 'gone'; c.hp = 0;
    }
    for (const t of b.floorTiles) if (t.floor > 0 && t.state !== 'gone') {
      if (!t.void) add('concrete', b.cellSize ** 2 * 1.85 * MATERIALS.concrete.density); t.state = 'gone';
    }
    for (const f of b.fixtures) if (!f.broken) {
      add(f.material, f.w * f.d * f.h * MATERIALS[f.material].density); f.broken = true; f.hp = 0;
    }
    for (const roof of b.roofs) if (roof.state !== 'gone') {
      add(roof.material, (roof.coverage?.length ?? roof.support.length) * b.cellSize ** 2 * .3 * MATERIALS[roof.material].density);
      roof.state = 'gone';
    }
    b.collisionDirty = true;
  }
  s.elapsed += dt;
  const progress = Math.min(1, s.elapsed / def.duration);
  s.drop = b.floors * FLOOR_Z * progress ** 1.55;
  const pulses = Math.min(b.floors, 1 + Math.floor(s.drop / FLOOR_Z));
  while (s.pulses < pulses) {
    const mass: CoreImpact['mass'] = {};
    for (const [m, amount] of Object.entries(s.mass)) mass[m as Material] = amount / b.floors;
    result.coreImpacts.push({ building: b, pulse: s.pulses++, mass });
  }
  b.visualRevision++;
  if (progress === 1) { s.phase = 'settled'; b.fullyDown = (b.silos ?? []).every(silo => silo.phase === 'gone'); }
}
