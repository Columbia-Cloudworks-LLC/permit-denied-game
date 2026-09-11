import { describe, expect, it } from 'vitest';
import { ARCHETYPES, BUILDING_FILES, parseBuildingPackages, parseContentFiles, validateBuildingDefinition } from './archetypes';
import { createBuildingFromDefinition } from '../structure/building';
import { createTown } from './town';

// Intentionally untyped at the JSON seam so malformed author input can be exercised.
const raw = (): Record<string, any> => structuredClone(BUILDING_FILES);
const buildingFile = (id: string) => Object.keys(BUILDING_FILES).find(f => f.endsWith('.building.json') && (BUILDING_FILES[f] as { id: string }).id === id)!;
const layoutFile = (id: string) => buildingFile(id).replace('main.building.json', 'main.layout.json');
const parse = parseBuildingPackages;
describe('discovered building packages', () => {
  it('discovers a new package in a nested folder, independent of file enumeration order', () => {
    const data = raw(), from = buildingFile('ranch'), local = layoutFile('ranch');
    const path = './data/buildings/anything/new-building/definition.building.json';
    data[path] = { ...data[from], id: 'authored-building', label: 'AUTHORED', generationOrder: 100 };
    data[path.replace('definition.building.json', 'main.layout.json')] = data[local];
    const definitions = parse(data);
    expect(parse(Object.fromEntries(Object.entries(data).reverse()))).toEqual(definitions);
    const definition = definitions.find(a => a.id === 'authored-building')!;
    const b = createBuildingFromDefinition(definition, definition.label, 10, 20);
    expect(b.archetypeId).toBe('authored-building');
    expect(b.fixtures.length).toBeGreaterThan(0);
    expect(b.floorTiles.length).toBe(b.w * b.d * b.floors);
    expect(b.roofs.every(r => r.support.length > 0)).toBe(true);
  });
  it('reports malformed JSON, shape, version and unknown fields with filenames and definitions', () => {
    expect(() => parseContentFiles({ 'bad.building.json': '{' })).toThrow('bad.building.json: malformed JSON');
    const file = buildingFile('ranch');
    for (const changed of [null, { ...raw()[file], version: 9 }, { ...raw()[file], silentFallback: true }]) {
      const data = raw(); data[file] = changed;
      expect(() => parse(data)).toThrow(file);
    }
    const data = raw(); data[layoutFile('ranch')].rooms[0].contents[0].x = 'wide';
    expect(() => parse(data)).toThrow(`${layoutFile('ranch')}.rooms[0].contents[0].x`);
  });
  it('resolves shared construction explicitly and rejects missing and duplicate references', () => {
    const file = buildingFile('ranch'), data = raw(); data[file].construction = 'missing';
    expect(() => parse(data)).toThrow(/ranch.*Unknown construction reference missing/);
    const duplicate = raw(); duplicate['./data/duplicate.building.json'] = duplicate[file];
    expect(() => parse(duplicate)).toThrow(/duplicate.building.json.*Duplicate building id ranch/);
    const material = raw(), construction = './data/shared/construction/timber-house.construction.json';
    material[construction].structure = 'mystery';
    expect(() => parse(material)).toThrow(/timber-house.construction.json.*Unknown structure material/);
    const assemblies = raw(); assemblies['./data/duplicate.construction.json'] = assemblies[construction];
    expect(() => parse(assemblies)).toThrow('Duplicate construction id timber-house');
    const layout = raw(); layout[file].layout = '../cottage/main.layout.json';
    expect(() => parse(layout)).toThrow('must be a sibling');
    layout[file].layout = 'missing.layout.json';
    expect(() => parse(layout)).toThrow('Unknown layout reference');
  });
  it('gives formerly shared layouts independent ownership while retaining explicit assembly reuse', () => {
    const data = raw(), local = layoutFile('cottage');
    data[local].rooms[0].contents[0].h += .25;
    const modified = parse(data);
    expect(modified.find(a => a.id === 'cottage')!.layout).not.toEqual(ARCHETYPES.find(a => a.id === 'cottage')!.layout);
    for (const id of ['colonial', 'walkup']) expect(modified.find(a => a.id === id)!.layout).toEqual(ARCHETYPES.find(a => a.id === id)!.layout);
    const shared = raw(); shared['./data/shared/construction/timber-house.construction.json'].failureDelay = .9;
    const resolved = parse(shared);
    expect(resolved.filter(a => a.construction.id === 'timber-house').every(a => a.construction.failureDelay === .9)).toBe(true);
    expect(resolved.find(a => a.id === 'colonial')!.construction.failureDelay).toBe(.38);
    expect(ARCHETYPES.find(a => a.id === 'cottage')!.layout).not.toBe(ARCHETYPES.find(a => a.id === 'walkup')!.layout);
    const sameFolder = raw(), original = buildingFile('ranch');
    sameFolder[original.replace('main.building.json', 'variant.building.json')] = { ...sameFolder[original], id: 'ranch-variant', generationOrder: 100 };
    expect(() => parse(sameFolder)).toThrow('already owned by ranch');
  });
  it('rejects bad room bounds, coverage, objects, identity and connections', () => {
    const floor = raw(); floor[layoutFile('ranch')].rooms[0].floor = 5;
    expect(() => parse(floor)).toThrow(/ranch.*main.layout.json.*room bounds/);
    const gap = raw(); gap[layoutFile('ranch')].rooms.pop();
    expect(() => parse(gap)).toThrow('complete room coverage');
    const object = raw(); object[layoutFile('ranch')].rooms[0].contents[0].kind = 'missing';
    expect(() => parse(object)).toThrow('Unknown object');
    const source = ARCHETYPES.find(a => a.id === 'rivertown')!, room = source.layout.rooms[0]!;
    expect(validateBuildingDefinition({ ...source, layout: { ...source.layout, rooms: [...source.layout.rooms, room] } }).join(';')).toContain('Duplicate');
    expect(validateBuildingDefinition({ ...source, layout: { ...source.layout, connections: [] } }).join(';')).toContain('connected doorway');
    expect(validateBuildingDefinition({ ...source, layout: { ...source.layout, connections: [{ a: room.id, b: 'missing', at: .5, width: .4 }] } }).join(';')).toContain('connection');
  });
  it('validates section bounds, repeats, overlaps, dimensions and limits before expansion', () => {
    const path = buildingFile('union-tower');
    for (const change of [(b: any) => b.sections[1].floor = 0, (b: any) => b.sections[1].x = -1,
      (b: any) => b.sections[1].floors = 999999, (b: any) => b.w = 999999,
      (b: any) => b.sections[1].id = b.sections[0].id,
      (b: any) => b.sections[1].x = 10]) {
      const data = raw(); change(data[path]); expect(() => parse(data)).toThrow(path);
    }
    const stride = raw(); stride[path].cellSize = 20; expect(() => parse(stride)).toThrow('cellSize');
    const order = raw(); order[path].generationOrder = 0; expect(() => parse(order)).toThrow('generationOrder');
    const template = raw(); const layout = path.replace('main.building.json', 'office.layout.json');
    template[layout].rooms[0].floor = 1; expect(() => parse(template)).toThrow('office.layout.json');
  });
  it('rejects rooms crossing footprint holes and unsupported entrances', () => {
    const source = ARCHETYPES.find(a => a.id === 'porch-house')!;
    const definition = { ...source, layout: { ...source.layout, rooms: source.layout.rooms.map(r => r.floor === 1 ? { ...r, w: r.w + .1 } : r) } };
    expect(validateBuildingDefinition(definition).join(';')).toContain('footprint');
    const data = raw(); data[buildingFile('ranch')].openings[0].side = 'west';
    expect(() => parse(data)).toThrow('supported frontage');
  });
  it('keeps repeated rooms and runtime damage independent', () => {
    const source = ARCHETYPES.find(a => a.id === 'union-tower')!;
    const repeated = source.layout.rooms.filter(r => r.id.startsWith('tower/'));
    expect(repeated).toHaveLength(21);
    expect(new Set(repeated.map(r => r.id)).size).toBe(21);
    expect(repeated[0]!.contents).not.toBe(repeated[1]!.contents);
    expect(Object.isFrozen(repeated[0]!.contents)).toBe(true);
    const a = createBuildingFromDefinition(source, 'A', 0, 0), b = createBuildingFromDefinition(source, 'B', 10, 0);
    a.fixtures[0]!.hp = 0;
    expect(b.fixtures[0]!.hp).toBeGreaterThan(0);
  });
  it.each(['classic', 'd10', 'd30', 'd100'] as const)('retains lot ownership and room identity in %s', district => {
    const town = createTown({ district, seed: 19 }), lots = new Set(town.lots.map(l => l.id));
    expect(town.buildings.every(b => b.lotId !== null && lots.has(b.lotId))).toBe(true);
    expect(town.props.filter(p => p.lotId !== null).every(p => lots.has(p.lotId!))).toBe(true);
    expect(town.buildings.every(b => b.floorTiles.every(t => b.layout.rooms.some(r => r.id === t.roomId)))).toBe(true);
  });
});
