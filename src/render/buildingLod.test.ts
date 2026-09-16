import { describe, expect, it } from "vitest";
import { defaultDebugView } from "../debug/view";
import { createBuildingFromArchetype } from "../structure/building";
import {
  buildingDamaged,
  buildingIsLive,
  buildingLod,
  buildingNeedsDetails,
  buildingNeedsInterior,
  coalesceStaticChunks,
  debugViewSignature,
} from "./buildingLod";

describe("building render lod", () => {
  const view = defaultDebugView();

  it("keeps interiors for near, glass, reveal, and damaged shells", () => {
    const ranch = createBuildingFromArchetype("ranch", "RANCH", 0, 0);
    const needle = createBuildingFromArchetype("needle-office", "NEEDLE", 0, 0);
    expect(buildingNeedsInterior(ranch, view, "street")).toBe(false);
    expect(buildingNeedsInterior(ranch, view, "overview")).toBe(false);
    expect(buildingNeedsInterior(ranch, view, "near")).toBe(true);
    expect(buildingNeedsInterior(ranch, { ...view, reveal: true }, "street")).toBe(true);
    ranch.roofs[0]!.state = "gone";
    expect(buildingDamaged(ranch)).toBe(true);
    expect(buildingNeedsInterior(ranch, view, "street")).toBe(true);
    if (needle.construction.skin === "glass") {
      expect(buildingNeedsInterior(needle, view, "overview")).toBe(true);
    }
  });

  it("hides facade details in overview and keeps them on the street", () => {
    expect(buildingNeedsDetails(view, "overview")).toBe(false);
    expect(buildingNeedsDetails(view, "street")).toBe(true);
    expect(buildingNeedsDetails(view, "near")).toBe(true);
    expect(buildingNeedsDetails({ ...view, details: false }, "street")).toBe(false);
  });

  it("treats only near or damaged buildings as live", () => {
    expect(buildingLod(true, false, 1.15)).toBe("near");
    expect(buildingLod(false, true, 0.2)).toBe("overview");
    expect(buildingLod(false, false, 1.15)).toBe("street");
    expect(buildingIsLive("near", false)).toBe(true);
    expect(buildingIsLive("street", false)).toBe(false);
    expect(buildingIsLive("overview", true)).toBe(true);
    expect(debugViewSignature(view)).toBe(debugViewSignature(defaultDebugView()));
  });

  it("coalesces consecutive static chunks without reordering other commands", () => {
    const order: string[] = [];
    const paint = (id: string) => ({
      chunk: id.startsWith("b") ? id : undefined,
      depth: order.length,
      run: (_g: unknown) => { void _g; order.push(id); },
    });
    const cmds = [paint("b1"), paint("b1"), paint("p"), paint("b2"), paint("b2"), paint("b2")];
    const merged = coalesceStaticChunks(cmds);
    expect(merged).toHaveLength(3);
    for (const cmd of merged) cmd.run({} as never);
    expect(order).toEqual(["b1", "b1", "p", "b2", "b2", "b2"]);
  });
});
