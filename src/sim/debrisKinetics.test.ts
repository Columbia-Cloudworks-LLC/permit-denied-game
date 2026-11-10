import { describe, expect, it } from "vitest";
import { DEBRIS, DOZER, SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import type { Material } from "../structure/types";
import { createDozer } from "../vehicle/dozer";
import { createTown } from "../world/town";
import { addDebrisBody, lastDebrisStats, spawnCollapseDebris, stepDebris, totalDebrisMass } from "./debris";

type Town = ReturnType<typeof createTown>;

/** A dozer parked far from the test bodies, so only body physics acts. */
function run(town: Town, steps: number, particles = new ParticlePool()): ParticlePool {
  const dozer = createDozer(40, 40, 0);
  for (let i = 0; i < steps; i++) stepDebris(town, dozer, particles, [], 1, SIM_DT);
  return particles;
}

const block = (town: Town, x: number, material: Material = "concrete", extra: Partial<Parameters<typeof addDebrisBody>[1]> = {}) =>
  addDebrisBody(town, { x, y: 18, w: 0.5, d: 0.5, material, layer: "remnant", mass: 1, ...extra });

describe("body contacts", () => {
  it("hands momentum from a moving chunk to the one it strikes", () => {
    const town = createTown();
    const striker = block(town, 12, "concrete", { vx: 3 });
    const target = block(town, 12.48);
    run(town, 1);
    expect(target.vx).toBeGreaterThan(0.8);
    expect(striker.vx).toBeLessThan(2.4);
    // Equal masses: what the striker lost along x, the target gained (contact friction aside).
    expect(striker.vx + target.vx).toBeLessThan(3.01);
    expect(striker.vx + target.vx).toBeGreaterThan(2.2);
  });

  it("leaves a pair that is already separating alone", () => {
    const town = createTown();
    const left = block(town, 12, "concrete", { vx: -1 });
    const right = block(town, 12.45, "concrete", { vx: 1 });
    run(town, 1);
    expect(left.vx).toBeLessThan(-0.9);
    expect(right.vx).toBeGreaterThan(0.9);
  });

  it("does not wake a sleeper that an idle neighbour merely rests against", () => {
    const town = createTown();
    const sleeper = block(town, 12);
    sleeper.sleeping = true;
    const idle = block(town, 12.3);
    run(town, 30);
    expect(sleeper.sleeping).toBe(true);
    expect(sleeper.x).toBe(12);
    // The idle body is pushed clear of the sleeper and then sleeps too.
    expect(idle.x).toBeGreaterThan(12.3);
    expect(idle.sleeping).toBe(true);
    expect(lastDebrisStats().active).toBe(0);
  });

  it("a slow nudge below the wake impulse bounces off a sleeper", () => {
    const town = createTown();
    const sleeper = block(town, 12, "concrete", { mass: 3 });
    sleeper.sleeping = true;
    const pebble = addDebrisBody(town, { x: 12.34, y: 18, w: 0.2, d: 0.2, material: "brick", layer: "fragment", mass: DEBRIS.wakeImpulse * 0.2, vx: -0.4 });
    run(town, 3);
    expect(sleeper.sleeping).toBe(true);
    expect(pebble.vx).toBeGreaterThanOrEqual(0);
  });

  it("settles a dropped heap to sleep instead of jittering awake", () => {
    const town = createTown();
    for (let i = 0; i < 40; i++) {
      const a = i * 2.399;
      addDebrisBody(town, { x: 12 + Math.cos(a) * 0.3, y: 18 + Math.sin(a) * 0.3, w: 0.4, d: 0.3, material: i % 2 ? "brick" : "concrete", layer: i % 3 ? "fragment" : "remnant", mass: 0.8, heading: a });
    }
    const mass = totalDebrisMass(town);
    run(town, 240);
    expect(lastDebrisStats().active).toBe(0);
    expect(lastDebrisStats().contactPairs).toBe(0);
    expect(totalDebrisMass(town)).toBeCloseTo(mass, 4);
  });
});

describe("drop, landing and slide", () => {
  it("keeps a thrown piece's speed in the air and grips it on landing", () => {
    const town = createTown();
    const piece = block(town, 12, "concrete", { vx: 3, elev: 1.4 });
    run(town, 6);
    expect(piece.elev).toBeGreaterThan(0.5);
    expect(piece.vx).toBeGreaterThan(2.9);
    run(town, 30);
    expect(piece.elev).toBeLessThan(0.05);
    expect(piece.vx).toBeLessThan(1.2);
  });

  it("steel bounces and slides on; concrete thuds and stops short", () => {
    const town = createTown();
    const steel = block(town, 12, "metal", { vx: 3, elev: 1.4 });
    const slab = addDebrisBody(town, { x: 12, y: 24, w: 0.5, d: 0.5, material: "concrete", layer: "remnant", mass: 1, vx: 3, elev: 1.4 });
    let steelBounce = 0, slabBounce = 0, landed = false;
    const dozer = createDozer(40, 40, 0);
    const particles = new ParticlePool();
    for (let i = 0; i < 240; i++) {
      stepDebris(town, dozer, particles, [], 1, SIM_DT);
      if (steel.elev < 0.02) landed = true;
      if (landed) { steelBounce = Math.max(steelBounce, steel.elev); slabBounce = Math.max(slabBounce, slab.elev); }
    }
    expect(steelBounce).toBeGreaterThan(slabBounce + 0.05);
    expect(steel.x).toBeGreaterThan(slab.x + 0.2);
    expect(steel.sleeping && slab.sleeping).toBe(true);
  });

  it("throws dust when a heavy remnant lands hard, a few puffs per step at most", () => {
    const town = createTown();
    for (let i = 0; i < 12; i++) addDebrisBody(town, { x: 10 + i * 0.8, y: 18, w: 0.5, d: 0.5, material: "concrete", layer: "remnant", mass: 2, elev: 1.5 });
    const particles = new ParticlePool();
    let peak = 0;
    const dozer = createDozer(40, 40, 0);
    for (let i = 0; i < 40; i++) {
      const before = particles.items.filter((p) => p.alive).length;
      stepDebris(town, dozer, particles, [], 1, SIM_DT);
      peak = Math.max(peak, particles.items.filter((p) => p.alive).length - before);
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(9);
  });

  it("drops upper-storey debris from higher and throws light material further", () => {
    const speedOf = (material: Material, floor: number) => {
      const town = createTown();
      let speed = 0, height = 0, n = 0;
      for (let k = 0; k < 12; k++) {
        for (const r of spawnCollapseDebris(town, { x: 12 + k * 1.7, y: 18, dx: 1, dy: 0, material, floor, cellSize: 1.15 })) {
          speed += Math.hypot(r.vx, r.vy); height += r.elev; n++;
        }
      }
      return { speed: speed / n, height: height / n };
    };
    const ground = speedOf("concrete", 0), upper = speedOf("concrete", 2), timber = speedOf("wood", 0);
    expect(upper.height).toBeGreaterThan(ground.height + 0.4);
    expect(upper.speed).toBeGreaterThan(ground.speed);
    expect(timber.speed).toBeGreaterThan(ground.speed);
  });

  it("breaks each material into its own kind of fragment", () => {
    const fragments = (material: Material) => {
      const town = createTown();
      const out = [];
      for (let k = 0; k < 10; k++) out.push(...spawnCollapseDebris(town, { x: 12 + k * 1.7, y: 18, dx: 1, dy: 0, material, floor: 0, cellSize: 1.15 }).filter((r) => r.layer === "fragment"));
      expect(out.length).toBeGreaterThan(0);
      return out;
    };
    // Bricks are stubby, close to two to one; splinters and steel bars run long and thin.
    for (const r of fragments("brick")) expect(r.w / r.d).toBeLessThan(3.1);
    for (const r of fragments("wood")) { expect(r.w / r.d).toBeGreaterThan(2.3); expect(r.shape).toBe("beam"); }
    for (const r of fragments("metal")) { expect(r.w / r.d).toBeGreaterThan(3.2); expect(r.shape).toBe("beam"); }
    for (const r of fragments("glass")) expect(r.d).toBeLessThanOrEqual(0.1);
  });
});

describe("blade work in a pile", () => {
  function scoop(height: number) {
    const town = createTown();
    const dozer = createDozer(12, 18, 0);
    dozer.bladeDown = true;
    const bx = dozer.x + DOZER.bladeReach + 0.1;
    // Material under the blade, and a berm of the given height ahead of it.
    for (let i = 0; i < 6; i++) town.pile.addMass(bx, 18, 1.5, "brick");
    while (town.pile.heightAt(bx + 0.9, 18) < height) town.pile.addMass(bx + 0.9, 18, 0.5, "brick");
    const side = () => town.pile.massAt(bx + 0.15, 18 + DOZER.bladeHalf + 0.3) + town.pile.massAt(bx + 0.15, 18 - DOZER.bladeHalf - 0.3);
    const before = side();
    const mass = totalDebrisMass(town);
    const particles = new ParticlePool();
    let load = 0;
    for (let i = 0; i < 20; i++) load += stepDebris(town, dozer, particles, [], 1, SIM_DT).load;
    expect(totalDebrisMass(town)).toBeCloseTo(mass, 3);
    return { spilled: side() - before, load };
  }

  it("rolls material off the blade ends once the berm ahead stands tall", () => {
    const low = scoop(0);
    const tall = scoop(0.7);
    expect(low.spilled).toBeLessThan(0.02);
    expect(tall.spilled).toBeGreaterThan(0.1);
    // A tall berm also pushes back harder.
    expect(tall.load).toBeGreaterThan(low.load);
  });
});
