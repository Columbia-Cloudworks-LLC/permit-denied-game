import { expect, it } from 'vitest';
import { createTown } from '../world/town';
import { applyCellDamage, stepStructures } from '../structure/building';
import { ParticlePool } from '../fx/particles';
import { createDozer, dozerSpeed, stepDozer } from '../vehicle/dozer';
import { applyCoreImpact } from './coreImpact';
import { stepWorld } from './worldSim';

function scene() {
  const town = createTown({ towerTest: true }), b = town.buildings[0]!, particles = new ParticlePool();
  const cx = b.x + b.w * b.cellSize / 2, cy = b.y + b.d * b.cellSize / 2;
  const dozer = createDozer(cx, cy + 16, -Math.PI / 2);
  for (const c of b.cells.filter(c => c.coreSupport)) applyCellDamage(b, c, 999, 0, -1, particles, []);
  for (let i = 0; i < 400; i++) for (const impact of stepStructures([b], 1 / 60, particles, []).coreImpacts)
    applyCoreImpact(town, dozer, particles, impact, []);
  particles.clear();
  return { town, dozer, particles, cx, cy };
}
function drive(s: ReturnType<typeof scene>, frames: number, throttle = 1, blade = false, engine = 0) {
  for (let i = 0; i < frames; i++) {
    stepDozer(s.dozer, { throttle, steer: 0, blade, engineMul: 1 + engine * .28, bladeMul: 1, pushMul: 1 }, 1 / 60);
    stepWorld(s.town, s.dozer, s.particles, { blade: 0, engine, push: 0 }, 1 / 60);
  }
}

it('slows approaching the mound and cannot creep through its dense center under sustained throttle', () => {
  const s = scene();
  drive(s, 60); const approachSpeed = dozerSpeed(s.dozer);
  drive(s, 420);
  expect(s.dozer.y).toBeGreaterThan(s.cy + 6);
  expect(dozerSpeed(s.dozer)).toBeLessThan(approachSpeed / 3);
  const stop = s.dozer.y; drive(s, 300);
  expect(Math.abs(s.dozer.y - stop)).toBeLessThan(.3);
});
it('allows reversing away and passes through a sufficiently cleared corridor', () => {
  const s = scene(); drive(s, 480); const stop = s.dozer.y;
  drive(s, 120, -1); expect(s.dozer.y).toBeGreaterThan(stop + 1);
  s.town.pile.clearArea(s.cx - 2, s.cy - 15, 4, 30);
  drive(s, 480); expect(s.dozer.y).toBeLessThan(s.cy - 3);
});
it('prevents an upgraded, powered dozer from charging directly across uncleared rubble', () => {
  const s = scene(); drive(s, 300, 1, true, 8);
  expect(s.dozer.y).toBeGreaterThan(s.cy + 5);
});
it('lets a dozer already inside the pile escape instead of trapping it in an invisible ring', () => {
  const s = scene(); s.dozer.y = s.cy; s.dozer.heading = Math.PI / 2;
  drive(s, 900); expect(s.dozer.y).toBeGreaterThan(s.cy + 10);
});
