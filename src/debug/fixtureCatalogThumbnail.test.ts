import { describe, expect, it } from "vitest";
import { interiorCmds } from "../render/interiorDraw";
import { fixtureExposed } from "../structure/interior";
import { discoverYardAssets } from "../world/yardCatalog";
import { createIsolateLot } from "./isolateLot";

describe("fixture catalog thumbnails", () => {
  const fixtures = discoverYardAssets().filter((a) => a.category === "fixture");

  it("registers every interior fixture as a catalog card", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(33);
    expect(fixtures.every((a) => a.id.startsWith("fixture:") && a.fixture)).toBe(true);
  });

  it("hides the named fixture behind the intact host and reveals it in the ground-floor cutaway", () => {
    const signatures = new Map<string, string>();
    for (const asset of fixtures) {
      const { bay } = createIsolateLot(asset);
      const b = bay.building!;
      const named = b.fixtures.filter((f) => f.kind === asset.fixture && f.floor === 0);
      expect(named.length, asset.id).toBeGreaterThan(0);
      expect(named.every((f) => !fixtureExposed(b, f)), asset.id).toBe(true);
      const intact = interiorCmds(b, 1, { reveal: false });
      expect(intact.filter((c) => c.kind === "fixture" || c.kind === "partition"), asset.id).toHaveLength(0);
      const cutaway = interiorCmds(b, 1, { reveal: true, maxFloor: 0 });
      expect(cutaway.some((c) => c.kind === "fixture" || c.kind === "partition"), asset.id).toBe(true);
      signatures.set(
        asset.id,
        named.map((f) => `${f.kind}:${f.w.toFixed(2)}:${f.d.toFixed(2)}:${f.h.toFixed(2)}`).join("|"),
      );
    }
    expect(signatures.get("fixture:interior-bed")).not.toBe(signatures.get("fixture:interior-pinsetter"));
    expect(signatures.get("fixture:interior-bottling-line")).not.toBe(signatures.get("fixture:interior-vehicle-ramp"));
    expect(signatures.get("fixture:interior-bed")).not.toBe(signatures.get("fixture:interior-bottling-line"));
  });
});
