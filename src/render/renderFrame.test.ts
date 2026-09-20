import { describe, expect, it } from "vitest";
import { DRAW_PASSES } from "./renderFrame";

describe("named render passes", () => {
  it("lists terrain, structures, dynamics, effects, and submit in painter order", () => {
    expect(DRAW_PASSES).toEqual([
      "yard",
      "terrain",
      "ground",
      "sites",
      "marks",
      "nhood",
      "buildings",
      "props",
      "garnish",
      "dynamics",
      "effects",
      "submit",
    ]);
  });
});
