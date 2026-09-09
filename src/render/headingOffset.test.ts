import { describe, expect, it } from "vitest";
import { headingOffset } from "./drawIso";

describe("headingOffset", () => {
  it("moves along +X when heading is 0", () => {
    const p = headingOffset(10, 20, 0, 2, 0);
    expect(p.x).toBeCloseTo(12);
    expect(p.y).toBeCloseTo(20);
  });

  it("rotates the whole machine when heading turns 90 degrees", () => {
    const blade = headingOffset(0, 0, -Math.PI / 2, 1.4, 0);
    expect(blade.x).toBeCloseTo(0);
    expect(blade.y).toBeCloseTo(-1.4);
    const cab = headingOffset(0, 0, -Math.PI / 2, 0, -0.16);
    expect(cab.x).toBeCloseTo(-0.16);
    expect(cab.y).toBeCloseTo(0);
  });
});
