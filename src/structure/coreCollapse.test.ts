import { describe, expect, it } from 'vitest';
import { applyCellDamage, createBuildingFromArchetype, stepStructures } from './building';
import { cellWorldBox, type Building } from './types';
import { ParticlePool } from '../fx/particles';
import { createTown } from '../world/town';
import { createDozer, stepDozer } from '../vehicle/dozer';
import { stepWorld } from '../sim/worldSim';
import { applyCoreImpact } from '../sim/coreImpact';
import { parseSessionFromSearch } from '../game/session';
import { archetypeById, BUILDING_FILES, parseBuildingPackages } from '../world/archetypes';

const tower = () => createBuildingFromArchetype('union-tower', 'TEST', 30, 30);
function hit(b: Building, pool: ParticlePool, core: boolean): void {
  for (const c of b.cells) if (c.floor === 0 && (core ? c.coreSupport : c.exterior.south)) applyCellDamage(b, c, 999, 0, -1, pool, []);
}

describe('authored tower core', () => {
  it('leaves the upper facade, floors and roof supported after losing the south ground facade', () => {
    const b = tower(), other = tower(), p = new ParticlePool(); hit(b, p, false);
    for (let i = 0; i < 600; i++) stepStructures([b], 1 / 60, p, []);
    expect(b.coreCollapse!.phase).toBe('standing');
    expect(b.coreCollapse!.capacity).toBe(1);
    expect(b.cells.filter(c => c.floor > 0).every(c => c.state === 'intact')).toBe(true);
    expect(b.floorTiles.every(t => t.state === 'intact')).toBe(true);
    expect(b.roofs.every(r => r.state === 'intact')).toBe(true);
    expect(other.cells.every(c => c.state === 'intact')).toBe(true);
    expect(other.coreCollapse).not.toBe(b.coreCollapse);
  });

  it('uses weighted surviving supports, gives a warning, then sinks one coherent shell', () => {
    const b = tower(), p = new ParticlePool(), supports = b.cells.filter(c => c.coreSupport);
    expect(supports).toHaveLength(6);
    const box = cellWorldBox(b, supports[0]!);
    expect(box.w).toBe(.6); expect(box.d).toBe(.6);
    for (const c of supports.filter(c => c.gx === 6)) applyCellDamage(b, c, 999, 0, -1, p, []);
    stepStructures([b], 1 / 60, p, []);
    expect(b.coreCollapse!.capacity).toBe(.5);
    expect(b.coreCollapse!.phase).toBe('standing');
    applyCellDamage(b, supports.find(c => c.gx !== 6)!, 999, 0, -1, p, []);
    stepStructures([b], 1 / 60, p, []);
    expect(b.coreCollapse!.phase).toBe('warning');
    expect(b.coreCollapse!.drop).toBe(0);
    let lastDrop = 0, pulses = 0, cash = 0;
    for (let i = 0; i < 450; i++) {
      const result = stepStructures([b], 1 / 60, p, []);
      expect(b.coreCollapse!.drop).toBeGreaterThanOrEqual(lastDrop); lastDrop = b.coreCollapse!.drop;
      pulses += result.coreImpacts.length; cash += result.cash;
    }
    expect(pulses).toBe(b.floors);
    expect(b.fullyDown).toBe(true);
    expect(b.coreCollapse!.phase).toBe('settled');
    expect(b.coreCollapse!.floors).toHaveLength(b.floors);
    expect(cash).toBeGreaterThan(0);
    const after = stepStructures([b], 1, p, []);
    expect(after.coreImpacts).toHaveLength(0); expect(after.cash).toBe(0);
  });

  it('bounds sequential damage debris and completes the playable map deterministically', () => {
    const replay = () => {
      const town = createTown({ towerTest: true }), b = town.buildings[0]!, p = new ParticlePool();
      p.ownerAt = town.debrisOwnerAt;
      const d = createDozer(town.spawnX, town.spawnY, town.spawnHeading);
      let peak = 0, maxMs = 0; const timings: number[] = [];
      const facade = b.cells.filter(c => c.floor === 0 && c.exterior.south);
      for (let i = 0; i < 700; i++) {
        if (i < facade.length * 12 && i % 12 === 0) applyCellDamage(b, facade[i / 12]!, 999, 0, -1, p, []);
        if (i === 180) hit(b, p, true);
        const start = performance.now();
        stepDozer(d, { throttle: 0, steer: 0, blade: false, engineMul: 1, bladeMul: 1, pushMul: 1 }, 1 / 60);
        stepWorld(town, d, p, { blade: 0, engine: 0, push: 0 }, 1 / 60); p.step(1 / 60);
        const ms = performance.now() - start; maxMs = Math.max(maxMs, ms); timings.push(ms);
        peak = Math.max(peak, town.rubble.length);
      }
      expect(peak).toBeLessThanOrEqual(80);
      expect(b.fullyDown).toBe(true); expect(b.collapseBonusPaid).toBe(true);
      expect(town.buildings).toHaveLength(1); expect(town.props).toHaveLength(0); expect(town.yard).toBeUndefined();
      expect(town.pile.mass.reduce((a, v) => a + v, 0)).toBeGreaterThan(3000);
      expect(d.y).toBeGreaterThan(town.spawnY);
      console.log(JSON.stringify({ scenario: 'sequential-facade-core', peakBodies: peak, simP95Ms: timings.sort((a, c) => a - c)[665], maxMs }));
      return { pile: Array.from(town.pile.mass), dozer: d, rubble: town.rubble, phase: b.coreCollapse!.phase };
    };
    expect(replay()).toEqual(replay());
  });

  it('pushes nearby dozers outwards, leaves distant dozers alone, and adds the exact aggregate mass', () => {
    const town = createTown({ towerTest: true }), b = town.buildings[0]!, p = new ParticlePool();
    const cx = b.x + b.w * b.cellSize / 2, cy = b.y + b.d * b.cellSize / 2;
    const near = createDozer(cx + 4, cy, 0), far = createDozer(cx + 40, cy, 0);
    const impact = { building: b, pulse: 1, mass: { concrete: 200, metal: 50 } };
    applyCoreImpact(town, near, p, impact, []);
    expect(near.vx).toBeGreaterThan(0); expect(near.track).toBeGreaterThan(0);
    expect(town.pile.mass.reduce((a, v) => a + v, 0)).toBeCloseTo(250, 3);
    for (const dust of p.items.filter(v => v.alive)) expect((dust.x - cx) * dust.vx + (dust.y - cy) * dust.vy).toBeGreaterThan(0);
    applyCoreImpact(town, far, p, impact, []);
    expect(far.vx).toBe(0); expect(far.track).toBe(0);
    town.pile.removeOwner('tower-test');
    expect(town.pile.mass.reduce((a, v) => a + v, 0)).toBeLessThan(.001);
  });

  it('validates authored core positions and reports their package file and building ID', () => {
    const a = archetypeById('union-tower'); expect(a.coreCollapse).toBeDefined();
    const path = Object.keys(BUILDING_FILES).find(p => p.includes('/union-tower/') && p.endsWith('.building.json'))!;
    for (const change of [ { supports: [{ x: 0, y: 0, weight: 1 }] }, { capacityThreshold: 2 }, { duration: 0 } ]) {
      const files = structuredClone(BUILDING_FILES);
      const entry = files[path] as { coreCollapse: unknown };
      entry.coreCollapse = { ...a.coreCollapse, ...change };
      expect(() => parseBuildingPackages(files)).toThrow(/union-tower.*coreCollapse/s);
    }
  });

  it('opens the dedicated map independently of yard/demo query flags', () => {
    expect(parseSessionFromSearch('?tower=1&demo=ranch&district=d100')).toMatchObject({ towerTest: true, kind: 'sandbox', district: 'classic', demo: undefined });
    expect(parseSessionFromSearch('?tower=1&job=brick').towerTest).toBe(false);
    expect(parseSessionFromSearch('?sandbox=1').towerTest).toBeUndefined();
  });

  it('lets the powered dozer damage a central support through the normal collision path', () => {
    const town = createTown({ towerTest: true }), b = town.buildings[0]!, p = new ParticlePool();
    hit(b, p, false);
    const support = b.cells.find(c => c.coreSupport && c.gx === 8 && c.gy === 6)!;
    const box = cellWorldBox(b, support);
    const d = createDozer(box.x + box.w / 2, box.y + box.d + 1.1, -Math.PI / 2);
    for (let i = 0; i < 180; i++) {
      stepDozer(d, { throttle: 1, steer: 0, blade: true, engineMul: 1, bladeMul: 1, pushMul: 1 }, 1 / 60);
      stepWorld(town, d, p, { blade: 0, engine: 0, push: 0 }, 1 / 60);
    }
    expect(support.hp).toBeLessThan(support.maxHp);
  });
});
