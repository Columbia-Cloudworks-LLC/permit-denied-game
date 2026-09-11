import { getAsset } from '../world/catalog';
import { MATERIALS } from './materials';
import type { Building, FloorFinish, Material, RoomKind, FixtureKind } from './types';

/** Structural assembly, independent of any floor plan. All buildings have slabs and perimeter walls. */
export interface ConstructionDef {
  id: string;
  walls: 'bearing' | 'masonry' | 'frame';
  structure: Material;
  skin: Material;
  floor: Material;
  roof: Material;
  fallDuration: number;
  failureDelay: number;
}
/** Room-relative fractions; dimensions describe the final rotated footprint. */
export interface ContentPlacement {
  id: string;
  kind: FixtureKind;
  x: number; y: number; w: number; d: number; h: number;
  rotation: 0 | 90 | 180 | 270;
}
export interface RoomRecipe {
  id: string;
  kind: RoomKind;
  floor: number;
  x: number; y: number; w: number; d: number;
  finish: FloorFinish;
  contents: readonly ContentPlacement[];
}
export interface LayoutDef {
  rooms: readonly RoomRecipe[];
  partitions: boolean;
  connections?: readonly { a: string; b: string; at: number; width: number }[];
}
/** Shared wall in normalized building coordinates. Corner contacts are not doors. */
export function sharedRoomEdge(a: RoomRecipe, b: RoomRecipe) {
  if (a.floor !== b.floor) return undefined;
  const vertical = Math.abs(a.x + a.w - b.x) < 1e-6 || Math.abs(b.x + b.w - a.x) < 1e-6;
  const horizontal = Math.abs(a.y + a.d - b.y) < 1e-6 || Math.abs(b.y + b.d - a.y) < 1e-6;
  if (!vertical && !horizontal) return undefined;
  const start = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
  const end = vertical ? Math.min(a.y + a.d, b.y + b.d) : Math.min(a.x + a.w, b.x + b.w);
  return end - start > 1e-6 ? { vertical, start, end, plane: vertical ? Math.max(a.x, b.x) : Math.max(a.y, b.y) } : undefined;
}
export interface OpeningDef {
  floor: number;
  side: 'south';
  /** Fraction along occupied south frontage. Doors remain destructible panels. */
  at: number;
  kind: 'door' | 'loading';
  /** Optional cell for recessed south-facing section frontage. */
  cell?: { x: number; y: number };
}
export function roomAt(b: Building, gx: number, gy: number, floor: number): RoomRecipe | undefined {
  const x = (gx + .5) / b.w, y = (gy + .5) / b.d;
  return b.layout.rooms.find(r => r.floor === floor && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.d);
}
export function validateConstruction(def: ConstructionDef): string[] {
  const issues: string[] = [];
  if (!def.id || !['bearing', 'masonry', 'frame'].includes(def.walls)) issues.push('Invalid construction identity or wall assembly');
  for (const part of ['structure', 'skin', 'floor', 'roof'] as const) {
    if (!Object.hasOwn(MATERIALS, def[part])) issues.push(`Unknown ${part} material ${def[part]}`);
  }
  if (!Number.isFinite(def.fallDuration) || !Number.isFinite(def.failureDelay) || def.fallDuration <= 0 || def.failureDelay < 0) issues.push('Invalid collapse timing');
  return issues;
}
const kinds = ['kitchen', 'bathroom', 'living', 'retail', 'storage', 'bedroom', 'production'];
const finishes = ['plank', 'tile', 'linoleum', 'concrete'];
const inside = (x: number, y: number, w: number, d: number) =>
  [x, y, w, d].every(Number.isFinite) && x >= 0 && y >= 0 && w > 0 && d > 0 && x + w <= 1.000001 && y + d <= 1.000001;
const overlaps = (a: { x: number; y: number; w: number; d: number }, b: typeof a) =>
  a.x < b.x + b.w - 1e-6 && a.x + a.w > b.x + 1e-6 && a.y < b.y + b.d - 1e-6 && a.y + a.d > b.y + 1e-6;

