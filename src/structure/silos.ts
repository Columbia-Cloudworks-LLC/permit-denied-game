import { cellPresent, type Building, type Cell } from './types';
import type { ParticlePool } from '../fx/particles';
import type { StructureStepResult } from './building';

export interface SiloDef {
  id:string; gx:number; gy:number; diameter:number; height:number;
  minimumSupports:number;
  feed:{gx:number;gy:number;floor:number};
}
export interface SiloState { definition:SiloDef; phase:'standing'|'falling'|'gone'; progress:number; dx:number;dy:number }
export function siloSupports(d:SiloDef) {
  const radius=(d.diameter-1)/2;
  return Array.from({length:8},(_,i)=>({gx:d.gx+Math.round(radius+radius*Math.cos(i*Math.PI/4)),gy:d.gy+Math.round(radius+radius*Math.sin(i*Math.PI/4)),angle:i*Math.PI/4}));
}
export function siloAt(definitions:readonly SiloDef[],gx:number,gy:number) {
  return definitions.find(d=>gx>=d.gx && gx<d.gx+d.diameter && gy>=d.gy && gy<d.gy+d.diameter);
}
export function siloCells(b:Building,s:SiloState):Cell[] { return b.cells.filter(c=>c.silo?.id===s.definition.id); }
export function siloPose(b:Building,s:SiloState) {
  const d=s.definition,p=s.progress,drop=p*p;
  return {x:b.x+(d.gx+d.diameter/2)*b.cellSize+s.dx*drop,y:b.y+(d.gy+d.diameter/2)*b.cellSize+s.dy*drop,
    radius:d.diameter*b.cellSize/2,height:d.height*(1-drop*.97),tilt:p*.35};
}
export function stepSilos(b:Building,dt:number,result:StructureStepResult,particles:ParticlePool) {
  for(const s of b.silos??[]) {
    if(s.phase==='gone')continue;
    const cells=siloCells(b,s);
    if(s.phase==='standing' && cells.filter(cellPresent).length<s.definition.minimumSupports) {
      s.phase='falling';
      const lost=cells.filter(c=>!cellPresent(c));
      const dx=lost.reduce((sum,c)=>sum+Math.cos(c.silo!.angle),0),dy=lost.reduce((sum,c)=>sum+Math.sin(c.silo!.angle),0),len=Math.hypot(dx,dy);
      s.dx=len?dx/len:1;s.dy=len?dy/len:0;
      for(const c of cells)if(cellPresent(c)){c.hp=0;c.state='breached';c.lastHitNx=s.dx;c.lastHitNy=s.dy;}
      b.collisionDirty=true;b.structureDirty=true;
    }
    if(s.phase!=='falling')continue;
    s.progress=Math.min(1,s.progress+dt/2.4);b.visualRevision++;
    if(s.progress<1)continue;
    s.phase='gone';const p=siloPose(b,s);
    particles.radialDust(p.x,p.y,p.radius,22);
    for(let i=0;i<16;i++) {
      const angle=i*Math.PI/8;
      result.rubbleSpawns.push({x:p.x+Math.cos(angle)*p.radius*.65,y:p.y+Math.sin(angle)*p.radius*.65,dx:Math.cos(angle),dy:Math.sin(angle),
        material:'metal',floor:0,cellSize:b.cellSize,source:'roof',panelW:p.radius*.65,panelD:s.definition.height*.3});
    }
  }
}
