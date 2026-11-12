import { describe, expect, it } from "vitest";
import { CATALOG_CAPTURE_DOZER } from "../debug/catalogCaptureDozer";
import { CELL, FLOOR_Z } from "../game/constants";
import { depthKey } from "../world/iso";
import { discoverYardAssets, instantiateBay, type YardBay } from "../world/yardCatalog";
import { getBuildingSurfaces } from "./buildingSurfaces";
import { interiorCmds } from "./interiorDraw";
import { WALL_OCCLUDE_ALPHA, objectOcclusionFade, wallSpanFadeRuns } from "./occlusion";
import { regionalWallPaint, wallFinish, wallPaintDepths, wallTone, wallTrimTone } from "./wallPaint";
import { wallFaceColor } from "./lighting";
import { createBuildingFromArchetype } from "../structure/building";
import type { Building } from "../structure/types";
import type { ArchetypeId } from "../world/archetypes";

const CATALOG_DOZER = CATALOG_CAPTURE_DOZER;

function captureBay(id: string, intactFacade = true): YardBay {
  const asset = discoverYardAssets().find((a) => a.id === id);
  if (!asset) throw new Error(`missing ${id}`);
  const pad = Math.max(12, asset.clearance);
  const bay: YardBay = {
    key: `capture:${id}`,
    asset,
    variant: 0,
    baseline: false,
    intactFacade,
    x: pad - asset.clearance,
    y: pad - asset.clearance,
    w: asset.w + pad * 2,
    d: asset.d + pad * 2,
  };
  instantiateBay(bay);
  return bay;
}

function mergedWallDepths(b: NonNullable<YardBay["building"]>) {
  return getBuildingSurfaces(b).walls.flatMap((span) =>
    wallSpanFadeRuns(b, span, CATALOG_DOZER).map((run) => ({ span: run.span, depth: run.span.depth })),
  );
}

function eastEdgeSlabDepth(b: NonNullable<YardBay["building"]>, gy: number, floor: number): number {
  const cs = b.cellSize;
  const x0 = b.x + (b.w - 1) * cs;
  const y0 = b.y + gy * cs;
  const z = floor * FLOOR_Z + 0.18;
  return Math.min(
    depthKey(x0, y0, z),
    depthKey(x0 + cs + 0.03, y0, z),
    depthKey(x0, y0 + cs + 0.03, z),
    depthKey(x0 + cs + 0.03, y0 + cs + 0.03, z),
  );
}

