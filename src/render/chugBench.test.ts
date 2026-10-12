import { writeFileSync } from "node:fs";
import { PerformanceObserver } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import { Container, Graphics } from "pixi.js";
import { PileField } from "../sim/pile";
import { cameraFocus } from "../game/camera";
import { SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { applyCellDamage } from "../structure/building";
import { addDebrisBody, lastDebrisStats } from "../sim/debris";
import { BENCH_UPGRADES, percentile } from "../sim/benchSupport";
import { SpatialHash } from "../sim/spatial";
import { stepWorld } from "../sim/worldSim";
import { createDozer } from "../vehicle/dozer";
import type { Town } from "../world/town";
import { DESKTOP_VIEW, createDenseCityTown, frameDenseCityOverview } from "./denseCityBench";
import { WorldRenderer } from "./WorldRenderer";

/** Per-tick phase timers filled by the wrapped modules below. */
const { phase, timed } = vi.hoisted(() => {
  const phase = { debris: 0, structures: 0, spatialQuery: 0, spatialInsert: 0, corePiles: 0 };
  const timed = <A extends unknown[], R>(key: keyof typeof phase, fn: (...args: A) => R) => (...args: A): R => {
    const t0 = performance.now();
    try { return fn(...args); } finally { phase[key] += performance.now() - t0; }
  };
  return { phase, timed };
});

vi.mock("../sim/debris", async (orig) => {
  const mod = await orig<typeof import("../sim/debris")>();
  return { ...mod, stepDebris: timed("debris", mod.stepDebris) };
});
vi.mock("../structure/building", async (orig) => {
  const mod = await orig<typeof import("../structure/building")>();
  return { ...mod, stepStructures: timed("structures", mod.stepStructures) };
});
vi.mock("./corePileDraw", async (orig) => {
  const mod = await orig<typeof import("./corePileDraw")>();
  return { ...mod, drawCorePiles: timed("corePiles", mod.drawCorePiles) };
});

const STEPS = Number(process.env.CHUG_STEPS ?? 900);
const INJECT = Number(process.env.CHUG_INJECT ?? 520);

interface Tick {
  simMs: number; debrisMs: number; structuresMs: number; spatialMs: number;
  renderMs: number; passes: Record<string, number>; corePilesMs: number;
  active: number; sleeping: number; pileCells: number; contactPairs: number;
  commands: number; rebuilt: number; fills: number; polys: number; strokes: number;
  heapDelta: number; overlayRebuilt: number; addChildMs: number; pileBumps: Record<string, number>;
}

function towersWithCores(town: Town, n: number) {
  return town.buildings
    .filter((b) => b.coreCollapse && b.cells.some((c) => c.coreSupport))
    .sort((a, b) => b.floors - a.floors)
    .slice(0, n);
}

function patchCounts() {
  const counts = { fill: 0, poly: 0, stroke: 0 };
  const proto = Graphics.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const name of Object.keys(counts) as (keyof typeof counts)[]) {
    const orig = proto[name]!;
    proto[name] = function (this: unknown, ...a: unknown[]) { counts[name]++; return orig.apply(this, a); };
  }
  const sp = SpatialHash.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const q = sp.query!, ins = sp.insert!;
  sp.query = function (this: unknown, ...a: unknown[]) { const t = performance.now(); try { return q.apply(this, a); } finally { phase.spatialQuery += performance.now() - t; } };
  sp.insert = function (this: unknown, ...a: unknown[]) { const t = performance.now(); try { return ins.apply(this, a); } finally { phase.spatialInsert += performance.now() - t; } };
  const pp = PileField.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const name of ["addMass", "compactPoint", "extractDisk", "clearArea", "removeOwner"]) {
    const orig = pp[name]!;
    pp[name] = function (this: PileField, ...a: unknown[]) { const r0 = this.revision; try { return orig.apply(this, a); } finally { if (this.revision !== r0) pileBumps[name] = (pileBumps[name] ?? 0) + 1; } };
  }
  const cp = Container.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const add = cp.addChild!;
  cp.addChild = function (this: unknown, ...a: unknown[]) { const t = performance.now(); try { return add.apply(this, a); } finally { addChildMs.v += performance.now() - t; } };
  return counts;
}
const pileBumps: Record<string, number> = {};
const addChildMs = { v: 0 };

