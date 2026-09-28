import { assertDebugControlsReachable } from './debug-reachability.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {privacyTestSetup} from './privacy-test-setup.mjs';
const base=process.env.ISSUES_TEST_URL||'http://127.0.0.1:5178';
const out=process.env.ISSUES_TEST_OUTPUT||'artifacts/open-issues';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[], errors=[];
try {
 for(const [width,height] of [[1536,960],[1024,768],[768,1024],[844,390],[390,844],[320,568],[1920,1080]].filter(([w])=>!process.env.ISSUES_WIDTH||w===Number(process.env.ISSUES_WIDTH))) {
  for(const touch of [false,true]) {
   const page=await browser.newPage({viewport:{width,height},hasTouch:touch,deviceScaleFactor:touch?2:1});
   await privacyTestSetup(page);page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/?sandbox=1&seed=19&debug=1'+(touch?'&controls=1':''));await page.waitForFunction(()=>window.__pd?.ready());
   await page.waitForTimeout(250);
   await page.evaluate(()=>document.querySelector("[data-debug=freeze]").click());
   const mode=await page.locator('#hud-root').getAttribute('data-hud-mode');
   await page.screenshot({path:`${out}/hud-${width}-${height}-${touch}.png`});
   const hud=await page.locator('.top').evaluate(el=>({w:el.clientWidth,sw:el.scrollWidth}));
   assert.ok(mode==='text'||hud.sw<=hud.w+2,JSON.stringify({width,height,touch,mode,hud}));
   await page.getByRole('button',{name:'Debug',exact:true}).filter({visible:true}).click();
   await page.waitForFunction(()=>document.querySelector('[data-assets]')?.options.length>100);
   const counts={};
   for(const name of ['Assets','Inspector','Session']) {
    await page.getByRole('tab',{name,exact:true}).click();await page.waitForTimeout(100);
    counts[name] = await assertDebugControlsReachable(page, '#debug-' + name.toLowerCase());
    assert.equal(await page.locator('#binder-next').count(), 0, 'Debug sections scroll without artificial sheets');
    if(touch) await page.screenshot({path:`${out}/binder-${width}-${height}-${name}.png`});
   }
   await page.keyboard.press('Escape');assert.equal(await page.locator('#debug-panel').isVisible(),false);
   results.push({width,height,touch,dpr:touch?2:1,mode,counts});console.log(results.at(-1));await page.close();
  }
 }
 assert.deepEqual(errors,[]);await writeFile(out+'/results.json',JSON.stringify({base,results,errors},null,2));
}finally{await browser.close();}
