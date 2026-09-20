import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';

const base=process.env.VEHICLE_TEST_URL||'http://127.0.0.1:5178';
const output=process.argv.includes('--controls-only')?'artifacts/debug-binder/vehicle-controls':'artifacts/vehicle-verification';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-precise-memory-info']});
const report={hardware:{cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,ramGB:Math.round(os.totalmem()/2**30),platform:os.platform(),browser:browser.version()},errors:[],layouts:[],performance:null,heap:[]};
try{
  for(const [name,width,height,mobile] of [['desktop',1440,1000,false],['portrait',390,844,true],['landscape',844,390,true]]){
    const page=await browser.newPage({viewport:{width,height},isMobile:mobile,hasTouch:mobile});page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto(base+'/?yard=1'+(mobile?'&controls=1':''));await page.waitForFunction(()=>window.__pd?.version===1);
    await page.locator('#debug-panel').waitFor({state:'visible'});
    await page.getByRole('tab',{name:'Assets',exact:true}).click();
    await page.locator('[data-category]').selectOption('vehicle');
    assert.equal(await page.locator('[data-assets] option').count(),12);
    await page.locator('[data-assets]').selectOption('vehicle:tractor');
    await page.locator('[data-run]').click();
    assert.equal(await page.evaluate(()=>window.__pd.yardInspect().vehicles.find(v=>v.definitionId==='tractor')?.autonomous),true);
    await page.locator('[data-stop]').click();await page.locator('[data-regions]').click();await page.locator('[data-side]').click();
    assert.ok(await page.evaluate(()=>window.__pd.yardInspect().vehicles.find(v=>v.definitionId==='tractor')?.damaged));
    await page.locator('[data-overhead]').click();assert.equal(await page.evaluate(()=>window.__pd.yardInspect().loads),1);
    await page.locator('[data-restore]').click();assert.equal(await page.evaluate(()=>window.__pd.yardInspect().vehicles.find(v=>v.definitionId==='tractor')?.status),'operational');
    await page.locator('[data-fleet]').click();assert.equal(await page.evaluate(()=>window.__pd.yardInspect().autonomousCount),12);
    await page.locator('[data-follow]').click();assert.equal(await page.evaluate(()=>window.__pd.yardInspect().followRoadCamera),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`${output}/${name}-controls.png`});report.layouts.push({name,width,height,vehicles:12,controls:'pass'});
    if(name==='desktop' && !process.argv.includes('--controls-only')){
      report.performance=await page.evaluate(()=>window.__pd.runVehiclePerfHarness());
      assert.equal(report.performance.vehicles,132);assert.ok(report.performance.stats.detached<=72);
    }
    await page.close();
  }
  const page=await browser.newPage();await page.goto(base+'/?capture=1');await page.waitForFunction(()=>window.__assetCapture);
  const session=await page.context().newCDPSession(page);
  for(let batch=0;batch<4;batch++){
    await page.evaluate(()=>{for(let i=0;i<24;i++){const a=window.__assetCapture;a.load('vehicle:tractor-trailer',i%2);a.vehicleScenario('overhead',50);a.advance(30);a.render();}window.__assetCapture.load('vehicle:tractor-trailer');});
    await session.send('HeapProfiler.collectGarbage');report.heap.push((await session.send('Runtime.getHeapUsage')).usedSize);
  }
  assert.ok(report.heap.at(-1)-report.heap[1]<15*2**20,'Restoration retained more than 15 MB after warmup');
  await page.close();assert.deepEqual(report.errors,[]);
}finally{await writeFile(output+'/report.json',JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report,null,2));
