import { describe, expect, it } from "vitest";
import { createTown } from "./town";
import { validateTown } from "./districts";
import { CLASSIC_PLACEMENTS } from "./families";

function layoutSig(town: ReturnType<typeof createTown>): string {
  return town.buildings
    .map((b) => `${b.archetypeId}:${b.name}:${b.x.toFixed(3)}:${b.y.toFixed(3)}:${b.w}x${b.d}:${b.floors}:${b.roof}:${b.cells[0]!.material}`)
    .join("|");
}

describe("generation smoke", () => {
  it("keeps the classic seven-building fixture", () => {
    const town = createTown();
    expect(town.buildings).toHaveLength(7);
    expect(town.buildings.map((b) => b.name)).toEqual(CLASSIC_PLACEMENTS.map((p) => p.name));
    expect(validateTown(town).ok).toBe(true);
  });

  it("builds a deterministic 10-building district", () => {
    const a = createTown({ district: "d10", seed: 0x51a11 });
    const b = createTown({ district: "d10", seed: 0x51a11 });
    expect(a.buildings).toHaveLength(10);
    expect(layoutSig(a)).toBe(layoutSig(b));
    const report = validateTown(a);
    expect(report.issues, report.issues.map((i) => i.detail).join("; ")).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