function patchPasses(renderer: WorldRenderer, sink: Record<string, number>) {
  const r = renderer as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const name of ["passTerrain", "passGround", "passSites", "passMarks", "passBuildings", "passProps", "passGarnish", "passDynamics", "passEffects", "submitDraw"]) {
    const orig = r[name]!.bind(renderer);
    r[name] = (...a: unknown[]) => { const t = performance.now(); try { return orig(...a); } finally { sink[name] = (sink[name] ?? 0) + performance.now() - t; } };
  }
  const drawing = (renderer as unknown as { drawing: { draw: (c: unknown) => void } }).drawing;
  const draw = drawing.draw.bind(drawing);
  drawing.draw = (c) => { const t = performance.now(); try { draw(c); } finally { sink.drawCacheSubmit = (sink.drawCacheSubmit ?? 0) + performance.now() - t; } };
}

/** `near` parks the street-camera dozer against an intact tower, whose occlusion fades keep it live. */
async function runScenario(camera: "street" | "overview" | "near", counts: ReturnType<typeof patchCounts>) {
  const town = createDenseCityTown();
  const particles = new ParticlePool();
  const towers = towersWithCores(town, 3);
  expect(towers.length).toBe(3);
  for (const b of towers) for (const c of b.cells) if (c.floor === 0 && c.coreSupport) applyCellDamage(b, c, 999, 0, -1, particles, []);
  // Plus four conventional per-cell wrecks so collapse waves overlap.
  const wrecks = town.buildings.filter((b) => !towers.includes(b)).slice(0, 4);
  for (const b of wrecks) {
    for (const cell of b.cells.slice(0, Math.ceil(b.cells.length * 0.45))) applyCellDamage(b, cell, 999, 1, 0, particles, []);
  }
  const focus = towers[0]!;
  const fx = focus.x + (focus.w * focus.cellSize) / 2, fy = focus.y + focus.d * focus.cellSize + 2.5;
  for (let i = 0; i < INJECT; i++) {
    const a = i * 2.399, rad = 1.5 + Math.sqrt(i) * 0.45;
    addDebrisBody(town, {
      x: fx + Math.cos(a) * rad, y: fy + Math.sin(a) * rad, w: 0.32 + (i % 5) * 0.06, d: 0.24 + (i % 3) * 0.05,
      material: i % 3 ? "concrete" : "brick", layer: i % 4 ? "fragment" : "remnant", mass: 0.6 + (i % 7) * 0.15,
      vx: Math.cos(a) * 2.2, vy: Math.sin(a) * 2.2,
    });
  }
  const host = town.buildings.filter((b) => !towers.includes(b) && !wrecks.includes(b)).sort((a, b) => b.floors - a.floors)[0]!;
  const dozer = camera === "near"
    ? createDozer(host.x + (host.w * host.cellSize) / 2, host.y + host.d * host.cellSize + 1.5, -Math.PI / 2)
    : createDozer(fx, fy + 4, -Math.PI / 2);
  const renderer = new WorldRenderer();
  renderer.debug.effects = true;
  if (camera === "overview") {
    renderer.showNhood = false;
    const cam = frameDenseCityOverview(town, DESKTOP_VIEW.w, DESKTOP_VIEW.h);
    Object.assign(renderer, { zoom: cam.zoom, camX: cam.camX, camY: cam.camY });
  }
  const passes: Record<string, number> = {};
  patchPasses(renderer, passes);
  const gcPauses: number[] = [];
  const obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) gcPauses.push(e.duration); });
  obs.observe({ entryTypes: ["gc"] });
  const ticks: Tick[] = [];
  const kinds: Record<number, Record<string, number>> = {};
  const keyDiffs: string[] = [];
  const heap0 = process.memoryUsage().heapUsed;
  let heapPrev = heap0, heapPeak = heap0;
  for (let i = 0; i < STEPS; i++) {
    for (const k of Object.keys(phase) as (keyof typeof phase)[]) phase[k] = 0;
    for (const k of Object.keys(passes)) passes[k] = 0;
    for (const k of Object.keys(pileBumps)) delete pileBumps[k];
    const s0 = performance.now();
    stepWorld(town, dozer, particles, BENCH_UPGRADES, SIM_DT);
    const simMs = performance.now() - s0;
    const sim = { ...phase };
    const pileBumpsSim = { ...pileBumps };
    const ds = lastDebrisStats();
    if (camera !== "overview") {
      const f = cameraFocus(dozer.x, dozer.y, 0.4, renderer.zoom);
      renderer.camX = f.x; renderer.camY = f.y;
    }
    renderer.layout(DESKTOP_VIEW.w, DESKTOP_VIEW.h, 0, 0);
    counts.fill = counts.poly = counts.stroke = 0;
    for (const k of Object.keys(pileBumps)) delete pileBumps[k];
    const bumps = { ...pileBumpsSim };
    addChildMs.v = 0;
    const overlayBefore = (renderer as unknown as { overlayKey: string }).overlayKey;
    const r0 = performance.now();
    renderer.draw(town, dozer, particles, [], SIM_DT);
    const renderMs = performance.now() - r0;
    let pileCells = 0;
    for (const h of town.pile.height) if (h >= 0.05) pileCells++;
    const heap = process.memoryUsage().heapUsed;
    heapPeak = Math.max(heapPeak, heap);
    ticks.push({
      simMs, debrisMs: sim.debris, structuresMs: sim.structures, spatialMs: sim.spatialQuery + sim.spatialInsert,
      renderMs, passes: { ...passes }, corePilesMs: phase.corePiles,
      active: ds.active, sleeping: ds.sleeping, pileCells, contactPairs: ds.contactPairs,
      commands: renderer.stats.commands, rebuilt: renderer.stats.rebuilt,
      fills: counts.fill, polys: counts.poly, strokes: counts.stroke, heapDelta: heap - heapPrev,
      overlayRebuilt: (renderer as unknown as { overlayKey: string }).overlayKey !== overlayBefore ? 1 : 0,
      addChildMs: addChildMs.v, pileBumps: bumps,
    });
    heapPrev = heap;
    if (i === 5 || i === 40 || i === 400) {
      const hist: Record<string, number> = {};
      for (const k of renderer.submittedKeys()) { const kind = k.split(":")[0]!; hist[kind] = (hist[kind] ?? 0) + 1; }
      kinds[i] = hist;
    }
    const overlayAfter = (renderer as unknown as { overlayKey: string }).overlayKey;
    if (i >= 600 && overlayAfter !== overlayBefore && keyDiffs.length < 6) keyDiffs.push(`${overlayBefore} -> ${overlayAfter}`);
    if (i % 60 === 59) await new Promise((r) => setTimeout(r, 0));
  }
  await new Promise((r) => setTimeout(r, 20));
  obs.disconnect();
  renderer.invalidate();
  renderer.root.destroy({ children: true });
  return { camera, keyDiffs, kinds, ticks, gcPauses, heap: { start: heap0, end: process.memoryUsage().heapUsed, peak: heapPeak }, towers: towers.map((t) => `${t.archetypeId}:${t.floors}f`) };
}

