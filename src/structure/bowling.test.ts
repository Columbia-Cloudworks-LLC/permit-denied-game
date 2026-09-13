import { createTown } from '../world/town';
import { createDozer } from '../vehicle/dozer';
import { stepWorld } from '../sim/worldSim';
import { archetypeById, validateBuildingDefinition } from '../world/archetypes';
import { fixtureSupported } from './interior';
import { expect, it } from 'vitest';
import { createBuildingFromArchetype, applyCellDamage, stepStructures } from './building';
import { applyFixtureDamage } from './interior';
import { ParticlePool } from '../fx/particles';
import type { WorldEvent } from './types';
import { ASSET_CATALOG } from '../world/catalog';
import { BowlingStrikes, STRIKE_DURATION } from '../render/bowlingStrikes';

it('authors lanes as slab paint, never as physical fixtures or spawnable props', () => {
  const b = createBuildingFromArchetype('bowling-alley','TEST',0,0);
  expect(b.layout.rooms.flatMap(r=>r.floorDesigns??[])).toHaveLength(6);
  expect(b.fixtures.filter(f=>f.kind==='bowling-pins')).toHaveLength(6);
  expect(b.fixtures.some(f=>String(f.kind)==='bowling-lane')).toBe(false);
  expect(ASSET_CATALOG.some(a=>a.id==='interior-bowling-lane')).toBe(false);
});
it('emits one strike only when a direct dozer hit finishes a pin set', () => {
  const b=createBuildingFromArchetype('bowling-alley','TEST',0,0), p=new ParticlePool(), events:WorldEvent[]=[];
  const pins=b.fixtures.filter(f=>f.kind==='bowling-pins');
  applyFixtureDamage(b,pins[0]!,1,1,0,p,events,true);
  expect(events.filter(e=>e.kind==='bowling-strike')).toHaveLength(0);
  applyFixtureDamage(b,pins[0]!,100,1,0,p,events,true);
  applyFixtureDamage(b,pins[0]!,100,1,0,p,events,true);
  applyFixtureDamage(b,pins[1]!,100,1,0,p,events);
  expect(events.filter(e=>e.kind==='bowling-strike')).toHaveLength(1);
});
it('roof demolition destroys pins without a strike and leaves lane paint owned by the slab', () => {
  const b=createBuildingFromArchetype('bowling-alley','TEST',0,0), p=new ParticlePool(), events:WorldEvent[]=[];
  for(const c of b.cells) applyCellDamage(b,c,99999,1,0,p,events);
  for(let i=0;i<900;i++) stepStructures([b],1/60,p,events);
  expect(b.fixtures.filter(f=>f.kind==='bowling-pins').every(f=>f.broken)).toBe(true);
  expect(events.some(e=>e.kind==='bowling-strike')).toBe(false);
  expect(b.layout.rooms.flatMap(r=>r.floorDesigns??[])).toHaveLength(6);
});
it('stacks simultaneous strikes and releases every graphic after its fade', () => {
  const strikes=new BowlingStrikes();
  for(let i=0;i<6;i++) strikes.add();
  strikes.draw(.2,100,100,1);
  expect(strikes.count).toBe(6);
  expect(new Set(strikes.root.children.map(c=>c.y)).size).toBe(6);
  strikes.draw(STRIKE_DURATION,100,100,1);
  expect(strikes.count).toBe(0);
  expect(strikes.root.children).toHaveLength(0);
});

it('sandwiches a connected apartment between two fully furnished bowling floors', () => {
  const a=archetypeById('frank-grimes-bowling'), b=createBuildingFromArchetype(a.id,'TEST',0,0);
  expect(validateBuildingDefinition(a)).toEqual([]);
  expect(b.floors).toBe(3);
  expect(b.coreCollapse).toBeUndefined();
  expect(b.layout.rooms.filter(r=>r.floorDesigns?.length).map(r=>r.floor)).toEqual([0,2]);
  expect(b.fixtures.filter(f=>f.kind==='bowling-pins')).toHaveLength(12);
  expect(b.layout.rooms.filter(r=>r.floor===1).map(r=>r.kind)).toEqual(expect.arrayContaining(['living','bedroom','bathroom']));
  expect(b.fixtures.filter(f=>f.kind==='staircase')).toHaveLength(2);
  expect(b.fixtures.every(f=>fixtureSupported(b,f))).toBe(true);
  const p=new ParticlePool();for(let i=0;i<180;i++)stepStructures([b],1/60,p,[]);
  expect(b.cells.every(c=>c.state==='intact')).toBe(true);
});

it('triggers the celebration through the real dozer collision path', () => {
  const town=createTown(), b=createBuildingFromArchetype('bowling-alley','TEST',30,30), p=new ParticlePool();
  town.buildings=[b];town.props=[];town.roadCar=null;
  b.cells.find(c=>c.exterior.south)!.state='gone';b.visualRevision++;b.collisionDirty=true;b.structureDirty=false;
  const pins=b.fixtures.filter(f=>f.kind==='bowling-pins'), events:WorldEvent[]=[];
  for(const f of pins) {
    const dozer=createDozer(f.x+f.w/2,f.y+f.d+.1,-Math.PI/2);dozer.vy=-7;
    events.push(...stepWorld(town,dozer,p,{blade:0,engine:0,push:0},1/60).events);
  }
  expect(pins.every(f=>f.broken)).toBe(true);
  expect(events.filter(e=>e.kind==='bowling-strike')).toHaveLength(6);
});
