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
    await page.goto(base+'/?yard=1'+(mobile?'&controls=1':''));await page.waitForFunction(()=>window.__pd);
    await page.locator('#debug-panel').waitFor({state:'visible'});
    await page.getByRole('tab',{name:'Assets',exact:true}).click();
    await page.locator('[data-category]').selectOption('vehicle');
    assert.equal(await page.locator('[data-assets] option').count(),12);
    await page.locator('[data-assets]').selectOption('vehicle:tractor');
    await page.locator('[data-run]').click();
    assert.equal(await page.evaluate(()=>window.__pd.town.yard.bays.find(b=>b.vehicle?.definitionId==='tractor').vehicle.autonomous),true);
    await page.locator('[data-stop]').click();await page.locator('[data-regions]').click();await page.locator('[data-side]').click();
    assert.ok(await page.evaluate(()=>window.__pd.town.yard.bays.find(b=>b.vehicle?.definitionId==='tractor').vehicle.parts.some(p=>p.damage>0)));
    await page.locator('[data-overhead]').click();assert.equal(await page.evaluate(()=>window.__pd.town.yard.loads.length),1);
    await page.locator('[data-restore]').click();assert.equal(await page.evaluate(()=>window.__pd.town.yard.bays.find(b=>b.vehicle?.definitionId==='tractor').vehicle.status),'operational');
    await page.locator('[data-fleet]').click();assert.equal(await page.evaluate(()=>window.__pd.town.yard.bays.filter(b=>b.vehicle?.autonomous).length),12);
    await page.locator('[data-follow]').click();assert.equal(await page.evaluate(()=>window.__pd.followRoadCamera),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`${output}/${name}-controls.png`});report.layouts.push({name,width,height,vehicles:12,controls:'pass'});
    if(name==='desktop' && !process.argv.includes('--controls-only')){
      report.performance=await page.evaluate(async()=>{
        const {createVehicle,stepDetached}=await import('/src/vehicle/runtime.ts');
        const {VEHICLES}=await import('/src/vehicle/definitions.ts');
        const {stepVehicleWorld,vehicleStats}=await import('/src/vehicle/world.ts');
        const {testVehicleImpact,yardVehicleRoute}=await import('/src/world/testYard.ts');
        const g=window.__pd;g.mode='pause';const t=g.town;t.yard=undefined;t.buildings=[];t.props=[];t.vehicles=[];t.roadCar=null;t.ground=[];t.roads=[];t.rubble=[];t.maxX=160;t.maxY=160;t.siteRevision++;
        for(let i=0;i<132;i++){const v=createVehicle(VEHICLES[i%12].id,10+(i%12)*10,10+Math.floor(i/12)*12);if(i<120){for(let n=0;n<5;n++)testVehicleImpact(v,'overhead',40);stepDetached(v,.02,{remaining:0},()=>0);v.sleeping=true;}else yardVehicleRoute(v);t.vehicles.push(v);}
        const sim=[],render=[];g.renderer.camX=0;g.renderer.camY=400;g.renderer.zoom=.4;
        for(let i=0;i<180;i++){let start=performance.now();stepVehicleWorld(t,g.dozer,g.particles,[],1/60);if(i>30)sim.push(performance.now()-start);start=performance.now();g.renderer.draw(t,g.dozer,g.particles,[],1/60);g.app.render();if(i>30)render.push(performance.now()-start);}
        const p95=a=>a.sort((a,b)=>a-b)[Math.floor(a.length*.95)];return{vehicles:t.vehicles.length,simP95Ms:p95(sim),renderSubmitP95Ms:p95(render),stats:{...vehicleStats},renderStats:{...g.renderer.stats}};
      });
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
