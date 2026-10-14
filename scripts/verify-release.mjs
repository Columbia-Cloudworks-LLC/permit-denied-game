import {spawn} from 'node:child_process';
const origin=process.env.RELEASE_TEST_URL||'http://127.0.0.1:4179';
const suites={
 'layout':['scripts/verify-open-issues.mjs','ISSUES_TEST_URL'],
 'binder':['scripts/verify-debug-binder.mjs','DEBUG_TEST_URL'],
 'menus':['scripts/verify-menu-usability.mjs','DEBUG_TEST_URL'],
 'coverage':['scripts/verify-binder-coverage.mjs','DEBUG_TEST_URL'],
 'seasons':['scripts/verify-seasons.mjs','SEASONS_TEST_URL'],
 'ice':['scripts/verify-ice.mjs','SEASONS_TEST_URL'],
 'performance':['scripts/verify-season-performance.mjs','SEASONS_TEST_URL'],
};
// Both accept comma lists so one CI runner shares one preview across several suites or widths.
const list=value=>(value||'').split(',').map(item=>item.trim()).filter(Boolean);
const selected=list(process.env.RELEASE_TEST_SUITE);
for(const name of selected)if(name!=='hud'&&!suites[name])throw new Error(`Unknown release suite: ${name}`);
const order=selected.length?selected:Object.keys(suites);
const widths=list(process.env.ISSUES_WIDTH);
let server;
const run=(file,env={})=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[file],{stdio:'inherit',windowsHide:true,env:{...process.env,...env}});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${file} exited ${code}`)));
});
/** Several widths run two at a time, each writing its evidence to its own folder. */
async function layout(file,env){
 if(widths.length<2)return run(file,env);
 const out=process.env.ISSUES_TEST_OUTPUT||'artifacts/open-issues',queue=[...widths];
 const lanes=await Promise.allSettled([0,1].map(async()=>{
  for(let width;(width=queue.shift());)await run(file,{...env,ISSUES_WIDTH:width,ISSUES_TEST_OUTPUT:`${out}/${width}`});
 }));
 const failed=lanes.find(lane=>lane.status==='rejected');
 if(failed)throw failed.reason;
}
try{
 if(!process.env.RELEASE_TEST_URL&&order.some(name=>name!=='hud')){
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4179','--strictPort'],{stdio:'pipe',windowsHide:true});
  for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{}if(i===99)throw new Error('Preview did not start');await new Promise(r=>setTimeout(r,100));}
 }
 for(const name of order){
  if(name==='hud'){console.log('Release verification: hud');await run('scripts/verify-hud-instruments.mjs');continue;}
  const [file,urlVariable]=suites[name];
  console.log(`Release verification: ${name} on ${origin}`);
  if(name==='layout')await layout(file,{[urlVariable]:origin});
  else await run(file,{[urlVariable]:origin});
 }
}finally{server?.kill();}
