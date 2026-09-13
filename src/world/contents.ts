import type { AssetDef, RenderBox } from "./catalog";
import type { FixtureKind, Material } from "../structure/types";

/** Normalized boxes share the outdoor catalog format. Fixtures scale them to their room slot. */
const wood = [0xbc915e, 0x61442c, 0x987044] as const;
const metal = [0x9ea6a3, 0x414c50, 0x708082] as const;
const white = [0xe4e0d0, 0x8f9692, 0xc4ccc4] as const;
const blue = [0x6b929a, 0x334d58, 0x4e727e] as const;
const red = [0xb76c52, 0x60342c, 0x914534] as const;
const dark = [0x33444c, 0x17232a, 0x29353e] as const;
const leaf = [0x729653, 0x33492a, 0x4b7138] as const;
function box(x: number, y: number, w: number, d: number, z: number, h: number, c: readonly number[] = wood): RenderBox {
  return { along: x + w / 2 - .5, across: y + d / 2 - .5, len: w, wid: d, z, h, top: c[0]!, left: c[1]!, right: c[2]! };
}

const shelving = (levels: number, frame: readonly number[] = metal): RenderBox[] => [
  ...[.02, .9].flatMap(x => [.02, .9].map(y => box(x, y, .08, .08, 0, 1, frame))),
  ...Array.from({ length: levels }, (_, i) => box(0, 0, 1, 1, .08 + i * .8 / levels, .06, frame)),
  ...Array.from({ length: levels }, (_, i) => box(.13, .15, .65, .63, .14 + i * .8 / levels, .12, wood)),
];

interface ContentSpec {
  size?: { w:number; d:number; h:number };
  material: Material;
  hp: number;
  finish: "wood" | "ceramic" | "metal";
  destruction: "brittle" | "crush" | "panel-collapse";
  boxes: RenderBox[];
}

