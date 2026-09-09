import { describe, expect, it } from "vitest";
import { PileField, pileBlocked, pileResistance, queryObstruction } from "./pile";

describe("pile field excavation", () => {
  it("deducts extracted mass immediately and keeps composition", () => {
    const pile = new PileField(0, 0, 8, 8);
    pile.addMass(2, 2, 4, "brick");
    pile.addMass(2.1, 2, 1.2, "wood");
    const before = pile.totalMass();
    const taken = pile.extractDisk(2, 2, 0.9, 2.5);
    expect(taken.mass).toBeGreaterThan(2.4);
    expect(pile.totalMass()).toBeCloseTo(before - taken.mass, 3);
    expect(taken.material === "brick" || taken.material === "wood").toBe(true);
    pile.addMass(3.2, 2, taken.mass, taken.material);
    expect(Math.abs(pile.totalMass() - before)).toBeLessThan(0.05);
  });

  it("treats a tall pile as a blocked obstruction", () => {
    const pile = new PileField(0, 0, 8, 8);
    pile.addMass(2, 2, 12, "concrete");
    const obs = queryObstruction(pile, [], 2, 2, 0.7);
    expect(obs.height).toBeGreaterThan(0.18);
    expect(obs.blocked).toBe(true);
    expect(pileBlocked(obs.height, obs.resistance, 0, obs.height && pile.sample(2, 2).mass)).toBe(true);
    expect(pileResistance(obs.height, obs.compaction, pile.sample(2, 2).mass)).toBeGreaterThan(1);
  });
});
