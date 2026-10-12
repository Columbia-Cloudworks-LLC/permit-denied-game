import { aabbOverlap, pointInPoly } from "../game/math";
import { Rng } from "../game/rng";
import type { CoverKind, GroundPatch, Lot, LotIdentity, Prop } from "../structure/types";
import type { Building } from "../structure/types";
import { getAsset, spawnAsset, type LotCompat } from "./catalog";
import { drivewayStyle } from "./drivewayStyle";

export interface DressSlot {
  assetId: string;
  along: number;
  across: number;
  headingBias: number;
  weight: number;
}

export interface DressTemplate {
  id: string;
  identities: readonly LotIdentity[];
  zones: readonly LotCompat[];
  cover: CoverKind;
  maxAssets: number;
  slots: readonly DressSlot[];
}

export const DRESS_TEMPLATES: readonly DressTemplate[] = [
  {
    id: "rural-residence",
    identities: ["residence"],
    zones: ["residential", "yard"],
    cover: "grass",
    maxAssets: 6,
    slots: [
      { assetId: "mailbox", along: 0.16, across: 0.18, headingBias: 0, weight: 1 },
      { assetId: "trash-can", along: 0.22, across: -0.32, headingBias: 0.2, weight: 0.9 },
      { assetId: "shrub", along: 0.18, across: 0.36, headingBias: 0, weight: 0.85 },
      { assetId: "sapling", along: 0.72, across: 0.34, headingBias: 0, weight: 0.55 },
      { assetId: "picnic-table", along: 0.62, across: -0.28, headingBias: 0.4, weight: 0.4 },
      { assetId: "doghouse", along: 0.78, across: -0.3, headingBias: 0.1, weight: 0.35 },
    ],
  },
  {
    id: "family-yard",
    identities: ["residence"],
    zones: ["residential", "yard"],
    cover: "grass",
    maxAssets: 7,
    slots: [
      { assetId: "mailbox", along: 0.16, across: -0.2, headingBias: 0, weight: 1 },
      { assetId: "swing-set", along: 0.7, across: 0.28, headingBias: 0.15, weight: 0.8 },
      { assetId: "clothesline", along: 0.68, across: -0.32, headingBias: 1.2, weight: 0.7 },
      { assetId: "woodpile", along: 0.42, across: -0.36, headingBias: 0.1, weight: 0.55 },
      { assetId: "picnic-table", along: 0.48, across: 0.3, headingBias: 0.3, weight: 0.5 },
      { assetId: "shrub", along: 0.2, across: 0.34, headingBias: 0, weight: 0.7 },
      { assetId: "trash-can", along: 0.24, across: -0.28, headingBias: 0, weight: 0.6 },
    ],
  },
  {
    id: "farmstead",
    identities: ["farm"],
    zones: ["agricultural"],
    cover: "dirt",
    maxAssets: 10,
    slots: [
      { assetId: "hay-bale-round", along: 0.72, across: 0.32, headingBias: 0.2, weight: 1 },
      { assetId: "hay-bale-square", along: 0.58, across: 0.34, headingBias: 0.1, weight: 0.85 },
      { assetId: "water-trough", along: 0.4, across: -0.34, headingBias: 0.2, weight: 0.7 },
      { assetId: "farm-implement", along: 0.78, across: -0.28, headingBias: 0.6, weight: 0.45 },
      { assetId: "tractor", along: 0.28, across: 0.3, headingBias: 0.15, weight: 0.35 },
      { assetId: "grain-bin", along: 0.82, across: 0.02, headingBias: 0, weight: 0.3 },
      { assetId: "woodpile", along: 0.2, across: -0.32, headingBias: 0, weight: 0.5 },
      { assetId: "shrub", along: 0.12, across: 0.36, headingBias: 0, weight: 0.4 },
      { assetId: "shed", along: 0.86, across: -0.26, headingBias: 0.1, weight: 0.42 },
      { assetId: "propane-tank", along: 0.34, across: 0.36, headingBias: 0.2, weight: 0.32 },
      { assetId: "fence", along: 0.5, across: 0.4, headingBias: 0, weight: 0.38 },
    ],
  },
  {
    id: "roadside-service",
    identities: ["service"],
    zones: ["commercial", "frontage"],
    cover: "concrete",
    maxAssets: 9,
    slots: [
      { assetId: "fuel-pump", along: 0.18, across: 0.28, headingBias: 0, weight: 1 },
      { assetId: "fuel-pump", along: 0.18, across: -0.28, headingBias: 0, weight: 0.7 },
      { assetId: "vending", along: 0.42, across: -0.34, headingBias: 0.1, weight: 0.65 },
      { assetId: "traffic-barrel", along: 0.14, across: 0.38, headingBias: 0, weight: 0.7 },
      { assetId: "propane-tank", along: 0.78, across: -0.3, headingBias: 0.2, weight: 0.55 },
      { assetId: "pallet-stack", along: 0.7, across: 0.3, headingBias: 0.1, weight: 0.72 },
      { assetId: "dumpster", along: 0.78, across: 0.28, headingBias: 0.15, weight: 0.82 },
      { assetId: "traffic-barrel", along: 0.48, across: 0.32, headingBias: 0.05, weight: 0.7 },
      { assetId: "trash-can", along: 0.32, across: -0.38, headingBias: 0, weight: 0.62 },
    ],
  },
  {
    id: "contractor-yard",
    identities: ["contractor"],
    zones: ["industrial", "yard"],
    cover: "gravel",
    maxAssets: 11,
    slots: [
      { assetId: "pallet-stack", along: 0.22, across: 0.32, headingBias: 0.1, weight: 1 },
      { assetId: "crate-stack", along: 0.4, across: 0.3, headingBias: 0.15, weight: 0.8 },
      { assetId: "shed", along: 0.75, across: -0.22, headingBias: 0, weight: 0.55 },
      { assetId: "hvac", along: 0.28, across: -0.34, headingBias: 0, weight: 0.5 },
      { assetId: "woodpile", along: 0.58, across: 0.32, headingBias: 0, weight: 0.7 },
      { assetId: "utility-cabinet", along: 0.12, across: -0.3, headingBias: 0, weight: 0.65 },
      { assetId: "dumpster", along: 0.78, across: 0.26, headingBias: 0.1, weight: 0.88 },
      { assetId: "crate-stack", along: 0.5, across: -0.28, headingBias: 0.2, weight: 0.74 },
      { assetId: "barricade", along: 0.16, across: 0.34, headingBias: 0.1, weight: 0.78 },
      { assetId: "fence", along: 0.68, across: 0.36, headingBias: 0, weight: 0.62 },
      { assetId: "pallet-stack", along: 0.34, across: -0.3, headingBias: 0.2, weight: 0.8 },
    ],
  },
  {
    id: "utility-lot",
    identities: ["utility"],
    zones: ["industrial", "utility"],
    cover: "gravel",
    maxAssets: 10,
    slots: [
      { assetId: "utility-cabinet", along: 0.22, across: 0.3, headingBias: 0, weight: 1 },
      { assetId: "transformer", along: 0.4, across: -0.28, headingBias: 0.1, weight: 0.85 },
      { assetId: "power-pole", along: 0.12, across: -0.36, headingBias: 0, weight: 0.6 },
      { assetId: "fire-hydrant", along: 0.1, across: 0.22, headingBias: 0, weight: 0.5 },
      { assetId: "hvac", along: 0.7, across: 0.28, headingBias: 0, weight: 0.68 },
      { assetId: "dumpster", along: 0.78, across: -0.26, headingBias: 0.15, weight: 0.84 },
      { assetId: "barricade", along: 0.18, across: 0.34, headingBias: 0, weight: 0.72 },
      { assetId: "propane-tank", along: 0.58, across: 0.3, headingBias: 0.2, weight: 0.66 },
      { assetId: "crate-stack", along: 0.48, across: -0.3, headingBias: 0.1, weight: 0.7 },
      { assetId: "utility-cabinet", along: 0.74, across: -0.28, headingBias: 0, weight: 0.76 },
    ],
  },
  {
    id: "small-commercial",
    identities: ["shop"],
    zones: ["commercial", "frontage"],
    cover: "parking",
    maxAssets: 10,
    slots: [
      { assetId: "vending", along: 0.22, across: -0.32, headingBias: 0, weight: 0.8 },
      { assetId: "fire-hydrant", along: 0.1, across: 0.28, headingBias: 0, weight: 0.7 },
      { assetId: "pallet-stack", along: 0.72, across: 0.3, headingBias: 0.1, weight: 0.76 },
      { assetId: "stop-sign", along: 0.12, across: -0.2, headingBias: 0, weight: 0.62 },
      { assetId: "trash-can", along: 0.3, across: 0.32, headingBias: 0, weight: 0.72 },
      { assetId: "hvac", along: 0.76, across: -0.28, headingBias: 0, weight: 0.64 },
      { assetId: "dumpster", along: 0.78, across: 0.24, headingBias: 0.1, weight: 0.82 },
      { assetId: "traffic-barrel", along: 0.46, across: 0.3, headingBias: 0.05, weight: 0.7 },
      { assetId: "barricade", along: 0.18, across: 0.34, headingBias: 0, weight: 0.58 },
      { assetId: "crate-stack", along: 0.62, across: -0.28, headingBias: 0.15, weight: 0.68 },
    ],
  },
];

