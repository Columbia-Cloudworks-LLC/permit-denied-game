import { expect, it } from 'vitest';
import { ParticlePool } from '../fx/particles';
import { archetypeById, validateBuildingDefinition } from '../world/archetypes';
import { applyCellDamage, createBuildingFromArchetype, stepStructures } from './building';
import { siloCells, siloPose } from './silos';
import { cellWorldBox } from './types';

it('keeps two cylindrical bins stable and collapses only the bin losing four supports',()=>{
  const b=createBuildingFromArchetype('grain-elevator','GRAIN',0,0), particles=new ParticlePool();
  expect(b.silos).toHaveLength(2);
  const first=b.silos![0]!,second=b.silos![1]!,cells=siloCells(b,first);
  expect(cells).toHaveLength(8);
  expect(b.roofs.every(r=>r.floor===5)).toBe(true);
  expect(cells.every(c=>cellWorldBox(b,c).w>0 && cellWorldBox(b,c).d>0)).toBe(true);
  for(let i=0;i<600;i++)stepStructures([b],1/60,particles,[]);
  expect(first.phase).toBe('standing');expect(second.phase).toBe('standing');
  for(const c of cells.slice(0,3))applyCellDamage(b,c,10000,1,0,particles,[]);
  for(let i=0;i<180;i++)stepStructures([b],1/60,particles,[]);
  expect(first.phase).toBe('standing');
  const initial=siloPose(b,first).height;
  applyCellDamage(b,cells[3]!,10000,1,0,particles,[]);
  let moved=false,panels=0;
  for(let i=0;i<600;i++) {
    panels+=stepStructures([b],1/60,particles,[]).rubbleSpawns.filter(p=>p.source==='roof').length;
    if(first.phase==='falling'){moved=true;expect(siloPose(b,first).height).toBeLessThan(initial);}
  }
  expect(moved).toBe(true);expect(first.phase).toBe('gone');expect(second.phase).toBe('standing');expect(panels).toBe(16);
  expect(b.cells.filter(c=>!c.silo).every(c=>c.state==='intact')).toBe(true);
  for(const c of b.cells)applyCellDamage(b,c,10000,1,0,particles,[]);
  for(let i=0;i<900;i++)stepStructures([b],1/60,particles,[]);
  expect(b.silos!.every(s=>s.phase==='gone')).toBe(true);expect(b.fullyDown).toBe(true);
});

it('rejects silo overlap and occupied floors passing through bins',()=>{
  const a=structuredClone(archetypeById('grain-elevator'));
  a.silos![1]!.gx=5;
  expect(validateBuildingDefinition(a).join(';')).toContain('bins overlap');
  const above=structuredClone(archetypeById('grain-elevator'));
  above.footprint[1]![2]='##############';
  expect(validateBuildingDefinition(above).join(';')).toContain('without upper floor rooms');
});
