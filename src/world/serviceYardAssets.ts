import { CAMPAIGN_LEVEL_IDS, type CampaignLevelId } from "../game/campaign";
import type { AssetDef, DebrisRecipe, RenderBox } from "./catalog";

/** Occupancy service-yard props: what stands behind and beside a building because of what it does. */

type Tone = readonly [top: number, left: number, right: number];

const box = (along: number, across: number, z: number, len: number, wid: number, h: number, [top, left, right]: Tone): RenderBox =>
  ({ along, across, z, len, wid, h, top, left, right });
const debris = (remnants: number, fragments: number, particles: number, remnantScale: number, pileMass: number, shape: DebrisRecipe["shape"]): DebrisRecipe =>
  ({ remnants, fragments, particles, remnantScale, pileMass, shape });

const EVERY_LEVEL = Object.fromEntries(CAMPAIGN_LEVEL_IDS.map(id => [id, 1])) as Record<CampaignLevelId, number>;
/** Bottled gas stays out of the dense city levels, like the bulk propane tank. */
const GAS_LEVELS = { county: 1, village: 1, township: 1, suburb: 1 } satisfies Partial<Record<CampaignLevelId, number>>;

const CMU: Tone = [0xb4b0a0, 0x6e6a5e, 0x94907f];
const PAD: Tone = [0xa8a494, 0x66635a, 0x8a8778];
const STEEL: Tone = [0x8b908c, 0x3e4240, 0x6d7270];
const DARK: Tone = [0x3a3a36, 0x1a1a18, 0x2a2a28];
const BIN: Tone = [0x4a8844, 0x244a22, 0x3d6a3a];
const GATE: Tone = [0x8a6a44, 0x4a3420, 0x6e5234];
const ICE_WHITE: Tone = [0xeef2f4, 0x8a9498, 0xc8d0d4];
const ICE_BLUE: Tone = [0x4a8ac8, 0x1e3e62, 0x3470a8];
const CAGE: Tone = [0xc8c4b4, 0x5e5c52, 0x9a9688];
const TANK: Tone = [0xe8e4d4, 0x7a786c, 0xbcb8a8];
const GENSET: Tone = [0x6a7a66, 0x2e3a2c, 0x4e5e4a];
const UTILITY_GREEN: Tone = [0x6a7a38, 0x3a4420, 0x5a6a30];
const SAFETY: Tone = [0xe8c83a, 0x7a6410, 0xc8a828];

const INERT = { trackHazard: 0, roadsideOk: false, birdGag: false, explodeRadius: 0, explodeImpulse: 0, explodeDamage: 0 } as const;

/** Chain-link screen: four posts and a top rail around a `len` by `wid` pad. */
function fence(len: number, wid: number, h: number): RenderBox[] {
  const x = len / 2 - 0.04, y = wid / 2 - 0.04;
  return [
    ...[[-x, -y], [x, -y], [-x, y], [x, y]].map(([along, across]) => box(along!, across!, 0, 0.06, 0.06, h, STEEL)),
    box(0, -y, h - 0.06, len, 0.04, 0.04, STEEL),
    box(-x, 0, h - 0.06, 0.04, wid, 0.04, STEEL),
    box(x, 0, h - 0.06, 0.04, wid, 0.04, STEEL),
  ];
}

