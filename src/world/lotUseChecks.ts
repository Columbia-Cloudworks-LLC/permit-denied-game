// Test support: lot-use rules checked across whole generated towns.
import { DRESS_TEMPLATES } from "./dressing";
import { identityFromBuilding, lotAllowsAgriculture, lotAllowsFuel } from "./lotUse";
import type { Town } from "./town";

export const AGRICULTURAL_PROPS: ReadonlySet<string> = new Set([
  "hay-bale-round",
  "hay-bale-square",
  "water-trough",
  "farm-implement",
  "tractor",
  "grain-bin",
]);

type LotsById = ReadonlyMap<string, Town["lots"][number]>;

/**
 * Every way a town breaks its lots' use: a lot identity that disagrees with its building,
 * a dressing template for another identity, fuel or farm props on lots that forbid them,
 * and fields tied to missing or non-farm lots. Empty when the town is consistent.
 */
export function lotUseViolations(town: Pick<Town, "lots" | "buildings" | "props" | "features">): string[] {
  const byLot: LotsById = new Map(town.lots.map((lot) => [lot.id, lot]));
  const out: string[] = [];
  for (const building of town.buildings) buildingLotViolations(byLot, building, out);
  for (const prop of town.props) propLotViolations(byLot, prop, out);
  for (const feature of town.features) {
    if (feature.kind !== "field" || !feature.lotId) continue;
    const lot = byLot.get(feature.lotId);
    if (!lot) out.push(`field ${feature.id} names missing lot ${feature.lotId}`);
    else if (!lotAllowsAgriculture(lot.identity)) out.push(`field ${feature.id} on ${lot.identity} lot ${lot.id}`);
  }
  return out;
}

function buildingLotViolations(byLot: LotsById, building: Town["buildings"][number], out: string[]): void {
  const lot = byLot.get(building.lotId ?? "");
  if (!lot) return;
  const identity = identityFromBuilding(building);
  if (lot.identity !== identity) out.push(`${building.archetypeId} on ${lot.id} is ${lot.identity}, expected ${identity}`);
  if (!lot.templateId) return;
  const template = DRESS_TEMPLATES.find((entry) => entry.id === lot.templateId);
  if (!template?.identities.includes(lot.identity)) out.push(`${lot.id} template ${lot.templateId} does not dress ${lot.identity}`);
}

function propLotViolations(byLot: LotsById, prop: Town["props"][number], out: string[]): void {
  const lot = prop.lotId ? byLot.get(prop.lotId) : undefined;
  if (!lot) return;
  if (prop.assetId === "fuel-pump" && !lotAllowsFuel(lot.identity)) out.push(`fuel-pump on ${lot.identity} lot ${lot.id}`);
  if (AGRICULTURAL_PROPS.has(prop.assetId) && !lotAllowsAgriculture(lot.identity)) out.push(`${prop.assetId} on ${lot.identity} lot ${lot.id}`);
}
