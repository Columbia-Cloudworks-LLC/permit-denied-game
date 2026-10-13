import type { Graphics } from 'pixi.js';
import { FLOOR_Z } from '../game/constants';
import type { DebugView } from '../debug/view';
import { cellPresent, cellWorldBox, type Building } from '../structure/types';
import { tankLegs, tankPose } from '../structure/elevatedTank';
import { depthKey } from '../world/iso';
import { drawIsoBox, drawWorldPoly } from './drawIso';
import { shade } from './palette';
import { drawFallingCell } from './facadeDraw';

type Point = { x:number;y:number;z:number };
type Cmd = {depth:number;run:(g:Graphics)=>void};
type TankPose = ReturnType<typeof tankPose>;
const addPoly=(commands:Cmd[],points:Point[],color:number)=>commands.push({depth:Math.max(...points.map(p=>depthKey(p.x,p.y,p.z))),run:g=>drawWorldPoly(g,points,color)});
/** A square member from a to c, as two crossed flat faces. */
const addBeam=(commands:Cmd[],a:Point,c:Point,color:number)=> {
  addPoly(commands,[{...a,x:a.x-.045},{...c,x:c.x-.045},{...c,x:c.x+.045},{...a,x:a.x+.045}],color);
  addPoly(commands,[{...a,y:a.y-.045},{...c,y:c.y-.045},{...c,y:c.y+.045},{...a,y:a.y+.045}],shade(color,.75));
};
export function elevatedTankCommands(b:Building, view:DebugView) {
  const commands:Cmd[]=[];
  const s=b.elevatedTank!;
  if(view.walls)pushTowerCells(commands,b,view.maxFloor);
  if(view.details)pushLegBracing(commands,b,view.maxFloor);
  if(s.phase==='gone' || view.maxFloor<b.floors-1)return commands;
  const frameDepth=Math.max(0,...commands.map(c=>c.depth));
  // The convex tank is a single raised assembly. Keep rear bracing from painting
  // through its cap, while retaining painter order among the tank's own panels.
  const tank=tankPanels(b,view).sort((a,c)=>a.depth-c.depth);
  if(tank.length)commands.push({depth:Math.max(frameDepth+.5,...tank.map(c=>c.depth)),run:g=>{for(const c of tank)c.run(g);}});
  if(view.details && s.phase==='standing')pushLadder(commands,b);
  return commands;
}
function pushTowerCells(commands:Cmd[],b:Building,maxFloor:number):void {
  for(const c of b.cells) {
    if(c.floor>maxFloor || c.state==='gone')continue;
    const box=cellWorldBox(b,c);
    commands.push({depth:depthKey(box.x+box.w/2,box.y+box.d/2,c.floor*FLOOR_Z),run:g=>{
      if(c.state==='falling')drawFallingCell(g,b,c,1);
      else drawIsoBox(g,box.x,box.y,box.w,box.d,c.floor*FLOOR_Z,FLOOR_Z,0xa9b5ac,0x52665a,0x7f9385);
    }});
  }
}
/** X-bracing and a top strut between each pair of standing legs, floor by floor. */
function pushLegBracing(commands:Cmd[],b:Building,maxFloor:number):void {
  const cs=b.cellSize, legs=tankLegs(b), faces=[[0,1],[0,2],[1,3],[2,3]];
  const standing=(floor:number,leg:typeof legs[number])=>cellPresent(b.grid[floor]![leg.gx]![leg.gy]!);
  for(let floor=0;floor<b.floors && floor<=maxFloor;floor++)for(const [a,c] of faces) {
    const left=legs[a!]!,right=legs[c!]!;
    if(!standing(floor,left) || !standing(floor,right))continue;
    const point=(p:typeof left,z:number)=>({x:b.x+(p.gx+.5)*cs,y:b.y+(p.gy+.5)*cs,z});
    addBeam(commands,point(left,floor*FLOOR_Z+.15),point(right,(floor+1)*FLOOR_Z-.15),0x779084);
    addBeam(commands,point(right,floor*FLOOR_Z+.15),point(left,(floor+1)*FLOOR_Z-.15),0x779084);
    addBeam(commands,point(left,(floor+1)*FLOOR_Z-.08),point(right,(floor+1)*FLOOR_Z-.08),0xa5b5aa);
  }
}
const TANK_SIDES=20;
/** The tilted tank: shell panels with a conical base and hoops, then the conical cap. */
function tankPanels(b:Building,view:DebugView):Cmd[] {
  const s=b.elevatedTank!, pose=tankPose(b), panels:Cmd[]=[];
  const cos=Math.cos(pose.tilt),sin=Math.sin(pose.tilt);
  const point=(x:number,y:number,z:number):Point=>({x:pose.x+x+z*s.dx*sin,y:pose.y+y+z*s.dy*sin,
    z:Math.max(.12,pose.z+z*cos-(x*s.dx+y*s.dy)*sin)});
  const n=TANK_SIDES, ring=(i:number,z:number,r=pose.radius)=>point(Math.cos(i/n*Math.PI*2)*r,Math.sin(i/n*Math.PI*2)*r,z);
  for(let i=0;i<n;i++) {
    if(view.walls)pushTankShell(panels,pose,ring,point,i);
    if(view.roofs)addPoly(panels,[ring(i,pose.height),ring(i+1,pose.height),point(0,0,pose.height+.35)],shade(0xc0cdc2,.8+.15*Math.cos(i/n*Math.PI*2)));
  }
  return panels;
}
function pushTankShell(panels:Cmd[],pose:TankPose,ring:(i:number,z:number,r?:number)=>Point,point:(x:number,y:number,z:number)=>Point,i:number):void {
  const color=shade(0xa1b9ae,.68+.28*(Math.cos(i/TANK_SIDES*Math.PI*2-.8)+1)/2);
  addPoly(panels,[ring(i,0),ring(i+1,0),ring(i+1,pose.height),ring(i,pose.height)],color);
  addPoly(panels,[ring(i,-.1),ring(i+1,-.1),point(0,0,-.38)],shade(color,.7));
  const hoop=pose.radius+.025;
  for(const z of [.12,pose.height-.12])addPoly(panels,[ring(i,z,hoop),ring(i+1,z,hoop),ring(i+1,z+.05,hoop),ring(i,z+.05,hoop)],0x637e70);
}
function pushLadder(commands:Cmd[],b:Building):void {
  const cs=b.cellSize, x=b.x+.5*cs,y=b.y+.5*cs;
  for(const dx of [-.18,.18])addBeam(commands,{x:x+dx,y:y-.2,z:.15},{x:x+dx,y:y-.2,z:b.floors*FLOOR_Z},0x465c4e);
  for(let z=.2;z<b.floors*FLOOR_Z;z+=.28)addBeam(commands,{x:x-.18,y:y-.2,z},{x:x+.18,y:y-.2,z},0x60786a);
}
