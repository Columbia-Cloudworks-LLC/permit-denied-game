import { describe, expect, it } from "vitest";
import { applyCellDamage, createBuildingFromArchetype } from "../structure/building";
import { ParticlePool } from "../fx/particles";
import { getBuildingSurfaces } from "./buildingSurfaces";
import {
  WALL_OCCLUDE_ALPHA,
  WALL_OCCLUDE_NEAR,
  wallCellOcclusionFade,
  wallSpanFadeRuns,
  type OccludeDozer,
} from "./occlusion";

function ranchAt(x = 20, y = 8) {
  return createBuildingFromArchetype("ranch", "RANCH", x, y);
}

function dozer(x: number, y: number, heading = -Math.PI / 2): OccludeDozer {
  return { x, y, heading };
}

function southFade(b: ReturnType<typeof ranchAt>, gx: number, d: OccludeDozer): number {
  return wallCellOcclusionFade(b, "south", gx, b.d - 1, 0, d);
}

function eastFade(b: ReturnType<typeof ranchAt>, gy: number, d: OccludeDozer): number {
  return wallCellOcclusionFade(b, "east", b.w - 1, gy, 0, d);
}

describe("wall cell occlusion fade", () => {
  it("keeps the intact ranch solid from the south lawn spawn", () => {
    const b = ranchAt();
    const lawn = dozer(b.x + b.w * b.cellSize * 0.5, b.y + b.d * b.cellSize + 3.5);
    for (let gx = 0; gx < b.w; gx++) expect(southFade(b, gx, lawn)).toBe(1);
    for (let gy = 0; gy < b.d; gy++) expect(eastFade(b, gy, lawn)).toBe(1);
  });

  it("does not ghost the distant south facade from north of the house", () => {
    const b = ranchAt();
    const behind = dozer(b.x + b.w * b.cellSize * 0.5, b.y - 1.2);
    for (let gx = 0; gx < b.w; gx++) expect(southFade(b, gx, behind)).toBe(1);
    for (let gy = 0; gy < b.d; gy++) expect(eastFade(b, gy, behind)).toBe(1);
  });

  it("ghosts only the south cell that covers a dozer just inside the wall", () => {
    const b = ranchAt();
    const cs = b.cellSize;
    const mid = dozer(b.x + 2.5 * cs, b.y + b.d * cs - 0.85, Math.PI / 2);
    expect(southFade(b, 2, mid)).toBe(WALL_OCCLUDE_ALPHA);
    expect(southFade(b, 0, mid)).toBe(1);
    expect(southFade(b, 4, mid)).toBe(1);
    expect(eastFade(b, 0, mid)).toBe(1);
  });

  it("ghosts an east cell the dozer is pressed against, not the far south wing", () => {
    const b = ranchAt();
    const cs = b.cellSize;
    const against = dozer(b.x + b.w * cs - 0.8, b.y + 1.5 * cs, 0);
    expect(eastFade(b, 1, against)).toBe(WALL_OCCLUDE_ALPHA);
    expect(southFade(b, 0, against)).toBe(1);
  });

  it("stays solid when the dozer is beside a wall but on the camera side of it", () => {
    const b = ranchAt();
    const cs = b.cellSize;
    const southOfSouth = dozer(b.x + 2.5 * cs, b.y + b.d * cs + 0.7, -Math.PI / 2);
    expect(southFade(b, 2, southOfSouth)).toBe(1);
    const eastOfEast = dozer(b.x + b.w * cs + 0.7, b.y + 1.5 * cs, Math.PI);
    expect(eastFade(b, 1, eastOfEast)).toBe(1);
  });

  it("leaves a south cell solid when the dozer is near but laterally clear", () => {
    const b = ranchAt();
    const cs = b.cellSize;
    const west = dozer(b.x - 1.6, b.y + b.d * cs - 0.7, 0);
    expect(southFade(b, 2, west)).toBe(1);
  });

  it("splits a merged south span so only the blocking run fades", () => {
    const b = ranchAt();
    const cs = b.cellSize;
    const mid = dozer(b.x + 2.5 * cs, b.y + b.d * cs - 0.85, Math.PI / 2);
    const south = getBuildingSurfaces(b).walls.find((w) => w.dir === "south" && w.gy0 === b.d - 1);
    expect(south).toBeTruthy();
    const runs = wallSpanFadeRuns(b, south!, mid);
    expect(runs.length).toBeGreaterThan(1);
    expect(runs.some((r) => r.fade === WALL_OCCLUDE_ALPHA)).toBe(true);
    expect(runs.some((r) => r.fade === 1 && r.span.gx0 === 0)).toBe(true);
    expect(runs.some((r) => r.fade === 1 && r.span.gx1 === b.w - 1)).toBe(true);
  });

  it("after a south breach, remaining wing walls stay solid unless they cover the dozer", () => {
    const b = ranchAt();
    applyCellDamage(b, b.grid[0]![2]![b.d - 1]!, 999, 0, 1, new ParticlePool(), []);
    const lawn = dozer(b.x + b.w * b.cellSize * 0.5, b.y + b.d * b.cellSize + 3.5);
    expect(southFade(b, 0, lawn)).toBe(1);
    expect(southFade(b, 4, lawn)).toBe(1);
    const hole = dozer(b.x + 2.5 * b.cellSize, b.y + (b.d - 0.4) * b.cellSize, -Math.PI / 2);
    expect(southFade(b, 0, hole)).toBe(1);
    expect(southFade(b, 4, hole)).toBe(1);
  });

  it("keeps the near radius tight enough that a house-depth gap does not fade", () => {
    const b = ranchAt();
    expect(b.d * b.cellSize).toBeGreaterThan(WALL_OCCLUDE_NEAR);
  });
});
