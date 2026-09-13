import { expect, it } from 'vitest';
import { ParticlePool } from '../fx/particles';
import { archetypeById, validateBuildingDefinition } from '../world/archetypes';
import { applyCellDamage, createBuildingFromDefinition, stepStructures } from './building';
import { floorIndex } from './floorIndex';
import { roofCoverage } from './roof';
import { interiorFloorCoverage } from './interior';

it('keeps the theater roof above a genuinely open auditorium without repeated upper seating',()=>{
  const b=createBuildingFromDefinition(archetypeById('neighborhood-theater'),'THEATER',0,0),p=new ParticlePool();
  expect(floorIndex(b).at(1,4,4)).toBeUndefined();
  expect(b.fixtures.some(f=>f.floor===1)).toBe(false);
  expect(b.fixtures.some(f=>f.kind==='theater-screen' && f.h>2.35)).toBe(true);
  expect(b.roofs.filter(r=>r.floor===1).flatMap(roofCoverage).some(c=>c.gx===4 && c.gy===4)).toBe(true);
  expect(interiorFloorCoverage(b,true).spans.some(s=>s.floor===1 && s.gx0<=4 && s.gx1>=4 && s.gy0<=4 && s.gy1>=4)).toBe(false);
  for(let i=0;i<180;i++)stepStructures([b],1/60,p,[]);
  expect(b.roofs.every(r=>r.state==='intact')).toBe(true);
  for(const c of b.cells)applyCellDamage(b,c,10000,0,1,p,[]);
  for(let i=0;i<900;i++)stepStructures([b],1/60,p,[]);
  expect(b.fullyDown).toBe(true);
});

it('rejects contents placed over a slab opening',()=>{
  const a=structuredClone(archetypeById('neighborhood-theater'));
  const room=a.layout.rooms.find(r=>r.floor===1)!;
  room.contents=[{id:'unsupported-chair',kind:'sofa',x:.3,y:.3,w:.2,d:.2,h:.8,rotation:0}];
  expect(validateBuildingDefinition(a).join(' ')).toContain('Fixture overlaps floor void');
});
