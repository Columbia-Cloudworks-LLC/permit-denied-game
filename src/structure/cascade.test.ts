import { expect, it } from "vitest";
import { SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { createTown } from "../world/town";
import { applyCellDamage, stepStructures } from "./building";

it("lets unsupported cells go in a ragged run, each within its share of the failure delay", () => {
  const town = createTown();
  const b = town.buildings.find((x) => x.floors >= 2 && !x.coreCollapse)!;
  expect(b).toBeDefined();
  const particles = new ParticlePool();
  for (const cell of b.cells) if (cell.floor === 0) applyCellDamage(b, cell, 999, 1, 0, particles, []);
  const upper = b.cells.filter((cell) => cell.floor === 1);
  const fellAt = new Map<object, number>();
  for (let step = 1; step <= 180; step++) {
    stepStructures([b], SIM_DT, particles, []);
    for (const cell of upper) if (!fellAt.has(cell) && (cell.state === "falling" || cell.state === "gone")) fellAt.set(cell, step * SIM_DT);
  }
  expect(fellAt.size).toBe(upper.length);
  const times = [...fellAt.values()];
  const first = Math.min(...times), last = Math.max(...times);
  // Not one flat sheet: the span sheds over several ticks.
  expect(new Set(times.map((t) => Math.round(t / SIM_DT))).size).toBeGreaterThan(3);
  expect(last - first).toBeGreaterThan(SIM_DT * 4);
  // Same building, same order, every run.
  const again = createTown().buildings.find((x) => x.id === b.id)!;
  const p2 = new ParticlePool();
  for (const cell of again.cells) if (cell.floor === 0) applyCellDamage(again, cell, 999, 1, 0, p2, []);
  const order = (cells: typeof upper, at: (c: (typeof upper)[number]) => number) => [...cells].sort((x, y) => at(x) - at(y) || x.gx - y.gx || x.gy - y.gy).map((c) => `${c.gx},${c.gy}`);
  const fell2 = new Map<object, number>();
  const upper2 = again.cells.filter((cell) => cell.floor === 1);
  for (let step = 1; step <= 180; step++) {
    stepStructures([again], SIM_DT, p2, []);
    for (const cell of upper2) if (!fell2.has(cell) && (cell.state === "falling" || cell.state === "gone")) fell2.set(cell, step);
  }
  expect(order(upper2, (c) => fell2.get(c)!)).toEqual(order(upper, (c) => Math.round(fellAt.get(c)! / SIM_DT)));
});
