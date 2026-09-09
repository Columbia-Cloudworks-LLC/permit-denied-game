import { describe, expect, it } from "vitest";
import { SIM_DT } from "../game/constants";
import { createDozer, dozerForward, stepDozer } from "./dozer";

function drive(throttle: number, seconds: number) {
  const d = createDozer(10, 10, 0);
  for (let t = 0; t < seconds; t += SIM_DT) {
    stepDozer(
      d,
      { throttle, steer: 0, blade: false, engineMul: 1, bladeMul: 1, pushMul: 1 },
      SIM_DT,
    );
  }
  return d;
}

describe("dozer reverse", () => {
  it("S/reverse moves opposite the heading", () => {
    const fwd = drive(1, 0.6);
    const rev = drive(-1, 0.6);
    const f = dozerForward(fwd);
    const alongFwd = fwd.vx * f.x + fwd.vy * f.y;
    const alongRev = rev.vx * f.x + rev.vy * f.y;
    expect(alongFwd).toBeGreaterThan(1);
    expect(alongRev).toBeLessThan(-1);
    expect(rev.x).toBeLessThan(10);
    expect(fwd.x).toBeGreaterThan(10);
  });
});
