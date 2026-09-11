import { expect, it } from "vitest";
import { createBuildingFromArchetype } from "../structure/building";
import { interiorCmds } from "./interiorDraw";
import { objectOcclusionFade, VisibilityFades, wallSpanFadeRuns } from "./occlusion";
import { getBuildingSurfaces } from "./buildingSurfaces";
import { depthKey } from "../world/iso";

it("sorts exterior walls at their actual face, ahead of furnishings behind that face", () => {
  const b = createBuildingFromArchetype("rivertown", "BRICK", 0, 0);
  for (const span of getBuildingSurfaces(b).walls) {
    for (const run of wallSpanFadeRuns(b, span, { x: -100, y: -100, heading: 0 })) {
      const s = run.span;
      const x = (s.dir === "east" ? s.gx0 + 1 : (s.gx0 + s.gx1 + 1) / 2) * b.cellSize;
      const y = (s.dir === "south" ? s.gy0 + 1 : (s.gy0 + s.gy1 + 1) / 2) * b.cellSize;
      expect(s.depth).toBeGreaterThan(depthKey(x - .05, y - .05, 1.5));
    }
  }
});

it("fades projected overhead geometry locally but keeps ground and distant objects solid", () => {
  const d = { x: 2, y: 2, heading: 0 };
  expect(objectOcclusionFade(d, 1, 1, 3, 3, 1, 2)).toBeLessThan(1);
  expect(objectOcclusionFade(d, 1, 1, 3, 3, 0, .18)).toBe(1);
  expect(objectOcclusionFade(d, 100, 100, 3, 3, 1, 2)).toBe(1);
});

it("restores visibility smoothly", () => {
  const fades = new VisibilityFades();
  fades.begin();
  const a = fades.sample("roof", .14, 1 / 60);
  const b = fades.sample("roof", .14, 1 / 60);
  const c = fades.sample("roof", 1, 1 / 60);
  expect(b).toBeLessThan(a);
  expect(c).toBeGreaterThan(b);
  expect(c).toBeLessThan(1);
});

it("visibility changes do not mutate support, damage, collision or scoring", () => {
  const b = createBuildingFromArchetype("rivertown", "BRICK", 0, 0);
  const before = JSON.stringify(b);
  const opaque = interiorCmds(b, 1, { reveal: true });
  const faded = interiorCmds(b, 1, { reveal: true, fadeBox: () => .14 });
  expect(faded.map(c => [c.kind, c.depth])).toEqual(opaque.map(c => [c.kind, c.depth]));
  expect(JSON.stringify(b)).toBe(before);
});
