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
    const panel=page.locator('#debug-panel');const n=Number(await panel.getAttribute('data-sheets')); counts[name]=n;
    const seen=new Set();
    const expected=await panel.locator('[role=tabpanel]:not([hidden])').evaluate(el=>[...el.querySelectorAll('button,input,select,summary')].filter(e=>!e.closest('[hidden]')&&!e.matches('.yard-panel > summary')&&![...function*(p){for(;p&&p!==el;p=p.parentElement)yield p;}(e.parentElement)].some(p=>p.tagName==='DETAILS'&&!p.open&&e.tagName!=='SUMMARY')).length);
    for(let i=1;i<=n;i++) {
     const state=await panel.evaluate(p=>{
      const area=p.querySelector('.debug-pages').getBoundingClientRect();
      const controls=[...p.querySelectorAll('[role=tabpanel]:not([hidden]) button,[role=tabpanel]:not([hidden]) input,[role=tabpanel]:not([hidden]) select,[role=tabpanel]:not([hidden]) summary')].filter(e=>e.getBoundingClientRect().height>0);
      return {sheet:p.dataset.sheet,area:area.toJSON(),controls:controls.map(e=>({key:e.id||e.getAttribute('aria-label')||e.outerHTML.split('>')[0],r:e.getBoundingClientRect().toJSON()}))};
     });
     assert.equal(Number(state.sheet),i);
     for(const c of state.controls){assert.ok(!seen.has(c.key),'duplicate '+c.key);seen.add(c.key);assert.ok(c.r.top>=state.area.top-2&&c.r.bottom<=state.area.bottom+2,JSON.stringify({width,height,touch,name,i,c,area:state.area}));}
     if(touch) await page.screenshot({path:`${out}/binder-${width}-${height}-${name}-${i}.png`});
     if(i<n)await page.getByRole('button',{name:'Next sheet',exact:true}).click();
    }
    assert.equal(seen.size,expected,`${name}: every available control belongs to exactly one sheet`);
    assert.equal(await page.getByRole('button',{name:'Next sheet',exact:true}).isDisabled(),true);
    await page.getByRole('tab',{name:name==='Session'?'Assets':'Session',exact:true}).click();
    await page.getByRole('tab',{name,exact:true}).click();await page.waitForTimeout(50);
    assert.equal(await panel.getAttribute('data-sheet'),'1');
   }
   await page.keyboard.press('Escape');assert.equal(await page.locator('#debug-panel').isVisible(),false);
   results.push({width,height,touch,dpr:touch?2:1,mode,counts});console.log(results.at(-1));await page.close();
  }
 }
 assert.deepEqual(errors,[]);await writeFile(out+'/results.json',JSON.stringify({base,results,errors},null,2));
}finally{await browser.close();}
