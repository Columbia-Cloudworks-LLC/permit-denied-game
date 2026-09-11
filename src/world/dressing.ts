import { aabbOverlap } from "../game/math";
import { Rng } from "../game/rng";
import type { CoverKind, GroundPatch, Lot, LotIdentity, Prop } from "../structure/types";
import type { Building } from "../structure/types";
import { getAsset, spawnAsset, type LotCompat } from "./catalog";

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
    maxAssets: 8,
    slots: [
      { assetId: "hay-bale-round", along: 0.72, across: 0.32, headingBias: 0.2, weight: 1 },
      { assetId: "hay-bale-square", along: 0.58, across: 0.34, headingBias: 0.1, weight: 0.85 },
      { assetId: "water-trough", along: 0.4, across: -0.34, headingBias: 0.2, weight: 0.7 },
      { assetId: "farm-implement", along: 0.78, across: -0.28, headingBias: 0.6, weight: 0.45 },
      { assetId: "tractor", along: 0.28, across: 0.3, headingBias: 0.15, weight: 0.35 },
      { assetId: "grain-bin", along: 0.82, across: 0.02, headingBias: 0, weight: 0.3 },
      { assetId: "woodpile", along: 0.2, across: -0.32, headingBias: 0, weight: 0.5 },
      { assetId: "shrub", along: 0.12, across: 0.36, headingBias: 0, weight: 0.4 },
    ],
  },
  {
    id: "roadside-service",
    identities: ["service"],
    zones: ["commercial", "frontage"],
    cover: "concrete",
    maxAssets: 6,
    slots: [
      { assetId: "fuel-pump", along: 0.18, across: 0.28, headingBias: 0, weight: 1 },
      { assetId: "fuel-pump", along: 0.18, across: -0.28, headingBias: 0, weight: 0.7 },
      { assetId: "vending", along: 0.42, across: -0.34, headingBias: 0.1, weight: 0.65 },
      { assetId: "traffic-barrel", along: 0.14, across: 0.38, headingBias: 0, weight: 0.7 },
      { assetId: "propane-tank", along: 0.78, across: -0.3, headingBias: 0.2, weight: 0.35 },
      { assetId: "pallet-stack", along: 0.7, across: 0.3, headingBias: 0.1, weight: 0.4 },
    ],
  },
  {
    id: "contractor-yard",
    identities: ["contractor"],
    zones: ["industrial", "yard"],
    cover: "gravel",
    maxAssets: 7,
    slots: [
      { assetId: "pallet-stack", along: 0.22, across: 0.32, headingBias: 0.1, weight: 1 },
      { assetId: "crate-stack", along: 0.4, across: 0.3, headingBias: 0.15, weight: 0.8 },
      { assetId: "shed", along: 0.75, across: -0.22, headingBias: 0, weight: 0.55 },
      { assetId: "hvac", along: 0.28, across: -0.34, headingBias: 0, weight: 0.5 },
      { assetId: "woodpile", along: 0.58, across: 0.32, headingBias: 0, weight: 0.45 },
      { assetId: "utility-cabinet", along: 0.12, across: -0.3, headingBias: 0, weight: 0.4 },
    ],
  },
  {
    id: "utility-lot",
    identities: ["utility"],
    zones: ["industrial", "utility"],
    cover: "gravel",
    maxAssets: 5,
    slots: [
      { assetId: "utility-cabinet", along: 0.22, across: 0.3, headingBias: 0, weight: 1 },
      { assetId: "transformer", along: 0.4, across: -0.28, headingBias: 0.1, weight: 0.85 },
      { assetId: "power-pole", along: 0.12, across: -0.36, headingBias: 0, weight: 0.6 },
      { assetId: "fire-hydrant", along: 0.1, across: 0.22, headingBias: 0, weight: 0.5 },
      { assetId: "hvac", along: 0.7, across: 0.28, headingBias: 0, weight: 0.4 },
    ],
  },
  {
    id: "small-commercial",
    identities: ["shop"],
    zones: ["commercial", "frontage"],
    cover: "parking",
    maxAssets: 6,
    slots: [
      { assetId: "vending", along: 0.22, across: -0.32, headingBias: 0, weight: 0.8 },
      { assetId: "fire-hydrant", along: 0.1, across: 0.28, headingBias: 0, weight: 0.7 },
      { assetId: "pallet-stack", along: 0.72, across: 0.3, headingBias: 0.1, weight: 0.5 },
      { assetId: "stop-sign", along: 0.12, across: -0.2, headingBias: 0, weight: 0.45 },
      { assetId: "trash-can", along: 0.3, across: 0.32, headingBias: 0, weight: 0.55 },
      { assetId: "hvac", along: 0.78, across: -0.3, headingBias: 0, weight: 0.4 },
    ],
  },
];

export function templatesFor(identity: LotIdentity): DressTemplate[] {
  return DRESS_TEMPLATES.filter((t) => t.identities.includes(identity));
}

export function pickTemplate(identity: LotIdentity, rng: Rng): DressTemplate {
  const pool = templatesFor(identity);
  return pool.length ? rng.pick(pool) : DRESS_TEMPLATES[0]!;
}

export interface Occupancy {
  boxes: { x: number; y: number; w: number; d: number }[];
}

/** Heading-aligned depth (along) and frontage (across). Axis-aligned AABBs used lot.w for both. */
export function lotAxisSizes(lot: Lot): { along: number; across: number } {
  const c = Math.abs(Math.cos(lot.heading));
  const s = Math.abs(Math.sin(lot.heading));
  return { along: c * lot.w + s * lot.d, across: s * lot.w + c * lot.d };
}

