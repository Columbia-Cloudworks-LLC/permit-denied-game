import type { Graphics } from 'pixi.js';
import { FLOOR_Z } from '../game/constants';
import type { DebugView } from '../debug/view';
import { cellPresent, type Building } from '../structure/types';
import { siloCells, siloPose } from '../structure/silos';
import { depthKey } from '../world/iso';
import { drawWorldPoly } from './drawIso';
import { shade } from './palette';

type Cmd = {depth:number;run:(g:Graphics)=>void};
type Point = {x:number;y:number;z:number};
type Silo = NonNullable<Building['silos']>[number];
type SiloPose = ReturnType<typeof siloPose>;
const addPoly=(parts:Cmd[],points:Point[],color:number)=>parts.push({depth:Math.max(...points.map(v=>depthKey(v.x,v.y,v.z))),run:g=>drawWorldPoly(g,points,color)});

export function siloCommands(b:Building,view:DebugView) {
  const commands:Cmd[]=[];
  for(const s of b.silos??[]) if(s.phase!=='gone')pushSilo(commands,b,s,view);
  return commands;
}

/** One silo drawn as a single sorted assembly, plus the feed chute from its mount while it stands. */
function pushSilo(commands:Cmd[],b:Building,s:Silo,view:DebugView):void {
  const p=siloPose(b,s),cells=siloCells(b,s),parts:Cmd[]=[];
  const point=(angle:number,z:number,r=p.radius)=>({x:p.x+Math.cos(angle)*r+z*s.dx*p.tilt,y:p.y+Math.sin(angle)*r+z*s.dy*p.tilt,z});
  const height=Math.min(p.height,(view.maxFloor+1)*FLOOR_Z);
  for(let i=0;i<32;i++) {
    const a=i*Math.PI/16, c=(i+1)*Math.PI/16;
    if(view.walls)pushSiloStave(parts,s,cells,point,a,c,height,p.radius);
    if(view.roofs && height===p.height)addPoly(parts,[point(a,height),point(c,height),{x:p.x+height*s.dx*p.tilt,y:p.y+height*s.dy*p.tilt,z:height+.55*(1-s.progress)}],shade(0xbec8bd,.8+.15*Math.cos(a)));
  }
  parts.sort((a,c)=>a.depth-c.depth);
  if(parts.length)commands.push({depth:Math.max(...parts.map(c=>c.depth)),run:g=>{for(const c of parts)c.run(g);}});
  if(view.details && s.phase==='standing')pushFeedChute(commands,b,s,p,view.maxFloor);
}

/** One wall stave with its hoops; a stave over a destroyed cell starts a story up while the silo stands. */
function pushSiloStave(parts:Cmd[],s:Silo,cells:ReturnType<typeof siloCells>,point:(angle:number,z:number,r?:number)=>Point,a:number,c:number,height:number,radius:number):void {
  const owner=cells.find(cell=>Math.round((a+Math.PI/32)/ (Math.PI/4))%8===Math.round(cell.silo!.angle/(Math.PI/4)));
  const damaged=owner && !cellPresent(owner);
  const base=damaged && s.phase==='standing'?Math.min(FLOOR_Z,height):0;
  const color=shade(0xa8b5b1,.68+.25*(Math.cos(a-.5)+1)/2);
  addPoly(parts,[point(a,base),point(c,base),point(c,height),point(a,height)],color);
  const hoop=radius+.012;
  for(let z=base+.2;z<height;z+=.45)addPoly(parts,[point(a,z,hoop),point(c,z,hoop),point(c,Math.min(height,z+.025),hoop),point(a,Math.min(height,z+.025),hoop)],shade(color,.82));
}

function pushFeedChute(commands:Cmd[],b:Building,s:Silo,p:SiloPose,maxFloor:number):void {
  const feed=s.definition.feed,mount=b.grid[feed.floor]?.[feed.gx]?.[feed.gy];
  if(!mount || !cellPresent(mount) || feed.floor>maxFloor)return;
  const a={x:b.x+(feed.gx+.5)*b.cellSize,y:b.y+(feed.gy+.5)*b.cellSize,z:(feed.floor+1)*FLOOR_Z};
  const c={x:p.x,y:p.y,z:p.height+.45};
  commands.push({depth:Math.max(depthKey(a.x,a.y,a.z),depthKey(p.x+p.radius,p.y+p.radius,p.height))+.5,
    run:g=>drawWorldPoly(g,[{...a,y:a.y-.1},{...c,y:c.y-.1},{...c,y:c.y+.1},{...a,y:a.y+.1}],0x647c73)});
}
