import type { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { MesaFeature } from "../world/terrainFeatures";
import { drawMesaShadow, drawMesaSlice, drawWash, mesaCellTop, mesaHeight, planMesaSlices } from "./landformDraw";

/** A 6x6 box: a 4x4 rock block inside the talus margin, its 2x2 middle one terrace higher. */
function mesa(form: MesaFeature["form"] = "mesa"): MesaFeature {
  const tiers = new Uint8Array(36);
  for (let r = 1; r <= 4; r++) for (let c = 1; c <= 4; c++) tiers[r * 6 + c] = r >= 2 && r <= 3 && c >= 2 && c <= 3 ? 2 : 1;
  return { kind: "mesa", id: "mesa-0", form, bedrock: "sandstone", x: 20, y: 30, cols: 6, rows: 6, tiers, tierHeight: 1.5, seed: 11 };
}

/** Records fills so tests can count polygons and read colours without a renderer. */
function recorder(): { g: Graphics; fills: { color: number; alpha: number }[] } {
  const fills: { color: number; alpha: number }[] = [];
  const g = { poly: () => g, fill: (style: { color: number; alpha: number }) => { fills.push(style); return g; } };
  return { g: g as unknown as Graphics, fills };
}

describe("mesa drawing", () => {
  it("cuts a formation into back-to-front strips that cover every rock cell once", () => {
    const feature = mesa();
    const slices = planMesaSlices([feature]);
    expect(slices.length).toBeGreaterThan(1);
    const drawn = slices.flatMap((slice) => slice.cells);
    expect(new Set(drawn).size).toBe(16);
    expect(drawn.length).toBe(16);
    const depth = (i: number) => (i % 6) + ((i / 6) | 0);
    for (let n = 1; n < drawn.length; n++) expect(depth(drawn[n]!)).toBeGreaterThanOrEqual(depth(drawn[n - 1]!));
    for (let n = 1; n < slices.length; n++) expect(slices[n]!.depthX + slices[n]!.depthY).toBeGreaterThan(slices[n - 1]!.depthX + slices[n - 1]!.depthY);
    expect(new Set(slices.map((slice) => slice.key)).size).toBe(slices.length);
    expect(planMesaSlices([{ kind: "wash", id: "w", path: [], halfWidth: 1, seed: 1 }])).toEqual([]);
  });

  it("steps a mesa in flat terraces and leaves an outcrop craggy", () => {
    const flat = mesa();
    expect(mesaCellTop(flat, 1, 1)).toBe(1.5);
    expect(mesaCellTop(flat, 2, 2)).toBe(3);
    expect(mesaCellTop(flat, 0, 0)).toBe(0);
    expect(mesaHeight(flat)).toBe(3);
    const crag = mesa("outcrop");
    const tops = new Set([1, 2, 3, 4].map((c) => mesaCellTop(crag, c, 1)));
    expect(tops.size).toBeGreaterThan(1);
  });

  it("bands the cliffs in detail, flattens them for the overview, and caps snow only on top", () => {
    const slices = planMesaSlices([mesa()]);
    const detail = recorder();
    const overview = recorder();
    const snow = recorder();
    for (const slice of slices) {
      drawMesaSlice(detail.g, slice, false, true);
      drawMesaSlice(overview.g, slice, false, false);
      drawMesaSlice(snow.g, slice, true, true, 0.45);
    }
    // Sixteen caps plus one flat quad per exposed face: 8 outer faces and 4 inner steps.
    expect(overview.fills.length).toBe(16 + 12);
    expect(detail.fills.length).toBeGreaterThan(overview.fills.length * 2);
    expect(new Set(detail.fills.map((fill) => fill.color)).size).toBeGreaterThan(6);
    expect(snow.fills.filter((fill) => fill.color === 0xe8eef4).length).toBe(16);
    expect(detail.fills.some((fill) => fill.color === 0xe8eef4)).toBe(false);
    expect(snow.fills.every((fill) => fill.alpha === 0.45)).toBe(true);
  });

  it("casts a shadow east of the rock, never on it, and strews a dry wash only without snow", () => {
    const shadow = recorder();
    drawMesaShadow(shadow.g, mesa());
    expect(shadow.fills.length).toBeGreaterThan(3);
    expect(shadow.fills.length).toBeLessThan(16);
    const wash = { kind: "wash" as const, id: "wash-0", path: [{ x: 0, y: 0 }, { x: 14, y: 2 }], halfWidth: 1.5, seed: 5 };
    const dry = recorder();
    const snowy = recorder();
    drawWash(dry.g, wash, false);
    drawWash(snowy.g, wash, true);
    expect(dry.fills.length).toBeGreaterThan(5);
    expect(snowy.fills).toEqual([]);
  });
});
