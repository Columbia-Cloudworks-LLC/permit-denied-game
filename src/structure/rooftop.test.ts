import { describe, expect, it } from "vitest";
import { ParticlePool } from "../fx/particles";
import { SIM_DT } from "../game/constants";
import { availableTownValue } from "../game/campaignValue";
import { mergeFlatRoofDecks } from "../render/buildingSurfaces";
import { flatRoofTone, roofFinishFor } from "../render/roofFinish";
import { rooftopVisibleAt } from "../render/rooftopDraw";
import { CLIMATES } from "../world/climate";
import { createTown } from "../world/town";
import { applyCellDamage, createBuildingFromArchetype, stepStructures } from "./building";
import { rooftopSalvage, salvageCash } from "./cellCash";
import { regionalRoofForm, stampRegionalExterior } from "./regionalExterior";
import { roofCoverage } from "./roof";
import { generateRooftop, ROOFTOP_KINDS, rooftopCells, rooftopKit, rooftopPose, rooftopSupports } from "./rooftop";
import type { Building, RooftopKind, WorldEvent } from "./types";

const make = (id: string, x = 0, y = 0) => createBuildingFromArchetype(id, id.toUpperCase(), x, y);
const kinds = (b: Building): RooftopKind[] => b.rooftop.map(f => f.kind);
const count = (b: Building, kind: RooftopKind) => kinds(b).filter(k => k === kind).length;

/** Knock out every wall of a building and step it until nothing is left moving. */
function demolish(b: Building, seconds = 14): { cash: number; events: WorldEvent[]; spawns: number } {
  const particles = new ParticlePool(), events: WorldEvent[] = [];
  let cash = 0, spawns = 0;
  for (const cell of b.cells) cash += applyCellDamage(b, cell, 100000, 0, 1, particles, events);
  for (let i = 0; i < seconds / SIM_DT; i++) {
    const out = stepStructures([b], SIM_DT, particles, events);
    cash += out.cash;
    spawns += out.rubbleSpawns.length;
    // Nothing mounted may stand on a roof that has already gone.
    for (const f of b.rooftop) if (f.state === "mounted") expect(rooftopSupports(b, f).every(r => r.state !== "gone" && r.state !== "falling")).toBe(true);
  }
  return { cash, events, spawns };
}

