import { assertDebugControlsReachable } from './debug-reachability.mjs';
import {chromium} from 'playwright';import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import {privacyTestSetup} from './privacy-test-setup.mjs';
const base=process.env.DEBUG_TEST_URL||'http://127.0.0.1:5178',out='artifacts/binder-coverage';await mkdir(out,{recursive:true});const browser=await chromium.launch();
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000}});await privacyTestSetup(p);await p.goto(base+'/?yard=1&debug=1');await p.waitForFunction(()=>window.__pd?.ready());await p.waitForFunction(()=>document.querySelector('[data-assets]')?.options.length>100);
 if(!await p.locator('#debug-panel').isVisible())await p.getByRole('button',{name:'Debug',exact:true}).filter({visible:true}).click();
 await p.locator('[data-assets]').selectOption('vehicle:bus');
 await p.locator('[data-section]').evaluateAll(es=>es.forEach(e=>e.open=true));
 for(const viewport of [{width:1440,height:1000},{width:320,height:568}]){
  await p.setViewportSize(viewport);await p.waitForTimeout(200);await p.getByRole('tab',{name:'Assets',exact:true}).click();await p.waitForTimeout(100);
  await assertDebugControlsReachable(p, '#debug-assets');
  const intercepted=await p.locator('#debug-assets input, #debug-assets select').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().height>0).flatMap(e=>['PageUp','PageDown'].filter(key=>!e.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})))));
  assert.deepEqual(intercepted,[],'Page keys retain native behavior inside form controls');
  await p.screenshot({path:`${out}/expanded-${viewport.width}.png`});
  await p.getByRole('tab',{name:'Inspector',exact:true}).click();await p.waitForTimeout(100);
  const floorKeys=await p.locator('#debug-inspector select').evaluate(el=>['PageUp','PageDown'].map(key=>el.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}))));
  assert.deepEqual(floorKeys,[true,true],'Inspector dropdown retains native Page keys');
  await assertDebugControlsReachable(p, '#debug-inspector');
 }
 await writeFile(out+'/result.json',JSON.stringify({base,passed:true}));console.log('Expanded asset and inspector controls are reachable by scrolling; native form keys passed.');
}finally{await browser.close();}