describe("fixture:interior-bed catalog host", () => {
  it("keeps a closed south facade for catalog capture", () => {
    const b = captureBay("fixture:interior-bed").building!;
    expect(b.cells.filter((c) => c.state === "gone")).toEqual([]);
    const south = getBuildingSurfaces(b).walls.filter((s) => s.dir === "south");
    expect(south.some((s) => s.gx0 <= 1 && s.gx1 >= 3)).toBe(true);
    expect(south.some((s) => s.floor === 0)).toBe(true);
    expect(south.some((s) => s.floor === 1)).toBe(true);
    for (const wall of wallPaintDepths(b, CATALOG_DOZER)) {
      expect(wall.fade).toBe(1);
    }
    const cs = b.cellSize;
    for (const cell of b.cells) {
      const x = b.x + (cell.exterior.east ? (cell.gx + 1) * cs : cell.gx * cs);
      const y = b.y + (cell.exterior.south ? (cell.gy + 1) * cs : cell.gy * cs);
      expect(
        objectOcclusionFade(
          CATALOG_DOZER,
          x,
          y,
          cell.exterior.east ? 0.08 : cs,
          cell.exterior.south ? 0.08 : cs,
          0,
          (cell.floor + 1) * FLOOR_Z,
        ),
      ).toBe(1);
    }
  });

  it("still opens the south wall on the yard/test host", () => {
    const b = captureBay("fixture:interior-bed", false).building!;
    const gone = b.cells.filter((c) => c.state === "gone");
    expect(gone.length).toBeGreaterThan(0);
    expect(gone.every((c) => c.gy === b.d - 1 && c.gx >= 1 && c.gx <= 3)).toBe(true);
  });

  it("ghosts a south wall only when the dozer is actually against it", () => {
    const b = captureBay("fixture:interior-bed").building!;
    const cs = b.cellSize;
    const against = {
      x: b.x + 0.5 * cs,
      y: b.y + b.d * cs - 0.8,
      heading: -Math.PI / 2,
    };
    const faded = wallPaintDepths(b, against).filter((w) => w.fade < 1);
    expect(faded.some((w) => w.span.dir === "south")).toBe(true);
    expect(faded.every((w) => w.fade === WALL_OCCLUDE_ALPHA)).toBe(true);
  });

  it("shows why a merged east span loses to a south-east upper floor", () => {
    const b = captureBay("fixture:interior-bed", false).building!;
    const floors = interiorCmds(b, 1).filter((c) => c.kind === "floor" && c.floor > 0);
    const east = mergedWallDepths(b).filter((w) => w.span.dir === "east" && w.span.floor > 0);
    expect(Math.max(...floors.map((c) => c.depth))).toBeGreaterThan(Math.max(...east.map((w) => w.depth)));
  });

  it("paints each east-edge slab behind the east wall cell in the same row", () => {
    const b = captureBay("fixture:interior-bed").building!;
    const east = wallPaintDepths(b, CATALOG_DOZER).filter((w) => w.span.dir === "east");
    expect(east.length).toBeGreaterThan(0);
    for (const wall of east) {
      const faceX = b.x + (wall.span.gx0 + 1) * b.cellSize;
      const faceY = b.y + (wall.span.gy0 + 0.5) * b.cellSize;
      expect(wall.depth).toBe(depthKey(faceX, faceY, wall.span.floor * FLOOR_Z));
      expect(eastEdgeSlabDepth(b, wall.span.gy0, wall.span.floor)).toBeLessThan(wall.depth);
    }
    const merged = mergedWallDepths(b).filter((w) => w.span.dir === "east" && w.span.floor > 0);
    const splitSouth = east.filter((w) => w.span.floor > 0 && w.span.gy0 === b.d - 1);
    expect(Math.max(...splitSouth.map((w) => w.depth))).toBeGreaterThan(Math.max(...merged.map((w) => w.depth)));
  });
});

describe("shared wall paint cells", () => {
  it("uses CELL-sized host math from the yard catalog", () => {
    const asset = discoverYardAssets().find((a) => a.id === "fixture:interior-bed")!;
    expect(asset.w).toBe(Math.max(5, Math.ceil((asset.fixtureSize!.w + 3) / CELL)) * CELL);
    expect(asset.clearance).toBe(5);
  });

  it("keeps walkup east-edge slabs behind the east wall on the shared path", () => {
    const b = captureBay("building:walkup").building!;
    const east = wallPaintDepths(b, CATALOG_DOZER).filter((w) => w.span.dir === "east");
    expect(east.length).toBeGreaterThan(0);
    for (const wall of east) {
      expect(eastEdgeSlabDepth(b, wall.span.gy0, wall.span.floor)).toBeLessThan(wall.depth);
    }
  });
});

