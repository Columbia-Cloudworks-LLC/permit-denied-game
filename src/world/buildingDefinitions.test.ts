import { describe, expect, it } from 'vitest';
import catalog from './data/buildings.json';
import { ARCHETYPES, parseBuildingCatalog, validateBuildingDefinition } from './archetypes';
import { createBuildingFromDefinition } from '../structure/building';
import { createTown } from './town';

const raw = () => structuredClone(catalog);
describe('JSON building authoring', () => {
  it('compiles a new JSON building through the production constructor without a code registration', () => {
    const data = raw();
    data.buildings.push({ ...data.buildings[0]!, id: 'authored-building', label: 'AUTHORED' });
    const definition = parseBuildingCatalog(JSON.parse(JSON.stringify(data))).at(-1)!;
    const b = createBuildingFromDefinition(definition, definition.label, 10, 20);
    expect(b.archetypeId).toBe('authored-building');
    expect(b.fixtures.length).toBeGreaterThan(0);
    expect(b.floorTiles.length).toBe(b.w * b.d * b.floors);
    expect(b.roofs.every(r => r.support.length > 0)).toBe(true);
  });
  it('rejects malformed data, unknown fields, references, materials and versions', () => {
    expect(() => parseBuildingCatalog(null)).toThrow('catalog');
    expect(() => parseBuildingCatalog({ ...raw(), version: 9 })).toThrow('version');
    expect(() => parseBuildingCatalog({ ...raw(), silentFallback: true })).toThrow('unknown field');
    const reference = raw(); reference.buildings[0]!.construction = 'missing';
    expect(() => parseBuildingCatalog(reference)).toThrow('reference');
    const material = raw(); material.constructions['timber-house'].structure = 'mystery';
    expect(() => parseBuildingCatalog(material)).toThrow('material');
  });
  it('rejects duplicate buildings, nonexistent floors, missing room coverage and unknown contents', () => {
    const duplicate = raw(); duplicate.buildings.push(duplicate.buildings[0]!);
    expect(() => parseBuildingCatalog(duplicate)).toThrow('Duplicate building');
    const floor = raw(); floor.layouts.ranch.rooms[0]!.floor = 5;
    expect(() => parseBuildingCatalog(floor)).toThrow('room bounds');
    const gap = raw(); gap.layouts.ranch.rooms.pop();
    expect(() => parseBuildingCatalog(gap)).toThrow('complete room coverage');
    const object = raw(); object.layouts.ranch.rooms[0]!.contents[0]!.kind = 'missing';
    expect(() => parseBuildingCatalog(object)).toThrow('Unknown object');
  });
  it('rejects room collisions, duplicate identities and invalid door connections', () => {
    const source = ARCHETYPES.find(a => a.id === 'rivertown')!;
    const room = source.layout.rooms[0]!;
    expect(validateBuildingDefinition({ ...source, layout: { ...source.layout, rooms: [...source.layout.rooms, room] } }).join(';')).toContain('Duplicate');
    expect(validateBuildingDefinition({ ...source, layout: { ...source.layout, connections: [] } }).join(';')).toContain('connected doorway');
    expect(validateBuildingDefinition({ ...source, layout: { ...source.layout, connections: [{ a: room.id, b: 'missing', at: .5, width: .4 }] } }).join(';')).toContain('connection');
  });
  it('rejects rooms that cross a footprint hole and unsupported entrance sides', () => {
    const source = ARCHETYPES.find(a => a.id === 'porch-house')!;
    const definition = { ...source, layout: { ...source.layout, rooms: source.layout.rooms.map(r => r.floor === 1 ? { ...r, w: r.w + .1 } : r) } };
    expect(validateBuildingDefinition(definition).join(';')).toContain('footprint');
    const data = raw(); data.buildings[0]!.openings[0]!.side = 'west';
    expect(() => parseBuildingCatalog(data)).toThrow('supported frontage');
  });
  it('keeps definition data immutable and damage local to the instance', () => {
    const source = ARCHETYPES[0]!, a = createBuildingFromDefinition(source, 'A', 0, 0), b = createBuildingFromDefinition(source, 'B', 10, 0);
    a.fixtures[0]!.hp = 0;
    expect(b.fixtures[0]!.hp).toBeGreaterThan(0);
    expect(Object.isFrozen(source.layout.rooms[0]!.contents)).toBe(true);
  });
  it.each(['classic', 'd10', 'd30', 'd100'] as const)('retains lot ownership and room identity in %s', district => {
    const town = createTown({ district, seed: 19 });
    const lots = new Set(town.lots.map(l => l.id));
    expect(town.buildings.every(b => b.lotId !== null && lots.has(b.lotId))).toBe(true);
    expect(town.props.filter(p => p.lotId !== null).every(p => lots.has(p.lotId!))).toBe(true);
    expect(town.buildings.every(b => b.floorTiles.every(t => b.layout.rooms.some(r => r.id === t.roomId)))).toBe(true);
  });
});
