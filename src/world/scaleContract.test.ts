import { describe, expect, it } from "vitest";
import { CELL, DOZER, FLOOR_Z } from "../game/constants";
import { createBuildingFromArchetype } from "../structure/building";
import { vehicleDefinition } from "../vehicle/definitions";
import { SCALE_CONTRACT, scaleReferenceVehicles } from "./scaleContract";
import { createTown } from "./town";
import { widthFor } from "./roads";

function luminance(color: number): number {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return r * 0.299 + g * 0.587 + b * 0.114;
}

describe("world scale contract", () => {
  it("documents dozer, door, story, and lane references", () => {
    expect(SCALE_CONTRACT.cell).toBe(CELL);
    expect(SCALE_CONTRACT.storyHeight).toBe(FLOOR_Z);
    expect(SCALE_CONTRACT.doorWidth).toBe(CELL);
    expect(SCALE_CONTRACT.dozer.length).toBe(DOZER.length);
    expect(SCALE_CONTRACT.lane.rural).toBe(widthFor("rural"));
    expect(SCALE_CONTRACT.lane.residential).toBeLessThan(SCALE_CONTRACT.lane.rural);
    expect(SCALE_CONTRACT.lane.driveway).toBeLessThan(SCALE_CONTRACT.lane.residential);
  });

  it("keeps passenger cars, the dozer, and a ranch door on the same scale", () => {
    const sedan = vehicleDefinition("car");
    const ranch = createBuildingFromArchetype("ranch", "SCALE", 0, 0);
    expect(sedan.length / DOZER.length).toBeGreaterThan(0.8);
    expect(sedan.length / DOZER.length).toBeLessThan(1.15);
    expect(ranch.cellSize).toBe(CELL);
    expect(FLOOR_Z / DOZER.length).toBeGreaterThan(0.85);
    expect(FLOOR_Z / DOZER.length).toBeLessThan(1.2);
    const vehicles = scaleReferenceVehicles();
    expect(vehicles.some((v) => v.id === "car")).toBe(true);
    expect(vehicles.some((v) => v.id === "excavator" && Math.abs(v.width - DOZER.width) < 0.1)).toBe(true);
  });

  it("includes an integrated scale-comparison bay in the test yard", () => {
    const town = createTown({ yard: true });
    expect(town.yard?.scaleBay).toBeDefined();
    expect(town.buildings.some((b) => b.name === "SCALE RANCH")).toBe(true);
    expect(town.vehicles.some((v) => v.definitionId === "car")).toBe(true);
    const classes = new Set(town.network.segments.map((s) => s.roadClass));
    expect(classes.has("rural")).toBe(true);
    expect(classes.has("residential")).toBe(true);
    expect(classes.has("commercial")).toBe(true);
  });
});

describe("palette hierarchy", () => {
  it("keeps the dozer brighter than grass in grayscale", async () => {
    const { PAL } = await import("../render/palette");
    expect(luminance(PAL.dozer)).toBeGreaterThan(luminance(PAL.grass) + 40);
    expect(luminance(PAL.grass)).toBeGreaterThan(luminance(PAL.grassDark));
    expect(luminance(PAL.brick)).not.toBe(luminance(PAL.grass));
  });
});