describe("regional wall palettes", () => {
  const MATERIALS = ["wood", "brick", "concrete", "metal", "glass"] as const;
  const REGIONS = ["southwest", "gulf", "brick-belt", "mountain", "pacific"] as const;
  const dressed = (id: string, walls: (typeof REGIONS)[number], seed: number) => {
    const b = createBuildingFromArchetype(id as ArchetypeId, id, 0, 0);
    b.region = { roofs: "temperate", walls, soil: "dark-loam", seed } as Building["region"];
    return b;
  };
  const finishes = (id: string, walls: (typeof REGIONS)[number], material: (typeof MATERIALS)[number]) => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) seen.add(regionalWallPaint(dressed(id, walls, seed * 2654435761), material)!.finish);
    return seen;
  };

  it("paints exactly the stock material ramp when a building has no region", () => {
    const b = createBuildingFromArchetype("bakery", "PLAIN", 0, 0);
    for (const material of MATERIALS) {
      expect(regionalWallPaint(b, material)).toBeNull();
      for (const face of ["south", "east"] as const) for (const damaged of [false, true]) {
        expect(wallTone(b, material, face, damaged)).toBe(wallFaceColor(material, face, damaged));
      }
    }
    expect(wallFinish(b, "brick")).toBe("brick");
    expect(wallFinish(b, "metal")).toBe("ribbed");
    expect(wallFinish(b, "wood")).toBe("plain");
  });

  it("is deterministic for a regional seed and varies between buildings", () => {
    const tones = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const a = dressed("bakery", "southwest", seed * 7919), b = dressed("bakery", "southwest", seed * 7919);
      expect(regionalWallPaint(a, "brick")).toEqual(regionalWallPaint(b, "brick"));
      expect(wallTone(a, "brick", "east")).toBe(wallTone(b, "brick", "east"));
      tones.add(regionalWallPaint(a, "brick")!.tone);
    }
    expect(tones.size).toBeGreaterThan(2);
  });

  it("weights finishes by region: stucco and adobe in the southwest, brick and clapboard in the brick belt, pastel stucco and painted block on the gulf", () => {
    expect([...finishes("bakery", "brick-belt", "brick")]).toEqual(["brick"]);
    expect([...finishes("ranch", "brick-belt", "wood")]).toEqual(["clapboard"]);
    const southwest = finishes("bakery", "southwest", "brick");
    expect(southwest.has("stucco") && southwest.has("adobe")).toBe(true);
    expect(finishes("clock-hall", "southwest", "concrete").has("sandstone")).toBe(true);
    expect(finishes("clock-hall", "brick-belt", "brick").has("limestone")).toBe(true);
    const gulf = finishes("bakery", "gulf", "concrete");
    expect(gulf.has("cmu") && gulf.has("stucco")).toBe(true);
    expect(finishes("ranch", "gulf", "wood")).toEqual(new Set(["clapboard"]));
    expect(finishes("ranch", "mountain", "wood").has("timber")).toBe(true);
    expect(finishes("ranch", "pacific", "wood").has("shingle")).toBe(true);
  });

  it("keeps the brick belt close to today's brick and never repaints glass", () => {
    const stock = wallFaceColor("brick", "east");
    let same = 0;
    for (let seed = 1; seed <= 60; seed++) if (wallTone(dressed("bakery", "brick-belt", seed * 7919), "brick", "east") === stock) same++;
    expect(same).toBeGreaterThan(15);
    for (const walls of REGIONS) expect(regionalWallPaint(dressed("bakery", walls, 5), "glass")).toBeNull();
  });

  it("gives industrial buildings ribbed steel and stained tilt-up concrete in every region", () => {
    for (const walls of REGIONS) {
      expect(finishes("steel-warehouse", walls, "metal")).toEqual(new Set(["ribbed"]));
      expect(finishes("steel-warehouse", walls, "concrete")).toEqual(new Set(["tiltup"]));
      const steel = new Set<number>();
      for (let seed = 1; seed <= 40; seed++) steel.add(regionalWallPaint(dressed("steel-warehouse", walls, seed * 7919), "metal")!.tone);
      expect(steel.size, walls).toBeGreaterThan(2);
    }
  });

  it("keeps light and damage from the stock ramp on a repainted wall", () => {
    const b = dressed("bakery", "gulf", 99);
    for (const material of ["brick", "concrete", "wood"] as const) {
      const lum = (c: number) => (c >> 16 & 255) + (c >> 8 & 255) + (c & 255);
      expect(lum(wallTone(b, material, "south"))).toBeLessThan(lum(wallTone(b, material, "east")));
      expect(lum(wallTone(b, material, "east", true))).toBeLessThan(lum(wallTone(b, material, "east")));
      expect(lum(wallTrimTone(b, material, "south"))).toBeLessThan(lum(wallTrimTone(b, material, "east")));
    }
  });
});