const specs: Record<FixtureKind, ContentSpec> = {
  'vehicle-ramp': {size:{w:2.3,d:6.9,h:2.35},material:'concrete',hp:55,finish:'ceramic',destruction:'brittle',boxes:[{...box(0,0,1,1,0,1,white),slope:true}]},
  'staircase': {size:{w:1,d:3.3,h:2.35},material:'wood',hp:28,finish:'wood',destruction:'panel-collapse',boxes:
    Array.from({length:12},(_,i)=>box(0,i/12,1,1/12,0,(12-i)/12,wood))},
  'theater-screen':{size:{w:4,d:.35,h:3.2},material:'wood',hp:20,finish:'wood',destruction:'panel-collapse',boxes:[
    box(0,.1,1,.4,0,1,red),box(.08,.52,.84,.2,.16,.75,dark),box(.12,.74,.76,.06,.2,.67,white),
    box(.05,.04,.05,.9,0,.06,metal),box(.9,.04,.05,.9,0,.06,metal),
  ]},
  'printing-press': {size:{w:3.4,d:1.5,h:1.4},material:'metal',hp:45,finish:'metal',destruction:'crush',boxes:[
    box(0,.08,1,.84,0,.16,metal),box(.02,.16,.16,.68,.16,.42,white),
    ...[.19,.36,.53,.7].flatMap((x,i)=>[
      box(x,.07,.13,.86,.16,.65,blue),box(x+.02,.15,.09,.7,.81,.09,[dark,red,blue,white][i]!),
      box(x+.13,.15,.035,.7,.53,.08,dark),
    ]),
    box(.87,.14,.12,.72,.16,.34,white),box(.85,.87,.13,.1,.3,.47,metal),
    box(.87,.975,.09,.025,.59,.14,dark),
    ...[.2,.27,.34,.41,.48].map(z=>box(.025,.16,.145,.68,z,.018,white)),
  ]},
  'dairy-vat': {size:{w:1.7,d:1.7,h:1.8},material:'metal',hp:40,finish:'metal',destruction:'crush',boxes:[
    ...[.16,.73].flatMap(x=>[.16,.73].map(y=>box(x,y,.09,.09,0,.25,metal))),
    box(.14,.05,.72,.9,.25,.55,metal),box(.05,.14,.9,.72,.25,.55,metal),
    box(.13,.13,.74,.74,.8,.08,white),box(.34,.34,.32,.32,.88,.055,metal),
    box(.48,.42,.08,.16,.93,.07,dark),
    box(.45,.85,.1,.13,.28,.08,metal),box(.42,.96,.16,.04,.26,.13,red),
    box(.86,.35,.1,.26,.57,.15,blue),box(.97,.4,.03,.16,.6,.08,white),
  ]},
  'bottling-line': {size:{w:3.8,d:.9,h:1.2},material:'metal',hp:36,finish:'metal',destruction:'panel-collapse',boxes:[
    ...[.06,.86].flatMap(x=>[.08,.8].map(y=>box(x,y,.06,.09,0,.45,metal))),
    box(0,.06,1,.88,.45,.08,metal),box(.02,.2,.96,.6,.53,.04,dark),
    box(.34,.06,.3,.09,.53,.4,blue),box(.34,.85,.3,.09,.53,.4,blue),box(.34,.06,.3,.88,.93,.07,blue),
    ...Array.from({length:8},(_,i)=>[box(.045+i*.12,.38,.055,.22,.57,.24,white),box(.057+i*.12,.42,.03,.14,.81,.05,blue)]).flat(),
  ]},
  pinsetter:{size:{w:1.3,d:.5,h:1.3},material:'metal',hp:35,finish:'metal',destruction:'crush',boxes:[
    box(0,0,1,1,.55,.4,blue), box(.02,.05,.06,.9,0,.65,metal), box(.92,.05,.06,.9,0,.65,metal),
    box(.12,.85,.76,.1,.7,.12,dark),
  ]},
  'bowling-pins':{size:{w:1.3,d:1.1,h:.58},material:'wood',hp:4,finish:'wood',destruction:'brittle',boxes:[
    ...Array.from({length:4},(_,row)=>Array.from({length:row+1},(_,col)=>{
      const x=.46+(col-row/2)*.21,y=.82-row*.23;
      return [box(x,y,.085,.1,0,.55,white),box(x+.02,y+.02,.045,.06,.55,.23,red),box(x+.01,y+.01,.065,.08,.78,.15,white)];
    }).flat()).flat(),
  ]},
  'diner-booth': { material: 'wood', hp: 18, finish: 'wood', destruction: 'crush', boxes: [
    box(0, 0, .25, 1, 0, .55, red), box(0, 0, .09, 1, .45, .55, red),
    box(.75, 0, .25, 1, 0, .55, red), box(.91, 0, .09, 1, .45, .55, red),
    box(.46, .35, .08, .3, 0, .66, metal), box(.3, .06, .4, .88, .66, .08, white),
  ] },
  'washer-dryer': { material: 'metal', hp: 28, finish: 'metal', destruction: 'crush', boxes: [
    ...[0, .52].flatMap(x => [box(x, 0, .48, .95, 0, 1, white), box(x + .07, .94, .34, .04, .15, .52, dark), box(x + .12, .98, .24, .02, .23, .35, blue), box(x + .05, .94, .38, .04, .83, .1, metal)]),
  ] },
  'commercial-oven': { material: 'metal', hp: 36, finish: 'metal', destruction: 'crush', boxes: [
    box(.05, .05, .9, .85, 0, .9, metal), box(.13, .89, .74, .06, .15, .5, dark),
    box(.2, .96, .6, .04, .62, .04, white), box(0, 0, 1, .95, .9, .05, dark),
    ...[.17, .6].flatMap(x => [box(x, .14, .22, .22, .95, .04, metal), box(x, .57, .22, .22, .95, .04, metal)]),
  ] },
  'office-desk': { material: 'wood', hp: 16, finish: 'wood', destruction: 'panel-collapse', boxes: [
    box(.03, .03, .23, .85, 0, .64), box(.83, .08, .08, .7, 0, .64, metal), box(0, 0, 1, .95, .64, .08),
    box(.48, .12, .3, .08, .72, .28, dark), box(.52, .34, .27, .16, .72, .02, white),
    box(.04, .88, .21, .03, .12, .04, metal), box(.04, .88, .21, .03, .38, .04, metal),
  ] },
  'filing-cabinet': { material: 'metal', hp: 25, finish: 'metal', destruction: 'crush', boxes: [
    box(0, 0, 1, .94, 0, 1, metal),
    ...[.05, .29, .53, .77].flatMap(z => [box(.05, .94, .9, .04, z, .2, blue), box(.34, .98, .32, .02, z + .08, .04, white)]),
  ] },
  'checkout-register': { material: 'wood', hp: 18, finish: 'wood', destruction: 'panel-collapse', boxes: [
    box(0, 0, 1, 1, 0, .62), box(0, 0, 1, 1, .62, .08, white), box(.05, .1, .45, .8, .7, .03, dark),
    box(.65, .15, .27, .35, .7, .12, metal), box(.64, .16, .29, .08, .82, .18, dark),
  ] },
  'theater-seats': { material: 'wood', hp: 17, finish: 'wood', destruction: 'crush', boxes: [
    ...[.02, .35, .68].flatMap(x => [box(x, .25, .29, .6, .18, .28, red), box(x, .05, .29, .2, .18, .8, red), box(x + .09, .25, .1, .5, 0, .18, metal)]),
  ] },
  'repair-lift': { material: 'metal', hp: 45, finish: 'metal', destruction: 'panel-collapse', boxes: [
    box(.02, .05, .12, .9, 0, .1, metal), box(.86, .05, .12, .9, 0, .1, metal),
    box(.03, .38, .1, .2, .1, .9, blue), box(.87, .38, .1, .2, .1, .9, blue),
    box(.12, .1, .15, .8, .25, .07, red), box(.73, .1, .15, .8, .25, .07, red),
  ] },
  'display-fridge': { material: 'metal', hp: 30, finish: 'metal', destruction: 'crush', boxes: [
    box(0, 0, 1, 1, 0, .17, metal), box(0, 0, 1, .15, .17, .83, white),
    box(0, .15, .07, .85, .17, .83, white), box(.93, .15, .07, .85, .17, .83, white),
    box(.07, .95, .86, .05, .17, .75, blue), box(0, 0, 1, 1, .92, .08, white),
    ...[.3, .6].map(z => box(.08, .15, .84, .78, z, .04, metal)),
  ] },
  'school-desks': { material: 'wood', hp: 14, finish: 'wood', destruction: 'panel-collapse', boxes: [
    ...[.02, .54].flatMap(x => [box(x, .05, .43, .48, .58, .07), box(x + .03, .1, .06, .38, 0, .58, metal), box(x + .34, .1, .06, .38, 0, .58, metal), box(x + .07, .64, .29, .3, .32, .06, blue), box(x + .07, .9, .29, .06, .32, .45, blue)]),
  ] },
  'examination-table': { material: 'metal', hp: 23, finish: 'metal', destruction: 'crush', boxes: [
    box(.16, .08, .68, .82, 0, .48, white), box(.05, .03, .9, .93, .48, .16, blue),
    box(.05, .03, .9, .22, .64, .16, blue), box(.25, .94, .5, .06, .2, .05, metal),
  ] },
  'nursery-bench': { material: 'wood', hp: 12, finish: 'wood', destruction: 'crush', boxes: [
    ...[.06, .86].flatMap(x => [.08, .82].map(y => box(x, y, .08, .08, 0, .56))),
    box(0, 0, 1, 1, .56, .07),
    ...[.1, .4, .7].flatMap(x => [.15, .6].flatMap(y => [box(x, y, .18, .2, .63, .13, red), box(x + .03, y + .03, .12, .14, .76, .24, leaf)])),
  ] },
  partition: { material: "wood", hp: 12, finish: "wood", destruction: "panel-collapse", boxes: [box(0, 0, 1, 1, 0, 1, white)] },
  cabinet: { material: "wood", hp: 10, finish: "wood", destruction: "panel-collapse", boxes: [box(0, 0, 1, 1, 0, 1), box(.12, .15, .76, .2, .12, .7)] },
  counter: { material: "wood", hp: 14, finish: "wood", destruction: "panel-collapse", boxes: [box(0, 0, 1, 1, 0, .72), box(0, 0, 1, 1, .72, .28, white)] },
  toilet: { material: "concrete", hp: 8, finish: "ceramic", destruction: "brittle", boxes: [box(.12, 0, .76, .38, .28, .7, white), box(.08, .28, .84, .7, 0, .42, white)] },
  sofa: { material: "wood", hp: 12, finish: "wood", destruction: "crush", boxes: [box(0, 0, 1, 1, 0, .45, blue), box(0, 0, 1, .32, .4, .58, blue), box(.06, .36, .4, .5, .42, .22, blue), box(.52, .36, .4, .5, .42, .22, blue)] },
  table: { material: "wood", hp: 8, finish: "wood", destruction: "panel-collapse", boxes: [...[.08, .74].flatMap(x => [.08, .74].map(y => box(x, y, .18, .18, 0, .76))), box(0, 0, 1, 1, .76, .24)] },
  radiator: { material: "metal", hp: 16, finish: "metal", destruction: "crush", boxes: [box(0, 0, 1, 1, 0, .9, metal), ...[.08, .38, .68].map(x => box(x, 0, .18, 1, .1, .9, white))] },
  shelf: { material: "wood", hp: 14, finish: "wood", destruction: "panel-collapse", boxes: shelving(3, wood) },
  rack: { material: "metal", hp: 26, finish: "metal", destruction: "panel-collapse", boxes: shelving(3) },
  pallet: { material: "wood", hp: 10, finish: "wood", destruction: "crush", boxes: [box(0, 0, 1, 1, 0, .18), box(.05, .1, .42, .8, .18, .7), box(.52, .1, .42, .8, .18, .55)] },
  fridge: { material: "metal", hp: 24, finish: "metal", destruction: "crush", boxes: [box(0, 0, 1, 1, 0, 1, white), box(.08, .92, .84, .08, .12, .76, blue)] },
  bed: { material: "wood", hp: 12, finish: "wood", destruction: "crush", boxes: [box(0, 0, 1, 1, 0, .3), box(.02, .02, .96, .96, .3, .4, blue), box(.08, .05, .8, .22, .7, .18, white)] },
  machine: { material: "metal", hp: 38, finish: "metal", destruction: "crush", boxes: [box(0, 0, 1, 1, 0, .2, metal), box(.1, .1, .65, .7, .2, .65, blue), box(.68, .25, .25, .45, .3, .7, metal), box(.7, .74, .2, .06, .6, .25, white)] },
};

