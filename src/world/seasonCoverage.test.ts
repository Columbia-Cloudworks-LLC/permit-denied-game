import {expect,it} from 'vitest';
import {CAMPAIGN_LEVELS} from '../game/campaign';
import {availableTownValue} from '../game/campaignValue';
import {createTown} from './town';
import {BIOME_PROFILES} from './biomes';
import {SEASONS,permittedFieldStates} from './season';
import {resolveTraversal,type TerrainFeature} from './terrainFeatures';
import {planForestMasses} from '../render/forestCanopy';
import {createSurfaceGrid,SURFACE_ID} from './terrain';

it('every campaign target is attainable without crop income in every season',()=>{
 for(const level of CAMPAIGN_LEVELS) for(const season of SEASONS){
  const town=createTown({district:"d30",seed:19,campaign:level,season,biome:BIOME_PROFILES['agricultural-plain']});
  expect(availableTownValue(town),`${level.id} ${season}`).toBeGreaterThanOrEqual(level.dollarTarget);
  for(const field of town.features)if(field.kind==='field')expect(permittedFieldStates(season)).toContain(field.state);
 }
},240000);

it('ponds, lakes, narrow and wide bent rivers share the winter crossing rule',()=>{
 const basin=[{x:2,y:2},{x:6,y:2},{x:6,y:6},{x:2,y:6}];
 const fixtures:TerrainFeature[]=[{kind:'pond',id:'pond',seed:1,poly:basin},{kind:'lake',id:'lake',seed:1,poly:basin},...[.5,2].map(halfWidth=>({kind:'river' as const,id:'river',seed:1,halfWidth,path:[{x:2,y:0},{x:2,y:4},{x:6,y:4}]}))];
 for(const feature of fixtures){
  const [x,y]=feature.kind==='river'?[4,4]:[4,4];
  for(const season of SEASONS)expect(resolveTraversal(x,y,0,0,[feature],null,season).blocked).toBe(season!=='winter');
 }
});

it('overview forest masses preserve species and collision footprints',()=>{
 const grid=createSurfaceGrid(0,0,8,8,'grass');
 for(let y=2;y<6;y++)for(let x=2;x<6;x++)grid.surface[x+y*8]=SURFACE_ID['forest-core'];
 const before=[...grid.surface];
 const pine=planForestMasses(grid,BIOME_PROFILES['northern-conifer'],19);
 expect(pine.length).toBeGreaterThan(0);expect(pine.every(m=>m.species==='pine')).toBe(true);
 expect([...grid.surface]).toEqual(before);
});
