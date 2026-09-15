import { describe, expect, it } from "vitest";
import { WALL_OCCLUDE_NEAR, objectOcclusionFade } from "../render/occlusion";
import { discoverYardAssets, instantiateBay, type YardBay } from "../world/yardCatalog";
import { CATALOG_CAPTURE_DOZER } from "./catalogCaptureDozer";

describe("catalog capture dozer", () => {
  it("stays far outside fixture-host cutaway range", () => {
    const asset = discoverYardAssets().find((a) => a.id === "fixture:interior-bed")!;
    const pad = Math.max(12, asset.clearance);
    const bay: YardBay = {
      key: "capture:fixture:interior-bed",
      asset,
      variant: 0,
      baseline: false,
      intactFacade: true,
      x: pad - asset.clearance,
      y: pad - asset.clearance,
      w: asset.w + pad * 2,
      d: asset.d + pad * 2,
    };
    instantiateBay(bay);
    const b = bay.building!;
    expect(b.cells.every((c) => c.state !== "gone")).toBe(true);
    const southY = b.y + b.d * b.cellSize;
    const eastX = b.x + b.w * b.cellSize;
    expect(southY - CATALOG_CAPTURE_DOZER.y).toBeGreaterThan(WALL_OCCLUDE_NEAR);
    expect(eastX - CATALOG_CAPTURE_DOZER.x).toBeGreaterThan(WALL_OCCLUDE_NEAR);
    expect(objectOcclusionFade(CATALOG_CAPTURE_DOZER, b.x, southY - 0.08, b.w * b.cellSize, 0.08, 0, 4)).toBe(1);
  });
});
