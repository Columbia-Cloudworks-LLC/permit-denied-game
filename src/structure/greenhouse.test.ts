import { expect, it } from 'vitest';
import { archetypeById } from '../world/archetypes';
import { createBuildingFromDefinition, applyCellDamage, stepStructures } from './building';
import { ParticlePool } from '../fx/particles';

it('has light breakable glazing around a stable steel frame in either roof orientation', () => {
  for (const roofAxis of ['x', 'y'] as const) {
    const b = createBuildingFromDefinition({ ...archetypeById('greenhouse'), roofAxis }, 'glasshouse', 3, 3);
    const particles = new ParticlePool();
    const glass = b.cells.find(c => !c.isSupport)!;
    const columns = b.cells.filter(c => c.isSupport);
    expect(glass.material).toBe('glass'); expect(glass.maxHp).toBe(9);
    expect(columns.every(c => c.material === 'metal' && c.maxHp > glass.maxHp)).toBe(true);
    expect(b.roofs.every(r => r.material === 'glass' && r.support.length > 0)).toBe(true);
    for (let n = 0; n < 120; n++) stepStructures([b], 1 / 60, particles, []);
    expect(b.roofs.every(r => r.state === 'intact')).toBe(true);
    applyCellDamage(b, glass, 20, 1, 0, particles, []);
    for (let n = 0; n < 120; n++) stepStructures([b], 1 / 60, particles, []);
    expect(glass.state).not.toBe('intact');
    expect(columns.every(c => c.state === 'intact')).toBe(true);
    expect(b.roofs.every(r => r.state === 'intact')).toBe(true);
    for (const c of columns) applyCellDamage(b, c, 10000, 1, 0, particles, []);
    for (let n = 0; n < 240; n++) stepStructures([b], 1 / 60, particles, []);
    expect(b.roofs.every(r => r.state === 'gone')).toBe(true);
  }
});
