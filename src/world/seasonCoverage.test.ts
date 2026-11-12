import {expect,it} from 'vitest';
import {CAMPAIGN_LEVELS,campaignLevelById} from '../game/campaign';
import {availableTownValue} from '../game/campaignValue';
import {createTown} from './town';
import {CLIMATES,legalConditions,type ClimateId} from './climate';
import {groundState} from './groundCondition';
import {rollWeatherCondition,weatherPresetFor} from './season';
import {weatherRisk} from '../game/weatherRisk';
import {coverColor,COVER_KINDS,groundTone} from '../render/coverPalette';
import {describeCell} from '../render/terrainTiles';
import {SeasonWeather} from '../fx/seasonWeather';
import {BIOME_PROFILES} from './biomes';
import {SEASONS,permittedFieldStates} from './season';
import {resolveTraversal,type TerrainFeature} from './terrainFeatures';
import {planForestMasses} from '../render/forestCanopy';
import {createSurfaceGrid,SURFACE_ID} from './terrain';
import {pumpVitestRpc} from '../sim/benchSupport';

it('every campaign target is attainable without crop income in every season',async()=>{
 for(const level of CAMPAIGN_LEVELS) for(const season of SEASONS){
  await pumpVitestRpc();
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
  for(const frozen of [false,true])expect(resolveTraversal(x,y,0,0,[feature],null,frozen).blocked).toBe(!frozen);
 }
});

it('overview forest masses preserve species and collision footprints',()=>{
 const grid=createSurfaceGrid(0,0,8,8,'grass');
 for(let y=2;y<6;y++)for(let x=2;x<6;x++)grid.surface[x+y*8]=SURFACE_ID['forest-core'];
 const before=[...grid.surface];
 const pine=planForestMasses(grid,BIOME_PROFILES['northern-conifer'],19);
 expect(pine.length).toBeGreaterThan(0);expect(pine.every(m=>m.species==='pine')).toBe(true);
 expect([...grid.surface]).toEqual(before);
 // Arid scrub has no woods: its thickets are dry brush in every season.
 const scrub=planForestMasses(grid,BIOME_PROFILES['arid-scrub'],19);
 expect(scrub.length).toBeGreaterThan(0);expect(scrub.every(m=>m.species==='scrub')).toBe(true);
});
it('an arid-scrub county generates in every season with only desert vegetation',async()=>{
 for(const season of ['spring','summer','autumn','winter'] as const){
  await pumpVitestRpc();
  const town=createTown({district:"d30",seed:19,campaign:campaignLevelById('village'),season,biome:BIOME_PROFILES['arid-scrub']});
  expect(town.biome?.id).toBe('arid-scrub');
  expect(town.diagnostic.ok,season).toBe(true);
  expect(town.props.filter(p=>/^(oak|pine)/.test(p.assetId)).map(p=>p.assetId)).toEqual([]);
 }
});

const WARM:readonly [ClimateId,keyof typeof BIOME_PROFILES][]=[['sonoran-desert','arid-scrub'],['mojave-desert','arid-scrub'],['gulf-subtropical','subtropical-coast'],['tropical','subtropical-coast']];
const COLD:readonly [ClimateId,keyof typeof BIOME_PROFILES][]=[['temperate','temperate-broadleaf'],['boreal','northern-conifer'],['alpine','northern-conifer'],['great-plains','agricultural-plain']];
// Colours only the snow palette paints: no clear-ground season of any cover shares them.
const CLEAR_COLORS=new Set(COVER_KINDS.flatMap(cover=>SEASONS.filter(season=>season!=='winter').map(season=>coverColor(cover,'clear',season))));
const SNOW_COLORS=new Set(COVER_KINDS.map(cover=>coverColor(cover,'snow')).filter(color=>!CLEAR_COLORS.has(color)));

