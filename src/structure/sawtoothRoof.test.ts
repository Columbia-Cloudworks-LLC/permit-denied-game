import { describe, expect, it } from 'vitest';
import { archetypeById } from '../world/archetypes';
import { createBuildingFromDefinition, applyCellDamage, stepStructures } from './building';
import { roofCoverage, sawtoothClosures } from './roof';
import { ParticlePool } from '../fx/particles';
import { FLOOR_Z } from '../game/constants';

describe('sawtooth factory roof', () => {
  it('covers each tile once with repeated slopes, closed ends and glazed high edges', () => {
    for (const roofAxis of ['x', 'y'] as const) {
      const b = createBuildingFromDefinition({ ...archetypeById('sawtooth-factory'), roofAxis }, 'factory', 5, 7);
      const coverage = b.roofs.flatMap(roofCoverage).map(c => `${c.gx}:${c.gy}`);
      expect(coverage.length).toBe(b.w * b.d);
      expect(new Set(coverage).size).toBe(coverage.length);
      expect(b.roofs.every(r => r.support.length && r.tooth)).toBe(true);
      const highs = new Set(b.roofs.flatMap(r => r.verts.filter(v => Math.abs(v.z - FLOOR_Z - .92) < 1e-6).map(v => v[roofAxis])));
      expect(highs.size).toBe(Math.ceil((roofAxis === 'x' ? b.w : b.d) / 3));
      expect(b.roofs.flatMap(sawtoothClosures).some(f => f.glass)).toBe(true);
      expect(b.roofs.flatMap(sawtoothClosures).some(f => !f.glass)).toBe(true);
      const particles = new ParticlePool();
      for (let i = 0; i < 180; i++) stepStructures([b], 1 / 60, particles, []);
      expect(b.roofs.every(r => r.state === 'intact')).toBe(true);
    }
  });
  it('carries closures through collapse and removes them with their roof panels', () => {
    const b = createBuildingFromDefinition(archetypeById('sawtooth-factory'), 'factory', 5, 7);
    const particles = new ParticlePool();
    const roof = b.roofs.find(r => sawtoothClosures(r).some(c => c.glass))!;
    const initial = sawtoothClosures(roof);
    for (const c of b.cells) if (c.isSupport) applyCellDamage(b, c, 10000, 1, 0, particles, []);
    let moved = false;
    for (let i = 0; i < 240; i++) {
      stepStructures([b], 1 / 60, particles, []);
      if (roof.state === 'falling') {
        const faces = sawtoothClosures(roof);
        expect(faces.flatMap(f => f.verts).every(v => [v.x, v.y, v.z].every(Number.isFinite))).toBe(true);
        moved ||= JSON.stringify(faces) !== JSON.stringify(initial);
      }
    }
    expect(moved).toBe(true);
    expect(b.roofs.every(r => r.state === 'gone')).toBe(true);
    expect(b.roofs.flatMap(sawtoothClosures)).toEqual([]);
  });
});
