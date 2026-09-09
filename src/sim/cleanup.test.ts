import { describe, expect, it } from "vitest";
import { DEBRIS, SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { createDozer } from "../vehicle/dozer";
import { createTown } from "../world/town";
import { addDebrisBody, enforceDistanceCleanup, lastDebrisStats, stepDebris, totalDebrisMass } from "./debris";
import type { Rubble } from "../structure/types";

function sleep(r: Rubble, touchedAt = -10): void {
  r.sleeping = true;
  r.sleepT = 1;
  r.vx = 0;
  r.vy = 0;
  r.omega = 0;
  r.touchedAt = touchedAt;
}

function fillRemnants(town: ReturnType<typeof createTown>, n: number, startX = 12): Rubble[] {
  const out: Rubble[] = [];
  for (let i = 0; i < n; i++) {
    out.push(
      addDebrisBody(town, {
        x: Math.min(town.maxX - 1.2, startX + i * 0.22),
        y: 18 + (i % 3) * 0.15,
        w: 0.4,
        d: 0.28,
        material: "concrete",
        layer: "remnant",
        mass: 0.4,
      }),
    );
  }
  return out;
}

describe("distance-ordered debris cleanup", () => {
  it("absorbs the furthest eligible remnant first when the cap is exceeded", () => {
    const town = createTown();
    const bodies = fillRemnants(town, DEBRIS.remnantCap + 3, 14);
    for (const r of bodies) sleep(r);
    const furthest = [...bodies].sort((a, b) => b.x - a.x)[0]!;
    const dozer = createDozer(2, 2, 0);
    stepDebris(town, dozer, new ParticlePool(), [], 1, SIM_DT);
    expect(town.rubble.some((r) => r.id === furthest.id)).toBe(false);
    expect(town.rubble.filter((r) => r.layer === "remnant").length).toBeLessThanOrEqual(DEBRIS.remnantCap);
  });

  it("breaks equal-distance ties by higher body id first", () => {
    const town = createTown();
    for (let i = 0; i < DEBRIS.remnantCap - 1; i++) {
      sleep(
        addDebrisBody(town, {
          x: 16 + (i % 8) * 0.2,
          y: 18,
          w: 0.3,
          d: 0.22,
          material: "brick",
          layer: "remnant",
          mass: 0.3,
        }),
      );
    }
    const a = addDebrisBody(town, {
      x: 40,
      y: 18,
      w: 0.3,
      d: 0.22,
      material: "brick",
      layer: "remnant",
      mass: 0.3,
    });
    const b = addDebrisBody(town, {
      x: 40,
      y: 18,
      w: 0.3,
      d: 0.22,
      material: "brick",
      layer: "remnant",
      mass: 0.3,
    });
    sleep(a);
    sleep(b);
    expect(b.id).toBeGreaterThan(a.id);
    enforceDistanceCleanup(town, 2, 2, new Set());
    expect(town.rubble.some((r) => r.id === b.id)).toBe(false);
    expect(town.rubble.some((r) => r.id === a.id)).toBe(true);
  });

  it("protects nearby debris from normal cleanup", () => {
    const town = createTown();
    const near = addDebrisBody(town, {
      x: 3.2,
      y: 2.4,
      w: 0.4,
      d: 0.28,
      material: "wood",
      layer: "remnant",
      mass: 0.35,
    });
    sleep(near);
    fillRemnants(town, DEBRIS.remnantCap, 20).forEach((r) => sleep(r));
    stepDebris(town, createDozer(2, 2, 0), new ParticlePool(), [], 1, SIM_DT);
    expect(town.rubble.some((r) => r.id === near.id)).toBe(true);
  });

  it("does not immediately clean a recently moved body", () => {
    const town = createTown();
    fillRemnants(town, DEBRIS.remnantCap, 16).forEach((r) => sleep(r));
    const recent = addDebrisBody(town, {
      x: 42,
      y: 18,
      w: 0.4,
      d: 0.28,
      material: "concrete",
      layer: "remnant",
      mass: 0.4,
    });
    recent.sleeping = true;
    recent.touchedAt = 0;
    enforceDistanceCleanup(town, 2, 2, new Set());
    expect(town.rubble.some((r) => r.id === recent.id)).toBe(true);
  });

  it("emergency cleanup still enforces the hard cap", () => {
    const town = createTown();
    const n = DEBRIS.remnantCap + DEBRIS.hardOverflow + 8;
    fillRemnants(town, n, 14);
    const dozer = createDozer(2, 2, 0);
    stepDebris(town, dozer, new ParticlePool(), [], 1, SIM_DT);
    expect(town.rubble.filter((r) => r.layer === "remnant").length).toBeLessThanOrEqual(
      DEBRIS.remnantCap + DEBRIS.hardOverflow,
    );
    expect(lastDebrisStats().emergencyCleanups).toBeGreaterThan(0);
  });

  it("absorbing debris preserves approximate total mass", () => {
    const town = createTown();
    fillRemnants(town, DEBRIS.remnantCap + 6, 15).forEach((r) => sleep(r));
    const before = totalDebrisMass(town);
    enforceDistanceCleanup(town, 2, 2, new Set());
    expect(Math.abs(totalDebrisMass(town) - before)).toBeLessThan(0.04);
    expect(town.rubble.filter((r) => r.layer === "remnant").length).toBeLessThanOrEqual(DEBRIS.remnantCap);
  });
});
