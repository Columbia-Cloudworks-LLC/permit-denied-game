import { describe, expect, it } from "vitest";
import { createTown } from "./town";
import { DRESS_TEMPLATES, lotLocalToWorld, pickTemplate } from "./dressing";
import { Rng } from "../game/rng";
import { validateTown } from "./districts";
import type { Lot } from "../structure/types";

function dressingSig(town: ReturnType<typeof createTown>): string {
  return town.props
    .map((p) => `${p.assetId}:${p.variant}:${p.x.toFixed(2)}:${p.y.toFixed(2)}:${p.heading.toFixed(2)}`)
    .join("|");
}

describe("lot dressing", () => {
  it("reproduces the same assets for the same seed", () => {
    const a = createTown({ district: "d10", seed: 0x51a11 });
    const b = createTown({ district: "d10", seed: 0x51a11 });
    expect(dressingSig(a)).toBe(dressingSig(b));
    expect(a.ground.map((g) => `${g.cover}:${g.x.toFixed(2)}:${g.y.toFixed(2)}`).join("|")).toBe(
      b.ground.map((g) => `${g.cover}:${g.x.toFixed(2)}:${g.y.toFixed(2)}`).join("|"),
    );
  });

  it("changes dressing when the seed changes", () => {
    const a = createTown({ district: "d10", seed: 11 });
    const b = createTown({ district: "d10", seed: 12 });
    expect(dressingSig(a)).not.toBe(dressingSig(b));
  });

  it("picks templates compatible with lot identity", () => {
    const rng = new Rng(7);
    const t = pickTemplate("farm", rng);
    expect(t.identities).toContain("farm");
    expect(DRESS_TEMPLATES.some((d) => d.id === "farmstead")).toBe(true);
  });

  it("keeps dressed districts inside placement rules", () => {
    for (const district of ["d10", "d30"] as const) {
      const town = createTown({ district, seed: 19 });
      const report = validateTown(town);
      expect(report.issues, report.issues.map((i) => i.detail).join("; ")).toEqual([]);
    }
  });

  it("places front-yard slots inside a north-facing lot, not past the road edge", () => {
    const lot: Lot = {
      id: "t",
      x: 10,
      y: 10,
      w: 11.4,
      d: 10.2,
      heading: Math.PI / 2,
      zone: "residential",
      identity: "residence",
      accessId: "",
      templateId: "family-yard",
    };
    const p = lotLocalToWorld(lot, 0.16, 0);
    expect(p.y).toBeGreaterThan(lot.y + 0.55);
    expect(p.y).toBeLessThan(lot.y + lot.d * 0.5);
  });

  it("keeps yard assets on lots and fills the world with ground", () => {
    const town = createTown({ district: "d10", seed: 19 });
    const yardIds = new Set([
      "mailbox",
      "trash-can",
      "shrub",
      "sapling",
      "picnic-table",
      "doghouse",
      "swing-set",
      "clothesline",
      "woodpile",
      "hay-bale-round",
      "hay-bale-square",
      "water-trough",
    ]);
    const yard = town.props.filter((p) => yardIds.has(p.assetId));
    expect(yard.length).toBeGreaterThanOrEqual(10);
    expect(town.props.some((p) => p.assetId === "mailbox")).toBe(true);
    const field = town.ground.filter((g) => g.cover === "grass" || g.cover === "scrub");
    expect(field.length).toBeGreaterThan(8);
    const area = field.reduce((sum, g) => sum + g.w * g.d, 0);
    expect(area).toBeGreaterThan((town.maxX - town.minX) * (town.maxY - town.minY) * 0.45);
  });

  it("dresses classic yards and covers the fixture with grass", () => {
    const town = createTown();
    expect(town.props.some((p) => p.assetId === "picnic-table" || p.assetId === "pallet-stack" || p.assetId === "swing-set")).toBe(
      true,
    );
    expect(town.ground.some((g) => g.cover === "grass" || g.cover === "scrub")).toBe(true);
    expect(validateTown(town).ok).toBe(true);
  });
});
