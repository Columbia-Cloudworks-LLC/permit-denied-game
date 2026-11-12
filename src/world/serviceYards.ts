import { hashSeed, mixSeed } from "../game/rng";
import type { Building, Lot } from "../structure/types";
import { archetypeById } from "./archetypes";
import { getAsset } from "./catalog";

/** Where a service prop stands against its building, relative to the lot frontage. */
type YardPlace = "rear" | "side" | "bay" | "bay-flank";

interface YardSlot {
  assetId: string;
  place: YardPlace;
  /** Position along the wall, as a share of its half-length from the middle (-1..1). */
  offset: number; // For bay props: which dock (0, 1) or which flank of the first dock (-1, 1).
  /** Clear gap between wall and prop. */
  gap: number;
  chance: number;
  /** Generic template prop this one supersedes on its lot. */
  replaces?: string;
}

/** One occupancy's exterior service gear. Data only: generation never switches on a building id. */
export interface ServiceYardRule {
  id: string;
  /** Archetype ids and `traits.use` tags the yard serves. */
  occupancies: readonly string[];
  slots: readonly YardSlot[];
}

export const SERVICE_YARDS: readonly ServiceYardRule[] = [
  {
    id: "food-service",
    occupancies: ["roadside-diner", "bakery", "small-grocery", "bakery-walkup", "market-apartments"],
    slots: [
      { assetId: "dumpster-corral", place: "rear", offset: 0.45, gap: 0.3, chance: 1, replaces: "dumpster" },
      { assetId: "grease-trap", place: "rear", offset: -0.4, gap: 0.2, chance: 0.9 },
    ],
  },
  {
    id: "convenience",
    occupancies: ["small-grocery", "hardware-store", "service-station-canopy", "fuel-canopy"],
    slots: [
      { assetId: "ice-merchandiser", place: "side", offset: -0.55, gap: 0.12, chance: 0.95 },
      { assetId: "propane-exchange-cage", place: "side", offset: 0.1, gap: 0.2, chance: 0.85, replaces: "propane-tank" },
    ],
  },
  {
    id: "critical-power",
    occupancies: ["data-hall", "datacenter", "cold-storage-depot", "telephone-exchange", "neighborhood-clinic"],
    slots: [
      { assetId: "backup-generator", place: "side", offset: 0.35, gap: 0.35, chance: 1 },
      { assetId: "transformer-pad", place: "side", offset: -0.45, gap: 0.3, chance: 0.95, replaces: "transformer" },
    ],
  },
  {
    id: "loading-dock",
    occupancies: ["warehouse", "steel-warehouse", "logistics-hub", "logistics", "freight-transfer-depot", "cold-storage-depot", "orchard-packing-shed", "factory"],
    slots: [
      { assetId: "loading-dock-bumpers", place: "bay", offset: 0, gap: 0.06, chance: 1 },
      { assetId: "loading-dock-bumpers", place: "bay", offset: 1, gap: 0.06, chance: 0.8 },
      { assetId: "bollard", place: "bay-flank", offset: -1, gap: 0.5, chance: 0.95 },
      { assetId: "bollard", place: "bay-flank", offset: 1, gap: 0.5, chance: 0.95 },
      { assetId: "pallet-stack", place: "side", offset: -0.3, gap: 0.3, chance: 0.9 },
    ],
  },
];

/** Service props never crowd out a lot: the rest of its budget stays with the lot template. */
export const SERVICE_YARD_MAX = 5;

/** A service prop waiting on the lot's occupancy tests: tried at each spot in order. */
export interface YardCandidate {
  assetId: string;
  chance: number;
  heading: number;
  replaces?: string;
  /** Top-left corners of the prop's footprint, best first. */
  spots: { x: number; y: number }[];
}

function buildingUses(b: Building): readonly string[] {
  try {
    return archetypeById(b.archetypeId).traits?.use ?? [];
  } catch {
    return [];
  }
}