export type DressEligible = (assetId: string) => boolean;

function templatesFor(identity: LotIdentity): DressTemplate[] {
  return DRESS_TEMPLATES.filter((t) => t.identities.includes(identity));
}

function slotEligible(slot: DressSlot, eligible?: DressEligible): boolean {
  return !eligible || eligible(slot.assetId);
}

function templateHasEligibleSlot(template: DressTemplate, eligible?: DressEligible): boolean {
  return template.slots.some((slot) => slotEligible(slot, eligible));
}

export function pickTemplate(identity: LotIdentity, rng: Rng, eligible?: DressEligible): DressTemplate {
  const matching = templatesFor(identity);
  const pool = matching.filter((template) => templateHasEligibleSlot(template, eligible));
  if (pool.length) return rng.pick(pool);
  return matching[0] ?? DRESS_TEMPLATES[0]!;
}

export interface Occupancy {
  boxes: { x: number; y: number; w: number; d: number }[];
}

/** Heading-aligned depth (along) and frontage (across). Axis-aligned AABBs used lot.w for both. */
function lotAxisSizes(lot: Lot): { along: number; across: number } {
  const c = Math.abs(Math.cos(lot.heading));
  const s = Math.abs(Math.sin(lot.heading));
  return { along: c * lot.w + s * lot.d, across: s * lot.w + c * lot.d };
}

