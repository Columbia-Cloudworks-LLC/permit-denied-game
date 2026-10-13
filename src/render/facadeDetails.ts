import type { Graphics } from 'pixi.js';
import { FLOOR_Z } from '../game/constants';
import { facadeDetailPose, roofDetailPoint, type FacadeDetailDef } from '../structure/facadeDetails';
import type { Building } from '../structure/types';
import { depthKey } from '../world/iso';
import { drawWorldPoly } from './drawIso';
import { shade } from './palette';
import { getBuildingSurfaces, type WallSpan } from './buildingSurfaces';
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

type Pose = NonNullable<ReturnType<typeof facadeDetailPose>>;
type Vec3 = { x: number; y: number; z: number };
/** A point on the detail's plane: u along the wall, v up it, out away from it. */
type PlanePoint = (u: number, v: number, out?: number) => Vec3;

const onRoof = (d: FacadeDetailDef) => d.kind === 'roof-duct' || d.kind === 'dormer';

export function facadeDetailCommand(b: Building, d: FacadeDetailDef, alpha = 1) {
  const pose = facadeDetailPose(b, d);
  if (!pose) return null;
  const point = detailPoint(b, d, pose);
  return {
    depth: detailDepth(b, d, pose),
    run: (g: Graphics) => PAINTERS[d.kind]({ pen: new DetailPen(g, point, alpha, pose.width), b, d, pose }),
  };
}

function detailPoint(b: Building, d: FacadeDetailDef, pose: Pose): PlanePoint {
  if (onRoof(d)) return (u, v, out = .045) => roofDetailPoint(b, d, u, out, v);
  const south = d.side === 'south';
  return (u, v, out = .045) => ({ x: pose.x + (south ? u : out), y: pose.y + (south ? out : u), z: pose.z + v * pose.scaleZ });
}

/**
 * Faded wall runs use the face plane, not the grid cell center. Bound all possible
 * split-run depths on this plane so a broad host facade cannot overpaint its mounts.
 */
function detailDepth(b: Building, d: FacadeDetailDef, pose: Pose): number {
  const south = d.side === 'south', w = pose.width;
  let depth = depthKey(pose.x + (south ? w / 2 : .25), pose.y + (south ? .25 : w / 2), pose.z + FLOOR_Z / 2);
  for (const span of getBuildingSurfaces(b).walls) if (hostsDetail(span, d)) depth = Math.max(depth, wallPlaneDepth(b, span) + .5);
  if (onRoof(d)) for (const roof of b.roofs) if (roof.floor === d.floor && roof.state !== 'gone')
    depth = Math.max(depth, roofCommandDepth(b, roof, displacedRoofVerts(roof)) + 1);
  return depth;
}

/** A wall run on the detail's face: same side, and the same row or column of cells. */
function hostsDetail(span: WallSpan, d: FacadeDetailDef): boolean {
  if (span.dir !== d.side) return false;
  return d.side === 'south' ? span.gy0 === d.gy : span.gx0 === d.gx;
}

/** Deepest point of a wall run on its face plane. */
function wallPlaneDepth(b: Building, span: WallSpan): number {
  const south = span.dir === 'south';
  return depthKey(b.x + (south ? span.gx1 + .5 : span.gx0 + 1) * b.cellSize,
    b.y + (south ? span.gy0 + 1 : span.gy1 + .5) * b.cellSize, span.floor * FLOOR_Z);
}

/** World-space drawing on one detail's plane. */
class DetailPen {
  constructor(private readonly g: Graphics, readonly point: PlanePoint, private readonly alpha: number, readonly w: number) {}

  world(points: Vec3[], color: number): void {
    drawWorldPoly(this.g, points, color, this.alpha);
  }

  poly(coords: number[][], color: number, out = .045): void {
    this.world(coords.map(([u, v]) => this.point(u!, v!, out)), color);
  }

  rect(u: number, v: number, width: number, height: number, color: number, out = .045): void {
    this.poly([[u,v],[u+width,v],[u+width,v+height],[u,v+height]], color, out);
  }

  /** A block standing off the plane: top, front face, then the right side. */
  box(u: number, out: number, z: number, width: number, depth: number, height: number, color: number): void {
    const p = this.point;
    this.world([p(u,z+height,out),p(u+width,z+height,out),p(u+width,z+height,out+depth),p(u,z+height,out+depth)],color);
    this.rect(u,z,width,height,shade(color,.67),out+depth);
    this.world([p(u+width,z,out),p(u+width,z,out+depth),p(u+width,z+height,out+depth),p(u+width,z+height,out)],shade(color,.82));
  }