describe("occupancy rooftop kits", () => {
  it("gives each occupancy family its equipment", () => {
    const diner = make("roadside-diner");
    expect(rooftopKit(diner)).toBe("food");
    expect(count(diner, "exhaust-hood")).toBeGreaterThan(0);
    expect(kinds(diner)).toEqual(expect.arrayContaining(["duct-run", "mua-box"]));

    const grocery = make("small-grocery"), cold = make("cold-storage-depot"), hall = make("data-hall");
    for (const b of [grocery, cold, hall]) {
      expect(rooftopKit(b)).toBe("cold");
      expect(count(b, "condenser-bank")).toBeGreaterThanOrEqual(2);
      expect(count(b, "rtu")).toBeGreaterThan(0);
    }
    // Cold chain and data halls run chillers; the corner grocery does not.
    expect(count(cold, "chiller") + count(hall, "chiller")).toBeGreaterThan(1);
    expect(count(grocery, "chiller")).toBe(0);

    const office = make("mid-rise-office-slab");
    expect(rooftopKit(office)).toBe("office");
    expect(kinds(office)).toEqual(expect.arrayContaining(["cooling-tower", "vent-stack", "comms-mast"]));
    expect(count(office, "bulkhead")).toBe(1);

    const walkup = make("walkup-block");
    expect(rooftopKit(walkup)).toBe("walkup");
    for (const b of [make("hardware-store"), make("department-store")]) expect(count(b, "rtu") + count(b, "rtu-large")).toBeGreaterThan(0);
    // Open canopies, tanks and pitched houses carry no plant.
    expect(make("service-station-canopy").rooftop).toEqual([]);
    expect(make("ranch").rooftop).toEqual([]);
  });

  it("anchors every fixture to distinct roof cells and is deterministic", () => {
    for (const id of ["roadside-diner", "small-grocery", "data-hall", "cold-storage-depot", "mid-rise-office-slab", "walkup-block", "department-store", "union-tower", "hotel-podium", "city-hall"]) {
      const b = make(id), taken = new Set<string>();
      expect(b.rooftop.length, id).toBeGreaterThan(0);
      for (const f of b.rooftop) {
        const def = ROOFTOP_KINDS[f.kind];
        expect(f.heavy).toBe(def.heavy);
        expect(f.span === 1 || f.span === 2).toBe(true);
        const supports = rooftopSupports(b, f);
        expect(supports.length, `${id} ${f.kind}`).toBeGreaterThan(0);
        for (const cell of rooftopCells(f)) {
          const key = `${f.floor}:${cell.gx}:${cell.gy}`;
          expect(taken.has(key), `${id} overlap at ${key}`).toBe(false);
          taken.add(key);
          // Covered by a solid roof, over a real slab, with nothing built on top of it.
          const roof = b.roofs.find(r => r.floor === f.floor && roofCoverage(r).some(c => c.gx === cell.gx && c.gy === cell.gy));
          expect(roof && roof.material !== "glass", `${id} ${f.kind} roof`).toBe(true);
          expect(b.floorTiles.some(t => t.floor === f.floor && t.gx === cell.gx && t.gy === cell.gy && !t.void)).toBe(true);
          expect(b.floorTiles.some(t => t.floor === f.floor + 1 && t.gx === cell.gx && t.gy === cell.gy)).toBe(false);
        }
        expect(rooftopPose(b, f)).not.toBeNull();
      }
      expect(generateRooftop(make(id)).map(f => [f.kind, f.gx, f.gy, f.floor])).toEqual(b.rooftop.map(f => [f.kind, f.gx, f.gy, f.floor]));
    }
    // Authored roof ducts keep their cell: the diner's kit goes around its kitchen exhaust.
    const diner = make("roadside-diner");
    for (const detail of diner.facadeDetails.filter(d => d.kind === "roof-duct")) {
      expect(diner.rooftop.some(f => rooftopCells(f).some(c => c.gx === detail.gx && c.gy === detail.gy))).toBe(false);
    }
  });

  it("strips small fittings at overview zoom and keeps the plant", () => {
    for (const kind of ["vent-stack", "gooseneck-vent", "turbine-vent", "roof-hatch"] as const) expect(rooftopVisibleAt(kind, false)).toBe(false);
    for (const kind of ["rtu", "chiller", "cooling-tower", "bulkhead", "condenser-bank", "exhaust-hood"] as const) {
      expect(rooftopVisibleAt(kind, false)).toBe(true);
      expect(rooftopVisibleAt(kind, true)).toBe(true);
    }
  });
});

describe("rooftop dead loads and salvage", () => {
  it("never leaves gear floating: light fittings tear off, heavy plant falls through and pays scrap", () => {
    const b = make("small-grocery");
    const standing = rooftopSalvage(b.rooftop), heavy = b.rooftop.filter(f => f.heavy).length;
    expect(standing).toBeGreaterThan(0);
    expect(heavy).toBeGreaterThan(2);
    const { events, spawns } = demolish(b);
    expect(b.rooftop.every(f => f.state === "gone")).toBe(true);
    expect(b.fullyDown).toBe(true);
    expect(rooftopSalvage(b.rooftop)).toBe(0);
    const scrap = events.filter(e => e.salvage && (e.cash ?? 0) > 0);
    // Every unit of scrap is paid exactly once, as copper or mechanical.
    expect(scrap.reduce((sum, e) => sum + e.cash!, 0)).toBe(standing);
    expect(new Set(scrap.map(e => e.salvage))).toEqual(new Set(["copper", "mechanical"]));
    // Condensers vent refrigerant as they break.
    expect(events.some(e => e.kind === "machine-break" && e.fx === "refrigerant")).toBe(true);
    expect(spawns).toBeGreaterThan(heavy);
  });

  it("drops a heavy unit storey by storey, crushing slabs and contents on the way", () => {
    // A two-storey timber-floored store: the big rooftop unit out-weighs the slab under it.
    const b = make("hardware-store");
    const tower = b.rooftop.find(f => f.kind === "rtu-large")!;
    expect(tower.heavy).toBe(true);
    const particles = new ParticlePool(), events: WorldEvent[] = [];
    // Take out only the top-floor bearing under the unit: the building stands, the plant does not.
    for (const roof of rooftopSupports(b, tower)) for (const s of roof.support) applyCellDamage(b, b.grid[roof.floor]![s.gx]![s.gy]!, 100000, 0, 1, particles, events);
    const slabsBefore = b.floorTiles.filter(t => t.state === "intact").length;
    const floors = new Set<number>();
    for (let i = 0; i < 6 / SIM_DT && tower.state !== "gone"; i++) {
      stepStructures([b], SIM_DT, particles, events);
      if (tower.state === "falling") {
        floors.add(tower.fallFloor);
        // A falling unit is always somewhere below the roof it left, never hanging at roof height.
        expect(rooftopPose(b, tower)!.z).toBeLessThanOrEqual((tower.floor + 1) * 2.35 + 1e-6);
      }
    }
    expect(tower.state).toBe("gone");
    // It landed on the upper storey, punched through the timber floor, and went on to the ground.
    expect([...floors].sort()).toEqual([0, 1]);
    expect(b.floorTiles.some(t => t.floor === 1 && t.state !== "intact" && rooftopCells(tower).some(c => c.gx === t.gx && c.gy === t.gy))).toBe(true);
    expect(events.some(e => e.kind === "impact")).toBe(true);
    const paid = events.find(e => e.salvage === "mechanical" && e.cash === tower.value);
    expect(paid).toBeDefined();
    // It came to rest below the roof.
    expect(paid!.z).toBeLessThan(tower.floor * 2.35);
    expect(b.floorTiles.filter(t => t.state === "intact").length).toBeLessThan(slabsBefore);
  });

  it("prices copper above mixed scrap and counts standing plant in the town's value", () => {
    expect(salvageCash("copper", 5)).toBeGreaterThan(salvageCash("mechanical", 5));
    expect(salvageCash("copper", 5) % 5).toBe(0);
    const town = createTown({ testMap: { kind: "asset", assetId: "building:data-hall", variant: 0 } });
    const hall = town.buildings.find(b => b.archetypeId === "data-hall")!;
    const value = availableTownValue(town), scrap = rooftopSalvage(hall.rooftop);
    expect(scrap).toBeGreaterThan(100);
    for (const f of hall.rooftop) f.state = "gone";
    expect(availableTownValue(town)).toBe(value - scrap);
  });
});

