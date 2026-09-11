import { it, expect } from 'vitest';
import { createBuildingFromArchetype, applyCellDamage, stepStructures } from '../structure/building';
import { ParticlePool } from '../fx/particles';
import { getBuildingSurfaces } from '../render/buildingSurfaces';
import { interiorFloorCoverage } from '../structure/interior';
import { roofCoversOnlyOccupied } from '../structure/roof';

const examples = ['union-tower','logistics-hub','data-hall'] as const;
it.each(examples)('%s remains intact when evaluated, reacts locally and fully collapses', id => {
  const b = createBuildingFromArchetype(id,id,0,0), p = new ParticlePool();
  expect(roofCoversOnlyOccupied(b)).toBe(true);
  for (const roof of b.roofs) {
    const xs = roof.verts.map(v => v.x), ys = roof.verts.map(v => v.y);
    for (const tile of b.floorTiles.filter(t => t.floor === roof.floor + 1)) {
      const x = b.x + (tile.gx + .5) * b.cellSize, y = b.y + (tile.gy + .5) * b.cellSize;
      expect(x > Math.min(...xs) && x < Math.max(...xs) && y > Math.min(...ys) && y < Math.max(...ys)).toBe(false);
    }
  }
  b.structureDirty = true;
  for(let i=0;i<90;i++) stepStructures([b],1/60,p,[]);
  expect(b.cells.every(c=>c.state==='intact')).toBe(true);
  expect(b.floorTiles.every(t=>t.state==='intact')).toBe(true);
  expect(b.roofs.every(r=>r.state==='intact')).toBe(true);
  applyCellDamage(b,b.cells[0]!,10000,1,0,p,[]);
  for(let i=0;i<120;i++) stepStructures([b],1/60,p,[]);
  expect(b.cells.filter(c=>c.state!=='intact').length).toBeLessThan(b.cells.length / 10);
  for(const cell of b.cells) applyCellDamage(b,cell,10000,1,0,p,[]);
  for(let i=0;i<480;i++) stepStructures([b],1/60,p,[]);
  expect(b.fullyDown).toBe(true);
  expect(b.floorTiles.filter(t=>t.floor===0).every(t=>t.state==='intact')).toBe(true);
});
it('bounds the large examples and measures constructor, surface and damaged simulation costs',()=>{
  for(const id of examples){
    const times=[]; let b=createBuildingFromArchetype(id,id,0,0);
    for(let i=0;i<7;i++){const t=performance.now();b=createBuildingFromArchetype(id,id,0,0);times.push(performance.now()-t);}
    const t=performance.now();const surfaces=getBuildingSurfaces(b);interiorFloorCoverage(b);const render=performance.now()-t;
    const p=new ParticlePool();applyCellDamage(b,b.cells[0]!,10000,1,0,p,[]);
    const steps=[];for(let i=0;i<120;i++){const t=performance.now();stepStructures([b],1/60,p,[]);steps.push(performance.now()-t);}
    expect(b.w*b.d*b.floors).toBeLessThanOrEqual(2880);
    expect(b.fixtures.length).toBeLessThanOrEqual(45);
    expect(surfaces.geometryCount).toBeLessThanOrEqual(48);
    if(id==='logistics-hub'){expect(b.w*b.cellSize).toBe(80);expect(b.d*b.cellSize).toBe(50);}
    console.log(JSON.stringify({id,grid:b.w*b.d*b.floors,tiles:b.floorTiles.length,cells:b.cells.length,fixtures:b.fixtures.length,roofs:b.roofs.length,surfaces:surfaces.geometryCount,constructorMedianMs:times.sort((a,b)=>a-b)[3],surfacePrepMs:render,damageStepP95Ms:steps.sort((a,b)=>a-b)[113]}));
  }
});

it('bounds a whole-tower debris burst before the solver and preserves owned mass', async () => {
  const { createTown } = await import('./town');
  const { createDozer } = await import('../vehicle/dozer');
  const { stepWorld } = await import('../sim/worldSim');
  const { restoreBay } = await import('./testYard');
  const { totalDebrisMass } = await import('../sim/debris');
  const t = createTown({ yard: true }), p = new ParticlePool();
  p.ownerAt = t.debrisOwnerAt;
  const bay = t.yard!.bays.find(b => b.asset.id === 'building:union-tower')!, b = bay.building!;
  const dozer = createDozer(b.x + b.w * b.cellSize / 2, b.y + b.d * b.cellSize + 3, 0);
  for(const c of b.cells) applyCellDamage(b,c,10000,1,0,p,[]);
  let peak=0;const times=[];
  for(let i=0;i<480;i++){const start=performance.now();stepWorld(t,dozer,p,{blade:0,engine:0,push:0},1/60);times.push(performance.now()-start);peak=Math.max(peak,t.rubble.length);}
  expect(b.fullyDown).toBe(true);
  expect(peak).toBeLessThanOrEqual(100);
  expect(totalDebrisMass(t)).toBeGreaterThan(2000);
  expect(t.rubble.every(r=>r.yardOwner===bay.key)).toBe(true);
  restoreBay(t,bay,p);
  expect(totalDebrisMass(t)).toBeLessThan(.005); // Float32 pile accumulation over thousands of deposits.
  console.log(JSON.stringify({scenario:'full-tower-world',peakBodies:peak,stepP95Ms:times.sort((a,b)=>a-b)[227],maxStepMs:Math.max(...times)}));
});

