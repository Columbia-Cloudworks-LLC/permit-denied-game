import type { Graphics } from 'pixi.js';
import { FLOOR_Z } from '../game/constants';
import { facadeDetailPose, roofDetailPoint, type FacadeDetailDef } from '../structure/facadeDetails';
import type { Building } from '../structure/types';
import { depthKey } from '../world/iso';
import { drawWorldPoly, shade } from './drawIso';
import { getBuildingSurfaces } from './buildingSurfaces';
import { displacedRoofVerts } from '../structure/roof';
import { roofCommandDepth } from './interiorDraw';

// A small world-space lettering alphabet keeps signs crisp at the game's pixel scale.
const LETTERS: Record<string, string> = {
  A:'010101111101101', B:'110101110101110', C:'011100100100011', D:'110101101101110',
  E:'111100110100111', F:'111100110100100', G:'011100101101011', H:'101101111101101',
  I:'111010010010111', J:'001001001101010', K:'101101110101101', L:'100100100100111',
  M:'101111111101101', N:'101111111111101', O:'010101101101010', P:'110101110100100',
  Q:'010101101111011', R:'110101110101101', S:'011100010001110', T:'111010010010010',
  U:'101101101101111', V:'101101101101010', W:'101101111111101', X:'101101010101101',
  Y:'101101010010010', Z:'111001010100111', ' ':'000000000000000',
  '0':'111101101101111','1':'010110010010111','2':'110001010100111','3':'110001010001110',
  '4':'101101111001001','5':'111100110001110','6':'011100111101111','7':'111001010010010',
  '8':'111101111101111','9':'111101111001110',
};

