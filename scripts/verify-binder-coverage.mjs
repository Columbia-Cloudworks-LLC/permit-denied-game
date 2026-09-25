import {chromium} from 'playwright';import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import {privacyTestSetup} from './privacy-test-setup.mjs';
const base=process.env.DEBUG_TEST_URL||'http://127.0.0.1:5178',out='artifacts/binder-coverage';await mkdir(out,{recursive:true});const browser=await chromium.launch();
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000}});await privacyTestSetup(p);await p.goto(base+'/?yard=1&debug=1');await p.waitForFunction(()=>window.__pd?.ready());await p.waitForFunction(()=>document.querySelector('[data-assets]')?.options.length>100);
 if(!await p.locator('#debug-panel').isVisible())await p.getByRole('button',{name:'Debug',exact:true}).filter({visible:true}).click();
 await p.locator('[data-assets]').selectOption('vehicle:bus');
 await p.locator('[data-section]').evaluateAll(es=>es.forEach(e=>e.open=true));
 for(const viewport of [{width:1440,height:1000},{width:320,height:568}]){
  await p.setViewportSize(viewport);await p.waitForTimeout(200);await p.getByRole('tab',{name:'Assets',exact:true}).click();await p.waitForTimeout(100);
  const total=Number(await p.locator('#debug-panel').getAttribute('data-sheets'));
  const expected=await p.locator('#debug-assets').evaluate(panel=>[...panel.querySelectorAll('button,input,select,summary')].filter(e=>!e.closest('[hidden]')&&!e.matches('.yard-panel>summary')).map((el,i)=>{el.dataset.coverageId=String(i);return i;}));
  const seen=[];
  for(let sheet=1;sheet<=total;sheet++){
   const intercepted=await p.locator('#debug-assets input, #debug-assets select').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().height>0).flatMap(e=>['PageUp','PageDown'].filter(key=>!e.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})))));
   assert.deepEqual(intercepted,[],'Page keys retain native behavior inside form controls');
   assert.equal(Number(await p.locator('#debug-panel').getAttribute('data-sheet')),sheet);
   const visible=await p.locator('[data-coverage-id]').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().height>0).map(e=>({id:Number(e.dataset.coverageId),rect:e.getBoundingClientRect().toJSON(),bottom:document.querySelector('.debug-pages').getBoundingClientRect().bottom})));
   for(const e of visible){assert.ok(e.rect.bottom<=e.bottom+2,JSON.stringify({viewport,sheet,e}));seen.push(e.id);}
   await p.screenshot({path:`${out}/expanded-${viewport.width}-${sheet}.png`});
   if(sheet<total)await p.getByRole('button',{name:'Next sheet',exact:true}).click();
  }
  assert.deepEqual([...seen].sort((a,b)=>a-b),expected);
  await p.getByRole('tab',{name:'Inspector',exact:true}).focus();await p.keyboard.press('Enter');await p.keyboard.press('PageDown');await p.waitForTimeout(50);assert.equal(await p.locator('#debug-panel').getAttribute('data-sheet'),'2');await p.keyboard.press('PageUp');assert.equal(await p.locator('#debug-panel').getAttribute('data-sheet'),'1');
 }
 await writeFile(out+'/result.json',JSON.stringify({base,passed:true}));console.log('Expanded asset controls occur exactly once; keyboard page boundaries passed.');
}finally{await browser.close();}