/** Lot frontage axis (fx, fy), depth axis (rx, ry), and centre. */
function lotFrame(lot: Lot): { fx: number; fy: number; rx: number; ry: number; cx: number; cy: number } {
  const fx = Math.cos(lot.heading);
  const fy = Math.sin(lot.heading);
  return { fx, fy, rx: -fy, ry: fx, cx: lot.x + lot.w * 0.5, cy: lot.y + lot.d * 0.5 };
}

export function lotLocalToWorld(
  lot: Lot,
  along: number,
  across: number,
): { x: number; y: number } {
  const { fx, fy, rx, ry, cx, cy } = lotFrame(lot);
  const size = lotAxisSizes(lot);
  const ox = (along - 0.5) * size.along;
  const oy = across * size.across * 0.38;
  return { x: cx + fx * ox + rx * oy, y: cy + fy * ox + ry * oy };
}

function placeSlot(
  lot: Lot,
  building: Building | undefined,
  w: number,
  d: number,
  along: number,
  across: number,
  occ: Occupancy,
  extras: { x: number; y: number; w: number; d: number }[],
  driveW: number,
  corridors: readonly { x: number; y: number }[][] = [],
): { x: number; y: number } | null {
  const tries = [
    { along, across },
    { along: along * 0.55 + 0.45, across: across * 0.55 },
    { along: 0.55, across: across >= 0 ? 0.28 : -0.28 },
  ];
  for (const tryAt of tries) {
    const p = lotLocalToWorld(lot, tryAt.along, tryAt.across);
    const x = p.x - w * 0.5;
    const y = p.y - d * 0.5;
    if (!insideLotYard(lot, x, y, w, d)) continue;
    if (blocked(x, y, w, d, occ, extras)) continue;
    if (corridors.some((poly) => pointInPoly(x + w * 0.5, y + d * 0.5, narrowCorridor(poly, 0.28)))) continue;
    if (building && sealsAccess(lot, building, [...extras, { x, y, w, d }], driveW)) continue;
    return { x, y };
  }
  return null;
}

