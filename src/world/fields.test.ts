import { describe, expect, it } from "vitest";
import { COPY, CASH_TARGET, SIM_DT } from "../game/constants";
import { ParticlePool } from "../fx/particles";
import { bladePoints, createDozer } from "../vehicle/dozer";
import { stepWorld } from "../sim/worldSim";
import { pointOnRoad } from "./roads";
import { createTown } from "./town";
import {
  CHURN_SWATH,
  CHURN_TRACK,
  FIELD_CELL,
  FIELD_COMPLETE_RATIO,
  FIELD_COMPLETION_SHARE,
  FIELD_FARM_RANGE,
  FIELD_MIN_AREA,
  FIELD_SWATH_RADIUS,
  FIELD_TRACK_RADIUS,
  FIELD_TRACK_SEP,
  FIELD_VALUE_CAP,
  cropLabel,
  fieldCellWorld,
  fieldChurnSpan,
  fieldProgress,
  fieldValidCount,
  fieldValue,
  fieldWorldBox,
  isPrimaryField,
  payFieldDamage,
  undevelopedFieldShare,
} from "./fields";
import { churnFieldAt, type FieldFeature } from "./terrainFeatures";
import { SURFACE_ID } from "./terrain";
import type { TopologyFamily } from "./rural";

const MATRIX: TopologyFamily[] = ["county", "curve-farm", "frontage"];
const SEEDS = [1, 7, 11, 19, 23, 29, 37, 41, 47, 53, 67, 71, 77, 83, 89, 97, 101, 107, 334353, 0x51a11];

function firstCropCell(feature: FieldFeature): { x: number; y: number } {
  for (let row = 0; row < feature.rows; row++) {
    for (let col = 0; col < feature.cols; col++) {
      if (feature.mask && !feature.mask[row * feature.cols + col]) continue;
      return fieldCellWorld(feature, col, row);
    }
  }
  return { x: feature.x + feature.w * 0.5, y: feature.y + feature.d * 0.5 };
}

function syntheticField(w = 28, d = 12): FieldFeature {
  const cell = FIELD_CELL;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(d / cell);
  const feature: FieldFeature = {
    kind: "field",
    id: "field-test",
    x: 0,
    y: 0,
    w,
    d,
    heading: 0,
    crop: "corn",
    state: "mature",
    seed: 1,
    cell,
    cols,
    rows,
    churn: new Uint8Array(cols * rows),
    mask: new Uint8Array(cols * rows).fill(1),
    paid: 0,
    cleared: false,
  };
  feature.valid = fieldValidCount(feature);
  feature.value = fieldValue(feature.valid * cell * cell);
  feature.primary = isPrimaryField(feature);
  return feature;
}

describe("field value and payout", () => {
  it("keeps a field between 3% and 8% of the cash target, capped", () => {
    const lo = fieldValue(FIELD_MIN_AREA);
    const hi = fieldValue(FIELD_MIN_AREA * 8);
    expect(lo).toBeGreaterThanOrEqual(CASH_TARGET * 0.03);
    expect(hi).toBeLessThanOrEqual(Math.min(FIELD_VALUE_CAP, CASH_TARGET * 0.08));
    expect(hi).toBeGreaterThanOrEqual(CASH_TARGET * 0.03);
  });

  it("pays unique area then a 20% completion bonus at 90%", () => {
    const field = syntheticField();
    const valid = field.valid!;
    const value = field.value!;
    const first = payFieldDamage(field, 10);
    expect(first).toBeGreaterThan(0);
    expect(payFieldDamage(field, 0)).toBe(0);
    const already = field.churn.fill(1, 0, 10);
    void already;
    const need = Math.ceil(valid * FIELD_COMPLETE_RATIO);
    for (let i = 10; i < need; i++) field.churn[i] = 1;
    const before = field.paid ?? 0;
    const rest = payFieldDamage(field, need - 10);
    expect(field.cleared).toBe(true);
    expect(field.paid).toBe(value);
    expect(rest).toBe(value - Math.floor(before));
    expect((value - (value * (1 - FIELD_COMPLETION_SHARE)) * FIELD_COMPLETE_RATIO) / value).toBeGreaterThan(0.15);
    expect(COPY.fieldCleared).toBe("FIELD CLEARED");
    expect(cropLabel("corn")).toBe("CORN");
  });
});

describe("blade swath versus tracks", () => {
  it("keeps blade-up tracks at or under 1.2 wu and blade-down at or over 1.9 wu", () => {
    const tracks = syntheticField();
    const cx = tracks.w * 0.5;
    const cy = tracks.d * 0.5;
    const t0 = performance.now();
    churnFieldAt(tracks, cx, cy - FIELD_TRACK_SEP, FIELD_TRACK_RADIUS, CHURN_TRACK);
    churnFieldAt(tracks, cx, cy + FIELD_TRACK_SEP, FIELD_TRACK_RADIUS, CHURN_TRACK);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(fieldChurnSpan(tracks)).toBeLessThanOrEqual(1.2);

    const swath = syntheticField();
    const dozer = createDozer(cx, cy, 0);
    dozer.bladeDown = true;
    for (const p of bladePoints(dozer)) churnFieldAt(swath, p.x, p.y, FIELD_SWATH_RADIUS, CHURN_SWATH);
    expect(fieldChurnSpan(swath)).toBeGreaterThanOrEqual(1.9);
  });
});

