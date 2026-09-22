import { describe, expect, it } from "vitest";
import { createTown } from "../world/town";
import { frameTownOverview } from "./overviewFrame";

describe("town overview framing", () => {
  it("keeps the surface inside the playfield between the HUD bars", () => {
    const town = createTown({ district: "d10", seed: 19 });
    const wide = frameTownOverview(town, 1533, 1066);
    const narrow = frameTownOverview(town, 390, 844);
    expect(wide.zoom).toBeGreaterThan(0.1);
    expect(wide.zoom).toBeLessThanOrEqual(0.95);
    expect(narrow.zoom).toBeLessThanOrEqual(wide.zoom);
    expect(Number.isFinite(wide.camX)).toBe(true);
    expect(Number.isFinite(wide.camY)).toBe(true);
  });
});
