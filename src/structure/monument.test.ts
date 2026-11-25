import { expect, it } from 'vitest';
import { defaultDebugView } from '../debug/view';
import { ParticlePool } from '../fx/particles';
import { FLOOR_Z } from '../game/constants';
import { monumentCommands } from '../render/monument';
import { applyMonumentImpact } from '../sim/monumentImpact';
import { createDozer } from '../vehicle/dozer';
import { archetypeById, validateBuildingDefinition } from '../world/archetypes';
import '../world/landmarkPack';
import { applyCellDamage, createBuildingFromArchetype, stepStructures, type StructureStepResult } from './building';
import { monumentPose, type MonumentImpact } from './monument';
import type { Building, WorldEvent } from './types';

const statue = (): Building => createBuildingFromArchetype('liberty-statue', 'STATUE', 10, 10);

/** Knock out one of the plinth's top-floor wall cells, as losing the walls under it would. */
function breach(b: Building, gx: number, gy: number, particles: ParticlePool): void {
  applyCellDamage(b, b.grid[b.floors - 1]![gx]![gy]!, 100000, 1, 0, particles, []);
}

function run(b: Building, particles: ParticlePool, steps: number, events: WorldEvent[] = []): StructureStepResult[] {
  const results: StructureStepResult[] = [];
  for (let i = 0; i < steps; i++) results.push(stepStructures([b], 1 / 60, particles, events));
  return results;
}

it('stands a drawn statue on a three-storey stone plinth of ordinary cells', () => {
  const b = statue(), particles = new ParticlePool();
  expect(b.floors).toBe(3);
  expect(b.coreCollapse).toBeUndefined();
  // Wall rings of 7 x 7, 5 x 5 and 3 x 3.
  expect(b.monument!.columns).toHaveLength(24 + 16 + 8);
  run(b, particles, 300);
  expect(b.monument!.phase).toBe('standing');
  expect(b.monument!.support).toBe(1);
  const pose = monumentPose(b);
  expect(pose.z).toBeCloseTo(3 * FLOOR_Z);
  expect(pose.theta).toBe(0);
  expect(monumentCommands(b, defaultDebugView())).toHaveLength(1);
});

it('keeps standing with under half its support gone, then leans toward the side that was eaten away', () => {
  const b = statue(), particles = new ParticlePool();
  // The plinth's top course is grid 2..4: take the whole east file and one more, exactly half.
  for (const gy of [2, 3, 4]) breach(b, 4, gy, particles);
  breach(b, 3, 2, particles);
  run(b, particles, 240);
  expect(b.monument!.phase).toBe('standing');
  expect(b.monument!.support).toBeCloseTo(0.5);
  breach(b, 3, 4, particles);
  run(b, particles, 30);
  expect(b.monument!.phase).toBe('warning');
  // The lost cells sit east of centre: the fall goes that way.
  expect(b.monument!.dx).toBeGreaterThan(0.9);
  expect(Math.hypot(b.monument!.dx, b.monument!.dy)).toBeCloseTo(1);
});

it('comes down when the dozer eats half of the star fort wall at ground level', () => {
  const b = statue(), particles = new ParticlePool();
  const fort = b.cells.filter(cell => cell.floor === 0);
  expect(fort).toHaveLength(24);
  // The west side of the fort, a cell short of half: still standing.
  const west = fort.filter(cell => cell.gx <= 3);
  for (const cell of west.slice(0, 12)) applyCellDamage(b, cell, 100000, 1, 0, particles, []);
  run(b, particles, 60);
  expect(b.monument!.phase).toBe('standing');
  expect(b.monument!.support).toBeCloseTo(0.5);
  applyCellDamage(b, west[12]!, 100000, 1, 0, particles, []);
  run(b, particles, 900);
  expect(b.monument!.phase).toBe('gone');
  expect(b.monument!.dx).toBeLessThan(-0.7);
});

it('topples, lands along its length, shatters into tinted copper and pays once', () => {
  const b = statue(), particles = new ParticlePool(), events: WorldEvent[] = [];
  for (const [gx, gy] of [[2, 2], [2, 3], [2, 4], [3, 2], [3, 4]] as const) breach(b, gx, gy, particles);
  const standing = monumentPose(b);
  let lowest = Infinity, widest = 0;
  const results: StructureStepResult[] = [];
  for (let i = 0; i < 600; i++) {
    results.push(...run(b, particles, 1, events));
    if (b.monument!.phase !== 'falling') continue;
    const pose = monumentPose(b);
    lowest = Math.min(lowest, pose.z);
    widest = Math.max(widest, pose.theta);
  }
  expect(b.monument!.phase).toBe('gone');
  expect(lowest).toBeLessThan(standing.z * 0.2);
  expect(widest).toBeGreaterThan(1.2);
  const impacts = results.flatMap(result => result.monumentImpacts);
  expect(impacts).toHaveLength(1);
  const impact = impacts[0]!, def = b.monument!.definition;
  expect(Math.hypot(impact.x1 - impact.x0, impact.y1 - impact.y0)).toBeCloseTo(def.height);
  // It fell west, toward the breached file.
  expect(impact.x1).toBeLessThan(impact.x0);
  const pieces = results.flatMap(result => result.rubbleSpawns).filter(spawn => spawn.tint === def.color);
  expect(pieces.length).toBeGreaterThanOrEqual(8);
  expect(pieces.every(piece => piece.material === 'metal')).toBe(true);
  expect(results.reduce((sum, result) => sum + result.cash, 0)).toBeGreaterThanOrEqual(def.bonus);
  expect(events.filter(event => event.kind === 'cash' && event.cash === def.bonus)).toHaveLength(1);
  expect(monumentCommands(b, defaultDebugView())).toEqual([]);
});

it('hurts a dozer under the falling statue and spares one standing clear', () => {
  const b = statue();
  const impact: MonumentImpact = { building: b, x0: 0, y0: 0, x1: 11, y1: 0, radius: 2.5 };
  const under = createDozer(5, 0.5, 0), clear = createDozer(5, 9, 0), events: WorldEvent[] = [];
  expect(applyMonumentImpact(under, impact, events)).toBe(true);
  expect(under.heat).toBeGreaterThan(15);
  expect(under.track).toBeGreaterThan(18);
  expect(Math.abs(under.vy)).toBeGreaterThan(1);
  expect(applyMonumentImpact(clear, impact, events)).toBe(false);
  expect(clear.heat).toBe(0);
  expect(clear.track).toBe(0);
});

it('rejects a statue on a plinth too tall to simulate cell by cell', () => {
  const a = structuredClone(archetypeById('liberty-statue'));
  a.monument!.minimumSupport = 1.5;
  expect(validateBuildingDefinition(a).join(' ')).toContain('Invalid monument configuration');
});