it('warm-arid and subtropical counties never show snow or ice in winter, and still play their own hazards',async()=>{
 for(const [id,biome] of WARM){
  await pumpVitestRpc();
  const climate=CLIMATES[id];
  const town=createTown({district:'d30',seed:19,campaign:campaignLevelById('village'),season:'winter',biome:BIOME_PROFILES[biome],climate});
  expect(town.diagnostic.ok,id).toBe(true);
  expect(town,id).toMatchObject({season:'winter',groundCondition:'clear',frozen:false});
  expect(town.look).not.toBe('winter');
  // No snow tiles, no winter cover colours, no frozen water.
  const tone=groundTone(town);
  for(let iy=0;iy<town.surface.rows;iy+=3)for(let ix=0;ix<town.surface.cols;ix+=3){
   expect(describeCell(town.surface,ix,iy,town.groundCondition,town.look,tone.arid)?.base.startsWith('snow-')).toBe(false);
  }
  for(const patch of town.ground)if(patch.cover!=='water')expect(SNOW_COLORS.has(coverColor(patch.cover,town.groundCondition,town.look,tone)),`${id} ${patch.cover}`).toBe(false);
  expect(tone.frozen).toBe(false);
  // No flurries from the seeded sky, from any county roll, or from any forced sky.
  expect(town.weather.kind).not.toBe('flurries');
  const weather=new SeasonWeather();
  for(let i=0;i<120;i++)weather.step({dt:1/60,kind:town.weather.kind,detail:'on',camX:0,camY:0,seed:town.seed});
  expect(weather.flakes.every(flake=>flake.kind!=='flurries')).toBe(true);
  for(let seed=1;seed<=200;seed++){
   const condition=rollWeatherCondition('winter',seed,climate);
   expect(legalConditions(climate,'winter')).toContain(condition);
   const sky=weatherPresetFor('winter',condition,climate);
   expect(sky.kind).not.toBe('flurries');
   expect(sky.hazard).not.toBe('blizzard');
   expect(groundState('winter',condition,climate).footing).not.toBe('snow');
  }
  // Hazards backfill the year: something this zone rolls pays Hazard Pay.
  const hazards=new Set<string>();
  for(const season of SEASONS)for(let seed=1;seed<=400;seed++){
   const condition=rollWeatherCondition(season,seed,climate);
   const sky=weatherPresetFor(season,condition,climate);
   if(sky.hazard){hazards.add(sky.hazard);expect(weatherRisk(season,condition,climate).hazardPay,`${id} ${sky.hazard}`).toBeGreaterThan(0);}
  }
  expect([...hazards],id).not.toContain('blizzard');
  if(climate.landscape==='desert')expect([...hazards]).toEqual(expect.arrayContaining(['haboob','monsoon','heat']));
  else expect([...hazards]).toEqual(expect.arrayContaining(['squall','heat']));
 }
},240000);

it('water in a snowless winter town stops the dozer, and ice in a cold one carries it',async()=>{
 const drive=(id:ClimateId,biome:keyof typeof BIOME_PROFILES)=>{
  const town=createTown({district:'d30',seed:19,campaign:campaignLevelById('village'),season:'winter',biome:BIOME_PROFILES[biome],climate:CLIMATES[id]});
  const pond:TerrainFeature={kind:'pond',id:'tank',seed:1,poly:[0,1,2,3].map(i=>({x:town.spawnX+(i===1||i===2?3:1.2),y:town.spawnY+(i>1?1.5:-1.5)}))};
  town.features.push(pond);
  return resolveTraversal(town.spawnX+2,town.spawnY,town.spawnX,town.spawnY,town.features,null,town.frozen);
 };
 expect(drive('sonoran-desert','arid-scrub').blocked).toBe(true);
 expect(drive('gulf-subtropical','subtropical-coast').blocked).toBe(true);
 expect(drive('temperate','temperate-broadleaf').blocked).toBe(false);
},120000);

it('cold, temperate and alpine counties keep snowfall, snow cover and ice',async()=>{
 for(const [id,biome] of COLD){
  await pumpVitestRpc();
  const climate=CLIMATES[id];
  const town=createTown({district:'d30',seed:19,campaign:campaignLevelById('village'),season:'winter',biome:BIOME_PROFILES[biome],climate,weather:'precip'});
  expect(town,id).toMatchObject({season:'winter',look:'winter',groundCondition:'snow',frozen:true});
  expect(town.weather.kind).toBe('flurries');
  const tone=groundTone(town);
  expect(describeCell(town.surface,0,0,town.groundCondition,town.look,tone.arid)?.base.startsWith('snow-')||describeCell(town.surface,0,0,town.groundCondition,town.look,tone.arid)?.base.startsWith('water-')).toBe(true);
  expect(SNOW_COLORS.has(coverColor('grass',town.groundCondition,town.look,tone))).toBe(true);
  const rolls=new Set<string>();
  for(let seed=1;seed<=300;seed++)rolls.add(weatherPresetFor('winter',rollWeatherCondition('winter',seed,climate),climate).kind);
  expect(rolls.has('flurries'),id).toBe(true);
  expect(weatherPresetFor('winter','storm',climate).hazard).toBe('blizzard');
  expect(weatherRisk('winter','storm',climate)).toEqual({slip:0.15,track:0.12,heat:0,hazardPay:0.2});
 }
},240000);
