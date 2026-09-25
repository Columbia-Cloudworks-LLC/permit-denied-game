import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {privacyTestSetup} from './privacy-test-setup.mjs';
const base=process.env.SEASONS_TEST_URL||'http://127.0.0.1:4173';
const out='artifacts/seasons';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const errors=[],reports=[];
const page=await browser.newPage({viewport:{width:1024,height:768},recordVideo:{dir:out,size:{width:1024,height:768}}});
await privacyTestSetup(page);page.on('pageerror',e=>errors.push(e.message));
const seasons=['spring','summer','autumn','winter'];
const stages={spring:['tilled','short'],summer:['short','mature'],autumn:['mature','stubble'],winter:['tilled','stubble']};
try {
 for(const biome of ['agricultural-plain','northern-conifer','temperate-broadleaf','mixed-woodland']) {
  let geography;
  for(const season of seasons){
   await page.goto(`${base}/?sandbox=1&seed=19&level=county&biome=${biome}&season=${season}&debug=1`);await page.waitForFunction(()=>window.__pd?.ready());
   await page.evaluate(()=>document.querySelector('[data-debug=freeze]').click());
   const town=await page.evaluate(()=>window.__pd.townSnapshot());assert.equal(town.season,season);
   assert.equal(town.groundCondition,season==='winter'?'snow':'clear');
   const fields=town.features.filter(f=>f.kind==='field');for(const field of fields)assert.ok(stages[season].includes(field.state));
   const signature=JSON.stringify({lots:town.lots,features:town.features.map(({state,...f})=>f)});
   if(geography)assert.equal(signature,geography);else geography=signature;
   await page.evaluate(()=>window.__pd.lookAtTown('overview'));await page.screenshot({path:`${out}/${biome}-${season}-overview.png`});
   const field=fields[0];if(field){await page.evaluate(f=>window.__pd.lookAtWorld(f.x+f.w/2,f.y+f.d/2,0,1),field);await page.screenshot({path:`${out}/${biome}-${season}-field.png`});}
   const forest=town.features.find(f=>f.kind==='forest');if(forest){await page.evaluate(f=>window.__pd.lookAtWorld(f.cx,f.cy,0,1.2),forest);await page.screenshot({path:`${out}/${biome}-${season}-forest.png`});}
   await page.evaluate(()=>window.__pd.reset('same'));const retried=await page.evaluate(()=>window.__pd.townSnapshot());assert.equal(retried.season,season);assert.deepEqual(retried.features,town.features);
   reports.push({biome:town.biomeId,season,fields:fields.map(f=>({crop:f.crop,state:f.state})),lots:town.lots.length,weather:town.weather});console.log(biome,season,'verified');
  }
 }
 // Production input drives a fixed ranch benchmark through its wall. This also
 // exercises real cash rollover, destruction, tracks, clock and restart state.
 for(const season of seasons){
  await page.goto(`${base}/?sandbox=1&ranch=1&season=${season}&debug=1`);await page.waitForFunction(()=>window.__pd?.ready());
  await page.locator('#game-root canvas').focus();await page.keyboard.down('w');await page.keyboard.down('Space');
  await page.waitForTimeout(4500);await page.keyboard.up('Space');await page.keyboard.up('w');
  const after=await page.evaluate(()=>window.__pd.snapshot());assert.ok(after.elapsed>0);assert.ok(after.marks<=1200);
  await page.screenshot({path:`${out}/drive-${season}.png`});
  reports.push({drive:season,cash:after.cash,marks:after.marks,rubble:after.rubble});
 }
 assert.deepEqual(errors,[]);await writeFile(out+'/report.json',JSON.stringify({base,reports,errors},null,2));
}finally{await browser.close();}
