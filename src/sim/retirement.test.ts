import { expect, it } from 'vitest';
import { createTown } from '../world/town';
import { createDozer } from '../vehicle/dozer';
import { ParticlePool } from '../fx/particles';
import { applyCellDamage } from '../structure/building';
import { addDebrisBody, stepDebris, totalDebrisMass } from './debris';
import { stepWorld } from './worldSim';

it.each([true, false])('retires distant unattended debris below the caps without losing mass (sleeping=%s)', sleeping => {
  const town = createTown(), particles = new ParticlePool(), dozer = createDozer(2, 2, 0);
  const piece = addDebrisBody(town, { x: 40, y: 25, w: .4, d: .3, material: 'brick', layer: 'remnant', mass: 1 });
  piece.sleeping = true; piece.sleepT = 20; piece.touchedAt = -20;
  for (let i = 0; i < 600; i++) {
    piece.sleeping = sleeping; piece.sleepT = sleeping ? 20 : 0;
    stepDebris(town, dozer, particles, [], 1, 1/60);
  }
  expect(town.rubble).not.toContain(piece);
  expect(totalDebrisMass(town)).toBeCloseTo(1, 4);
});

it('releases a distant demolished building runtime while retaining its site and reward identity', () => {
  const town = createTown(), b = town.buildings[0]!, particles = new ParticlePool();
  town.maxX += 100; town.maxY += 100;
  const dozer = createDozer(town.maxX - 1, town.maxY - 1, 0);
  for (const cell of b.cells) applyCellDamage(b, cell, 999, 1, 0, particles, []);
  for (let i = 0; i < 900; i++) stepWorld(town, dozer, particles, { blade: 0, engine: 0, push: 0 }, 1/60);
  expect(b.fullyDown).toBe(true);
  expect(b.collapseBonusPaid).toBe(true);
  expect(town.collapsedSites.filter(s => s.buildingId === b.id)).toHaveLength(1);
  expect(b.cells).toHaveLength(0);
  expect(b.grid).toHaveLength(0);
  expect(b.fixtures).toHaveLength(0);
  expect(b.floorTiles).toHaveLength(0);
  expect(b.roofs).toHaveLength(0);
  expect(town.rubble).toHaveLength(0);
  expect(stepWorld(town, dozer, particles, { blade: 0, engine: 0, push: 0 }, 1/60).cash).toBe(0);
});
