import { describe, expect, it } from "vitest";
import { ARCHETYPES, archetypeById } from "./archetypes";
import {
  identityFromArchetype,
  identityFromBuilding,
  lotAllowsAgriculture,
  lotAllowsFuel,
  LOT_USE_PROFILES,
} from "./lotUse";
import { AGRICULTURAL_PROPS, lotUseViolations } from "./lotUseChecks";
import { createTown } from "./town";

function expectLotUse(town: ReturnType<typeof createTown>, label: string): void {
  expect(lotUseViolations(town), label).toEqual([]);
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
    expect(identityFromArchetype(archetypeById("governors-mansion"))).toBe("shop");
    expect(identityFromArchetype(archetypeById("city-hall"))).toBe("shop");
    expect(identityFromArchetype(archetypeById("mansion-service"))).toBe("utility");
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
