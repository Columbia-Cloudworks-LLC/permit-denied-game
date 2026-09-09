import { describe, expect, it } from "vitest";
import { createTown } from "./town";
import { validateTown } from "./districts";
import { CLASSIC_PLACEMENTS } from "./families";

function layoutSig(town: ReturnType<typeof createTown>): string {
  return town.buildings
    .map((b) => `${b.archetypeId}:${b.name}:${b.x.toFixed(3)}:${b.y.toFixed(3)}:${b.w}x${b.d}:${b.floors}:${b.roof}:${b.cells[0]!.material}`)
    .join("|");
}

describe("district generation", () => {
  it("keeps the classic seven-building fixture", () => {
    const town = createTown();
    expect(town.buildings).toHaveLength(7);
    expect(town.buildings.map((b) => b.name)).toEqual(CLASSIC_PLACEMENTS.map((p) => p.name));
    expect(validateTown(town).ok).toBe(true);
  });

  it("builds deterministic 10, 30, and 100 building districts", () => {
    for (const district of ["d10", "d30", "d100"] as const) {
      const a = createTown({ district, seed: 0x51a11 });
      const b = createTown({ district, seed: 0x51a11 });
      expect(a.buildings.length).toBe(district === "d10" ? 10 : district === "d30" ? 30 : 100);
      expect(layoutSig(a)).toBe(layoutSig(b));
      const report = validateTown(a);
      expect(report.issues, report.issues.map((i) => i.detail).join("; ")).toEqual([]);
      expect(report.ok).toBe(true);
    }
  });

  it("changes layout when the seed changes and restores it on restart", () => {
    const a = createTown({ district: "d10", seed: 11 });
    const b = createTown({ district: "d10", seed: 12 });
    expect(layoutSig(a)).not.toBe(layoutSig(b));
    const saved = layoutSig(a);
    a.buildings[0]!.cells[0]!.state = "gone";
    const again = createTown({ district: "d10", seed: 11 });
    expect(again.buildings.every((building) => building.cells.every((c) => c.state === "intact"))).toBe(true);
    expect(layoutSig(again)).toBe(saved);
  });

  it("derives pile coverage and vehicle spawns from the selected district", () => {
    const town = createTown({ district: "d30", seed: 3 });
    expect(town.pile.ox).toBeLessThanOrEqual(town.minX);
    expect(town.pile.oy).toBeLessThanOrEqual(town.minY);
    expect(town.roadSpawnX).toBeGreaterThan(town.minX);
    expect(town.spawnY).toBeGreaterThan(town.minY);
    expect(validateTown(town).ok).toBe(true);
  });
});
