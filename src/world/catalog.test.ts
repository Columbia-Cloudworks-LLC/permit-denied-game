import { describe, expect, it } from "vitest";
import { PAL } from "../render/palette";
import { ASSET_CATALOG, ASSET_IDS, assetsByFamily, spawnAsset, validateCatalog } from "./catalog";

function srgbChannel(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: number): number {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

function contrastRatio(a: number, b: number): number {
  const left = relativeLuminance(a);
  const right = relativeLuminance(b);
  const hi = Math.max(left, right);
  const lo = Math.min(left, right);
  return (hi + 0.05) / (lo + 0.05);
}

describe("destructible asset catalog", () => {
  it("has unique ids and valid definitions", () => {
    const report = validateCatalog();
    expect(report.issues, report.issues.map((i) => i.detail).join("; ")).toEqual([]);
    expect(report.ok).toBe(true);
    const ids = ASSET_CATALOG.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers all five new families with at least 16 assets", () => {
    expect(ASSET_IDS.length).toBeGreaterThanOrEqual(16);
    expect(assetsByFamily("residential").length).toBeGreaterThanOrEqual(1);
    expect(assetsByFamily("agricultural").length).toBeGreaterThanOrEqual(1);
    expect(assetsByFamily("commercial").length).toBeGreaterThanOrEqual(1);
    expect(assetsByFamily("roadside").length).toBeGreaterThanOrEqual(1);
    expect(assetsByFamily("vegetation").length).toBeGreaterThanOrEqual(1);
    for (const id of ["oak", "pine", "oak-sapling", "pine-sapling", "oak-shrub", "pine-shrub"]) {
      expect(ASSET_IDS).toContain(id);
    }
  });

  it("defines camera and pole behavior through catalog capabilities", () => {
    expect(ASSET_CATALOG.some((a) => a.id === "camera" && a.birdGag)).toBe(true);
    expect(ASSET_CATALOG.some((a) => a.id === "light" && a.trackHazard > 0)).toBe(true);
  });

  it("gives the traffic camera a readable housing, lens, and aiming arm", () => {
    const camera = ASSET_CATALOG.find((asset) => asset.id === "camera");
    expect(camera).toBeDefined();
    if (!camera) return;
    expect(camera.footprint).toEqual({ w: 0.26, d: 0.26, h: 2.2 });
    expect(camera.collision).toEqual({ w: 0.26, d: 0.26 });
    expect(camera.birdGag).toBe(true);
    expect(camera.boxes.length).toBeGreaterThanOrEqual(4);
    const post = camera.boxes[0]!;
    const arm = camera.boxes[1]!;
    const housing = camera.boxes[2]!;
    const lens = camera.boxes[3]!;
    expect(arm.along).toBeGreaterThan(post.along);
    expect(housing.along).toBeGreaterThan(arm.along);
    expect(lens.along).toBeGreaterThan(housing.along);
    expect(housing.len).toBeGreaterThan(arm.wid);
    expect(lens.h).toBeLessThan(housing.h);
    const canvas = 0x3a4a24;
    const playBackgrounds = [canvas, PAL.grass, PAL.asphalt];
    for (const background of playBackgrounds) {
      expect(contrastRatio(housing.top, background), `housing vs 0x${background.toString(16)}`).toBeGreaterThan(2.4);
      expect(contrastRatio(lens.top, background), `lens vs 0x${background.toString(16)}`).toBeGreaterThan(2.4);
    }
    expect(contrastRatio(housing.top, PAL.lot)).toBeGreaterThan(1.8);
    expect(contrastRatio(housing.top, canvas)).toBeGreaterThan(contrastRatio(0x3a3a36, canvas) + 1);
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
