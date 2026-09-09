import { describe, expect, it } from "vitest";
import { createTown } from "./town";
import { validateTown } from "./districts";
import { ARCHETYPES } from "./archetypes";
import { createBuildingFromArchetype } from "../structure/building";
import { siteDescriptor, buildCollapsedSite } from "../structure/site";

function facadeSig(town: ReturnType<typeof createTown>): string {
  return town.buildings
    .map((b) => {
      const windows = b.cells.map((c) => `${c.gx}${c.gy}${c.floor}${c.windowS ? "S" : ""}${c.doorS ? "D" : ""}`).join("");
      const roofs = b.roofs.map((r) => `${r.style}:${r.verts.map((v) => v.z.toFixed(2)).join(",")}`).join("/");
      return `${b.archetypeId}:${b.theme}:${b.w}x${b.d}:${b.floors}:${b.roof}:${b.roofAxis}:${windows}:${roofs}`;
    })
    .join("|");
}

describe("building archetypes", () => {
  it("defines visually distinct residential and commercial silhouettes", () => {
    const ids = ARCHETYPES.map((a) => `${a.id}:${a.w}x${a.d}:${a.floors}:${a.roof}:${a.theme}`);
    expect(new Set(ids).size).toBe(ARCHETYPES.length);
    expect(ARCHETYPES.some((a) => a.id === "ranch" && a.floors === 1 && a.w >= 5)).toBe(true);
    expect(ARCHETYPES.some((a) => a.id === "warehouse" && a.roof === "shed" && a.loading)).toBe(true);
    expect(ARCHETYPES.some((a) => a.id === "storefront" && a.features.awning && a.roof === "flat")).toBe(true);
  });

  it("reproduces archetypes, facades, roofs, and collapsed sites for the same seed", () => {
    const a = createTown({ district: "d10", seed: 0x51a11 });
    const b = createTown({ district: "d10", seed: 0x51a11 });
    expect(facadeSig(a)).toBe(facadeSig(b));
    const host = { seed: a.seed, collapsedSites: [], siteRevision: 1, roads: a.roads };
    const siteA = buildCollapsedSite(a.buildings[0]!, host);
    const siteB = buildCollapsedSite(b.buildings[0]!, { ...host, seed: b.seed });
    expect(siteDescriptor(siteA)).toBe(siteDescriptor(siteB));
  });

  it("keeps decorative attachments inside validated lots", () => {
    for (const district of ["d10", "d30", "d100"] as const) {
      const town = createTown({ district, seed: 19 });
      const report = validateTown(town);
      expect(report.issues, report.issues.map((i) => i.detail).join("; ")).toEqual([]);
    }
  });

  it("builds garage and porch features without inventing extra collision cells on empty floors", () => {
    const b = createBuildingFromArchetype("porch-house", "PORCH LOT", 2, 2);
    expect(b.features.garage).toBe(true);
    expect(b.features.porch).toBe(true);
    const topGarage = b.grid[1]![b.w - 1]![0]!;
    expect(topGarage.state).toBe("gone");
    expect(b.cells.some((c) => c.gx === b.w - 1 && c.floor === 0)).toBe(true);
    expect(b.decorBoxes.some((d) => d.kind === "porch")).toBe(true);
  });
});
