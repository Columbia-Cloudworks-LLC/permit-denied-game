import { describe, expect, it } from "vitest";
import { Rng } from "../game/rng";
import { campaignEligible } from "./campaignPlacement";
import { getAsset } from "./catalog";
import { buildingOccupy, dressLot } from "./dressing";
import { createBuildingFromArchetype } from "../structure/building";
import type { ArchetypeId } from "./archetypes";
import { DRESSING } from "../game/constants";
import { SERVICE_YARD_MAX, SERVICE_YARDS, serviceYardsFor } from "./serviceYards";
import { createTown } from "./town";
import { validateTown } from "./districts";
import { completeLot } from "./parcels";
import type { Lot } from "../structure/types";

function serviceLot(): Lot {
  return completeLot({
    id: "service-probe",
    x: 0,
    y: 0,
    w: 20,
    d: 20,
    heading: 0,
    zone: "commercial",
    identity: "service",
    accessId: "",
    templateId: "roadside-service",
  });
}

function farmLot(): Lot {
  return completeLot({
    id: "farm-probe",
    x: 0,
    y: 0,
    w: 20,
    d: 20,
    heading: 0,
    zone: "residential",
    identity: "farm",
    accessId: "",
    templateId: "farmstead",
  });
}

function downtownEligible(assetId: string): boolean {
  return campaignEligible(getAsset(assetId).campaign, "city-downtown");
}

describe("dressing budget eligibility", () => {
  it("reaches later eligible service slots instead of spending budget on pumps", () => {
    const unfiltered = dressLot(serviceLot(), undefined, new Rng(19), { boxes: [] }, 3);
    expect(unfiltered.props.map((prop) => prop.assetId)).toContain("fuel-pump");

    const occ = { boxes: [] as { x: number; y: number; w: number; d: number }[] };
    const filtered = dressLot(serviceLot(), undefined, new Rng(19), occ, 3, [], downtownEligible);
    expect(filtered.props.map((prop) => prop.assetId)).not.toContain("fuel-pump");
    expect(filtered.props.every((prop) => downtownEligible(prop.assetId))).toBe(true);
    expect(filtered.props.some((prop) => prop.assetId === "vending" || prop.assetId === "traffic-barrel" || prop.assetId === "pallet-stack")).toBe(true);
    expect(filtered.props.length).toBeGreaterThan(0);
    expect(occ.boxes).toEqual([]);
  });

  it("does not spend farm budget on downtown-ineligible hay", () => {
    const unfiltered = dressLot(farmLot(), undefined, new Rng(19), { boxes: [] }, 3);
    expect(unfiltered.props.some((prop) => prop.assetId.startsWith("hay-bale"))).toBe(true);

    const filtered = dressLot(farmLot(), undefined, new Rng(19), { boxes: [] }, 3, [], downtownEligible);
    expect(filtered.props.every((prop) => downtownEligible(prop.assetId))).toBe(true);
    expect(filtered.props.some((prop) => prop.assetId.startsWith("hay-bale"))).toBe(false);
  });

  it("places nothing when no slots are eligible", () => {
    const dressed = dressLot(serviceLot(), undefined, new Rng(19), { boxes: [] }, 3, [], () => false);
    expect(dressed.props).toEqual([]);
  });

  it("keeps later slots available when earlier ones are blocked", () => {
    const lot = serviceLot();
    const occ = { boxes: [{ x: -1, y: -1, w: 8, d: 22 }] };
    const dressed = dressLot(lot, undefined, new Rng(19), occ, 3, [], downtownEligible);
    expect(dressed.props.every((prop) => downtownEligible(prop.assetId))).toBe(true);
    expect(dressed.props.length).toBeGreaterThan(0);
    expect(dressed.props.every((prop) => prop.x >= 7)).toBe(true);
  });

  it("reproduces eligible dressing for the same seed", () => {
    const a = dressLot(serviceLot(), undefined, new Rng(19), { boxes: [] }, 3, [], downtownEligible);
    const b = dressLot(serviceLot(), undefined, new Rng(19), { boxes: [] }, 3, [], downtownEligible);
    expect(a.props.map((prop) => `${prop.assetId}:${prop.x.toFixed(3)}:${prop.y.toFixed(3)}`)).toEqual(
      b.props.map((prop) => `${prop.assetId}:${prop.x.toFixed(3)}:${prop.y.toFixed(3)}`),
    );
  });
});

/** A roomy south-fronting lot (street below it) with one building in the middle. */
function yardLot(archetype: string, identity: Lot["identity"] = "shop") {
  const lot = completeLot({
    id: `yard-${archetype}`, x: 0, y: 0, w: 60, d: 50, heading: Math.PI * 1.5,
    zone: "commercial", identity, accessId: "", templateId: identity === "shop" ? "small-commercial" : "contractor-yard",
  });
  const building = createBuildingFromArchetype(archetype as ArchetypeId, archetype, 0, 0);
  building.x = 30 - building.w * building.cellSize / 2;
  building.y = 25 - building.d * building.cellSize / 2;
  return { lot, building };
}