/** Ground-floor loading docks on the south face: each a run of adjacent bay cells, as centre x and half-width in world units. */
function loadingDocks(b: Building): { x: number; half: number }[] {
  const cells = b.cells.filter(c => c.floor === 0 && c.loadingS && c.exterior.south).sort((a, c) => a.gy - c.gy || a.gx - c.gx);
  const docks: { x: number; half: number }[] = [];
  for (let i = 0, start = 0; i < cells.length; i++) {
    const last = i === cells.length - 1 || cells[i + 1]!.gy !== cells[i]!.gy || cells[i + 1]!.gx !== cells[i]!.gx + 1;
    if (!last) continue;
    const count = i - start + 1;
    docks.push({ x: b.x + (cells[start]!.gx + count / 2) * b.cellSize, half: count * b.cellSize / 2 });
    start = i + 1;
  }
  return docks;
}

/** Service yards a building's occupancy calls for, in table order. */
export function serviceYardsFor(building: Building): ServiceYardRule[] {
  const uses = buildingUses(building);
  return SERVICE_YARDS.filter(rule => rule.occupancies.includes(building.archetypeId) || uses.some(use => rule.occupancies.includes(use)));
}

/** Seed for one lot's service yard: independent of the layout's shared stream, so adding a yard never reshuffles a town. */
export function serviceYardSeed(lot: Lot, building: Building): number {
  return mixSeed(hashSeed(`${lot.id}:${building.archetypeId}:${Math.round(building.x * 8)}:${Math.round(building.y * 8)}`));
}

/**
 * Where a building's service props would stand: behind it (away from the frontage), beside it,
 * or at its loading bays. Pure geometry; the caller applies occupancy, corridor and budget rules.
 */
export function serviceYardCandidates(lot: Lot, building: Building): YardCandidate[] {
  const rules = serviceYardsFor(building);
  const candidates: YardCandidate[] = [];
  if (!rules.length) return candidates;
  const bw = building.w * building.cellSize, bd = building.d * building.cellSize;
  const cx = building.x + bw / 2, cy = building.y + bd / 2;
  // Depth axis runs frontage to rear; the across axis runs along the frontage.
  const fx = Math.cos(lot.heading), fy = Math.sin(lot.heading), rx = -fy, ry = fx;
  const halfAlong = (Math.abs(fx) * bw + Math.abs(fy) * bd) / 2, halfAcross = (Math.abs(rx) * bw + Math.abs(ry) * bd) / 2;
  // Doors and loading bays face south, so a south-facing lot keeps its side yards clear of them by default.
  const sideFirst = serviceYardSeed(lot, building) & 1 ? 1 : -1;
  const docks = loadingDocks(building);
  for (const rule of rules) for (const slot of rule.slots) {
    const { w, d } = getAsset(slot.assetId).footprint;
    const corner = (px: number, py: number) => ({ x: px - w / 2, y: py - d / 2 });
    const propAlong = (Math.abs(fx) * w + Math.abs(fy) * d) / 2, propAcross = (Math.abs(rx) * w + Math.abs(ry) * d) / 2;
    const spots: { x: number; y: number }[] = [];
    if (slot.place === "rear") {
      const out = halfAlong + slot.gap + propAlong;
      for (const offset of [slot.offset, -slot.offset, 0]) {
        spots.push(corner(cx + fx * out + rx * offset * halfAcross, cy + fy * out + ry * offset * halfAcross));
      }
    } else if (slot.place === "side") {
      const out = halfAcross + slot.gap + propAcross;
      for (const side of [sideFirst, -sideFirst]) for (const offset of [slot.offset, slot.offset + 0.35]) {
        spots.push(corner(cx + rx * side * out + fx * offset * halfAlong, cy + ry * side * out + fy * offset * halfAlong));
      }
    } else {
      const dock = docks[slot.place === "bay" ? slot.offset : 0];
      const south = building.y + bd + slot.gap + d / 2;
      if (dock) spots.push(corner(slot.place === "bay" ? dock.x : dock.x + slot.offset * (dock.half + 0.3 + w / 2), south));
    }
    if (spots.length) candidates.push({ assetId: slot.assetId, chance: slot.chance, replaces: slot.replaces, heading: slot.place === "bay" || slot.place === "bay-flank" ? 0 : lot.heading, spots });
  }
  return candidates;
}
