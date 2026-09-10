import { describe, expect, it } from "vitest";
import { ASSET_CATALOG, NEW_ASSET_IDS, assetsByFamily, spawnAsset, validateCatalog } from "./catalog";

describe("destructible asset catalog", () => {
  it("has unique ids and valid definitions", () => {
    const report = validateCatalog();
    expect(report.issues, report.issues.map((i) => i.detail).join("; ")).toEqual([]);
    expect(report.ok).toBe(true);
    const ids = ASSET_CATALOG.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers all five new families with at least 16 assets", () => {
    expect(NEW_ASSET_IDS.length).toBeGreaterThanOrEqual(16);
    expect(assetsByFamily("residential").length).toBeGreaterThanOrEqual(1);
    expect(assetsByFamily("agricultural").length).toBeGreaterThanOrEqual(1);
    expect(assetsByFamily("commercial").length).toBeGreaterThanOrEqual(1);
    expect(assetsByFamily("roadside").length).toBeGreaterThanOrEqual(1);
    expect(assetsByFamily("vegetation").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps legacy camera and pole entries for existing gags", () => {
    expect(ASSET_CATALOG.some((a) => a.id === "camera" && a.birdGag)).toBe(true);
    expect(ASSET_CATALOG.some((a) => a.id === "light" && a.trackHazard > 0)).toBe(true);
  });

  it("spawns runtime instances without mutating definitions", () => {
    const a = spawnAsset("mailbox", 1, 2, 0.2, 1);
    const b = spawnAsset("mailbox", 3, 4, 0.4, 1);
    expect(a.id).not.toBe(b.id);
    expect(a.assetId).toBe("mailbox");
    expect(a.hp).toBe(a.maxHp);
    a.hp = 1;
    expect(spawnAsset("mailbox", 0, 0).hp).toBeGreaterThan(1);
  });
});
