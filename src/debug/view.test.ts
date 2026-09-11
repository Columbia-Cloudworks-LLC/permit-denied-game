import { describe, expect, it } from "vitest";
import { defaultDebugView } from "./view";
import { createBuildingFromArchetype } from "../structure/building";
import { fixtureSolid, interiorFloorCoverage } from "../structure/interior";
import { interiorCmds } from "../render/interiorDraw";
import { debugLines } from "../render/debugOverlay";
import { createTown } from "../world/town";
import { createDozer } from "../vehicle/dozer";

describe("scene inspection", () => {
  it("reveals intact rooms without changing normal exposure, support, or collision", () => {
    const b = createBuildingFromArchetype("rivertown", "INSPECT", 0, 0);
    const before = JSON.stringify(b);
    const collision = b.fixtures.map(f => fixtureSolid(b, f));
    const normal = interiorFloorCoverage(b);
    const area = (spans: typeof normal.spans) => spans.reduce((n, s) => n + (s.gx1 - s.gx0 + 1) * (s.gy1 - s.gy0 + 1), 0);
    expect(area(interiorFloorCoverage(b, true).spans)).toBeGreaterThan(area(normal.spans));
    const visible = interiorCmds(b, 1, { reveal: true, maxFloor: 0 });
    expect(visible.filter(c => c.kind === "fixture")).toHaveLength(b.fixtures.filter(f => f.floor === 0 && f.kind !== "partition").length);
    expect(interiorFloorCoverage(b).spans).toBe(normal.spans);
    expect(b.fixtures.map(f => fixtureSolid(b, f))).toEqual(collision);
    expect(JSON.stringify(b)).toBe(before);
  });

  it("draws requested overlays from live geometry even when their art is hidden", () => {
    const town = createTown({ showcase: true });
    const dozer = createDozer(town.spawnX, town.spawnY, town.spawnHeading);
    const view = defaultDebugView();
    expect(debugLines(town, dozer, view)).toEqual([]);
    view.paths = true;
    expect(debugLines(town, dozer, view)).toHaveLength(town.network.segments.length);
    view.paths = false;
    view.collision = true;
    const before = debugLines(town, dozer, view);
    view.walls = false;
    view.contents = false;
    expect(debugLines(town, dozer, view)).toEqual(before);
    expect(before.length).toBeGreaterThan(1);
  });
});