describe("rural farmland matrix", () => {
  it("keeps crop complexes property-scale, near farms, and off developed ground", () => {
    const shares: number[] = [];
    let agPrimary = 0;
    let agTowns = 0;
    let near = 0;
    let totalFields = 0;
    for (const topology of MATRIX) {
      for (const seed of SEEDS) {
        const town = createTown({ district: "d10", seed, topology });
        const share = undevelopedFieldShare(town.surface);
        shares.push(share);
        const fields = town.features.filter((f): f is FieldFeature => f.kind === "field");
        if (town.biome.id === "agricultural-plain") {
          agTowns++;
          const primary = fields.find((f) => isPrimaryField(f) && (f.state === "mature" || f.state === "short"));
          if (primary) agPrimary++;
        }
        const farms = town.lots.filter((lot) => lot.identity === "farm");
        for (const field of fields) {
          totalFields++;
          const box = fieldWorldBox(field);
          const close = farms.some((lot) => {
            const dx = Math.max(0, box.x - (lot.x + lot.w), lot.x - (box.x + box.w));
            const dy = Math.max(0, box.y - (lot.y + lot.d), lot.y - (box.y + box.d));
            return Math.hypot(dx, dy) <= FIELD_FARM_RANGE;
          }) || !!field.lotId;
          if (close || farms.length === 0) near++;
          expect(field.cell).toBeGreaterThanOrEqual(0.55);
          expect(field.cell).toBeLessThanOrEqual(0.8);
          for (let row = 0; row < field.rows; row += 3) {
            for (let col = 0; col < field.cols; col += 3) {
              if (field.mask && !field.mask[row * field.cols + col]) continue;
              const fx = Math.cos(field.heading);
              const fy = Math.sin(field.heading);
              const ox = field.x + field.w * 0.5;
              const oy = field.y + field.d * 0.5;
              const x = ox + fx * ((col + 0.5) * field.cell - field.w * 0.5) - fy * ((row + 0.5) * field.cell - field.d * 0.5);
              const y = oy + fy * ((col + 0.5) * field.cell - field.w * 0.5) + fx * ((row + 0.5) * field.cell - field.d * 0.5);
              expect(pointOnRoad(town.network, x, y)).toBe(false);
              const ix = Math.floor(x - town.surface.ox);
              const iy = Math.floor(y - town.surface.oy);
              if (ix >= 0 && iy >= 0 && ix < town.surface.cols && iy < town.surface.rows) {
                const id = town.surface.surface[iy * town.surface.cols + ix]!;
                expect(id).not.toBe(SURFACE_ID.water);
                expect(id).not.toBe(SURFACE_ID.developed);
              }
              for (const lot of town.lots) {
                if (lot.identity === "farm") continue;
                expect(x >= lot.x && y >= lot.y && x <= lot.x + lot.w && y <= lot.y + lot.d).toBe(false);
              }
            }
          }
        }
      }
    }
    const mean = shares.reduce((s, n) => s + n, 0) / shares.length;
    expect(mean).toBeGreaterThanOrEqual(0.15);
    expect(mean).toBeLessThanOrEqual(0.3);
    expect(agTowns).toBeGreaterThan(0);
    expect(agPrimary / agTowns).toBeGreaterThanOrEqual(0.9);
    expect(totalFields).toBeGreaterThan(0);
    expect(near / totalFields).toBeGreaterThanOrEqual(0.9);
  });

  it("flattens a live field with crop fragments, cash, and no stalk props", () => {
    const town = createTown({ district: "d10", seed: 334353, topology: "curve-farm" });
    const live = town.features.find((f): f is FieldFeature => f.kind === "field" && (f.state === "mature" || f.state === "short"));
    expect(live).toBeDefined();
    expect(Math.min(live!.w, live!.d)).toBeGreaterThanOrEqual(3);
    const sample = firstCropCell(live!);
    const dozer = createDozer(sample.x, sample.y, live!.heading);
    dozer.bladeDown = true;
    const particles = new ParticlePool();
    const before = live!.churn.reduce((sum, cell) => sum + cell, 0);
    const t0 = performance.now();
    const out = stepWorld(town, dozer, particles, { blade: 0, engine: 0, push: 0 }, SIM_DT);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(live!.churn.reduce((sum, cell) => sum + cell, 0)).toBeGreaterThan(before);
    expect(particles.items.some((p) => p.alive && p.kind === "crop")).toBe(true);
    expect(particles.items.some((p) => p.alive && p.kind === "wood")).toBe(false);
    expect(out.cash).toBeGreaterThanOrEqual(0);
    expect(fieldProgress(live!)).toBeGreaterThan(0);
    expect(town.props.every((p) => p.assetId !== "corn" && p.assetId !== "wheat")).toBe(true);
  });
});
