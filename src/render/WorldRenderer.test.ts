import { expect, it } from 'vitest';
import { frameIsolateLot, instantiateIsolateDefinition } from '../debug/isolateLot';
import { ParticlePool } from '../fx/particles';
import { archetypeById } from '../world/archetypes';
import { createDozer } from '../vehicle/dozer';
import { createTown } from '../world/town';
import { WorldRenderer } from './WorldRenderer';

it('reuses visible building geometry when panning and zooming, and rebuilds after damage', () => {
  const town = createTown(), renderer = new WorldRenderer();
  town.props = []; town.ground = []; town.lots = []; town.network.mesh = [];
  const dozer = createDozer(-100, -100, 0), particles = new ParticlePool();
  renderer.debug.effects = false; renderer.debug.debris = false;
  renderer.layout(10000, 10000, 0, 0);
  renderer.draw(town, dozer, particles, []);
  const first = renderer.stats.rebuilt;
  renderer.draw(town, dozer, particles, []);
  const stationary = renderer.stats.rebuilt;
  expect(stationary).toBeLessThan(first);
  renderer.camX += 10; renderer.camY += 5; renderer.zoom += .05;
  renderer.layout(10001, 10001, 0, 0);
  renderer.draw(town, dozer, particles, []);
  expect(renderer.stats.rebuilt).toBe(stationary);
  town.buildings[0]!.visualRevision++;
  renderer.draw(town, dozer, particles, []);
  expect(renderer.stats.rebuilt).toBeGreaterThan(stationary);
  renderer.invalidate(); renderer.root.destroy({ children: true });
});

it('keeps isolated intact stats after a static cache hit and DrawCache invalidate', () => {
  const lot = instantiateIsolateDefinition(archetypeById('farmhouse-rear-wing'));
  const renderer = new WorldRenderer();
  const particles = new ParticlePool();
  renderer.debug.effects = false;
  renderer.debug.debris = false;
  frameIsolateLot(renderer, lot.camera, 1280, 960);
  renderer.layout(1280, 960, 0, 0);
  renderer.draw(lot.town, lot.dozer, particles, [], 10, false);
  const first = { visible: renderer.stats.visible, commands: renderer.stats.commands };
  expect(first.visible).toBeGreaterThan(first.commands);
  renderer.invalidate();
  renderer.draw(lot.town, lot.dozer, particles, [], 10, false);
  expect(renderer.stats.visible).toBe(first.visible);
  expect(renderer.stats.commands).toBe(first.commands);
  renderer.invalidate();
  renderer.root.destroy({ children: true });
});
