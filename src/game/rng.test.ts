import { describe, expect, it } from "vitest";
import { Rng } from "./rng";

describe("Rng.pick", () => {
  it("returns an item from a non-empty list", () => {
    const rng = new Rng(1);
    expect(["a", "b", "c"]).toContain(rng.pick(["a", "b", "c"]));
  });

  it("throws when the list is empty", () => {
    const rng = new Rng(1);
    expect(() => rng.pick([])).toThrow(/no items/);
  });
});