export function lotLocalToWorld(
  lot: Lot,
  along: number,
  across: number,
): { x: number; y: number } {
  const fx = Math.cos(lot.heading);
  const fy = Math.sin(lot.heading);
  const rx = -fy;
  const ry = fx;
  const cx = lot.x + lot.w * 0.5;
  const cy = lot.y + lot.d * 0.5;
  const size = lotAxisSizes(lot);
  const ox = (along - 0.5) * size.along;
  const oy = across * size.across * 0.38;
  return { x: cx + fx * ox + rx * oy, y: cy + fy * ox + ry * oy };
}

export function fillWorldGround(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  seed: number,
  tile = 6.2,
): GroundPatch[] {
  const patches: GroundPatch[] = [];
  const cols = Math.max(1, Math.ceil((maxX - minX) / tile));
  const rows = Math.max(1, Math.ceil((maxY - minY) / tile));
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const n = (ix * 17 + iy * 31 + (seed & 0xffff)) >>> 0;
      const cover: CoverKind = n % 7 === 0 ? "scrub" : n % 11 === 0 ? "dirt" : "grass";
      patches.push({
        x: minX + ix * tile,
        y: minY + iy * tile,
        w: tile + 0.08,
        d: tile + 0.08,
        heading: 0,
        cover,
        seed: (seed ^ (ix * 7919 + iy * 6271)) >>> 0,
        z: -0.02,
      });
    }
  }
  return patches;
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
    if (corridors.some((poly) => yardPointInPoly(x + w * 0.5, y + d * 0.5, poly))) continue;
    if (building && sealsAccess(lot, building, [...extras, { x, y, w, d }], driveW)) continue;
    return { x, y };
  }
  return null;
}

function insideLotYard(lot: Lot, x: number, y: number, w: number, d: number): boolean {
  if (lot.boundary && lot.boundary.length >= 3) {
    if (yardPointInPoly(x + w * 0.5, y + d * 0.5, lot.boundary)) return true;
  }
  const size = lotAxisSizes(lot);
  const fx = Math.cos(lot.heading);
  const fy = Math.sin(lot.heading);
  const rx = -fy;
  const ry = fx;
  const cx = lot.x + lot.w * 0.5;
  const cy = lot.y + lot.d * 0.5;
  const px = x + w * 0.5 - cx;
  const py = y + d * 0.5 - cy;
  const along = px * fx + py * fy;
  const across = px * rx + py * ry;
  const pad = 0.28;
  return Math.abs(along) <= size.along * 0.5 - pad && Math.abs(across) <= size.across * 0.5 - pad;
}

function yardPointInPoly(x: number, y: number, poly: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const hit = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y + 1e-9) + a.x;
    if (hit) inside = !inside;
  }
  return inside;
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

export function dressLot(
  lot: Lot,
  building: Building | undefined,
  rng: Rng,
  occ: Occupancy,
  budget: number,
  corridors: readonly { x: number; y: number }[][] = [],
): { props: Prop[]; patches: GroundPatch[] } {
  const template = DRESS_TEMPLATES.find((t) => t.id === lot.templateId) ?? pickTemplate(lot.identity, rng);
  lot.templateId = template.id;
  if (building) building.lotId = lot.id;
  const props: Prop[] = [];
  const extras: { x: number; y: number; w: number; d: number }[] = [];
  const driveW = 1.7;
  const drive = drivewayPatch(lot);

  const slots = [...template.slots].sort((a, b) => b.weight - a.weight);
  const max = Math.min(template.maxAssets, budget);
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
    },
    { ...drive, heading: lot.heading, cover: "driveway", seed: rng.int(1, 1_000_000), z: 0.01 },
  ];
  if (template.cover === "grass" && rng.chance(0.7)) {
    const worn = lotLocalToWorld(lot, 0.35, 0);
    patches.push({
      x: worn.x - 0.7,
      y: worn.y - 0.25,
      w: 1.6,
      d: 0.55,
      heading: lot.heading,
      cover: "tracks",
      seed: rng.int(1, 1_000_000),
      z: 0.012,
    });
  }
  if (template.cover === "grass" && rng.chance(0.45)) {
    const bed = lotLocalToWorld(lot, 0.55, 0.32);
    patches.push({
      x: bed.x - 0.45,
      y: bed.y - 0.35,
      w: 0.9,
      d: 0.7,
      heading: lot.heading,
      cover: "planted",
      seed: rng.int(1, 1_000_000),
      z: 0.012,
    });
  }
  if (lot.identity === "shop" || lot.identity === "service") {
    const pad = lotLocalToWorld(lot, 0.22, 0);
    patches.push({
      x: pad.x - 1.2,
      y: pad.y - 1.1,
      w: 2.4,
      d: 2.2,
      heading: lot.heading,
      cover: "parking",
      seed: rng.int(1, 1_000_000),
      z: 0.012,
    });
  }
  return { props, patches };
}

export function drivewayPatch(lot: Lot): { x: number; y: number; w: number; d: number } {
  const width = 1.7;
  const depth = 2.1;
  const size = lotAxisSizes(lot);
  const along = Math.min(0.28, 0.04 + depth * 0.5 / Math.max(0.8, size.along));
  const center = lotLocalToWorld(lot, along, 0);
  return { x: center.x - width * 0.5, y: center.y - depth * 0.5, w: width, d: depth };
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
