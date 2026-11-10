import { expect, it } from "vitest";
import { SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { createTown } from "../world/town";
import { applyCellDamage, stepStructures } from "./building";

/** Gut the ground floor of the first two-storey building and record the step each upper cell lets go. */
function upperFloorFalls(): { key: string; step: number }[] {
  const b = createTown().buildings.find((x) => x.floors >= 2 && !x.coreCollapse)!;
  const particles = new ParticlePool();
  for (const cell of b.cells.filter((c) => c.floor === 0)) applyCellDamage(b, cell, 999, 1, 0, particles, []);
  const waiting = new Set(b.cells.filter((c) => c.floor === 1));
  const falls: { key: string; step: number }[] = [];
  for (let step = 1; step <= 180 && waiting.size; step++) {
    stepStructures([b], SIM_DT, particles, []);
    for (const cell of [...waiting].filter((c) => c.state === "falling" || c.state === "gone")) {
      waiting.delete(cell);
      falls.push({ key: `${cell.gx},${cell.gy}`, step });
    }
  }
  expect(waiting.size).toBe(0);
  return falls;
}

it("lets unsupported cells go in a ragged run, the same way every time", () => {
  const falls = upperFloorFalls();
  const steps = falls.map((f) => f.step);
  // Not one flat sheet: the span sheds over several ticks.
  expect(new Set(steps).size).toBeGreaterThan(3);
  expect(Math.max(...steps) - Math.min(...steps)).toBeGreaterThan(4);
  // The stagger is fixed by each cell's place in the grid, so a second run matches.
  expect(upperFloorFalls()).toEqual(falls);
});