/** Validate the composed plan, including footprint holes, before allocating runtime state. */
export function validateLayout(layout: LayoutDef, w: number, d: number, floors: number, mask: boolean[][][]): string[] {
  const issues: string[] = [], ids = new Set<string>();
  for (const room of layout.rooms) {
    if (!room.id || ids.has(room.id)) issues.push(`Duplicate or missing room id ${room.id}`);
    ids.add(room.id);
    if (!kinds.includes(room.kind) || !finishes.includes(room.finish)) issues.push(`Unknown room kind or finish in ${room.id}`);
    if (!Number.isInteger(room.floor) || room.floor < 0 || room.floor >= floors || !inside(room.x, room.y, room.w, room.d)) {
      issues.push(`Invalid ${room.kind} room bounds`); continue;
    }
    for (let gx = 0; gx < w; gx++) for (let gy = 0; gy < d; gy++) {
      if (overlaps(room, { x: gx / w, y: gy / d, w: 1 / w, d: 1 / d }) && !mask[room.floor]?.[gx]?.[gy]) issues.push(`Room ${room.id} crosses unoccupied footprint at ${gx},${gy}`);
    }
    const slots = new Set<string>();
    for (const slot of room.contents) {
      if (!slot.id || slots.has(slot.id)) issues.push(`Duplicate or missing object id in ${room.id}`);
      slots.add(slot.id);
      if (!inside(slot.x, slot.y, slot.w, slot.d) || !Number.isFinite(slot.h) || slot.h <= 0 || ![0, 90, 180, 270].includes(slot.rotation)) issues.push(`Invalid ${slot.kind} slot in ${room.kind}`);
      try {
        const object = getAsset(`interior-${slot.kind}`);
        if (!['brittle', 'crush', 'panel-collapse'].includes(object.destruction)) issues.push(`Object ${slot.kind} requires unsupported room behavior ${object.destruction}`);
      } catch { issues.push(`Unknown object ${slot.kind} in ${room.id}`); }
    }
    for (let i = 0; i < room.contents.length; i++) for (let j = i + 1; j < room.contents.length; j++) {
      if (overlaps(room.contents[i]!, room.contents[j]!)) issues.push(`Overlapping objects in ${room.id}`);
    }
  }
  for (let i = 0; i < layout.rooms.length; i++) for (let j = i + 1; j < layout.rooms.length; j++) {
    const a = layout.rooms[i]!, b = layout.rooms[j]!;
    if (a.floor === b.floor && overlaps(a, b)) issues.push(`Overlapping ${a.kind}/${b.kind} rooms`);
  }
  for (let floor = 0; floor < floors; floor++) {
    const area = layout.rooms.filter(r => r.floor === floor).reduce((n, r) => n + r.w * r.d, 0);
    const occupied = mask[floor]?.flat().filter(Boolean).length ?? 0;
    if (Math.abs(area - occupied / (w * d)) > 1e-6) issues.push(`Floor ${floor} must have complete room coverage`);
  }
  const pairs = new Set<string>();
  for (const door of layout.connections ?? []) {
    const a = layout.rooms.find(r => r.id === door.a), b = layout.rooms.find(r => r.id === door.b);
    const edge = a && b && sharedRoomEdge(a, b);
    const pair = [door.a, door.b].sort().join(':');
    if (!edge || pairs.has(pair)) issues.push(`Invalid or duplicate room connection ${pair}`);
    pairs.add(pair);
    // Width and position are fractions of the shared wall, so resizing preserves the door.
    if (![door.at, door.width].every(Number.isFinite) || door.width <= 0 || door.at - door.width / 2 < 0 || door.at + door.width / 2 > 1) issues.push(`Invalid door bounds ${pair}`);
  }
  if (layout.partitions) for (let floor = 0; floor < floors; floor++) {
    const floorRooms = layout.rooms.filter(r => r.floor === floor);
    const reached = new Set(floorRooms.slice(0, 1).map(r => r.id));
    for (let pass = 0; pass < floorRooms.length; pass++) for (const door of layout.connections ?? []) {
      if (reached.has(door.a)) reached.add(door.b);
      if (reached.has(door.b)) reached.add(door.a);
    }
    if (floorRooms.some(r => !reached.has(r.id))) issues.push(`Floor ${floor} contains rooms without a connected doorway`);
  }
  return issues;
}