  label(text: string, v: number, height: number, color: number, out: number): void {
    const w = this.w;
    const unit = Math.min((w - .2) / (text.length * 4), height / 5), left = (w - (text.length * 4 - 1) * unit) / 2;
    [...text].forEach((ch, i) => [...LETTERS[ch]!].forEach((bit, j) => {
      if (bit === '1') this.rect(left + (i * 4 + j % 3) * unit, v + (4 - Math.floor(j / 3)) * unit, unit * .85, unit * .85, color, out);
    }));
  }
}

interface DetailPaint { pen: DetailPen; b: Building; d: FacadeDetailDef; pose: Pose }

function drawDormer({ pen }: DetailPaint): void {
  const { w, point } = pen;
  const left=.08, right=w-.08, center=w/2, front=.9, back=-.45, eave=.8, peak=1.2;
  pen.box(left,back,-.15,right-left,front-back,eave+.15,0xb5a184);
  pen.poly([[left,eave],[right,eave],[center,peak]],0xcbbb9e,front);
  pen.rect(w*.25,.08,w*.5,.59,0x433f37,front+.01);
  pen.rect(w*.29,.12,w*.42,.51,0x7c9a9c,front+.02);
  pen.rect(center-.022,.1,.044,.55,0xe0d5b6,front+.03);
  pen.rect(w*.27,.35,w*.46,.035,0xe0d5b6,front+.03);
  pen.rect(w*.22,.05,w*.56,.055,0xe0d5b6,front+.04);
  pen.world([point(left-.08,eave,back-.06),point(center,peak,back-.06),point(center,peak,front+.12),point(left-.08,eave,front+.12)],0x705546);
  pen.world([point(center,peak,back-.06),point(right+.08,eave,back-.06),point(right+.08,eave,front+.12),point(center,peak,front+.12)],0x503d33);
}

function drawRoofDuct({ pen }: DetailPaint): void {
  const { w } = pen;
  pen.box(.08,.08,.01,w-.16,.75,.12,0x697b79);
  pen.box(w*.32,.23,.13,w*.36,.42,.85,0xa8b4ad);
  pen.box(w*.2,.13,.98,w*.6,.63,.1,0x60736f);
  pen.box(w*.25,.18,1.08,w*.5,.53,.1,0xb8c0b6);
  for (let z=.22;z<.9;z+=.16) pen.rect(w*.32,z,w*.36,.025,0x718680,.66);
}

function drawDisplayGlazing({ pen, b, d, pose }: DetailPaint): void {
  const { w } = pen;
  pen.rect(.03,.12,w-.06,FLOOR_Z*.63,0x333f40);
  for(let i=0;i<d.width;i++) drawGlazingPane(pen, b.cellSize, i, pose.panes?.[i]);
  pen.rect(w-.045,.12,.045,FLOOR_Z*.63,0xb3bab2,.075);
  pen.rect(0,.12,w,.065,0xb3bab2,.075);pen.rect(0,FLOOR_Z*.66,w,.065,0xb3bab2,.075);
}

/** One storefront pane: glass with a glint while it holds, a crack once hit, then its mullion. */
function drawGlazingPane(pen: DetailPen, cellSize: number, i: number, pane: NonNullable<Pose['panes']>[number] | undefined): void {
  const left=i*cellSize+.08, width=cellSize-.16;
  pen.rect(left,.22,width,FLOOR_Z*.54,pane?.hp?0x759da1:0x293435,.06);
  if(pane?.hp) {
    pen.poly([[left+.03,.25],[left+width*.25,.25],[left+width*.75,FLOOR_Z*.61],[left+width*.55,FLOOR_Z*.61]],0x9bb7b8,.065);
    if(pane.hp<pane.maxHp) pen.poly([[left+width*.4,.45],[left+width*.45,.47],[left+width*.62,1.2],[left+width*.58,1.2]],0x36464a,.07);
  }
  pen.rect(i*cellSize,.12,.045,FLOOR_Z*.63,0xb3bab2,.075);
}

function drawRollUpDoor({ pen, pose }: DetailPaint): void {
  const { w } = pen;
  pen.rect(.03,.03,w-.06,FLOOR_Z*.84,0x424a46);
  pen.rect(.1,.06,w-.2,FLOOR_Z*.75,pose.damaged?0x777568:0x9c9f92);
  for (let z=.14;z<FLOOR_Z*.8;z+=.13) pen.rect(.1,z,w-.2,.022,0x59625c);
  pen.rect(w*.44,.19,w*.12,.045,0x333b36);
}

function drawEntrySteps({ pen }: DetailPaint): void {
  // Visual shallow steps intentionally add no collision; existing entrance access stays clear.
  for (let i=0;i<3;i++) pen.box(.1,.04+i*.28,.01,pen.w-.2,.28,.27-i*.08,0x9b998c);
}