function insideLotYard(lot: Lot, x: number, y: number, w: number, d: number): boolean {
  if (lot.boundary && lot.boundary.length >= 3) {
    if (pointInPoly(x + w * 0.5, y + d * 0.5, lot.boundary)) return true;
  }
  const size = lotAxisSizes(lot);
  const { fx, fy, rx, ry, cx, cy } = lotFrame(lot);
  const px = x + w * 0.5 - cx;
  const py = y + d * 0.5 - cy;
  const along = px * fx + py * fy;
  const across = px * rx + py * ry;
  const pad = 0.28;
  return Math.abs(along) <= size.along * 0.5 - pad && Math.abs(across) <= size.across * 0.5 - pad;
}

function blocked(
  x: number,
  y: number,
  w: number,
  d: number,
  occ: Occupancy,
  extras: { x: number; y: number; w: number; d: number }[],
): boolean {
  for (const b of occ.boxes) {
    if (aabbOverlap(x, y, w, d, b.x, b.y, b.w, b.d)) return true;
  }
  for (const b of extras) {
    if (aabbOverlap(x, y, w, d, b.x, b.y, b.w, b.d)) return true;
  }
  return false;
}

/** Dress lots in order; each lot's props become occupied space for the lots after it. */
export function dressLots(
  lots: readonly Lot[],
  buildings: readonly (Building | undefined)[],
  rng: Rng,
  occBoxes: { x: number; y: number; w: number; d: number }[],
  budget: number,
  corridors?: readonly { x: number; y: number }[][],
  eligible?: DressEligible,
): { props: Prop[]; patches: GroundPatch[] } {
  const props: Prop[] = [];
  const patches: GroundPatch[] = [];
  for (let i = 0; i < lots.length; i++) {
    const dressed = dressLot(lots[i]!, buildings[i], rng, { boxes: occBoxes }, budget, corridors, eligible);
    props.push(...dressed.props);
    patches.push(...dressed.patches);
    for (const p of dressed.props) occBoxes.push({ x: p.x, y: p.y, w: p.w, d: p.d });
  }
  return { props, patches };
}