export const CONTENT_ASSETS: readonly AssetDef[] = Object.entries(specs).map(([kind, spec]) => ({
  id: `interior-${kind}`, family: "residential", tags: ["residential", "commercial"],
  footprint: spec.size ?? { w: 1, d: 1, h: 1 }, collision: { w: spec.size?.w ?? 1, d: spec.size?.d ?? 1 },
  material: spec.material, hp: spec.hp, mass: spec.material === "metal" ? 1.5 : .7,
  resistance: .4, bladeMul: 1, trackHazard: 0, cash: spec.material === "metal" ? 10 : 6,
  destruction: spec.destruction,
  debris: { remnants: spec.destruction === "brittle" ? 0 : 1, fragments: 2, particles: 4, remnantScale: .65, pileMass: .1, shape: spec.destruction === "panel-collapse" ? "panel" : "chunk" },
  variants: 1, boxes: spec.boxes.map(b=>({...b,along:b.along*(spec.size?.w??1),across:b.across*(spec.size?.d??1),
    len:b.len*(spec.size?.w??1),wid:b.wid*(spec.size?.d??1),z:b.z*(spec.size?.h??1),h:b.h*(spec.size?.h??1)})), zones: ["residential", "commercial", "industrial"],
  roadsideOk: false, minClear: .1, sparks: false, birdGag: false,
  explodeRadius: 0, explodeImpulse: 0, explodeDamage: 0, yawResist: 0,
}));

export function contentFinish(kind: FixtureKind): ContentSpec["finish"] { return specs[kind].finish; }
