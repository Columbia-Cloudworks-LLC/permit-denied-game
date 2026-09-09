import { describe, expect, it } from "vitest";
import { createBuildingFromArchetype } from "../structure/building";
import { cellColors } from "./drawIso";
import { topFaceColor, wallFaceColor } from "./lighting";

describe("wall lighting", () => {
  it("uses wall orientation shade for eave/gable fills, not top or raw side ramps", () => {
    const b = createBuildingFromArchetype("cottage", "T", 0, 0);
    const mat = b.cells.find((c) => c.floor === b.floors - 1 && c.state !== "gone")!.material;
    const cols = cellColors(mat, false);
    const eastWall = wallFaceColor(mat, "east");
    const southWall = wallFaceColor(mat, "south");

    expect(eastWall).not.toBe(topFaceColor(mat));
    expect(southWall).not.toBe(topFaceColor(mat));
    expect(eastWall).not.toBe(cols.right);
    expect(southWall).not.toBe(cols.left);
  });
});