export const SERVICE_YARD_ASSETS: readonly AssetDef[] = [
  {
    ...INERT, id: "dumpster-corral", family: "commercial", tags: ["commercial", "utility"],
    footprint: { w: 1.5, d: 1.15, h: 1.05 }, collision: { w: 1.5, d: 1.15 },
    material: "concrete", hp: 46, mass: 4.6, resistance: 1.05, bladeMul: 0.8, cash: 30,
    destruction: "panel-collapse", debris: debris(2, 4, 12, 0.7, 1.1, "panel"), variants: 1,
    boxes: [
      box(0, -0.52, 0, 1.5, 0.11, 1.05, CMU),
      box(-0.7, 0, 0, 0.11, 1.0, 1.05, CMU),
      box(0.7, 0, 0, 0.11, 1.0, 1.05, CMU),
      box(0, -0.08, 0, 0.92, 0.66, 0.7, BIN),
      box(0, -0.08, 0.7, 0.96, 0.7, 0.05, DARK),
      box(-0.34, 0.53, 0.06, 0.62, 0.05, 0.9, GATE),
      box(0.34, 0.53, 0.06, 0.62, 0.05, 0.9, GATE),
    ],
    zones: ["commercial", "industrial", "yard"], minClear: 0.3, sparks: false, yawResist: 0.7,
    campaign: { levels: EVERY_LEVEL },
  },
  {
    ...INERT, id: "grease-trap", family: "commercial", tags: ["commercial", "utility"],
    footprint: { w: 0.8, d: 0.6, h: 0.12 }, collision: { w: 0.8, d: 0.6 },
    material: "metal", hp: 9, mass: 0.7, resistance: 0.12, bladeMul: 1.1, cash: 6,
    destruction: "crush", debris: debris(0, 2, 5, 0.4, 0.12, "panel"), variants: 1,
    boxes: [
      box(0, 0, 0, 0.8, 0.6, 0.06, PAD),
      box(-0.17, 0, 0.06, 0.3, 0.44, 0.04, STEEL),
      box(0.17, 0, 0.06, 0.3, 0.44, 0.04, STEEL),
      box(0, 0, 0.1, 0.05, 0.3, 0.02, DARK),
    ],
    zones: ["commercial", "yard"], minClear: 0.1, sparks: false, yawResist: 0.6,
    campaign: { levels: EVERY_LEVEL },
  },
  {
    ...INERT, id: "ice-merchandiser", family: "commercial", tags: ["commercial"],
    footprint: { w: 1.1, d: 0.6, h: 1.05 }, collision: { w: 1.1, d: 0.6 },
    material: "metal", hp: 19, mass: 1.9, resistance: 0.55, bladeMul: 0.95, cash: 18,
    destruction: "crush", debris: debris(1, 2, 8, 0.65, 0.4, "panel"), variants: 1,
    boxes: [
      box(0, 0, 0, 1.1, 0.6, 0.1, DARK),
      box(0, 0, 0.1, 1.1, 0.6, 0.7, ICE_WHITE),
      box(0, 0.02, 0.5, 1.12, 0.6, 0.18, ICE_BLUE),
      box(0, -0.08, 0.8, 1.1, 0.44, 0.25, ICE_WHITE),
      box(-0.27, 0.22, 0.8, 0.5, 0.05, 0.2, STEEL),
      box(0.27, 0.22, 0.8, 0.5, 0.05, 0.2, STEEL),
    ],
    zones: ["commercial", "frontage", "yard"], minClear: 0.2, sparks: true, yawResist: 0.3,
    campaign: { levels: EVERY_LEVEL },
  },
  {
    id: "propane-exchange-cage", family: "commercial", tags: ["commercial", "explosive"],
    footprint: { w: 1.0, d: 0.5, h: 1.15 }, collision: { w: 1.0, d: 0.5 },
    material: "metal", hp: 20, mass: 1.7, resistance: 0.5, bladeMul: 1, trackHazard: 0, cash: 30,
    destruction: "explosive", debris: debris(1, 3, 10, 0.5, 0.35, "panel"), variants: 1,
    boxes: [
      box(0, 0, 0, 1.0, 0.5, 0.06, DARK),
      ...[0.08, 0.6].flatMap(z => [-0.3, 0, 0.3].map(along => box(along, 0, z, 0.22, 0.26, 0.4, TANK))),
      box(0, 0, 0.52, 1.0, 0.5, 0.05, CAGE),
      ...[-0.47, 0.47].flatMap(along => [-0.22, 0.22].map(across => box(along, across, 0, 0.05, 0.05, 1.1, CAGE))),
      box(0, 0, 1.08, 1.0, 0.5, 0.06, CAGE),
    ],
    zones: ["commercial", "frontage", "yard"], roadsideOk: false, minClear: 0.35, sparks: false, birdGag: false,
    // One cage is a smaller charge than the bulk tank: it rattles its neighbours rather than levelling them.
    explodeRadius: 3, explodeImpulse: 5, explodeDamage: 20, yawResist: 0.2,
    campaign: { levels: GAS_LEVELS },
  },
  {
    ...INERT, id: "backup-generator", family: "commercial", tags: ["commercial", "utility"],
    footprint: { w: 1.7, d: 1.1, h: 1.3 }, collision: { w: 1.7, d: 1.1 },
    material: "metal", hp: 46, mass: 5.2, resistance: 1.1, bladeMul: 0.8, cash: 64,
    destruction: "crush", debris: debris(2, 4, 12, 0.75, 1, "panel"), variants: 1,
    boxes: [
      box(0, 0, 0, 1.7, 1.1, 0.07, PAD),
      box(-0.08, 0, 0.07, 1.2, 0.62, 0.22, DARK),
      box(-0.08, 0, 0.29, 1.12, 0.58, 0.56, GENSET),
      box(0.2, 0, 0.85, 0.5, 0.4, 0.08, STEEL),
      box(-0.5, 0.12, 0.85, 0.09, 0.09, 0.42, STEEL),
      ...fence(1.7, 1.1, 1.05),
    ],
    zones: ["commercial", "industrial", "utility", "yard"], minClear: 0.35, sparks: true, yawResist: 0.8,
    salvage: "mechanical", campaign: { levels: EVERY_LEVEL },
  },
  {
    ...INERT, id: "transformer-pad", family: "commercial", tags: ["commercial", "utility"],
    footprint: { w: 1.05, d: 0.95, h: 0.95 }, collision: { w: 1.05, d: 0.95 },
    material: "metal", hp: 28, mass: 3.2, resistance: 0.9, bladeMul: 0.9, cash: 46,
    destruction: "brittle", debris: debris(1, 3, 10, 0.6, 0.6, "chunk"), variants: 1,
    boxes: [
      box(0, 0, 0, 1.05, 0.95, 0.08, PAD),
      box(0, -0.06, 0.08, 0.72, 0.6, 0.72, UTILITY_GREEN),
      box(0, 0.26, 0.14, 0.6, 0.04, 0.5, DARK),
      box(0, -0.06, 0.8, 0.76, 0.64, 0.05, UTILITY_GREEN),
      ...[-0.44, 0.44].map(along => box(along, 0.4, 0, 0.09, 0.09, 0.7, SAFETY)),
    ],
    zones: ["commercial", "industrial", "utility", "yard"], minClear: 0.3, sparks: true, yawResist: 0.6,
    salvage: "copper", campaign: { levels: EVERY_LEVEL },
  },
  {
    ...INERT, id: "bollard", family: "commercial", tags: ["commercial", "utility"],
    footprint: { w: 0.24, d: 0.24, h: 0.95 }, collision: { w: 0.24, d: 0.24 },
    material: "metal", hp: 14, mass: 0.7, resistance: 0.5, bladeMul: 1, cash: 5,
    destruction: "bend-snap", debris: debris(1, 0, 3, 0.5, 0.08, "beam"), variants: 1,
    boxes: [
      box(0, 0, 0, 0.18, 0.18, 0.9, SAFETY),
      box(0, 0, 0.9, 0.2, 0.2, 0.05, DARK),
    ],
    zones: ["commercial", "industrial", "frontage", "yard"], minClear: 0.1, sparks: false, yawResist: 0.3,
    campaign: { levels: EVERY_LEVEL },
  },
];