export function facadeDetailCommand(b: Building, d: FacadeDetailDef, alpha = 1) {
  const pose = facadeDetailPose(b, d);
  if (!pose) return null;
  const south = d.side === 'south', w = pose.width;
  const point = (u: number, v: number, out = .045) => (d.kind === 'roof-duct' || d.kind === 'dormer') ? roofDetailPoint(b, d, u, out, v) : ({
    x: pose.x + (south ? u : out), y: pose.y + (south ? out : u), z: pose.z + v * pose.scaleZ,
  });
  let depth = depthKey(pose.x + (south ? w / 2 : .25), pose.y + (south ? .25 : w / 2), pose.z + FLOOR_Z / 2);
  // Faded wall runs use the face plane, not the grid cell center. Bound all possible
  // split-run depths on this plane so a broad host facade cannot overpaint its mounts.
  for (const span of getBuildingSurfaces(b).walls) if (span.dir === d.side && (south ? span.gy0 === d.gy : span.gx0 === d.gx))
    depth = Math.max(depth, depthKey(b.x + (south ? span.gx1 + .5 : span.gx0 + 1) * b.cellSize,
      b.y + (south ? span.gy0 + 1 : span.gy1 + .5) * b.cellSize, span.floor * FLOOR_Z) + .5);
  if ((d.kind === 'roof-duct' || d.kind === 'dormer')) for (const roof of b.roofs) if (roof.floor === d.floor && roof.state !== 'gone')
    depth = Math.max(depth, roofCommandDepth(b, roof, displacedRoofVerts(roof)) + 1);
  return { depth,
    run: (g: Graphics) => {
      const poly = (coords: number[][], color: number, out = .045) => drawWorldPoly(g, coords.map(([u, v]) => point(u!, v!, out)), color, alpha);
      const rect = (u: number, v: number, width: number, height: number, color: number, out = .045) =>
        poly([[u,v],[u+width,v],[u+width,v+height],[u,v+height]], color, out);
      const box = (u: number, out: number, z: number, width: number, depth: number, height: number, color: number) => {
        drawWorldPoly(g, [point(u,z+height,out),point(u+width,z+height,out),point(u+width,z+height,out+depth),point(u,z+height,out+depth)],color,alpha);
        rect(u,z,width,height,shade(color,.67),out+depth);
        drawWorldPoly(g,[point(u+width,z,out),point(u+width,z,out+depth),point(u+width,z+height,out+depth),point(u+width,z+height,out)],shade(color,.82),alpha);
      };
      const label = (text: string, v: number, height: number, color: number, out: number) => {
        const unit = Math.min((w - .2) / (text.length * 4), height / 5), left = (w - (text.length * 4 - 1) * unit) / 2;
        [...text].forEach((ch, i) => [...LETTERS[ch]!].forEach((bit, j) => {
          if (bit === '1') rect(left + (i * 4 + j % 3) * unit, v + (4 - Math.floor(j / 3)) * unit, unit * .85, unit * .85, color, out);
        }));
      };
      if (d.kind === 'dormer') {
        const left=.08, right=w-.08, center=w/2, front=.9, back=-.45, eave=.8, peak=1.2;
        box(left,back,-.15,right-left,front-back,eave+.15,0xb5a184);
        poly([[left,eave],[right,eave],[center,peak]],0xcbbb9e,front);
        rect(w*.25,.08,w*.5,.59,0x433f37,front+.01);
        rect(w*.29,.12,w*.42,.51,0x7c9a9c,front+.02);
        rect(center-.022,.1,.044,.55,0xe0d5b6,front+.03);
        rect(w*.27,.35,w*.46,.035,0xe0d5b6,front+.03);
        rect(w*.22,.05,w*.56,.055,0xe0d5b6,front+.04);
        drawWorldPoly(g,[point(left-.08,eave,back-.06),point(center,peak,back-.06),point(center,peak,front+.12),point(left-.08,eave,front+.12)],0x705546,alpha);
        drawWorldPoly(g,[point(center,peak,back-.06),point(right+.08,eave,back-.06),point(right+.08,eave,front+.12),point(center,peak,front+.12)],0x503d33,alpha);
      } else if (d.kind === 'roof-duct') {
        box(.08,.08,.01,w-.16,.75,.12,0x697b79);
        box(w*.32,.23,.13,w*.36,.42,.85,0xa8b4ad);
        box(w*.2,.13,.98,w*.6,.63,.1,0x60736f);
        box(w*.25,.18,1.08,w*.5,.53,.1,0xb8c0b6);
        for (let z=.22;z<.9;z+=.16) rect(w*.32,z,w*.36,.025,0x718680,.66);
      } else if (d.kind === 'display-glazing') {
        rect(.03,.12,w-.06,FLOOR_Z*.63,0x333f40);
        for(let i=0;i<d.width;i++) {
          const left=i*b.cellSize+.08, width=b.cellSize-.16, pane=pose.panes?.[i];
          rect(left,.22,width,FLOOR_Z*.54,pane?.hp?0x759da1:0x293435,.06);
          if(pane?.hp) {
            poly([[left+.03,.25],[left+width*.25,.25],[left+width*.75,FLOOR_Z*.61],[left+width*.55,FLOOR_Z*.61]],0x9bb7b8,.065);
            if(pane.hp<pane.maxHp) poly([[left+width*.4,.45],[left+width*.45,.47],[left+width*.62,1.2],[left+width*.58,1.2]],0x36464a,.07);
          }
          rect(i*b.cellSize,.12,.045,FLOOR_Z*.63,0xb3bab2,.075);
        }
        rect(w-.045,.12,.045,FLOOR_Z*.63,0xb3bab2,.075);
        rect(0,.12,w,.065,0xb3bab2,.075);rect(0,FLOOR_Z*.66,w,.065,0xb3bab2,.075);
      } else if (d.kind === 'roll-up-door') {
        rect(.03,.03,w-.06,FLOOR_Z*.84,0x424a46);
        rect(.1,.06,w-.2,FLOOR_Z*.75,pose.damaged?0x777568:0x9c9f92);
        for (let z=.14;z<FLOOR_Z*.8;z+=.13) rect(.1,z,w-.2,.022,0x59625c);
        rect(w*.44,.19,w*.12,.045,0x333b36);
      } else if (d.kind === 'entry-steps') {
        // Visual shallow steps intentionally add no collision; existing entrance access stays clear.
        for (let i=0;i<3;i++) box(.1,.04+i*.28,.01,w-.2,.28,.27-i*.08,0x9b998c);
      } else if (d.kind === 'porch' || d.kind === 'fire-escape') {
        const porch = d.kind === 'porch', depth = porch ? 1.1 : .8, base = porch ? .12 : .08;
        const color = porch ? 0x634c32 : 0x303c35;
        box(.03,.035,.015,w-.06,depth,base,porch ? 0xaa8a64 : 0x747e77);
        for (const u of [.08,w-.14]) box(u,.03,base,.07,depth,.045,color);
        // Open center gate on a porch; continuous rail and descending ladder on a fire escape.
        for (let u=.09;u<w-.05;u+=.24) {
          if (porch && u>w*.33 && u<w*.67) continue;
          box(u,depth,base,.04,.04,.58,color);
        }
        if(porch) {
          box(.06,depth,base+.56,w*.27,.065,.055,color);
          box(w*.67,depth,base+.56,w*.27,.065,.055,color);
          for(const u of [.06,w-.14]) box(u,depth-.03,base,.08,.08,FLOOR_Z*.75,color);
        } else {
          box(.06,depth,base+.56,w-.12,.065,.055,color);
          for(const u of [w-.62,w-.12]) box(u,depth+.08,-FLOOR_Z+.08,.045,.055,FLOOR_Z+.5,color);
          for(let z=-FLOOR_Z+.15;z<.4;z+=.23) box(w-.62,depth+.08,z,.54,.055,.045,color);
        }
      } else if (d.kind === 'clock-face') {
        const cx = w / 2, cy = FLOOR_Z * .53, r = Math.min(w * .43, FLOOR_Z * .4);
        const circle = (radius: number, color: number) => poly(Array.from({length: 32}, (_, i) => {
          const angle = i / 32 * Math.PI * 2; return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
        }), color);
        circle(r, 0x3f443f); circle(r * .87, pose.damaged ? 0xb4b19b : 0xf1e9ce);
        for (let i = 0; i < 12; i++) {
          const a = i / 12 * Math.PI * 2;
          rect(cx + Math.cos(a) * r * .7 - .025, cy + Math.sin(a) * r * .7 - .04, .05, .08, 0x333831);
        }
        poly([[cx-.035,cy],[cx+.035,cy],[cx+.035,cy+r*.62],[cx-.035,cy+r*.62]],0x333831);
        poly([[cx,cy-.035],[cx+r*.48,cy-.035],[cx+r*.48,cy+.035],[cx,cy+.035]],0x333831);
      } else {
        const marquee = d.kind === 'marquee', top = FLOOR_Z * .93, bottom = top - (marquee ? .58 : .5);
        const out = marquee ? .85 : .08;
        if (marquee) {
          drawWorldPoly(g, [point(0,bottom,.02),point(w,bottom,.02),point(w,bottom,out),point(0,bottom,out)], 0x847c64, alpha);
          for (const u of [.08, w-.08]) drawWorldPoly(g, [point(u,bottom,.02),point(u,bottom,out),point(u,top-.05,.02)], 0x5b615a, alpha);
          rect(0,bottom,w,top-bottom,0x8d4239,out);
          rect(.08,bottom+.09,w-.16,top-bottom-.18,0xe9d7a7,out+.01);
          label(d.text ?? 'STAR',bottom+.15,.28,0x3d3933,out+.02);
          for(let u=.12;u<w;u+=.2) rect(u,bottom+.025,.045,.045,0xffedac,out+.025);
        } else {
          rect(0,bottom,w,top-bottom,0x343f39,out);
          rect(.045,bottom+.04,w-.09,top-bottom-.08,pose.damaged?0x795f46:0x947446,out+.005);
          label(d.text ?? 'SHOP',bottom+.1,.3,0xf3e4ba,out+.01);
        }
      }
    } };
}
