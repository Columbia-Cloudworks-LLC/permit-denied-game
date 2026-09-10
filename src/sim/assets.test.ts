import { describe, expect, it } from "vitest";
import { ParticlePool } from "../fx/particles";
import { resetPropIds, spawnAsset } from "../world/catalog";
import { createTown } from "../world/town";
import { applyAssetHit, destroyProp } from "./assets";
import { totalDebrisMass } from "./debris";
import { getAsset } from "../world/catalog";
import { validateTown } from "../world/districts";

describe("catalog destruction", () => {
  it("removes collision after an asset is destroyed", () => {
    resetPropIds();
    const town = createTown();
    const mailbox = spawnAsset("mailbox", town.spawnX + 3, town.spawnY);
    town.props.push(mailbox);
    const particles = new ParticlePool();
    destroyProp(town, mailbox, particles, [], town.spawnX, town.spawnY);
    expect(mailbox.broken).toBe(true);
    expect(town.props.filter((p) => !p.broken && p.id === mailbox.id)).toHaveLength(0);
  });

  it("topples a mature tree into elongated remnant debris", () => {
    resetPropIds();
    const town = createTown();
    const tree = spawnAsset("mature-tree", 8, 8);
    town.props.push(tree);
    applyAssetHit(tree, 40, 1, 0);
    const before = town.rubble.length;
    destroyProp(town, tree, new ParticlePool(), [], 6, 8);
    expect(tree.broken).toBe(true);
    expect(town.rubble.length).toBeGreaterThan(before);
    expect(town.rubble.some((r) => r.w > r.d)).toBe(true);
  });

  it("rolls or crushes hay according to profile", () => {
    resetPropIds();
    const town = createTown();
    const round = spawnAsset("hay-bale-round", 10, 10);
    const square = spawnAsset("hay-bale-square", 14, 10);
    town.props.push(round, square);
    const mass0 = totalDebrisMass(town);
    destroyProp(town, round, new ParticlePool(), [], 9, 10);
    destroyProp(town, square, new ParticlePool(), [], 13, 10);
    expect(round.broken).toBe(true);
    expect(square.broken).toBe(true);
    expect(totalDebrisMass(town)).toBeGreaterThan(mass0);
    expect(town.rubble.some((r) => Math.hypot(r.vx, r.vy) > 0.5)).toBe(true);
  });

  it("explodes a propane tank but does not chain forever", () => {
    resetPropIds();
    const town = createTown();
    const a = spawnAsset("propane-tank", 12, 12);
    const b = spawnAsset("propane-tank", 13.2, 12);
    const c = spawnAsset("propane-tank", 14.4, 12);
    town.props.push(a, b, c);
    const events: { kind: string }[] = [];
    destroyProp(town, a, new ParticlePool(), events as never, 11, 12, 0);
    const blasts = events.filter((e) => e.kind === "blast").length;
    expect(blasts).toBeLessThanOrEqual(2);
    expect(a.broken).toBe(true);
    expect(getAsset("propane-tank").destruction).toBe("explosive");
  });

  it("accounts for new debris mass after dressing destruction", () => {
    const town = createTown({ district: "d10", seed: 5 });
    const particles = new ParticlePool();
    const before = totalDebrisMass(town);
    for (const p of town.props.slice(0, 6)) {
      if (!p.broken) destroyProp(town, p, particles, [], p.x - 1, p.y);
    }
    expect(totalDebrisMass(town)).toBeGreaterThanOrEqual(before);
    expect(validateTown(town).ok).toBe(true);
  });
});
