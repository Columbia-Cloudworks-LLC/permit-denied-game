import { expect, it } from 'vitest';
import { ParticlePool } from '../fx/particles';
import { archetypeById, validateBuildingDefinition } from '../world/archetypes';
import { applyCellDamage, createBuildingFromDefinition, stepStructures } from './building';
import { tankPose } from './elevatedTank';
import { elevatedTankCommands } from '../render/elevatedTank';
import { defaultDebugView } from '../debug/view';
import { cellWorldBox } from './types';

it('has four exposed legs, no hidden slabs, and a stable tank before losing a second leg', () => {
  const b=createBuildingFromDefinition(archetypeById('elevated-water-tower'),'TANK',3,4),particles=new ParticlePool();
  expect(b.cells.length).toBe(12);expect(b.floorTiles).toEqual([]);expect(b.roofs).toEqual([]);
  expect(b.cells.every(c=>c.role==='column' && !c.cladding)).toBe(true);
  expect(b.cells.every(c=>cellWorldBox(b,c).w===.32 && cellWorldBox(b,c).d===.32)).toBe(true);
  for(let i=0;i<600;i++)stepStructures([b],1/60,particles,[]);
  expect(b.elevatedTank!.phase).toBe('standing');expect(b.cells.every(c=>c.state==='intact')).toBe(true);
  applyCellDamage(b,b.grid[0]![0]![0]!,10000,1,0,particles,[]);
  for(let i=0;i<180;i++)stepStructures([b],1/60,particles,[]);
  expect(b.elevatedTank!.phase).toBe('standing');expect(b.elevatedTank!.legs).toBe(3);
  applyCellDamage(b,b.grid[0]![4]![0]!,10000,1,0,particles,[]);
  stepStructures([b],1/60,particles,[]);expect(b.elevatedTank!.phase).toBe('warning');
  const initial=tankPose(b);let fell=false,panels=0;
  for(let i=0;i<600;i++) {
    const r=stepStructures([b],1/60,particles,[]);panels+=r.rubbleSpawns.filter(p=>p.source==='roof').length;
    if(b.elevatedTank!.phase==='falling' && b.elevatedTank!.progress>.1) {
      fell=true;expect(tankPose(b).z).toBeLessThan(initial.z);expect(tankPose(b).tilt).toBeGreaterThan(0);
    }
  }
  expect(fell).toBe(true);expect(panels).toBe(12);expect(b.elevatedTank!.phase).toBe('gone');expect(b.fullyDown).toBe(true);
  expect(elevatedTankCommands(b,defaultDebugView())).toEqual([]);
});

it('rejects unsupported tank forms instead of compiling an enclosed substitute',()=>{
  const a=structuredClone(archetypeById('elevated-water-tower'));
  a.footprint[1]![0]='#####';
  expect(validateBuildingDefinition(a).join(' ')).toContain('exactly four continuous corner legs');
});
