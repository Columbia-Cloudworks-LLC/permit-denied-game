import type { Graphics } from 'pixi.js';
import { FLOOR_Z } from '../game/constants';
import type { DebugView } from '../debug/view';
import { cellPresent, type Building } from '../structure/types';
import { siloCells, siloPose } from '../structure/silos';
import { depthKey } from '../world/iso';
import { drawWorldPoly, shade } from './drawIso';

export function siloCommands(b:Building,view:DebugView) {
  const commands:{depth:number;run:(g:Graphics)=>void}[]=[];
  for(const s of b.silos??[]) {
    if(s.phase==='gone')continue;
    const p=siloPose(b,s),cells=siloCells(b,s),parts:{depth:number;run:(g:Graphics)=>void}[]=[];
    const point=(angle:number,z:number,r=p.radius)=>({x:p.x+Math.cos(angle)*r+z*s.dx*p.tilt,y:p.y+Math.sin(angle)*r+z*s.dy*p.tilt,z});
    const add=(points:{x:number;y:number;z:number}[],color:number)=>parts.push({depth:Math.max(...points.map(v=>depthKey(v.x,v.y,v.z))),run:g=>drawWorldPoly(g,points,color)});
    const height=Math.min(p.height,(view.maxFloor+1)*FLOOR_Z);
    for(let i=0;i<32;i++) {
      const a=i*Math.PI/16, c=(i+1)*Math.PI/16;
      const owner=cells.find(cell=>Math.round((a+Math.PI/32)/ (Math.PI/4))%8===Math.round(cell.silo!.angle/(Math.PI/4)));
      const damaged=owner && !cellPresent(owner);
      const base=damaged && s.phase==='standing'?Math.min(FLOOR_Z,height):0;
      const color=shade(0xa8b5b1,.68+.25*(Math.cos(a-.5)+1)/2);
      if(view.walls) {
        add([point(a,base),point(c,base),point(c,height),point(a,height)],color);
        for(let z=base+.2;z<height;z+=.45)add([point(a,z,p.radius+.012),point(c,z,p.radius+.012),point(c,Math.min(height,z+.025),p.radius+.012),point(a,Math.min(height,z+.025),p.radius+.012)],shade(color,.82));
      }
      if(view.roofs && height===p.height)add([point(a,height),point(c,height),{x:p.x+height*s.dx*p.tilt,y:p.y+height*s.dy*p.tilt,z:height+.55*(1-s.progress)}],shade(0xbec8bd,.8+.15*Math.cos(a)));
    }
    parts.sort((a,c)=>a.depth-c.depth);
    if(parts.length)commands.push({depth:Math.max(...parts.map(c=>c.depth)),run:g=>{for(const c of parts)c.run(g);}});
    const feed=s.definition.feed,mount=b.grid[feed.floor]?.[feed.gx]?.[feed.gy];
    if(view.details && s.phase==='standing' && mount && cellPresent(mount) && feed.floor<=view.maxFloor) {
      const a={x:b.x+(feed.gx+.5)*b.cellSize,y:b.y+(feed.gy+.5)*b.cellSize,z:(feed.floor+1)*FLOOR_Z};
      const c={x:p.x,y:p.y,z:p.height+.45};
      commands.push({depth:Math.max(depthKey(a.x,a.y,a.z),depthKey(p.x+p.radius,p.y+p.radius,p.height))+.5,
        run:g=>drawWorldPoly(g,[{...a,y:a.y-.1},{...c,y:c.y-.1},{...c,y:c.y+.1},{...a,y:a.y+.1}],0x647c73)});
    }
  }
  return commands;
}
