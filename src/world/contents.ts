import type { AssetDef, RenderBox } from "./catalog";
import type { FixtureKind, Material } from "../structure/types";

/** Normalized boxes share the outdoor catalog format. Fixtures scale them to their room slot. */
const wood = [0xbc915e, 0x61442c, 0x987044] as const;
const metal = [0x9ea6a3, 0x414c50, 0x708082] as const;
const white = [0xe4e0d0, 0x8f9692, 0xc4ccc4] as const;
const blue = [0x6b929a, 0x334d58, 0x4e727e] as const;
function box(x: number, y: number, w: number, d: number, z: number, h: number, c: readonly number[] = wood): RenderBox {
  return { along: x + w / 2 - .5, across: y + d / 2 - .5, len: w, wid: d, z, h, top: c[0]!, left: c[1]!, right: c[2]! };
}

const shelving = (levels: number, frame: readonly number[] = metal): RenderBox[] => [
  ...[.02, .9].flatMap(x => [.02, .9].map(y => box(x, y, .08, .08, 0, 1, frame))),
  ...Array.from({ length: levels }, (_, i) => box(0, 0, 1, 1, .08 + i * .8 / levels, .06, frame)),
  ...Array.from({ length: levels }, (_, i) => box(.13, .15, .65, .63, .14 + i * .8 / levels, .12, wood)),
];

interface ContentSpec {
  material: Material;
  hp: number;
  finish: "wood" | "ceramic" | "metal";
  destruction: "brittle" | "crush" | "panel-collapse";
  boxes: RenderBox[];
}

const specs: Record<FixtureKind, ContentSpec> = {
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
  footprint: { w: 1, d: 1, h: 1 }, collision: { w: 1, d: 1 },
  material: spec.material, hp: spec.hp, mass: spec.material === "metal" ? 1.5 : .7,
  resistance: .4, bladeMul: 1, trackHazard: 0, cash: spec.material === "metal" ? 10 : 6,
  destruction: spec.destruction,
  debris: { remnants: spec.destruction === "brittle" ? 0 : 1, fragments: 2, particles: 4, remnantScale: .65, pileMass: .1, shape: spec.destruction === "panel-collapse" ? "panel" : "chunk" },
  variants: 1, boxes: spec.boxes, zones: ["residential", "commercial", "industrial"],
  roadsideOk: false, minClear: .1, sparks: false, birdGag: false,
  explodeRadius: 0, explodeImpulse: 0, explodeDamage: 0, yawResist: 0,
}));

export function contentFinish(kind: FixtureKind): ContentSpec["finish"] { return specs[kind].finish; }
