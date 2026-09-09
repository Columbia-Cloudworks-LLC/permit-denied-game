import { describe, expect, it } from "vitest";
import { SpatialHash } from "./spatial";

describe("SpatialHash", () => {
  it("does not collide distant cells onto the same key", () => {
    const hash = new SpatialHash<string>(1);
    hash.insert(0, 600, 0.2, 0.2, "far");
    hash.insert(1, -424, 0.2, 0.2, "near");
    const far: string[] = [];
    const near: string[] = [];
    hash.query(0, 600, 0.2, 0.2, far);
    hash.query(1, -424, 0.2, 0.2, near);
    expect(far).toEqual(["far"]);
    expect(near).toEqual(["near"]);
  });
});