export function dressLot(
  lot: Lot,
  building: Building | undefined,
  rng: Rng,
  occ: Occupancy,
  budget: number,
  corridors: readonly { x: number; y: number }[][] = [],
  eligible?: DressEligible,
): { props: Prop[]; patches: GroundPatch[] } {
  const stored = DRESS_TEMPLATES.find((t) => t.id === lot.templateId);
  const storedOk = !!stored
    && stored.identities.includes(lot.identity)
    && templateHasEligibleSlot(stored, eligible);
  const template = storedOk ? stored : pickTemplate(lot.identity, rng, eligible);
  lot.templateId = template.id;
  if (building) building.lotId = lot.id;
  const drive = drivewayPatch(lot);
  const props = placeTemplateSlots(lot, building, template, rng, occ, Math.min(template.maxAssets, budget), corridors, eligible);

  const patches: GroundPatch[] = [
    {
      x: lot.x,
      y: lot.y,
      w: lot.w,
      d: lot.d,
      heading: 0,
      cover: template.cover,
      seed: rng.int(1, 1_000_000),
      z: 0,
      poly: lot.boundary.length >= 3 ? lot.boundary.map((p) => ({ x: p.x, y: p.y })) : undefined,
    },
    { ...drive, heading: lot.heading, cover: "driveway", seed: rng.int(1, 1_000_000), z: 0.01 },
  ];
  wearPatches(lot, template.cover, rng, patches);
  return { props, patches };
}

/** Roll each eligible slot, heaviest first, until the lot's asset cap. */
function placeTemplateSlots(
  lot: Lot,
  building: Building | undefined,
  template: DressTemplate,
  rng: Rng,
  occ: Occupancy,
  max: number,
  corridors: readonly { x: number; y: number }[][],
  eligible: DressEligible | undefined,
): Prop[] {
  const props: Prop[] = [];
  const extras: { x: number; y: number; w: number; d: number }[] = [];
  const driveW = drivewayStyle(lot.identity).width * 0.85;
  const slots = [...template.slots].filter((slot) => slotEligible(slot, eligible)).sort((a, b) => b.weight - a.weight);
  for (const slot of slots) {
    if (props.length >= max) break;
    if (!rng.chance(slot.weight)) continue;
    const def = getAsset(slot.assetId);
    const heading = lot.heading + slot.headingBias + rng.range(-0.08, 0.08);
    const placed = placeSlot(
      lot,
      building,
      def.footprint.w,
      def.footprint.d,
      slot.along + rng.range(-0.03, 0.03),
      slot.across + rng.range(-0.04, 0.04),
      occ,
      extras,
      driveW,
      corridors,
    );
    if (!placed) continue;
    const prop = spawnAsset(slot.assetId, placed.x, placed.y, heading, rng.int(0, def.variants - 1));
    prop.lotId = lot.id;
    props.push(prop);
    extras.push({ x: prop.x, y: prop.y, w: prop.w, d: prop.d });
  }
  return props;
}

/** One worn or planted patch around `at`, kept inside the parcel. `jitter` rolls a heading wobble only when it lands. */
interface WearPatch { dx: number; dy: number; w: number; d: number; cover: GroundPatch['cover']; z: number; turn?: number; jitter?: number }
function pushWearPatch(lot: Lot, rng: Rng, patches: GroundPatch[], at: { x: number; y: number }, patch: WearPatch): void {
  if (!coverAllowed(lot, at.x, at.y)) return;
  const heading = patch.jitter ? lot.heading + rng.range(-patch.jitter, patch.jitter) : patch.turn ? lot.heading + patch.turn : lot.heading;
  patches.push({
    x: at.x - patch.dx,
    y: at.y - patch.dy,
    w: patch.w,
    d: patch.d,
    heading,
    cover: patch.cover,
    seed: rng.int(1, 1_000_000),
    z: patch.z,
  });
}

/** A parking pad and, often, an oil-stained track. */
function commercialWearPatches(lot: Lot, rng: Rng, patches: GroundPatch[]): void {
  pushWearPatch(lot, rng, patches, lotLocalToWorld(lot, 0.22, 0), { dx: 1.2, dy: 1.1, w: 2.4, d: 2.2, cover: "parking", z: 0.012 });
  if (!rng.chance(0.7)) return;
  const stain = lotLocalToWorld(lot, 0.3, rng.chance(0.5) ? 0.18 : -0.18);
  pushWearPatch(lot, rng, patches, stain, { dx: 0.45, dy: 0.35, w: 0.95, d: 0.7, cover: "tracks", z: 0.014, jitter: 0.2 });
}

