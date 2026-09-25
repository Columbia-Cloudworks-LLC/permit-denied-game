import {chromium} from 'playwright';import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import {privacyTestSetup} from './privacy-test-setup.mjs';
const base=process.env.SEASONS_TEST_URL||'http://127.0.0.1:4173',out='artifacts/ice';await mkdir(out,{recursive:true});
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1024,height:768}});await privacyTestSetup(p);const reports=[];
try{for(const season of ['summer','winter']){
 await p.goto(`${base}/?sandbox=1&debug=1&seed=19&level=county&biome=temperate-broadleaf&season=${season}`);await p.waitForFunction(()=>window.__pd?.ready());
 await p.evaluate(()=>document.querySelector('[data-debug=freeze]').click());
 const features=await p.evaluate(()=>window.__pd.townSnapshot().features.filter(f=>['pond','lake','river'].includes(f.kind)));
 assert.ok(features.length>0);
 for(const f of features){
  const point=f.poly?{x:f.poly.reduce((s,v)=>s+v.x,0)/f.poly.length,y:f.poly.reduce((s,v)=>s+v.y,0)/f.poly.length}:{x:(f.path[0].x+f.path[1].x)/2,y:(f.path[0].y+f.path[1].y)/2};
  const pose=await p.evaluate(point=>{window.__pd.lookAtWorld(point.x,point.y,0,1);window.__pd.setDozerPose({vx:1});for(let i=0;i<30;i++)window.__pd.step(1/60);return window.__pd.dozerSnapshot();},point);
  const displacement=Math.hypot(pose.x-point.x,pose.y-point.y);
  reports.push({season,kind:f.kind,point,pose,displacement});
  if(season==='winter')assert.ok(displacement<1,JSON.stringify(reports.at(-1)));
  await p.screenshot({path:`${out}/${season}-${f.kind}-${reports.length}.png`});
 }
}
for(const warm of reports.filter(r=>r.season==='summer')){const cold=reports.find(r=>r.season==='winter'&&r.kind===warm.kind&&r.point.x===warm.point.x);assert.ok(warm.displacement>cold.displacement+0.2,JSON.stringify({warm,cold}));}
await writeFile(out+'/report.json',JSON.stringify({base,reports},null,2));console.log('Live liquid-water rejection and winter ice support verified',reports.length);
}finally{await b.close();}