function dressYard(archetype: string, budget: number, identity?: Lot["identity"], eligible?: (id: string) => boolean, corridors: { x: number; y: number }[][] = []) {
  const { lot, building } = yardLot(archetype, identity);
  const rng = new Rng(19);
  const dressed = dressLot(lot, building, rng, { boxes: buildingOccupy(building) }, budget, corridors, eligible);
  return { lot, building, rng, props: dressed.props, ids: dressed.props.map(p => p.assetId) };
}

const SERVICE_IDS = new Set(SERVICE_YARDS.flatMap(rule => rule.slots.map(slot => slot.assetId)));

describe("occupancy service yards", () => {
  it("matches each yard to the occupancies in its table and nothing else", () => {
    const yards = (id: string) => serviceYardsFor(createBuildingFromArchetype(id as ArchetypeId, id, 0, 0)).map(rule => rule.id);
    expect(yards("roadside-diner")).toEqual(["food-service"]);
    expect(yards("bakery")).toEqual(["food-service"]);
    expect(yards("small-grocery")).toEqual(["food-service", "convenience"]);
    expect(yards("hardware-store")).toContain("convenience");
    expect(yards("service-station-canopy")).toContain("convenience");
    for (const id of ["data-hall", "cold-storage-depot", "telephone-exchange", "neighborhood-clinic"]) expect(yards(id), id).toContain("critical-power");
    for (const id of ["warehouse", "steel-warehouse", "logistics-hub", "freight-transfer-depot"]) expect(yards(id), id).toContain("loading-dock");
    for (const id of ["ranch", "cottage", "clock-hall"]) expect(yards(id), id).toEqual([]);
  });

  it("puts corrals and grease traps behind food buildings, away from the frontage", () => {
    for (const id of ["roadside-diner", "bakery"]) {
      const { building, props, ids } = dressYard(id, 10);
      expect(ids, id).toContain("dumpster-corral");
      expect(ids, id).not.toContain("dumpster");
      // The street is south of this lot, so behind the building is north of it.
      for (const p of props.filter(p => p.assetId === "dumpster-corral" || p.assetId === "grease-trap")) expect(p.y + p.d, id).toBeLessThanOrEqual(building.y);
    }
  });

  it("stands ice chests and propane cages beside groceries and hardware stores", () => {
    for (const id of ["small-grocery", "hardware-store"]) {
      const { building, props, ids } = dressYard(id, 10);
      expect(ids.includes("ice-merchandiser") || ids.includes("propane-exchange-cage"), id).toBe(true);
      const bw = building.w * building.cellSize;
      for (const p of props.filter(p => p.assetId === "ice-merchandiser" || p.assetId === "propane-exchange-cage")) {
        expect(p.x + p.w <= building.x || p.x >= building.x + bw, `${id} ${p.assetId}`).toBe(true);
      }
    }
  });

  it("fences a backup generator and a transformer pad beside critical buildings, both salvageable and live", () => {
    for (const id of ["data-hall", "telephone-exchange", "neighborhood-clinic", "cold-storage-depot"]) {
      const { ids } = dressYard(id, 10, id === "data-hall" || id === "cold-storage-depot" ? "contractor" : "shop");
      expect(ids, id).toContain("backup-generator");
    }
    expect(getAsset("backup-generator")).toMatchObject({ salvage: "mechanical", sparks: true });
    expect(getAsset("transformer-pad")).toMatchObject({ salvage: "copper", sparks: true });
    const cage = getAsset("propane-exchange-cage"), tank = getAsset("propane-tank");
    expect(cage.destruction).toBe("explosive");
    expect(cage.explodeRadius).toBeLessThanOrEqual(tank.explodeRadius);
    expect(cage.explodeDamage).toBeLessThanOrEqual(tank.explodeDamage);
  });

  it("dresses loading bays with bumpers, bollards and pallets on the dock face", () => {
    const { building, props, ids } = dressYard("steel-warehouse", 10, "contractor");
    expect(ids).toContain("loading-dock-bumpers");
    expect(ids).toContain("bollard");
    const south = building.y + building.d * building.cellSize;
    const bays = building.cells.filter(c => c.floor === 0 && c.loadingS).map(c => building.x + (c.gx + 0.5) * building.cellSize);
    for (const p of props.filter(p => p.assetId === "loading-dock-bumpers")) {
      expect(p.y).toBeGreaterThanOrEqual(south);
      expect(p.y).toBeLessThan(south + 0.3);
      expect(p.x + p.w / 2).toBeGreaterThan(Math.min(...bays) - 1);
      expect(p.x + p.w / 2).toBeLessThan(Math.max(...bays) + 1);
    }
  });

  it("lives inside the lot cap: yard props displace generic ones instead of adding to them", () => {
    for (const budget of [0, 1, 2, 3, 6, 10]) for (const id of ["bakery", "small-grocery", "steel-warehouse", "cold-storage-depot"]) {
      const { ids } = dressYard(id, budget, id === "bakery" || id === "small-grocery" ? "shop" : "contractor");
      expect(ids.length, `${id} budget ${budget}`).toBeLessThanOrEqual(Math.min(budget, DRESSING.perLotMax));
      const yard = ids.filter(a => SERVICE_IDS.has(a) && a !== "pallet-stack").length;
      expect(yard).toBeLessThanOrEqual(SERVICE_YARD_MAX);
      if (budget >= 1) expect(yard, `${id} budget ${budget}`).toBeGreaterThan(0);
    }
  });

  it("never overlaps the building, another prop, or the driveway corridor", () => {
    const corridor = [{ x: 29, y: 26 }, { x: 31, y: 26 }, { x: 31, y: 50 }, { x: 29, y: 50 }];
    for (const id of ["bakery", "small-grocery", "hardware-store", "telephone-exchange", "steel-warehouse"]) {
      const { building, props } = dressYard(id, 10, id === "steel-warehouse" ? "contractor" : "shop", undefined, [corridor]);
      const solids = buildingOccupy(building);
      for (const [i, p] of props.entries()) {
        for (const s of solids) expect(p.x < s.x + s.w && p.x + p.w > s.x && p.y < s.y + s.d && p.y + p.d > s.y, `${id} ${p.assetId} in building`).toBe(false);
        for (const q of props.slice(i + 1)) expect(p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.d && p.y + p.d > q.y, `${id} ${p.assetId}/${q.assetId}`).toBe(false);
        if (SERVICE_IDS.has(p.assetId)) {
          const cx = p.x + p.w / 2, cy = p.y + p.d / 2;
          expect(cx > 29 && cx < 31 && cy > 26 && cy < 50, `${id} ${p.assetId} in corridor`).toBe(false);
        }
        expect(p.lotId).toBe(`yard-${id}`);
      }
    }
  });

  it("leaves the layout's shared random stream exactly where the template left it", () => {
    for (const id of ["bakery", "small-grocery", "telephone-exchange"]) {
      const withYard = dressYard(id, 10);
      const { lot, building } = yardLot(id);
      building.archetypeId = "no-such-occupancy";
      const rng = new Rng(19);
      const plain = dressLot(lot, building, rng, { boxes: buildingOccupy(building) }, 10);
      expect(plain.props.some(p => SERVICE_IDS.has(p.assetId) && p.assetId !== "pallet-stack")).toBe(false);
      expect(withYard.rng.next()).toBe(rng.next());
    }
  });

  it("honours campaign eligibility and reproduces for the same lot", () => {
    const downtown = dressYard("hardware-store", 10, "shop", downtownEligible);
    expect(downtown.ids).not.toContain("propane-exchange-cage");
    expect(downtown.props.every(p => downtownEligible(p.assetId))).toBe(true);
    expect(dressYard("small-grocery", 10, "shop", () => false).props).toEqual([]);
    const sig = (id: string) => dressYard(id, 10).props.map(p => `${p.assetId}:${p.x.toFixed(3)}:${p.y.toFixed(3)}`);
    expect(sig("small-grocery")).toEqual(sig("small-grocery"));
  });

  it("keeps generated districts inside their prop budgets with service yards on the right lots", () => {
    let yards = 0;
    for (const [district, seed] of [["d30", 19], ["d100", 7]] as const) {
      const town = createTown({ district, seed });
      expect(validateTown(town).issues.filter(i => i.code === "density")).toEqual([]);
      expect(town.props.length).toBeLessThanOrEqual(DRESSING.districtMax[district]);
      const byLot = new Map<string, number>();
      for (const p of town.props) if (p.lotId) byLot.set(p.lotId, (byLot.get(p.lotId) ?? 0) + 1);
      for (const count of byLot.values()) expect(count).toBeLessThanOrEqual(DRESSING.perLotMax);
      for (const p of town.props) {
        if (!SERVICE_IDS.has(p.assetId) || p.assetId === "pallet-stack" || !p.lotId) continue;
        const building = town.buildings.find(b => b.lotId === p.lotId);
        if (!building) continue;
        const slots = serviceYardsFor(building).flatMap(rule => rule.slots.map(slot => slot.assetId));
        expect(slots, `${building.archetypeId} ${p.assetId}`).toContain(p.assetId);
        yards++;
      }
    }
    expect(yards).toBeGreaterThan(0);
  });
});
