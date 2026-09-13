import { expect, it } from 'vitest';
import { archetypeById, validateBuildingDefinition } from '../world/archetypes';
import { createBuildingFromArchetype } from './building';
import { floorIndex } from './floorIndex';
import { fixtureSupported } from './interior';

it('gives eight boarding rooms private hall entrances and supported stairs from the commons', () => {
  const a = archetypeById('boarding-house');
  expect(validateBuildingDefinition(a)).toEqual([]);
  const entrances = a.layout.connections!.filter(c => c.b.startsWith('stair-hall/'));
  expect(entrances).toHaveLength(8);
  expect(entrances.every(c => c.a.endsWith('/bedroom'))).toBe(true);
  const b = createBuildingFromArchetype('boarding-house', 'BOARDING', 0, 0);
  const flights = b.fixtures.filter(f => f.kind === 'staircase');
  expect(flights).toHaveLength(2);
  expect(flights.every(f => fixtureSupported(b, f))).toBe(true);
  const sealed = structuredClone(a);
  sealed.layout.connections = sealed.layout.connections!.filter(c => c.a !== 'west-south/2/bedroom' || c.b !== 'stair-hall/2/hall');
  expect(validateBuildingDefinition(sealed).join(';')).toContain('without exterior and stair access');
});

it('fits rowhouse stairs and clear landing lanes inside the original narrow footprint', () => {
  const a = archetypeById('rowhouse-unit');
  expect([a.w, a.d, a.floors]).toEqual([3, 7, 3]);
  expect(validateBuildingDefinition(a)).toEqual([]);
  const b = createBuildingFromArchetype('rowhouse-unit', 'ROWHOUSE', 0, 0);
  const flights = b.fixtures.filter(f => f.kind === 'staircase');
  expect(flights).toHaveLength(2);
  expect(flights.every(f => fixtureSupported(b, f))).toBe(true);
  for (const [floor, lane] of [[1, 1], [2, 0]]) for (let gy = 0; gy < 4; gy++) {
    expect(floorIndex(b).at(floor!, lane!, gy)?.state).toBe('intact');
  }
  const sealed = structuredClone(a);
  sealed.layout.stairs = sealed.layout.stairs!.slice(0, 1);
  expect(validateBuildingDefinition(sealed).join(';')).toContain('without exterior and stair access');
});

it('serves hotel guests privately and connects the lobby through the top service floor', () => {
  const a = archetypeById('hotel-podium');
  expect(validateBuildingDefinition(a)).toEqual([]);
  const entrances = a.layout.connections!.filter(c => c.b.startsWith('guest-hall/'));
  expect(entrances).toHaveLength(24);
  expect(entrances.every(c => c.a.endsWith('/bedroom'))).toBe(true);
  const b = createBuildingFromArchetype('hotel-podium', 'HOTEL', 0, 0);
  const flights = b.fixtures.filter(f => f.kind === 'staircase');
  expect(flights).toHaveLength(3);
  expect(flights.every(f => fixtureSupported(b, f))).toBe(true);
  const sealed = structuredClone(a);
  sealed.layout.connections = sealed.layout.connections!.filter(c => c.a !== 'south-2/6/bedroom' || c.b !== 'guest-hall/6/hall');
  expect(validateBuildingDefinition(sealed).join(';')).toContain('without exterior and stair access');
  const isolatedService = structuredClone(a);
  isolatedService.layout.stairs = isolatedService.layout.stairs!.slice(0, -1);
  expect(validateBuildingDefinition(isolatedService).join(';')).toContain('without exterior and stair access');
});

it('connects all twelve tower levels through supported stairs and separate private home entrances', () => {
  const a = archetypeById('apartment-tower');
  expect(validateBuildingDefinition(a)).toEqual([]);
  expect(a.layout.stairs).toHaveLength(11);
  const entrances = a.layout.connections!.filter(c => c.a.split('/')[0] !== c.b.split('/')[0]);
  expect(entrances).toHaveLength(24);
  expect(entrances.every(c => c.a.endsWith('/living') && c.b.startsWith('stair-hall/'))).toBe(true);
  const b = createBuildingFromArchetype('apartment-tower', 'TOWER', 0, 0);
  const flights = b.fixtures.filter(f => f.kind === 'staircase');
  expect(flights).toHaveLength(3);
  expect(flights.every(f => fixtureSupported(b, f))).toBe(true);
  const severed = structuredClone(a);
  severed.layout.stairs = severed.layout.stairs!.filter(s => s.a !== 'stair-hall/5/hall');
  expect(validateBuildingDefinition(severed).join(';')).toContain('without exterior and stair access');
  const sealed = structuredClone(a);
  sealed.layout.connections = sealed.layout.connections!.filter(c => c.a !== 'east-home/11/living' || c.b !== 'stair-hall/11/hall');
  expect(validateBuildingDefinition(sealed).join(';')).toContain('without exterior and stair access');
});