function wearPatches(lot: Lot, cover: GroundPatch['cover'], rng: Rng, patches: GroundPatch[]): void {
  if (cover === "grass" && rng.chance(0.7)) {
    pushWearPatch(lot, rng, patches, lotLocalToWorld(lot, 0.35, 0), { dx: 0.7, dy: 0.25, w: 1.6, d: 0.55, cover: "tracks", z: 0.012 });
  }
  if (cover === "grass" && rng.chance(0.45)) {
    pushWearPatch(lot, rng, patches, lotLocalToWorld(lot, 0.55, 0.32), { dx: 0.45, dy: 0.35, w: 0.9, d: 0.7, cover: "planted", z: 0.012 });
  }
  if (lot.identity === "shop" || lot.identity === "service") commercialWearPatches(lot, rng, patches);
  if (cover === "gravel" && rng.chance(0.75)) {
    const worn = lotLocalToWorld(lot, 0.4, rng.chance(0.5) ? 0.16 : -0.16);
    pushWearPatch(lot, rng, patches, worn, { dx: 0.8, dy: 0.35, w: 1.7, d: 0.7, cover: "dirt", z: 0.013 });
  }
  if (cover === "concrete" && rng.chance(0.6)) {
    pushWearPatch(lot, rng, patches, lotLocalToWorld(lot, 0.38, 0.08), { dx: 0.9, dy: 0.12, w: 1.8, d: 0.28, cover: "tracks", z: 0.013, turn: 0.15 });
  }
}

function coverAllowed(lot: Lot, x: number, y: number): boolean {
  if (lot.boundary.length >= 3) return pointInPoly(x, y, lot.boundary);
  return true;
}

export function drivewayPatch(lot: Lot): { x: number; y: number; w: number; d: number } {
  const style = drivewayStyle(lot.identity);
  const width = style.width * 0.82;
  const depth = 2.1;
  const size = lotAxisSizes(lot);
  const along = Math.min(0.28, 0.04 + depth * 0.5 / Math.max(0.8, size.along));
  const center = lotLocalToWorld(lot, along, 0);
  return { x: center.x - width * 0.5, y: center.y - depth * 0.5, w: width, d: depth };
}

function narrowCorridor(
  poly: readonly { x: number; y: number }[],
  inset: number,
): { x: number; y: number }[] {
  if (poly.length !== 4) return [...poly];
  const [a0, b0, b1, a1] = poly;
  const pull = (p: { x: number; y: number }, q: { x: number; y: number }) => {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * inset, y: p.y + (dy / len) * inset };
  };
  return [pull(a0!, a1!), pull(b0!, b1!), pull(b1!, b0!), pull(a1!, a0!)];
}

function sealsAccess(
  lot: Lot,
  building: Building,
  blockers: { x: number; y: number; w: number; d: number }[],
  driveW: number,
): boolean {
  const bw = building.w * building.cellSize;
  const bd = building.d * building.cellSize;
  const doorX = building.x + bw * 0.5;
  const doorY = building.y + bd;
  const front = lotLocalToWorld(lot, 0.02, 0);
  let clear = 0;
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const x = front.x + (doorX - front.x) * t - driveW * 0.25;
    const y = front.y + (doorY - front.y) * t - driveW * 0.25;
    let hit = false;
    for (const b of blockers) {
      if (aabbOverlap(x, y, driveW * 0.5, driveW * 0.5, b.x, b.y, b.w, b.d)) {
        hit = true;
        break;
      }
    }
    if (!hit) clear++;
  }
  return clear < 3;
}

export function buildingOccupy(building: Building): { x: number; y: number; w: number; d: number }[] {
  return [
    { x: building.x, y: building.y, w: building.w * building.cellSize, d: building.d * building.cellSize },
    ...building.decorBoxes.map((b) => ({ x: b.x, y: b.y, w: b.w, d: b.d })),
  ];
}
