import { expect, it } from 'vitest';
import { WorldRenderer } from './WorldRenderer';
import { createTown } from '../world/town';
import { createDozer } from '../vehicle/dozer';
import { ParticlePool } from '../fx/particles';

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