it.each(['garden-apartment-block','courtyard-apartment'])('%s has private wings, an open court and supported horizontal stairs', id => {
  const a=archetypeById(id), b=createBuildingFromArchetype(id,'APARTMENTS',0,0);
  expect(a.footprint[0]![a.d-1]![6]).toBe('.');
  expect(a.layout.stairs).toHaveLength(2);
  expect(a.layout.stairs!.every(s=>s.rotation===90)).toBe(true);
  for(const c of a.layout.connections!)if(c.a.split('/')[0]!==c.b.split('/')[0])
    expect(c.a.startsWith('shared-hall/') || c.b.startsWith('shared-hall/')).toBe(true);
  const flight=b.fixtures.find(f=>f.kind==='staircase' && f.floor===0)!;
  expect(flight.heading).toBe(Math.PI/2);
  expect(fixtureSupported(b,flight)).toBe(true);
  expect(flight.landingSupport!.every(s=>s.gx===7)).toBe(true);
  for(const support of flight.landingSupport!)floorIndex(b).at(support.floor,support.gx,support.gy)!.state='gone';
  expect(fixtureSupported(b,flight)).toBe(false);
});

it('gives each duplex home its own stairs and upper slab opening without doors through the party wall', () => {
  const b = createBuildingFromArchetype('side-by-side-duplex', 'DUPLEX', 0, 0);
  expect(b.layout.stairs).toHaveLength(2);
  expect(b.fixtures.filter(f => f.kind === 'staircase')).toHaveLength(2);
  expect(b.layout.connections!.every(c => c.a.split('/')[0] === c.b.split('/')[0])).toBe(true);
  for (const gx of [0,4]) for (const gy of [1,2,3]) expect(floorIndex(b).byFloor[1]!.some(t => t.gx===gx && t.gy===gy)).toBe(false);
});

it('rejects a home with no stairs, an entrance removed, or a slab sealing the stairwell', () => {
  const original = archetypeById('side-by-side-duplex');
  const missingStair = structuredClone(original);
  missingStair.layout.stairs = missingStair.layout.stairs!.slice(1);
  expect(validateBuildingDefinition(missingStair).join(';')).toContain('without exterior and stair access');
  const missingEntrance = structuredClone(original);
  missingEntrance.openings = missingEntrance.openings.slice(1);
  expect(validateBuildingDefinition(missingEntrance).join(';')).toContain('without exterior and stair access');
  const sealed = structuredClone(original);
  sealed.floorVoids = [];
  expect(validateBuildingDefinition(sealed).join(';')).toContain('open upper slab');
});

it('serves every motel room from a shared corridor without connecting neighboring bedrooms', () => {
  const a = archetypeById('motel-room-block');
  expect(validateBuildingDefinition(a)).toEqual([]);
  expect(a.layout.stairs).toHaveLength(1);
  for (const c of a.layout.connections!) {
    const left = c.a.split('/')[0], right = c.b.split('/')[0];
    expect(left === right || left === 'corridor' || right === 'corridor').toBe(true);
  }
  const sealed = structuredClone(a);
  sealed.layout.connections = sealed.layout.connections!.filter(c => !(c.a === 'room-3/1/sleeping' && c.b === 'corridor/1/hall'));
  expect(validateBuildingDefinition(sealed).join(';')).toContain('without exterior and stair access');
  const noStairs = structuredClone(a);
  noStairs.layout.stairs = [];
  expect(validateBuildingDefinition(noStairs).join(';')).toContain('without exterior and stair access');
});

it('serves four private homes from one stair hall with living-room entrances', () => {
  const a = archetypeById('fourplex');
  const entrances = a.layout.connections!.filter(c => c.a.split('/')[0] !== c.b.split('/')[0]);
  expect(entrances).toHaveLength(4);
  expect(entrances.every(c => c.a.endsWith('/living') && c.b.startsWith('stair-hall/'))).toBe(true);
  expect(a.layout.stairs).toHaveLength(1);
  const b = createBuildingFromArchetype('fourplex', 'FOURPLEX', 0, 0);
  expect(b.fixtures.filter(f => f.kind === 'staircase')).toHaveLength(1);
  expect(floorIndex(b).byFloor[1]!.some(t => t.gx===5 && t.gy===2)).toBe(true);
  const sealed = structuredClone(a);
  sealed.layout.connections = sealed.layout.connections!.filter(c => c.a !== 'west-units/1/living' || c.b !== 'stair-hall/1/hall');
  expect(validateBuildingDefinition(sealed).join(';')).toContain('without exterior and stair access');
});

it('keeps independently entered storage units separated by full-depth partitions', () => {
  const b = createBuildingFromArchetype('self-storage-row', 'STORAGE', 0, 0);
  expect(b.layout.connections).toEqual([]);
  const partitions = b.fixtures.filter(f => f.kind === 'partition');
  expect(partitions).toHaveLength(3);
  for (const p of partitions) {
    expect(p.y).toBe(0);
    expect(p.d).toBe(b.d * b.cellSize);
  }
  for (const gx of [1, 4, 7, 10]) expect(b.grid[0]![gx]![2]!.loadingS).toBe(true);
});

it('rejects a sealed storage unit even when its neighbors have entrances', () => {
  const a = structuredClone(archetypeById('self-storage-row'));
  a.openings = a.openings.slice(1);
  expect(validateBuildingDefinition(a).join(';')).toContain('connected doorway');
});

it('does not count an entrance on an interior cell as exterior access', () => {
  const a = structuredClone(archetypeById('self-storage-row'));
  a.openings[0]!.cell = { x: 1, y: 1 };
  expect(validateBuildingDefinition(a).join(';')).toContain('connected doorway');
});
