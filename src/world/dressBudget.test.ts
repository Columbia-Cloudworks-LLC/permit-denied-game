import { describe, expect, it } from "vitest";
import { Rng } from "../game/rng";
import { campaignEligible } from "./campaignPlacement";
import { getAsset } from "./catalog";
import { dressLot } from "./dressing";
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
