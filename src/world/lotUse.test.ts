import { describe, expect, it } from "vitest";
import { ARCHETYPES, archetypeById } from "./archetypes";
import { DRESS_TEMPLATES } from "./dressing";
import {
  identityFromArchetype,
  identityFromBuilding,
  lotAllowsAgriculture,
  lotAllowsFuel,
  LOT_USE_PROFILES,
} from "./lotUse";
import { createTown } from "./town";
import type { FieldFeature } from "./terrainFeatures";

const AGRICULTURAL_PROPS = new Set([
  "hay-bale-round",
  "hay-bale-square",
  "water-trough",
  "farm-implement",
  "tractor",
  "grain-bin",
]);

function expectLotUse(town: ReturnType<typeof createTown>, label: string): void {
  const byLot = new Map(town.lots.map((lot) => [lot.id, lot]));
  for (const building of town.buildings) {
    const lot = byLot.get(building.lotId ?? "");
    if (!lot) continue;
    expect(lot.identity, `${label} ${building.archetypeId} ${lot.id}`).toBe(identityFromBuilding(building));
    const template = DRESS_TEMPLATES.find((entry) => entry.id === lot.templateId);
    expect(template?.identities, `${label} ${lot.id} template`).toContain(lot.identity);
  }
  for (const prop of town.props) {
    if (!prop.lotId) continue;
    const lot = byLot.get(prop.lotId);
    if (!lot) continue;
    if (prop.assetId === "fuel-pump") {
      expect(lotAllowsFuel(lot.identity), `${label} fuel-pump on ${lot.id}`).toBe(true);
    }
    if (AGRICULTURAL_PROPS.has(prop.assetId)) {
      expect(lotAllowsAgriculture(lot.identity), `${label} ${prop.assetId} on ${lot.id}`).toBe(true);
    }
  }
  for (const feature of town.features) {
    if (feature.kind !== "field" || !feature.lotId) continue;
    const field = feature as FieldFeature;
    const lot = byLot.get(field.lotId ?? "");
    expect(lot, `${label} field ${field.id}`).toBeTruthy();
    expect(lotAllowsAgriculture(lot!.identity), `${label} field on ${lot!.id}`).toBe(true);
  }
}

describe("lot-use matching", () => {
  it("maps authored archetypes onto documented profiles", () => {
    expect(identityFromArchetype(archetypeById("ranch"))).toBe("residence");
    expect(identityFromArchetype(archetypeById("walkup"))).toBe("residence");
    expect(identityFromArchetype(archetypeById("apartment-tower"))).toBe("residence");
    expect(identityFromArchetype(archetypeById("laundry-lofts"))).toBe("shop");
    expect(identityFromArchetype(archetypeById("laundromat"))).toBe("shop");
    expect(identityFromArchetype(archetypeById("farmhouse-rear-wing"))).toBe("farm");
    expect(identityFromArchetype(archetypeById("gable-barn"))).toBe("farm");
    expect(identityFromArchetype(archetypeById("service-station-canopy"))).toBe("service");
    expect(identityFromArchetype(archetypeById("pump-house"))).toBe("utility");
    expect(lotAllowsFuel("residence")).toBe(false);
    expect(lotAllowsFuel("service")).toBe(true);
    expect(lotAllowsAgriculture("residence")).toBe(false);
    expect(lotAllowsAgriculture("farm")).toBe(true);
    for (const archetype of ARCHETYPES) {
      expect(LOT_USE_PROFILES).toContain(identityFromArchetype(archetype));
    }
  });

  it("does not give county ranches fuel pumps or farm yards to walkups", () => {
    const town = createTown({ district: "d10", seed: 19, topology: "county" });
    expectLotUse(town, "county seed 19");
    const ranches = town.buildings.filter((building) => building.archetypeId === "ranch");
    for (const building of ranches) {
      const lot = town.lots.find((entry) => entry.id === building.lotId);
      expect(lot?.identity).toBe("residence");
      expect(town.props.some((prop) => prop.lotId === building.lotId && prop.assetId === "fuel-pump")).toBe(false);
    }
    const walkups = town.buildings.filter((building) => building.archetypeId === "walkup");
    for (const building of walkups) {
      expect(lotAllowsAgriculture(identityFromBuilding(building))).toBe(false);
      expect(town.props.some((prop) => prop.lotId === building.lotId && AGRICULTURAL_PROPS.has(prop.assetId))).toBe(false);
    }
  });
});
