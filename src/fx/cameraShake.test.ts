import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraShake } from "./cameraShake";

describe("camera shake", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lurches along the impact direction, scaled by magnitude, and springs back", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const jolt = (mag: number) => {
      const shake = new CameraShake();
      shake.punch(mag, 3, 4);
      return shake.step(1 / 60);
    };
    const soft = jolt(0.6), hard = jolt(2.2);
    expect(hard.x).toBeGreaterThan(soft.x);
    expect(hard.y / hard.x).toBeCloseTo(4 / 3);
    const shake = new CameraShake();
    shake.punch(2.2, 1, 0);
    for (let i = 0; i < 30; i++) shake.step(1 / 60);
    expect(shake.step(1 / 60)).toEqual({ x: 0, y: 0 });
  });

  it("ignores taps below the threshold and stays undirected without a direction", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const shake = new CameraShake();
    shake.punch(0.2, 1, 0);
    expect(shake.step(1 / 60)).toEqual({ x: 0, y: 0 });
    shake.punch(1);
    expect(shake.step(1 / 60)).toEqual({ x: 0, y: 0 });
  });

  it("chatters fast and small for light timber, heaves slow and wide for heavy concrete", () => {
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => (i++ % 2 ? 0.95 : 0.05));
    const trace = (heft: number) => {
      const shake = new CameraShake();
      shake.punch(1.2, 0, 0, heft);
      return Array.from({ length: 16 }, () => shake.step(1 / 60).x);
    };
    const reversals = (xs: number[]) => xs.slice(2).filter((x, k) => Math.sign(x - xs[k + 1]!) !== Math.sign(xs[k + 1]! - xs[k]!)).length;
    const light = trace(0.9), heavy = trace(1.45);
    expect(reversals(light)).toBeGreaterThan(reversals(heavy));
    expect(Math.max(...heavy.map(Math.abs))).toBeGreaterThan(Math.max(...light.map(Math.abs)));
  });
});
