import { describe, expect, it } from "vitest";
import { SIM_DT, DOZER } from "../game/constants";
import { createDozer, dozerForward, resolveCircleSolid, stepDozer } from "./dozer";

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
  it('scales forward and reverse target speed without changing full throttle', () => {
    expect(drive(1, 5).vx).toBeCloseTo(DOZER.maxSpeed);
    expect(drive(-1, 5).vx).toBeCloseTo(-DOZER.maxReverse);
    expect(drive(.5, 5).vx).toBeCloseTo(DOZER.maxSpeed * .5);
    expect(drive(-.5, 5).vx).toBeCloseTo(-DOZER.maxReverse * .5);
  });
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

describe("dozer chassis pitch", () => {
  const input = (throttle: number) => ({ throttle, steer: 0, blade: false, engineMul: 1, bladeMul: 1, pushMul: 1 });

  it("squats the rear under throttle and dips the nose when braking", () => {
    const d = createDozer(10, 10, 0);
    for (let i = 0; i < 6; i++) stepDozer(d, input(1), SIM_DT);
    expect(d.pitch).toBeLessThan(-0.01);
    for (let t = 0; t < 2; t += SIM_DT) stepDozer(d, input(1), SIM_DT);
    expect(Math.abs(d.pitch)).toBeLessThan(0.005);
    for (let i = 0; i < 6; i++) stepDozer(d, input(-1), SIM_DT);
    expect(d.pitch).toBeGreaterThan(0.01);
  });

  it("throws the nose down on a head-on hit, harder the faster the hit, within bounds", () => {
    const hit = (speed: number) => {
      const d = createDozer(10, 10, 0);
      d.vx = speed;
      resolveCircleSolid(d, 10.5, 9, 2, 2);
      return d.pitch;
    };
    expect(hit(2)).toBeGreaterThan(0);
    expect(hit(6)).toBeGreaterThan(hit(2));
    expect(hit(40)).toBeLessThanOrEqual(0.13);
  });
});

describe("dozer track scrub and chassis roll", () => {
  const input = (throttle: number, steer: number, blade = false) => ({ throttle, steer, blade, engineMul: 1, bladeMul: 1, pushMul: 1 });
  const speedAfter = (throttle: number, steer: number, seconds: number, start = 0) => {
    const d = createDozer(10, 10, 0);
    d.vx = start;
    for (let t = 0; t < seconds; t += SIM_DT) stepDozer(d, input(throttle, steer), SIM_DT);
    return Math.hypot(d.vx, d.vy);
  };

  it("sheds speed in a pivot: a hard turn holds a lower top speed and a coasting turn slows faster", () => {
    const straight = speedAfter(1, 0, 4), turning = speedAfter(1, 1, 4);
    expect(turning).toBeLessThan(straight * 0.95);
    expect(turning).toBeGreaterThan(straight * 0.75);
    expect(speedAfter(0, 1, 0.5, 6)).toBeLessThan(speedAfter(0, 0, 0.5, 6) - 0.5);
  });

  it("rolls the struck side up on a glancing hit and springs back to the ground's roll", () => {
    const d = createDozer(10, 10, 0);
    d.vx = 4;
    d.vy = 3;
    // A wall on the right-hand (+y) side pushes back along -y.
    resolveCircleSolid(d, 8, 10.6, 4, 2);
    expect(d.hitNy).toBeLessThan(-0.9);
    expect(d.roll).toBeGreaterThan(0);
    expect(d.roll).toBeLessThanOrEqual(0.026);
    d.vx = d.vy = 0;
    d.rideRoll = -0.02;
    for (let t = 0; t < 1.5; t += SIM_DT) stepDozer(d, input(0, 0), SIM_DT);
    expect(d.roll).toBeCloseTo(-0.02, 3);
  });

  it("flags the blade landing for one step and rocks the nose down", () => {
    const d = createDozer(10, 10, 0);
    stepDozer(d, input(0, 0, true), SIM_DT);
    expect(d.bladeLanded).toBe(true);
    expect(d.pitchVel).toBeGreaterThan(0);
    stepDozer(d, input(0, 0, true), SIM_DT);
    expect(d.bladeLanded).toBe(false);
  });
});