/** Porch and fire escape share a railed deck; a porch opens a center gate, a fire escape adds a ladder. */
function drawRailedDeck({ pen, d }: DetailPaint): void {
  const { w } = pen;
  const porch = d.kind === 'porch', depth = porch ? 1.1 : .8, base = porch ? .12 : .08;
  const color = porch ? 0x634c32 : 0x303c35;
  pen.box(.03,.035,.015,w-.06,depth,base,porch ? 0xaa8a64 : 0x747e77);
  for (const u of [.08,w-.14]) pen.box(u,.03,base,.07,depth,.045,color);
  for (let u=.09;u<w-.05;u+=.24) {
    if (porch && u>w*.33 && u<w*.67) continue;
    pen.box(u,depth,base,.04,.04,.58,color);
  }
  if (porch) drawPorchRails(pen, depth, base, color);
  else drawFireEscapeLadder(pen, depth, base, color);
}

function drawPorchRails(pen: DetailPen, depth: number, base: number, color: number): void {
  const { w } = pen;
  pen.box(.06,depth,base+.56,w*.27,.065,.055,color);
  pen.box(w*.67,depth,base+.56,w*.27,.065,.055,color);
  for(const u of [.06,w-.14]) pen.box(u,depth-.03,base,.08,.08,FLOOR_Z*.75,color);
}

function drawFireEscapeLadder(pen: DetailPen, depth: number, base: number, color: number): void {
  const { w } = pen;
  pen.box(.06,depth,base+.56,w-.12,.065,.055,color);
  for(const u of [w-.62,w-.12]) pen.box(u,depth+.08,-FLOOR_Z+.08,.045,.055,FLOOR_Z+.5,color);
  for(let z=-FLOOR_Z+.15;z<.4;z+=.23) pen.box(w-.62,depth+.08,z,.54,.055,.045,color);
}

function drawClockFace({ pen, pose }: DetailPaint): void {
  const { w } = pen;
  const cx = w / 2, cy = FLOOR_Z * .53, r = Math.min(w * .43, FLOOR_Z * .4);
  const circle = (radius: number, color: number) => pen.poly(Array.from({length: 32}, (_, i) => {
    const angle = i / 32 * Math.PI * 2; return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  }), color);
  circle(r, 0x3f443f); circle(r * .87, pose.damaged ? 0xb4b19b : 0xf1e9ce);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    pen.rect(cx + Math.cos(a) * r * .7 - .025, cy + Math.sin(a) * r * .7 - .04, .05, .08, 0x333831);
  }
  pen.poly([[cx-.035,cy],[cx+.035,cy],[cx+.035,cy+r*.62],[cx-.035,cy+r*.62]],0x333831);
  pen.poly([[cx,cy-.035],[cx+r*.48,cy-.035],[cx+r*.48,cy+.035],[cx,cy+.035]],0x333831);
}

const SIGN_TOP = FLOOR_Z * .93;

function drawMarquee({ pen, d }: DetailPaint): void {
  const { w, point } = pen;
  const top = SIGN_TOP, bottom = top - .58, out = .85;
  pen.world([point(0,bottom,.02),point(w,bottom,.02),point(w,bottom,out),point(0,bottom,out)], 0x847c64);
  for (const u of [.08, w-.08]) pen.world([point(u,bottom,.02),point(u,bottom,out),point(u,top-.05,.02)], 0x5b615a);
  pen.rect(0,bottom,w,top-bottom,0x8d4239,out);
  pen.rect(.08,bottom+.09,w-.16,top-bottom-.18,0xe9d7a7,out+.01);
  pen.label(d.text ?? 'STAR',bottom+.15,.28,0x3d3933,out+.02);
  for(let u=.12;u<w;u+=.2) pen.rect(u,bottom+.025,.045,.045,0xffedac,out+.025);
}

function drawSignboard({ pen, d, pose }: DetailPaint): void {
  const { w } = pen;
  const top = SIGN_TOP, bottom = top - .5, out = .08;
  pen.rect(0,bottom,w,top-bottom,0x343f39,out);
  pen.rect(.045,bottom+.04,w-.09,top-bottom-.08,pose.damaged?0x795f46:0x947446,out+.005);
  pen.label(d.text ?? 'SHOP',bottom+.1,.3,0xf3e4ba,out+.01);
}

const PAINTERS: Record<FacadeDetailDef['kind'], (paint: DetailPaint) => void> = {
  signboard: drawSignboard,
  marquee: drawMarquee,
  'clock-face': drawClockFace,
  'roll-up-door': drawRollUpDoor,
  porch: drawRailedDeck,
  'fire-escape': drawRailedDeck,
  'entry-steps': drawEntrySteps,
  'display-glazing': drawDisplayGlazing,
  'roof-duct': drawRoofDuct,
  dormer: drawDormer,
};
