import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const base=process.env.HUD_TEST_URL||'http://127.0.0.1:5181';
let server;
const browser=await chromium.launch({headless:true});
const out='artifacts/hud-instruments';await mkdir(out,{recursive:true});
const reports=[];
try {
if(!process.env.HUD_TEST_URL){
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5181','--strictPort'],{stdio:'pipe',windowsHide:true});
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}if(i===99)throw new Error('HUD fixture server did not start');await new Promise(r=>setTimeout(r,100));}
}
for(const touch of [false,true]) {
 const page=await browser.newPage({viewport:{width:1024,height:768},hasTouch:touch,recordVideo:{dir:out,size:{width:1024,height:768}}});
 await page.route('**/__hud-fixture',r=>r.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/style.css"><div id="game-root"><canvas></canvas></div><div id="hud-root"></div>'}));
 await page.goto(base+'/__hud-fixture');
 await page.evaluate(async touch=>{
  const {Hud}=await import('/src/render/hud.ts');
  if(touch)document.documentElement.classList.add('touch-ui');
  const hud=new Hud(document.querySelector('#hud-root'));
  const state={hasYard:false,upgradeModifiers:{bladeMul:1,engineMul:1,pushMul:1},cash:999,timeLeft:120,elapsed:59,session:'sandbox',district:'d10',bladeDown:false,muted:true,heat:50,track:25,overlay:'none',death:null,won:false,resubmitted:false};
  window.fixture={hud,state,input:null};
  if(touch){const {TouchControls}=await import('/src/render/touchControls.ts');window.fixture.touch=new TouchControls(hud.root,{change:v=>window.fixture.input=v,release:()=>{},interact:()=>{},resize:()=>{}});}
  hud.render(state);
 },touch);
 for(const values of [[999,59],[1000,60],[123456789,359999],[Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER]]) {
  await page.evaluate(([cash,elapsed])=>{Object.assign(window.fixture.state,{cash,elapsed});window.fixture.hud.render(window.fixture.state);},values);
  for(const width of [1536,1024,768,600,500,430,390,360,320,280,240]) {
   await page.setViewportSize({width,height:768});await page.waitForTimeout(80);
   const report=await page.evaluate(()=>({width:innerWidth,mode:document.querySelector('#hud-root').dataset.hudMode,cash:document.querySelector('#hud-cash').getAttribute('aria-label'),time:document.querySelector('#hud-time').getAttribute('aria-label'),overflow:document.documentElement.scrollWidth>innerWidth,visible:[...document.querySelectorAll('.top .stat,.top .hud-actions,.mobile-readouts strong')].filter(e=>e.getBoundingClientRect().height>0).map(e=>({id:e.id||e.className,r:e.getBoundingClientRect().toJSON()}))}));
   assert.equal(report.overflow,false,JSON.stringify(report));
   assert.equal(await page.locator('.mobile-hud').isVisible(),touch||report.mode!=='full','Auxiliary meters are visible only for touch or constrained layouts');
   for(const v of report.visible) assert.ok(v.r.left>=0&&v.r.right<=width+1,JSON.stringify(report));
   reports.push({...report,touch,values});
   if(touch&&values[0]===1000)await page.screenshot({path:`${out}/${width}-${report.mode}.png`});
  }
 }
 await page.evaluate(()=>{Object.assign(window.fixture.state,{cash:1000,elapsed:60});window.fixture.hud.render(window.fixture.state);});
 for(const target of ['compact','full']) {
  let low=200,high=1100;
  const rank={text:0,compact:1,full:2};
  while(low<high){const mid=Math.floor((low+high)/2);await page.setViewportSize({width:mid,height:768});await page.waitForTimeout(30);const mode=await page.locator('#hud-root').getAttribute('data-hud-mode');if(rank[mode]>=rank[target])high=mid;else low=mid+1;}
  for(const width of [low-1,low]){await page.setViewportSize({width,height:768});await page.waitForTimeout(50);const mode=await page.locator('#hud-root').getAttribute('data-hud-mode');reports.push({boundary:target,width,mode,touch});await page.screenshot({path:`${out}/boundary-${target}-${width}-${touch}.png`});}
 }
 if(touch){
  const client=await page.context().newCDPSession(page);
  for(const width of [1024,390,240]){
   await page.setViewportSize({width,height:768});await page.waitForTimeout(80);
   const stick=await page.locator('.touch-stick').boundingBox(),blade=await page.locator('.touch-blade').boundingBox();
   await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:stick.x+stick.width/2,y:stick.y+10,id:1},{x:blade.x+40,y:blade.y+40,id:2}]});
   assert.ok(await page.evaluate(()=>window.fixture.input.throttle>0&&window.fixture.input.blade));
   await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   assert.ok(await page.evaluate(()=>window.fixture.input.throttle===0&&!window.fixture.input.blade));
   assert.deepEqual(await page.evaluate(()=>[window.fixture.state.cash,window.fixture.state.elapsed]),[1000,60]);
  }
 }
 await page.evaluate(()=>{
  const f=window.fixture;
  f.state.session='campaign';f.state.campaign={levelIndex:7,levelName:'Governor estate',landmarkName:'Governor mansion and grounds',dollarTarget:20000,levelEarned:1000,campaignEarned:12000,landmarkProgress:.37,landmarkReady:false,dollarsReady:false,briefing:'',victory:false,complete:false};
  f.hud.render(f.state);
 });
 for(const width of [1536,768,430,390,320,240]){
  await page.setViewportSize({width,height:768});await page.waitForTimeout(80);
  const campaign=await page.evaluate(()=>{
   const mode=document.querySelector('#hud-root').dataset.hudMode;
   const el=document.querySelector(mode==='full'?'#hud-landmark':'#mobile-job');
   return {mode,text:el.textContent,rect:el.getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.ok(campaign.text.includes('37%')&&campaign.rect.height>0&&campaign.rect.left>=0&&campaign.rect.right<=width&&!campaign.overflow,JSON.stringify(campaign));
  reports.push({touch,width,campaign,mode:campaign.mode});await page.screenshot({path:`${out}/campaign-${width}-${touch}.png`});
 }
 await page.close();
}
assert.deepEqual(reports.filter(r=>!r.touch).map(r=>r.mode),reports.filter(r=>r.touch).map(r=>r.mode));
await writeFile(out+'/measurements.json',JSON.stringify(reports,null,2));console.log('HUD measurements passed',reports.length);
}finally{await browser.close();server?.kill();}