describe("unified flat-roof decks", () => {
  it("merges an intact flat roof into decks that cover every cell once, with no interior seams", () => {
    for (const id of ["small-grocery", "roadside-diner", "data-hall", "mid-rise-office-slab", "union-tower"]) {
      const b = make(id), plan = mergeFlatRoofDecks(b);
      const flat = b.roofs.filter(r => r.style === "flat" && r.material !== "glass");
      const cells = flat.flatMap(r => roofCoverage(r).map(c => `${r.floor}:${c.gx}:${c.gy}`));
      const covered = plan.decks.flatMap(d => {
        const out: string[] = [];
        for (let gx = d.gx0; gx <= d.gx1; gx++) for (let gy = d.gy0; gy <= d.gy1; gy++) out.push(`${d.floor}:${gx}:${gy}`);
        return out;
      });
      expect(covered.length, id).toBe(new Set(covered).size);
      expect(new Set(covered), id).toEqual(new Set(cells));
      // Far fewer drawn surfaces than cells, and no panel left to draw on its own.
      expect(plan.decks.length, id).toBeLessThan(cells.length / 2);
      expect(plan.loose.filter(r => r.style === "flat" && r.material !== "glass")).toEqual([]);
      // Deck-to-deck joints carry no edge run: only parapets and taller walls do.
      for (const deck of plan.decks) for (const runs of Object.values(deck.edges)) for (const run of runs) expect(["parapet", "wall"]).toContain(run.kind);
    }
  });

  it("opens seams only around a breach or a sagging panel", () => {
    const b = make("small-grocery"), before = mergeFlatRoofDecks(b);
    const victim = b.roofs.find(r => r.style === "flat")!;
    victim.state = "gone";
    b.visualRevision++;
    const after = mergeFlatRoofDecks(b);
    const lost = new Set(roofCoverage(victim).map(c => `${c.gx}:${c.gy}`));
    for (const deck of after.decks) for (let gx = deck.gx0; gx <= deck.gx1; gx++) for (let gy = deck.gy0; gy <= deck.gy1; gy++) expect(lost.has(`${gx}:${gy}`)).toBe(false);
    // The panels beside the hole draw loose; the rest of the roof is still merged.
    expect(after.loose.length).toBeGreaterThan(0);
    expect(after.loose.length).toBeLessThan(b.roofs.length / 2);
    expect(after.decks.length).toBeGreaterThanOrEqual(before.decks.length);
    const sagging = make("data-hall"), panel = sagging.roofs.find(r => r.style === "flat")!;
    panel.sag = 0.4;
    panel.state = "sagging";
    expect(mergeFlatRoofDecks(sagging).loose).toContain(panel);
  });

  it("lays a membrane family by occupancy and construction", () => {
    expect(roofFinishFor(make("small-grocery"))).toBe("tpo");
    expect(roofFinishFor(make("data-hall"))).toBe("tpo");
    expect(roofFinishFor(make("department-store"))).toBe("tpo");
    expect(roofFinishFor(make("roadside-diner"))).toBe("bur");
    expect(roofFinishFor(make("mid-rise-office-slab"))).toBe("epdm");
    expect(roofFinishFor(make("union-tower"))).toBe("epdm");
    const grocery = make("small-grocery");
    expect(flatRoofTone(grocery, false)).not.toEqual(flatRoofTone(make("union-tower"), false));
    // Snow caps every membrane alike.
    expect(flatRoofTone(grocery, true)).toEqual(flatRoofTone(make("union-tower"), true));
  });
});

