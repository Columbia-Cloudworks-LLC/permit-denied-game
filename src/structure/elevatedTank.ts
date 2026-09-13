import { FLOOR_Z } from '../game/constants';
import type { ParticlePool } from '../fx/particles';
import { cellPresent, type Building, type WorldEvent } from './types';
import type { StructureStepResult } from './building';

export interface ElevatedTankDef {
  radius: number; height: number; minimumLegs: number; warningDuration: number; fallDuration: number;
}
export interface ElevatedTankState {
  definition: ElevatedTankDef;
  phase: 'standing' | 'warning' | 'falling' | 'gone';
  elapsed: number; progress: number; dx: number; dy: number; legs: number;
}
export function tankLegs(b: Building) {
  return [[0,0],[b.w-1,0],[0,b.d-1],[b.w-1,b.d-1]].map(([gx,gy]) => ({gx:gx!,gy:gy!}));
}
export function initializeElevatedTank(b: Building, definition: ElevatedTankDef) {
  b.elevatedTank = { definition, phase:'standing', elapsed:0, progress:0, dx:0, dy:1, legs:4 };
  b.floorTiles = []; b.roofs = []; b.fixtures = [];
  for (const c of b.cells) { c.cladding = undefined; c.role = 'column'; c.isSupport = true; }
}
export function tankPose(b: Building) {
  const s=b.elevatedTank!;
  const p=s.progress, drop=p*p;
  return { x:b.x+b.w*b.cellSize/2+s.dx*drop*1.2, y:b.y+b.d*b.cellSize/2+s.dy*drop*1.2,
    z:Math.max(.15,b.floors*FLOOR_Z*(1-drop)), tilt:p*.55, radius:s.definition.radius,
    height:s.definition.height*(1-p*.65) };
}
export function stepElevatedTank(b: Building, dt: number, result: StructureStepResult, particles: ParticlePool, events: WorldEvent[]) {
  const s=b.elevatedTank!, def=s.definition;
  if(s.phase==='gone')return;
  const legs=tankLegs(b), live=legs.filter(p=>b.grid.every(layer=>cellPresent(layer[p.gx]![p.gy]!)));
  s.legs=live.length;
  if(s.phase==='standing' && live.length<def.minimumLegs) {
    s.phase='warning';s.elapsed=0;
    const lost=legs.filter(p=>!live.includes(p));
    const dx=lost.reduce((n,p)=>n+p.gx-(b.w-1)/2,0),dy=lost.reduce((n,p)=>n+p.gy-(b.d-1)/2,0), len=Math.hypot(dx,dy);
    s.dx=len?dx/len:0;s.dy=len?dy/len:1;
    const p=tankPose(b);events.push({kind:'snap',x:p.x,y:p.y,z:p.z,mag:1.4,material:'metal'});
  }
  if(s.phase==='standing')return;
  s.elapsed+=dt;b.visualRevision++;b.structureDirty=true;
  if(s.phase==='warning') {
    if(s.elapsed<def.warningDuration)return;
    s.phase='falling';s.elapsed=0;
    // The tank pulls the remaining frame down with it; column debris stays on the production path.
    for(const c of b.cells)if(cellPresent(c)){c.hp=0;c.state='breached';c.lastHitNx=s.dx;c.lastHitNy=s.dy;}
    b.collisionDirty=true;
  }
  s.progress=Math.min(1,s.elapsed/def.fallDuration);
  if(s.progress<1)return;
  const p=tankPose(b);s.phase='gone';
  particles.radialDust(p.x,p.y,def.radius,22);
  events.push({kind:'snap',x:p.x,y:p.y,z:0,mag:2,material:'metal'});
  for(let i=0;i<12;i++) {
    const angle=i/12*Math.PI*2;
    result.rubbleSpawns.push({x:p.x+Math.cos(angle)*def.radius*.65,y:p.y+Math.sin(angle)*def.radius*.65,
      dx:Math.cos(angle),dy:Math.sin(angle),material:'metal',floor:0,cellSize:b.cellSize,source:'roof',
      panelW:def.radius*.8,panelD:def.height*.7});
  }
}
