import {chromium} from 'playwright';import {mkdir,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {privacyTestSetup} from './privacy-test-setup.mjs';
const base=process.env.SEASONS_TEST_URL||'http://127.0.0.1:4173',out='artifacts/season-performance';await mkdir(out,{recursive:true});
const browser=await chromium.launch();const reports=[];
try{for(const touch of [false,true])for(const effects of ['off','on']){
 const page=await browser.newPage({viewport:touch?{width:844,height:390}:{width:1440,height:900},hasTouch:touch});await privacyTestSetup(page);
 await page.goto(`${base}/?sandbox=1&debug=1&level=city-downtown&seed=19&season=winter&effects=${effects}${touch?'&controls=1':''}`);await page.waitForFunction(()=>window.__pd?.ready());
 const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');
 const before=await cdp.send('Runtime.getHeapUsage');
 const frames=await page.evaluate(()=>new Promise(resolve=>{const times=[];let last=performance.now();function tick(now){times.push(now-last);last=now;if(times.length<180)requestAnimationFrame(tick);else resolve(times.slice(30).sort((a,b)=>a-b));}requestAnimationFrame(tick);}));
 const p95=frames[Math.floor(frames.length*.95)],median=frames[Math.floor(frames.length*.5)];
 for(let i=0;i<5;i++){await page.evaluate(()=>window.__pd.reset('same'));await page.waitForTimeout(100);}
 await cdp.send('HeapProfiler.collectGarbage');const after=await cdp.send('Runtime.getHeapUsage');
 assert.ok(after.usedSize<before.usedSize*1.5+16*1024*1024,'Repeated resets retain excessive heap');
 reports.push({touch,effects,viewport:page.viewportSize(),frames:frames.length,medianMs:median,p95Ms:p95,heapBefore:before.usedSize,heapAfterFiveResets:after.usedSize});console.log(reports.at(-1));await page.close();
}await writeFile(out+'/report.json',JSON.stringify({base,note:'Headless Chromium on this machine; effects Off is the baseline. Frame time includes browser scheduling, not just render submission.',reports},null,2));}finally{await browser.close();}
