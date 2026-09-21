import type { Building, LotIdentity } from "../structure/types";
import { ARCHETYPES, type Archetype } from "./archetypes";

/** Lot-use profiles that drive dressing templates, fuel equipment, and crop fields. */
export const LOT_USE_PROFILES = ["residence", "farm", "service", "contractor", "utility", "shop"] as const;

const FUEL_USES = new Set(["fuel-canopy"]);
const FARM_USES = new Set([
  "farmhouse-rear-wing",
  "gable-barn",
  "stable-block",
  "farm-equipment-shed",
  "feed-store",
  "grain-storage",
  "dairy-building",
  "poultry-house",
  "horticulture",
  "orchard-packing-shed",
]);
const UTILITY_USES = new Set([
  "pump-house",
  "water-storage",
  "telephone-exchange",
  "service-house",
]);
const FARM_ID = /farm|barn|grain|greenhouse|orchard|dairy|poultry|stable|feed-store/;
const FUEL_ID = /service-station|fuel/;
const UTILITY_ID = /pump-house|water-tower|telephone-exchange/;
const CIVIC_USES = new Set([
  "landmark",
  "governors-mansion",
  "city-hall",
  "township-hall",
  "community-hall",
  "clock-hall",
  "permit-office",
  "post-office",
  "admin-wing",
]);

/**
 * Compatibility:
 * - Agricultural props and crop fields require a farm profile (barns, farmhouses, grain, livestock).
 * - Fuel pumps require a service profile (authored fuel canopy / service station).
 * - Residential houses and apartments take the residence profile.
 * - Civic halls, shops, and offices take the shop profile.
 * - Industrial yards take contractor; pump houses and towers take utility.
 */
export function identityFromArchetype(archetype: Pick<Archetype, "id" | "kind" | "traits">): LotIdentity {
  const uses = archetype.traits?.use ?? [];
  if (uses.some((use) => FUEL_USES.has(use)) || FUEL_ID.test(archetype.id)) return "service";
  if (uses.some((use) => FARM_USES.has(use)) || FARM_ID.test(archetype.id)) return "farm";
  if (uses.some((use) => UTILITY_USES.has(use)) || UTILITY_ID.test(archetype.id)) return "utility";
  if (
    uses.some((use) => CIVIC_USES.has(use))
    || archetype.traits?.style?.includes("civic")
  ) return "shop";
  switch (archetype.kind) {
    case "industrial":
      return "contractor";
    case "shop":
      return "shop";
    case "house":
      return "residence";
    default: {
      const _never: never = archetype.kind;
      return _never;
    }
  }
}

export function identityFromBuilding(building: Building): LotIdentity {
  const archetype = ARCHETYPES.find((entry) => entry.id === building.archetypeId);
  if (archetype) return identityFromArchetype(archetype);
  switch (building.kind) {
    case "industrial":
      return "contractor";
    case "shop":
      return "shop";
    case "house":
      return "residence";
    default: {
      const _never: never = building.kind;
      return _never;
    }
  }
}

export function lotAllowsFuel(identity: LotIdentity): boolean {
  return identity === "service";
}

export function lotAllowsAgriculture(identity: LotIdentity): boolean {
  return identity === "farm";
}
