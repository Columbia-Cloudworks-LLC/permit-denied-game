import {spawn} from 'node:child_process';
const origin=process.env.RELEASE_TEST_URL||'http://127.0.0.1:4179';
const suites={
 'layout':['scripts/verify-open-issues.mjs','ISSUES_TEST_URL'],
 'binder':['scripts/verify-debug-binder.mjs','DEBUG_TEST_URL'],
 'coverage':['scripts/verify-binder-coverage.mjs','DEBUG_TEST_URL'],
 'seasons':['scripts/verify-seasons.mjs','SEASONS_TEST_URL'],
 'ice':['scripts/verify-ice.mjs','SEASONS_TEST_URL'],
 'performance':['scripts/verify-season-performance.mjs','SEASONS_TEST_URL'],
};
const selected=process.env.RELEASE_TEST_SUITE;
if(selected&&selected!=='hud'&&!suites[selected])throw new Error(`Unknown release suite: ${selected}`);
let server;
const run=(file,env={})=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[file],{stdio:'inherit',windowsHide:true,env:{...process.env,...env}});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${file} exited ${code}`)));
});
try{
 if(selected==='hud'){
  await run('scripts/verify-hud-instruments.mjs');
 }else{
 if(!process.env.RELEASE_TEST_URL){
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4179','--strictPort'],{stdio:'pipe',windowsHide:true});
  for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{}if(i===99)throw new Error('Preview did not start');await new Promise(r=>setTimeout(r,100));}
 }
 for(const [name,[file,urlVariable]] of Object.entries(suites)){
  if(selected&&selected!==name)continue;
  console.log(`Release verification: ${name} on ${origin}`);
  await run(file,{[urlVariable]:origin});
 }
 }
}finally{server?.kill();}
