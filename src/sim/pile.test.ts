import { describe, expect, it } from "vitest";
import { PILE_TILE, PileField, pileBlocked, pileResistance, queryObstruction } from "./pile";

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

  it("does not revise a saturated pile during extra compaction", () => {
    const pile = new PileField(0, 0, 8, 8);
    pile.addMass(2, 2, 6, "concrete");
    pile.compactPoint(2, 2, 8);
    const revision = pile.revision;
    const height = pile.heightAt(2, 2);
    pile.compactPoint(2, 2, 8);
    expect(pile.revision).toBe(revision);
    expect(pile.heightAt(2, 2)).toBeCloseTo(height, 5);
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

  it("dirties only the tiles a mutation and its sampling apron reach", () => {
    const pile = new PileField(0, 0, 64, 64);
    const span = PILE_TILE * pile.cell;
    const tile = (x: number, y: number) => Math.floor(y / span) * pile.tilesX + Math.floor(x / span);
    const before = Array.from(pile.tileRevision);
    pile.addMass(span * 1.5, span * 1.5, 2, "brick");
    const moved = Array.from(pile.tileRevision).flatMap((r, t) => (r !== before[t] ? [t] : []));
    expect(moved).toEqual([tile(span * 1.5, span * 1.5)]);
    const edge = Array.from(pile.tileRevision);
    pile.compactPoint(span * 2 + 0.1, span * 1.5, 0.5);
    const touched = Array.from(pile.tileRevision).flatMap((r, t) => (r !== edge[t] ? [t] : []));
    expect(touched).toEqual([tile(span * 1.5, span * 1.5), tile(span * 2.5, span * 1.5)]);
    const quiet = Array.from(pile.tileRevision);
    pile.compactPoint(span * 2 + 0.1, span * 1.5, 0);
    expect(Array.from(pile.tileRevision)).toEqual(quiet);
  });

  it("keeps a running mass close to the exact total through adds, scoops and clears", () => {
    const pile = new PileField(0, 0, 12, 12, 0.5);
    for (let i = 0; i < 200; i++) pile.addMass(1 + (i % 20) * 0.5, 1 + (i % 7), 0.37, i % 2 ? "brick" : "wood", i % 5 ? "yard-a" : undefined);
    for (let i = 0; i < 40; i++) pile.extractDisk(2 + (i % 9), 3, 0.78, 0.25);
    pile.clearArea(0, 0, 3, 3);
    pile.removeOwner("yard-a");
    expect(pile.massEstimate()).toBeCloseTo(pile.totalMass(), 3);
    const grown = pile.grow(20, 20);
    expect(grown.massEstimate()).toBeCloseTo(grown.totalMass(), 3);
    // Carried mass must repaint in the new field.
    expect(grown.tileRevisionAt(5, 5)).toBeGreaterThan(0);
  });

  it("reports the tile revision a read at a point depends on", () => {
    const pile = new PileField(0, 0, 40, 40, 0.5);
    const span = PILE_TILE * pile.cell;
    const near = pile.tileRevisionAt(span * 1.5, span * 1.5), far = pile.tileRevisionAt(span * 6.5, span * 6.5);
    pile.addMass(span * 1.5, span * 1.5, 1, "concrete");
    expect(pile.tileRevisionAt(span * 1.5, span * 1.5)).toBeGreaterThan(near);
    expect(pile.tileRevisionAt(span * 6.5, span * 6.5)).toBe(far);
    expect(pile.tileRevisionAt(-5, 2)).toBe(0);
    // Field reads without allocation agree with the sampled record.
    const s = pile.sample(span * 1.5 + 0.2, span * 1.5 - 0.1);
    expect(pile.heightAt(span * 1.5 + 0.2, span * 1.5 - 0.1)).toBe(s.height);
    expect(pile.massAt(span * 1.5 + 0.2, span * 1.5 - 0.1)).toBe(s.mass);
    expect(pile.compactAt(span * 1.5 + 0.2, span * 1.5 - 0.1)).toBe(s.compact);
    const slope = pile.slope(span * 1.5 + 0.6, span * 1.5);
    expect(slope.dx).toBe(pile.slopeX(span * 1.5 + 0.6, span * 1.5));
    expect(slope.dx).toBeLessThan(0);
    expect(pile.materialAt(span * 1.5, span * 1.5)).toBe("concrete");
    expect(pile.materialAt(-3, -3)).toBe("concrete");
  });
});
