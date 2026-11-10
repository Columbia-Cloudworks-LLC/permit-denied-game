import { describe, expect, it } from "vitest";
import { advanceSimulation } from "./fixedStep";

describe("fixed step", () => {
  const dt = 1 / 60;

  it("runs the steps a frame owes and keeps the remainder", () => {
    let steps = 0;
    const out = advanceSimulation(dt * 2.5, dt, 5, () => true, () => { steps++; });
    expect(steps).toBe(2);
    expect(out.acc).toBeCloseTo(dt * 0.5, 9);
    expect(out.dropped).toBe(0);
  });

  it("drops what is still owed at the step limit", () => {
    let steps = 0;
    const out = advanceSimulation(dt * 9, dt, 5, () => true, () => { steps++; });
    expect(steps).toBe(5);
    expect(out.acc).toBe(0);
    expect(out.dropped).toBeCloseTo(dt * 4, 9);
  });

  it("stops catching up once the frame's simulation budget is spent", () => {
    // Each step costs 9 ms: the first always runs, the second passes the 12 ms budget.
    let clock = 0, steps = 0;
    const out = advanceSimulation(dt * 5, dt, 5, () => true, () => { steps++; clock += 9; }, 12, () => clock);
    expect(steps).toBe(2);
    expect(out.acc).toBe(0);
    expect(out.dropped).toBeCloseTo(dt * 3, 9);
  });

  it("keeps a sub-step remainder when the budget runs out with nothing more owed", () => {
    let clock = 0, steps = 0;
    const out = advanceSimulation(dt * 1.5, dt, 5, () => true, () => { steps++; clock += 30; }, 12, () => clock);
    expect(steps).toBe(1);
    expect(out.acc).toBeCloseTo(dt * 0.5, 9);
    expect(out.dropped).toBe(0);
  });

  it("stops at once when a step leaves play", () => {
    let playing = true, steps = 0;
    const out = advanceSimulation(dt * 4, dt, 5, () => playing, () => { steps++; playing = false; });
    expect(steps).toBe(1);
    expect(out).toEqual({ acc: 0, dropped: 0 });
  });
});
