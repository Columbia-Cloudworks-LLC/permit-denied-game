import { describe, expect, it } from "vitest";
import { pointInPoly } from "../game/math";
import { Rng } from "../game/rng";
import { completeLot } from "./parcels";
import { dressLot } from "./dressing";
import { createTown } from "./town";
import { groundPatchContains, lotFootprintContains, SURFACE_ID } from "./terrain";
import { pointOnRoad } from "./roads";
import type { Lot } from "../structure/types";

function aabbCorners(box: { x: number; y: number; w: number; d: number }): { x: number; y: number }[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.d },
    { x: box.x, y: box.y + box.d },
  ];
}

describe("parcel-clipped lot covers", () => {
  it("keeps the frontage lot5 gravel patch inside its polygon", () => {
    const town = createTown({ district: "d10", seed: 19, topology: "frontage" });
    const lot = town.lots.find((entry) => entry.id === "lot5");
    expect(lot, "lot5").toBeTruthy();
    const patch = town.ground.find((g) =>
      g.cover !== "driveway" &&
      Math.abs(g.x - lot!.x) < 1e-6 &&
      Math.abs(g.y - lot!.y) < 1e-6 &&
      Math.abs(g.w - lot!.w) < 1e-6,
    );
    expect(patch?.poly?.length).toBeGreaterThanOrEqual(3);
    expect(patch!.heading).toBe(0);
    const outside = aabbCorners(lot!).filter((p) => !pointInPoly(p.x, p.y, lot!.boundary));
    expect(outside.length).toBeGreaterThan(0);
    for (const p of outside) {
      expect(groundPatchContains(patch!, p.x, p.y)).toBe(false);
      expect(lotFootprintContains(lot!, p.x, p.y)).toBe(false);
    }
    const inside = {
      x: lot!.x + lot!.w * 0.5,
      y: lot!.y + lot!.d * 0.5,
    };
    if (pointInPoly(inside.x, inside.y, lot!.boundary)) {
      expect(groundPatchContains(patch!, inside.x, inside.y)).toBe(true);
    }
  });

  it("does not stamp developed cells on AABB corners outside the parcel", () => {
    const town = createTown({ district: "d10", seed: 19, topology: "frontage" });
    const lot = town.lots.find((entry) => entry.id === "lot5")!;
    const x1 = lot.x + lot.w;
    const y1 = lot.y + lot.d;
    for (let y = lot.y + 0.5; y < y1; y += 1) {
      for (let x = lot.x + 0.5; x < x1; x += 1) {
        if (lotFootprintContains(lot, x, y)) continue;
        if (town.lots.some((other) => other.id !== lot.id && lotFootprintContains(other, x, y))) continue;
        if (pointOnRoad(town.network, x, y)) continue;
        if (town.ground.some((pad) => pad.cover === "driveway" && groundPatchContains(pad, x, y))) continue;
        const ix = Math.floor((x - town.surface.ox) / town.surface.cell);
        const iy = Math.floor((y - town.surface.oy) / town.surface.cell);
        if (ix < 0 || iy < 0 || ix >= town.surface.cols || iy >= town.surface.rows) continue;
        expect(town.surface.surface[iy * town.surface.cols + ix], `cell ${x},${y}`).not.toBe(SURFACE_ID.developed);
      }
    }
  });

  it("clips speckles and axis-aligned pads to an explicit polygon", () => {
    const lot: Lot = completeLot({
      id: "aligned",
      x: 0,
      y: 0,
      w: 10,
      d: 10,
      heading: 0,
      zone: "residential",
      identity: "residence",
      accessId: "",
      templateId: "rural-residence",
    });
    const dressed = dressLot(lot, undefined, new Rng(3), { boxes: [] }, 4);
    const pad = dressed.patches[0]!;
    expect(pad.poly).toHaveLength(4);
    expect(groundPatchContains(pad, 5, 5)).toBe(true);
    expect(groundPatchContains(pad, -0.2, -0.2)).toBe(false);

    const tapered = completeLot({
      id: "tapered",
      x: 0,
      y: 0,
      w: 8,
      d: 10,
      heading: 0.4,
      zone: "residential",
      identity: "residence",
      accessId: "",
      templateId: "rural-residence",
      boundary: [
        { x: 0, y: 0 },
        { x: 8, y: 1 },
        { x: 6, y: 10 },
        { x: 1, y: 9 },
      ],
    });
    const again = dressLot(tapered, undefined, new Rng(3), { boxes: [] }, 2);
    const cover = again.patches[0]!;
    expect(cover.poly).toEqual(tapered.boundary);
    expect(groundPatchContains(cover, 0, 10)).toBe(false);
    expect(groundPatchContains(cover, 3.5, 5)).toBe(true);
  });
});