const stat = (xs: number[]) => {
  const mean = xs.reduce((n, v) => n + v, 0) / Math.max(1, xs.length);
  return { mean, p50: percentile(xs, 50), p95: percentile(xs, 95), p99: percentile(xs, 99), max: percentile(xs, 100) };
};

describe("chug bench: overlapping tower collapses with injected debris", () => {
  it("splits sim, render, and allocation cost per tick", { timeout: 600_000 }, async () => {
    const counts = patchCounts();
    const out = [await runScenario("street", counts), await runScenario("overview", counts), await runScenario("near", counts)];
    const summary = out.map(({ camera, keyDiffs, kinds, ticks, gcPauses, heap, towers }) => {
      const passNames = Object.keys(ticks[0]!.passes);
      const windows = [[0, 60], [60, 180], [180, 360], [360, 600], [600, STEPS]].map(([a, b]) => {
        const w = ticks.slice(a, b);
        return { from: a, to: b, sim: stat(w.map((t) => t.simMs)).mean, render: stat(w.map((t) => t.renderMs)).mean,
          active: stat(w.map((t) => t.active)).mean, sleeping: stat(w.map((t) => t.sleeping)).mean, pileCells: stat(w.map((t) => t.pileCells)).mean,
          commands: stat(w.map((t) => t.commands)).mean, overlay: stat(w.map((t) => t.overlayRebuilt)).mean, rebuilt: stat(w.map((t) => t.rebuilt)).mean, fills: stat(w.map((t) => t.fills)).mean };
      });
      return {
        camera, towers, steps: ticks.length,
        simMs: stat(ticks.map((t) => t.simMs)), renderMs: stat(ticks.map((t) => t.renderMs)),
        debrisMs: stat(ticks.map((t) => t.debrisMs)), structuresMs: stat(ticks.map((t) => t.structuresMs)), spatialMs: stat(ticks.map((t) => t.spatialMs)),
        corePilesMs: stat(ticks.map((t) => t.corePilesMs)),
        passes: Object.fromEntries(passNames.map((p) => [p, stat(ticks.map((t) => t.passes[p] ?? 0))])),
        active: stat(ticks.map((t) => t.active)), sleeping: stat(ticks.map((t) => t.sleeping)), pileCells: stat(ticks.map((t) => t.pileCells)),
        contactPairs: stat(ticks.map((t) => t.contactPairs)),
        commands: stat(ticks.map((t) => t.commands)), rebuilt: stat(ticks.map((t) => t.rebuilt)),
        fills: stat(ticks.map((t) => t.fills)), polys: stat(ticks.map((t) => t.polys)), strokes: stat(ticks.map((t) => t.strokes)),
        heapDeltaKb: stat(ticks.map((t) => t.heapDelta / 1024)), heapMb: { start: heap.start / 2 ** 20, end: heap.end / 2 ** 20, peak: heap.peak / 2 ** 20 },
        gc: { count: gcPauses.length, totalMs: gcPauses.reduce((n, v) => n + v, 0), ...stat(gcPauses.length ? gcPauses : [0]) },
        windows, kinds, keyDiffs,
        overlayRebuildRate: ticks.filter((t) => t.overlayRebuilt).length / ticks.length,
        addChildMs: stat(ticks.map((t) => t.addChildMs)),
        pileBumpsPerTick: Object.fromEntries([...new Set(ticks.flatMap((t) => Object.keys(t.pileBumps)))].map((k) => [k, ticks.reduce((n, t) => n + (t.pileBumps[k] ?? 0), 0) / ticks.length])),
      };
    });
    if (process.env.CHUG_OUT) writeFileSync(process.env.CHUG_OUT, JSON.stringify(summary, null, 2));
    for (const s of summary) {
      // eslint-disable-next-line no-console
      console.log(`[chug] ${s.camera} sim mean=${s.simMs.mean.toFixed(2)} p95=${s.simMs.p95.toFixed(2)} p99=${s.simMs.p99.toFixed(2)} | render mean=${s.renderMs.mean.toFixed(2)} p95=${s.renderMs.p95.toFixed(2)} p99=${s.renderMs.p99.toFixed(2)} | gc=${s.gc.count}/${s.gc.totalMs.toFixed(1)}ms`);
      expect(s.steps).toBe(STEPS);
    }
  });
});
