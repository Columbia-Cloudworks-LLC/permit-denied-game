import { describe, expect, it } from "vitest";
import { Rng } from "../game/rng";
import {
  aabbContainedInBox,
  allocateFrontage,
  completeLot,
  parcelFromFrontage,
  parcelHitsRoad,
  placeBuildingInLot,
  PARCEL,
} from "./parcels";
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

  it("rejects a parcel that only overlaps a street corridor along one edge", () => {
    const b = new RoadBuilder();
    const w = b.node(0, 0);
    const e = b.node(24, 0);
    const seg = b.segment(w, e, linePoints(pt(w), pt(e)), { roadClass: "rural", width: 4, shoulder: 0.4 });
    const overlapping = [
      { x: 6, y: 1.6 },
      { x: 14, y: 1.6 },
      { x: 14, y: 12 },
      { x: 6, y: 12 },
    ];
    expect(parcelHitsRoad(overlapping, [seg])).toBe(true);
    const clear = [
      { x: 6, y: 3.1 },
      { x: 14, y: 3.1 },
      { x: 14, y: 14 },
      { x: 6, y: 14 },
    ];
    expect(parcelHitsRoad(clear, [seg])).toBe(false);
  });

  it("requires full envelope containment for buildings and decorative attachments", () => {
    const env = { x: 10, y: 10, w: 6, d: 4 };
    expect(aabbContainedInBox({ x: 10.2, y: 10.2, w: 5, d: 3.4 }, env)).toBe(true);
    expect(aabbContainedInBox({ x: 12, y: 10.2, w: 5, d: 3.4 }, env)).toBe(false);
    const lot = completeLot({
      id: "tight",
      x: 40,
      y: 40,
      w: 6,
      d: 4.2,
      heading: 0,
      zone: "residential",
      identity: "residence",
      accessId: "",
      templateId: "",
      boundary: [
        { x: 40, y: 40 },
        { x: 46, y: 40 },
        { x: 46, y: 44.2 },
        { x: 40, y: 44.2 },
      ],
      buildable: { x: 40.1, y: 40.1, w: 5.8, d: 3.2 },
    });
    expect(placeBuildingInLot(lot, new Rng(2), [], [], [])).toBeNull();
  });

  it("cuts frontage on later streets instead of stopping after the first", () => {
    const b = new RoadBuilder();
    const a = b.node(0, 0);
    const c = b.node(80, 0);
    const d = b.node(0, 40);
    const e = b.node(80, 40);
    b.segment(a, c, linePoints(pt(a), pt(c)), { roadClass: "rural" });
    b.segment(d, e, linePoints(pt(d), pt(e)), { roadClass: "rural" });
    const { lots } = allocateFrontage(b.segments, b.nodes, 6, new Rng(3));
    expect(new Set(lots.map((l) => l.frontage.segmentId)).size).toBeGreaterThan(1);
  });

  it("flags a decorative attachment that leaves the envelope", () => {
    const town = createTown({ district: "d10", seed: 1 });
    const lot = town.lots[0]!;
    const building = town.buildings[0]!;
    building.decorBoxes.push({
      x: lot.buildable.x + lot.buildable.w + 0.4,
      y: lot.buildable.y + 0.2,
      w: 1.1,
      d: 0.7,
      kind: "porch",
    });
    const report = validateTown(town);
    expect(report.issues.some((i) => i.code === "envelope" || i.code === "parcel-contain")).toBe(true);
  });
});
