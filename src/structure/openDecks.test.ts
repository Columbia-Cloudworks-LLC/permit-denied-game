import { expect, it } from 'vitest';
import { ParticlePool } from '../fx/particles';
import { archetypeById, validateBuildingDefinition } from '../world/archetypes';
import { applyCellDamage, createBuildingFromArchetype, stepStructures } from './building';
import { cellWorldBox } from './types';

it('has open parking decks, alternating sloped ramps and a bare top deck', () => {
  const b=createBuildingFromArchetype('parking-garage','GARAGE',0,0),particles=new ParticlePool();
  expect(b.cells).toHaveLength(24);
  expect(b.cells.every(c=>c.role==='column' && !c.cladding && c.floor<3)).toBe(true);
  expect(b.roofs).toEqual([]);
  expect(b.fixtures.filter(f=>f.kind==='vehicle-ramp')).toHaveLength(3);
  expect(b.grid[0]![6]![8]!.state).toBe('gone');
  expect(b.cells.every(c=>cellWorldBox(b,c).w===.32)).toBe(true);
  for(let i=0;i<300;i++)stepStructures([b],1/60,particles,[]);
  expect(b.cells.every(c=>c.state==='intact')).toBe(true);
  expect(b.floorTiles.every(t=>t.state==='intact')).toBe(true);
  for(const c of b.cells.filter(c=>c.floor===0))applyCellDamage(b,c,10000,1,0,particles,[]);
  for(let i=0;i<900;i++)stepStructures([b],1/60,particles,[]);
  expect(b.fullyDown).toBe(true);
  expect(b.fixtures.every(f=>f.broken)).toBe(true);
});

it('rejects unsupported open-deck columns and sealed ramp openings',()=>{
  const a=structuredClone(archetypeById('parking-garage'));
  a.openDecks!.columns[0]={x:30,y:0};
  expect(validateBuildingDefinition(a).join(';')).toContain('continuous column cells');
  const sealed=structuredClone(archetypeById('parking-garage'));
  sealed.floorVoids=[];
  expect(validateBuildingDefinition(sealed).join(';')).toContain('open upper slab');
});
