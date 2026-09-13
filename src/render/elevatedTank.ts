import type { Graphics } from 'pixi.js';
import { FLOOR_Z } from '../game/constants';
import type { DebugView } from '../debug/view';
import { cellPresent, cellWorldBox, type Building } from '../structure/types';
import { tankLegs, tankPose } from '../structure/elevatedTank';
import { depthKey } from '../world/iso';
import { drawIsoBox, drawWorldPoly, shade } from './drawIso';
import { drawFallingCell } from './facadeDraw';

type Point = { x:number;y:number;z:number };
export function elevatedTankCommands(b:Building, view:DebugView) {
  const commands:{depth:number;run:(g:Graphics)=>void}[]=[];
  const s=b.elevatedTank!, pose=tankPose(b), cs=b.cellSize;
  const add=(points:Point[],color:number)=>commands.push({depth:Math.max(...points.map(p=>depthKey(p.x,p.y,p.z))),run:g=>drawWorldPoly(g,points,color)});
  const beam=(a:Point,c:Point,color:number)=> {
    add([{...a,x:a.x-.045},{...c,x:c.x-.045},{...c,x:c.x+.045},{...a,x:a.x+.045}],color);
    add([{...a,y:a.y-.045},{...c,y:c.y-.045},{...c,y:c.y+.045},{...a,y:a.y+.045}],shade(color,.75));
  };
  if(view.walls)for(const c of b.cells) {
    if(c.floor>view.maxFloor || c.state==='gone')continue;
    const box=cellWorldBox(b,c);
    commands.push({depth:depthKey(box.x+box.w/2,box.y+box.d/2,c.floor*FLOOR_Z),run:g=>{
      if(c.state==='falling')drawFallingCell(g,b,c,1);
      else drawIsoBox(g,box.x,box.y,box.w,box.d,c.floor*FLOOR_Z,FLOOR_Z,0xa9b5ac,0x52665a,0x7f9385);
    }});
  }
  const legs=tankLegs(b), faces=[[0,1],[0,2],[1,3],[2,3]];
  if(view.details)for(let floor=0;floor<b.floors && floor<=view.maxFloor;floor++)for(const [a,c] of faces) {
    const left=legs[a!]!,right=legs[c!]!;
    if(!cellPresent(b.grid[floor]![left.gx]![left.gy]!) || !cellPresent(b.grid[floor]![right.gx]![right.gy]!))continue;
    const point=(p:typeof left,z:number)=>({x:b.x+(p.gx+.5)*cs,y:b.y+(p.gy+.5)*cs,z});
    beam(point(left,floor*FLOOR_Z+.15),point(right,(floor+1)*FLOOR_Z-.15),0x779084);
    beam(point(right,floor*FLOOR_Z+.15),point(left,(floor+1)*FLOOR_Z-.15),0x779084);
    beam(point(left,(floor+1)*FLOOR_Z-.08),point(right,(floor+1)*FLOOR_Z-.08),0xa5b5aa);
  }
  if(s.phase==='gone' || view.maxFloor<b.floors-1)return commands;
  const frameDepth=Math.max(0,...commands.map(c=>c.depth)),tankStart=commands.length;
  const cos=Math.cos(pose.tilt),sin=Math.sin(pose.tilt);
  const point=(x:number,y:number,z:number):Point=>({x:pose.x+x+z*s.dx*sin,y:pose.y+y+z*s.dy*sin,
    z:Math.max(.12,pose.z+z*cos-(x*s.dx+y*s.dy)*sin)});
  const n=20, ring=(i:number,z:number,r=pose.radius)=>point(Math.cos(i/n*Math.PI*2)*r,Math.sin(i/n*Math.PI*2)*r,z);
  for(let i=0;i<n;i++) {
    const color=shade(0xa1b9ae,.68+.28*(Math.cos(i/n*Math.PI*2-.8)+1)/2);
    if(view.walls) {
      add([ring(i,0),ring(i+1,0),ring(i+1,pose.height),ring(i,pose.height)],color);
      add([ring(i,-.1),ring(i+1,-.1),point(0,0,-.38)],shade(color,.7));
      for(const z of [.12,pose.height-.12])add([ring(i,z,pose.radius+.025),ring(i+1,z,pose.radius+.025),ring(i+1,z+.05,pose.radius+.025),ring(i,z+.05,pose.radius+.025)],0x637e70);
    }
    if(view.roofs)add([ring(i,pose.height),ring(i+1,pose.height),point(0,0,pose.height+.35)],shade(0xc0cdc2,.8+.15*Math.cos(i/n*Math.PI*2)));
  }
  // The convex tank is a single raised assembly. Keep rear bracing from painting
  // through its cap, while retaining painter order among the tank's own panels.
  const tank=commands.splice(tankStart).sort((a,c)=>a.depth-c.depth);
  if(tank.length)commands.push({depth:Math.max(frameDepth+.5,...tank.map(c=>c.depth)),run:g=>{for(const c of tank)c.run(g);}});
  if(view.details && s.phase==='standing') {
    const x=b.x+.5*cs,y=b.y+.5*cs;
    for(const dx of [-.18,.18])beam({x:x+dx,y:y-.2,z:.15},{x:x+dx,y:y-.2,z:b.floors*FLOOR_Z},0x465c4e);
    for(let z=.2;z<b.floors*FLOOR_Z;z+=.28)beam({x:x-.18,y:y-.2,z},{x:x+.18,y:y-.2,z},0x60786a);
  }
  return commands;
}
