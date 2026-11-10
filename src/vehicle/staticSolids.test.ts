import { expect, it } from "vitest";
import { ParticlePool } from "../fx/particles";
import { applyCellDamage, createBuildingFromArchetype } from "../structure/building";
import { buildingSolids } from "./world";

it("counts a column whose cladding is stripped, so vehicles stop hitting the old wall-sized box", () => {
  const b = createBuildingFromArchetype("steel-warehouse", "SKIN", 0, 0);
  const column = b.cells.find((c) => c.floor === 0 && c.role === "column" && c.cladding)!;
  const before = { ...buildingSolids(b) };
  applyCellDamage(b, column, column.cladding!.hp, 0, 1, new ParticlePool(), []);
  // The column still stands, but its footprint shrank: the stamp must move.
  expect(column.hp).toBeGreaterThan(0);
  const after = buildingSolids(b);
  expect(after.standing).toBe(before.standing);
  expect(after.stripped).toBe(before.stripped + 1);
  // Destroying the stripped column moves the standing count instead.
  applyCellDamage(b, column, 999, 0, 1, new ParticlePool(), []);
  expect(buildingSolids(b).standing).toBe(before.standing - 1);
});