describe("regional roof silhouettes", () => {
  const seeds = Array.from({ length: 200 }, (_, n) => Math.imul(n + 1, 0x9e3779b1) >>> 0);
  const forms = (id: string, roofs: "southwest" | "subtropical" | "temperate") => seeds.map(seed => regionalRoofForm(id, roofs, seed)?.id ?? "classic");

  it("weights low clay tile and adobe in the Southwest, hips on the Gulf, and leaves temperate roofs alone", () => {
    for (const id of ["ranch", "cottage", "porch-house", "community-hall", "motel-room-block", "neighborhood-clinic"]) {
      expect(new Set(forms(id, "temperate")), id).toEqual(new Set(["classic"]));
      const southwest = forms(id, "southwest"), gulf = forms(id, "subtropical");
      expect(southwest.filter(f => f === "barrel-tile-gable" || f === "adobe-flat").length, id).toBeGreaterThan(160);
      expect(southwest).toContain("barrel-tile-gable");
      expect(southwest).toContain("adobe-flat");
      expect(gulf.filter(f => f.startsWith("hip") || f === "cool-flat").length, id).toBeGreaterThan(140);
      expect(gulf).not.toContain("adobe-flat");
    }
    // Only the residential, hospitality and low civic set follows the climate.
    expect(regionalRoofForm("union-tower", "southwest", 7)).toBeUndefined();
    expect(regionalRoofForm("ranch", "southwest", 99)).toEqual(regionalRoofForm("ranch", "southwest", 99));
  });

  it("re-roofs a desert town's houses, mounts coolers and solar, and keeps temperate towns as authored", () => {
    const desert = Array.from({ length: 24 }, (_, i) => make("ranch", i * 12, 0));
    const authored = make("ranch");
    stampRegionalExterior(desert, CLIMATES["sonoran-desert"], 19);
    const adobe = desert.filter(b => b.roofForm?.id === "adobe-flat"), tile = desert.filter(b => b.roofForm?.id === "barrel-tile-gable");
    expect(adobe.length).toBeGreaterThan(3);
    expect(tile.length).toBeGreaterThan(3);
    for (const b of adobe) {
      expect(b.roof).toBe("flat");
      expect(b.roofs.every(r => r.style === "flat")).toBe(true);
      expect(b.features.chimney).toBe(false);
      expect(roofFinishFor(b)).toBe("adobe");
    }
    // Low-pitch clay tile sits lower than the authored shingle gable.
    const peak = (b: Building) => Math.max(...b.roofs.flatMap(r => r.verts.map(v => v.z)));
    for (const b of tile) expect(peak(b)).toBeLessThan(peak(authored) - 0.3);
    const gear = desert.flatMap(b => b.rooftop.map(f => f.kind));
    expect(gear).toContain("swamp-cooler");
    expect(gear).toContain("solar-array");
    for (const b of desert) for (const f of b.rooftop) expect(rooftopSupports(b, f).length).toBeGreaterThan(0);

    const temperate = Array.from({ length: 8 }, (_, i) => make("ranch", i * 12, 0));
    stampRegionalExterior(temperate, CLIMATES.temperate, 19);
    for (const b of temperate) {
      expect(b.roofForm).toBeUndefined();
      expect(b.roofs.map(r => r.verts)).toEqual(authored.roofs.map(r => r.verts.map(v => ({ ...v, x: v.x + b.x }))));
      expect(b.rooftop).toEqual([]);
    }
    // Same town seed, same roofs.
    const again = Array.from({ length: 24 }, (_, i) => make("ranch", i * 12, 0));
    stampRegionalExterior(again, CLIMATES["sonoran-desert"], 19);
    expect(again.map(b => b.roofForm?.id)).toEqual(desert.map(b => b.roofForm?.id));
  });
});
