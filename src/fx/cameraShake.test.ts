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
});
