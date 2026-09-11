import { describe, expect, it } from "vitest";
import { Rng } from "../game/rng";
import { allocateFrontage, completeLot, parcelFromFrontage, PARCEL } from "./parcels";
import { linePoints, pt, RoadBuilder } from "./roads";
import { createTown } from "./town";
import { validateTown } from "./districts";

describe("frontage parcels", () => {
  it("records frontage, boundary, and a buildable envelope", () => {
    const b = new RoadBuilder();
    const w = b.node(0, 10);
    const e = b.node(80, 10);
    const seg = b.segment(w, e, linePoints(pt(w), pt(e)), { roadClass: "rural" });
    const geom = parcelFromFrontage(seg, 1, 0.2, 0.32, 11);
    expect(geom.boundary).toHaveLength(4);
    const lot = completeLot({
      id: "p",
      x: 0,
      y: 0,
      w: 10,
      d: 10,
      heading: geom.heading,
      zone: "residential",
      identity: "residence",
      accessId: "",
      templateId: "",
      frontage: { segmentId: seg.id, side: 1, t0: 0.2, t1: 0.32 },
      boundary: geom.boundary,
    });
    expect(lot.buildable.w).toBeGreaterThan(2);
    expect(lot.buildable.d).toBeGreaterThan(2);
    expect(lot.frontage.segmentId).toBe(seg.id);
  });

  it("places parcels on street frontage instead of distant unserved rows", () => {
    const b = new RoadBuilder();
    const a = b.node(0, 8);
    const c = b.node(90, 8);
    b.segment(a, c, linePoints(pt(a), pt(c)), { roadClass: "rural" });
    const { lots } = allocateFrontage(b.segments, b.nodes, 8, new Rng(3));
    expect(lots.length).toBeGreaterThanOrEqual(4);
    for (const lot of lots) {
      expect(lot.frontage.segmentId).toBeTruthy();
      const midY = lot.y + lot.d * 0.5;
      expect(Math.abs(midY - 8)).toBeLessThan(PARCEL.maxDepth + 4);
    }
  });

  it("keeps generated districts free of unserved back-row lots", () => {
    const town = createTown({ district: "d10", seed: 0x51a11 });
    expect(town.lots.every((l) => l.frontage.segmentId && l.drivewayId)).toBe(true);
    const report = validateTown(town);
    expect(report.issues, report.issues.map((i) => i.detail).join("; ")).toEqual([]);
  });
});
