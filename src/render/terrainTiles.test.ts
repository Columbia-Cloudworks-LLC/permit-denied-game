import { describe, expect, it } from "vitest";
import { BLOB_CARDINAL_INDEX, BLOB_FULL_INDEX, blob47Masks, blobIndex47 } from "./terrainTiles";

describe("autotile blob mask", () => {
  it("compacts the 8-neighbor bitmask to 47 unique indices", () => {
    expect(blob47Masks()).toHaveLength(47);
    expect(new Set(blob47Masks()).size).toBe(47);
  });

  it("maps a documented 3×3 cardinal fixture to a stable 47-index", () => {
    // . M .
    // M C M
    // . M .
    expect(blobIndex47(true, false, true, false, true, false, true, false)).toBe(BLOB_CARDINAL_INDEX);
    expect(BLOB_CARDINAL_INDEX).toBeGreaterThanOrEqual(0);
    expect(BLOB_CARDINAL_INDEX).toBeLessThan(47);
  });

  it("maps a fully surrounded 3×3 fixture to the last blob index", () => {
    expect(blobIndex47(true, true, true, true, true, true, true, true)).toBe(BLOB_FULL_INDEX);
    expect(BLOB_FULL_INDEX).toBe(46);
  });
});
