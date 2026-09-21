import { describe, expect, it } from "vitest";
import { addDebrisBody, totalDebrisMass } from "./debris";
import { createDozer } from "../vehicle/dozer";
import { createTown } from "../world/town";
import type { DistrictId } from "../game/session";
import { pumpVitestRpc, report, smashNearest, timeSteps } from "./benchSupport";

describe("district simulation benches", () => {
  it("measures intact, collapse, push, and revisit costs", { timeout: 120_000 }, async () => {
    const districts: DistrictId[] = ["classic", "d10", "d30", "d100"];
    for (const district of districts) {
      const town = createTown({ district, seed: 9 });
      const dozer = createDozer(town.spawnX, town.spawnY, town.spawnHeading);
      report(`${district} intact`, timeSteps(town, dozer, 90));
      smashNearest(town, district === "classic" ? 3 : 4);
      report(`${district} collapses`, timeSteps(town, dozer, 180, false));
      for (let i = 0; i < 8; i++) {
        addDebrisBody(town, {
          x: dozer.x + 1.2 + i * 0.16,
          y: dozer.y,
          w: 0.4,
          d: 0.28,
          material: "concrete",
          layer: "remnant",
          mass: 1.4,
        });
      }
      report(`${district} push`, timeSteps(town, dozer, 120));
      smashNearest(town, Math.min(town.buildings.length, 8));
      report(`${district} demolish`, timeSteps(town, dozer, 240, false));
      dozer.x = town.buildings[0]!.x + 1;
      dozer.y = town.buildings[0]!.y + 1;
      report(`${district} revisit`, timeSteps(town, dozer, 90, false));
      expect(totalDebrisMass(town)).toBeGreaterThanOrEqual(0);
      await pumpVitestRpc();
    }
  });
});
