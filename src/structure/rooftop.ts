import { FLOOR_Z } from "../game/constants";
import { hashSeed, mixSeed, Rng } from "../game/rng";
import type { ParticlePool } from "../fx/particles";
import type { RoofRegion } from "../world/climate";
import type { StructureStepResult } from "./building";
import { salvageCash } from "./cellCash";
import { onRoof } from "./facadeDetails";
import { MATERIALS } from "./materials";
import { displacedRoofVerts, heightOnPoly, roofCoverage } from "./roof";
import type {
  InteriorFixture,
  Building, Cell, MachineFx, Material, RoofAxis, RoofSection, RooftopFixture, RooftopKind, SalvageKind, WorldEvent,
} from "./types";

export interface RooftopKindDef {
  heavy: boolean;
  /** Dead load for the crush model, in the same loose units as debris mass. */
  mass: number;
  span: 1 | 2;
  /** Footprint as a share of one cell: `w` across the fixture's axis, `l` along it (added to the second cell when span is 2). */
  w: number;
  l: number;
  /** Height above the deck, for culling and occlusion. */
  h: number;
  salvage?: SalvageKind;
  /** Salvageable mass behind `salvageCash`. */
  scrap?: number;
  fx?: MachineFx;
  /** Can stand on a sloped roof. */
  pitched?: boolean;
  debris: Material;
}

export const ROOFTOP_KINDS: Record<RooftopKind, RooftopKindDef> = {
  "exhaust-hood": { heavy: false, mass: 0.6, span: 1, w: 0.52, l: 0.52, h: 0.62, fx: "soot", pitched: true, debris: "metal" },
  "duct-run": { heavy: false, mass: 0.7, span: 2, w: 0.3, l: 0.78, h: 0.38, fx: "soot", debris: "metal" },
  "mua-box": { heavy: false, mass: 1.2, span: 1, w: 0.62, l: 0.74, h: 0.52, debris: "metal" },
  rtu: { heavy: true, mass: 3, span: 1, w: 0.68, l: 0.8, h: 0.62, salvage: "mechanical", scrap: 3, fx: "refrigerant", debris: "metal" },
  "rtu-large": { heavy: true, mass: 6, span: 2, w: 0.74, l: 0.7, h: 0.78, salvage: "mechanical", scrap: 6, fx: "refrigerant", debris: "metal" },
  "condenser-bank": { heavy: true, mass: 5, span: 2, w: 0.7, l: 0.78, h: 0.58, salvage: "copper", scrap: 5, fx: "refrigerant", debris: "metal" },
  chiller: { heavy: true, mass: 8, span: 2, w: 0.76, l: 0.8, h: 0.86, salvage: "copper", scrap: 7, fx: "refrigerant", debris: "metal" },
  bulkhead: { heavy: true, mass: 10, span: 2, w: 0.86, l: 0.82, h: 1.3, salvage: "mechanical", scrap: 4, debris: "concrete" },
  "cooling-tower": { heavy: true, mass: 9, span: 2, w: 0.84, l: 0.8, h: 1.25, salvage: "mechanical", scrap: 9, fx: "refrigerant", debris: "metal" },
  "vent-stack": { heavy: false, mass: 0.2, span: 1, w: 0.16, l: 0.16, h: 0.6, pitched: true, debris: "metal" },
  "comms-mast": { heavy: false, mass: 0.5, span: 1, w: 0.3, l: 0.3, h: 2.3, fx: "arc", debris: "metal" },
  "roof-hatch": { heavy: false, mass: 0.4, span: 1, w: 0.56, l: 0.62, h: 0.3, debris: "metal" },
  "turbine-vent": { heavy: false, mass: 0.2, span: 1, w: 0.32, l: 0.32, h: 0.52, pitched: true, debris: "metal" },
  "gooseneck-vent": { heavy: false, mass: 0.2, span: 1, w: 0.22, l: 0.34, h: 0.46, debris: "metal" },
  "skylight-curb": { heavy: false, mass: 0.5, span: 1, w: 0.66, l: 0.66, h: 0.26, debris: "glass" },
  "flue-stack": { heavy: false, mass: 0.3, span: 1, w: 0.2, l: 0.2, h: 0.95, fx: "soot", pitched: true, debris: "metal" },
  "split-condenser": { heavy: false, mass: 0.8, span: 1, w: 0.5, l: 0.36, h: 0.42, salvage: "copper", scrap: 0.5, fx: "refrigerant", debris: "metal" },
  "swamp-cooler": { heavy: false, mass: 0.9, span: 1, w: 0.56, l: 0.56, h: 0.6, pitched: true, debris: "metal" },
  "solar-array": { heavy: false, mass: 0.6, span: 2, w: 0.78, l: 0.8, h: 0.42, pitched: true, debris: "glass" },
};

export type RooftopKit = "food" | "cold" | "retail" | "office" | "walkup" | "service";

const KIT_BY_ID: Readonly<Record<string, RooftopKit>> = {
  "roadside-diner": "food", bakery: "food", "bakery-walkup": "food", "mega-beaver-travel-plaza": "food",
  "small-grocery": "cold", "cold-storage-depot": "cold", "data-hall": "cold", "dairy-building": "cold",
  "department-store": "retail", "hardware-store": "retail", laundromat: "retail",
  "mid-rise-office-slab": "office", "plaza-office-tower": "office", "setback-office-tower": "office",
  "twin-office-building": "office", "union-tower": "office", "hotel-podium": "office", "apartment-tower": "office",
  "residence-tower": "office", "crown-apartments": "office", "city-hall": "office", "police-headquarters": "office",
  walkup: "walkup", "walkup-block": "walkup", "avenue-apartments": "walkup", "corner-apartments": "walkup",
  "courtyard-apartment": "walkup", "motel-room-block": "walkup", "rowhouse-unit": "walkup",
  "auto-repair-shop": "walkup", "printing-works": "walkup", "contractor-workshop": "walkup",
};

const FOOD_FIXTURES: ReadonlySet<string> = new Set(["commercial-oven", "diner-booth"]);

/** A kitchen line under the roof: ovens or booths, whatever the storefront calls itself. */
function foodTagged(building: Building): boolean {
  return building.fixtures.some(f => FOOD_FIXTURES.has(f.kind));
}

/** Which equipment family an occupancy puts on its roof; null leaves the roof bare. */
export function rooftopKit(building: Building): RooftopKit | null {
  if (building.canopy || building.openDecks || building.elevatedTank) return null;
  const id = building.archetypeId;
  const listed = KIT_BY_ID[id] ?? (id.startsWith("office-") ? "office" : undefined);
  if (listed) return listed;
  if (foodTagged(building)) return "food";
  if (building.floors >= 5) return "office";
  if (building.roof !== "flat") return null;
  return building.kind === "house" ? "walkup" : "service";
}

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)));

/** The kit's shopping list for a roof of `area` flat cells, heaviest first so big units get the open deck. */
function kitWants(kit: RooftopKit, building: Building, area: number, penthouse: boolean): RooftopKind[] {
  const many = (kind: RooftopKind, n: number): RooftopKind[] => Array.from({ length: Math.max(0, n) }, () => kind);
  const id = building.archetypeId;
  switch (kit) {
    case "food":
      return [
        ...many("rtu", area >= 50 ? 2 : area >= 18 ? 1 : 0), ...many("mua-box", 1),
        ...many("exhaust-hood", clampInt(area / 14, 1, 3)), ...many("duct-run", area >= 30 ? 2 : 1), ...many("gooseneck-vent", 1),
      ];
    case "cold": {
      const dense = id !== "small-grocery";
      return [
        ...many("chiller", dense ? clampInt(area / 30, 1, 3) : 0),
        ...many("condenser-bank", clampInt(area / (dense ? 14 : 18), 2, 6)),
        ...many("rtu", clampInt(area / 26, 1, 4)), ...many("turbine-vent", 2),
      ];
    }
    case "retail":
      return [
        ...many("rtu-large", clampInt(area / 42, 0, 3)), ...many("rtu", clampInt(area / 16, 1, 5)),
        ...many("roof-hatch", 1), ...many("gooseneck-vent", id === "laundromat" ? 3 : 1),
      ];
    case "office":
      return [
        ...many("bulkhead", penthouse ? 0 : 1), ...many("cooling-tower", area >= 56 ? 2 : area >= 20 ? 1 : 0),
        ...many("rtu", building.floors <= 6 && area >= 30 ? 1 : 0),
        ...many("comms-mast", building.floors >= 5 ? 1 : 0), ...many("vent-stack", clampInt(area / 14, 2, 4)),
      ];
    case "walkup":
      return [
        ...many("rtu", building.kind !== "house" && area >= 40 ? 1 : 0),
        ...many("roof-hatch", 1), ...many("skylight-curb", area >= 8 ? 1 : 0),
        ...many("split-condenser", clampInt(area / 10, 1, 4)), ...many("flue-stack", 1),
        ...many("turbine-vent", area >= 12 ? 2 : 1), ...many("gooseneck-vent", area >= 20 ? 2 : 1),
      ];
    case "service":
      return [...many("roof-hatch", area >= 9 ? 1 : 0), ...many("turbine-vent", area >= 12 ? 1 : 0), ...many("gooseneck-vent", 1)];
    default: {
      const _never: never = kit;
      return _never;
    }
  }
}

/** Regional extras: desert houses and low civic roofs carry evaporative coolers and tilted solar. */
const SOUTHWEST_RESIDENTIAL: ReadonlySet<string> = new Set(["ranch", "cottage", "porch-house", "motel-room-block", "neighborhood-clinic", "community-hall"]);

function regionalWants(building: Building, region: RoofRegion | undefined, area: number): RooftopKind[] {
  if (region !== "southwest" || !SOUTHWEST_RESIDENTIAL.has(building.archetypeId)) return [];
  return ["swamp-cooler", "solar-array", ...(area >= 14 ? ["solar-array", "swamp-cooler"] as const : [])];
}

interface RoofSite {
  floor: number;
  gx: number;
  gy: number;
  flat: boolean;
  /** No roof beyond it to the south or east: the parapet and any brand sign own this row. */
  frontEdge: boolean;
  backEdge: boolean;
}

const siteKey = (floor: number, gx: number, gy: number): string => `${floor}:${gx}:${gy}`;

/** Roof cells that can carry equipment, keyed by floor and cell. */
function roofSites(building: Building): Map<string, RoofSite> {
  const covered = new Map<string, RoofSection>();
  for (const roof of building.roofs) for (const c of roofCoverage(roof)) covered.set(siteKey(roof.floor, c.gx, c.gy), roof);
  const tiles = new Map<string, boolean>();
  for (const t of building.floorTiles) tiles.set(siteKey(t.floor, t.gx, t.gy), !!t.void);
  const blocked = new Set<string>();
  for (const d of building.facadeDetails) {
    if (!onRoof(d)) continue;
    for (let i = 0; i < d.width; i++) blocked.add(siteKey(d.floor, d.gx + (d.side === "south" ? i : 0), d.gy + (d.side === "east" ? i : 0)));
  }
  if (building.features.chimney) blocked.add(siteKey(building.floors - 1, building.w - 1, 0));
  const sites = new Map<string, RoofSite>();
  for (const [key, roof] of covered) {
    const [floor, gx, gy] = key.split(":").map(Number) as [number, number, number];
    const flat = roof.style === "flat";
    if (roof.material === "glass" || blocked.has(key) || !(flat || roof.style === "gable")) continue;
    if (!flat && !facesCamera(building, roof, gx, gy)) continue;
    if (shaftBelow(tiles, floor, gx, gy) || tallerBehind(tiles, floor, gx, gy)) continue;
    const has = (dx: number, dy: number) => covered.has(siteKey(floor, gx + dx, gy + dy));
    sites.set(key, { floor, gx, gy, flat, frontEdge: !has(1, 0) || !has(0, 1), backEdge: !has(-1, 0) || !has(0, -1) });
  }
  dropSmallDecks(sites);
  return sites;
}

/** A stair or atrium void anywhere under the cell: nothing heavy parks over an open shaft. */
function shaftBelow(tiles: ReadonlyMap<string, boolean>, floor: number, gx: number, gy: number): boolean {
  for (let f = floor; f >= 0; f--) if (tiles.get(siteKey(f, gx, gy))) return true;
  return false;
}

/** A taller wing right behind the cell would paint over anything standing here. */
function tallerBehind(tiles: ReadonlyMap<string, boolean>, floor: number, gx: number, gy: number): boolean {
  const up = (dx: number, dy: number) => tiles.has(siteKey(floor + 1, gx + dx, gy + dy));
  return up(-1, 0) || up(0, -1) || up(-1, -1);
}

/** Pitched roofs only carry gear on the slopes the camera sees: falling toward the south or east. */
function facesCamera(building: Building, roof: RoofSection, gx: number, gy: number): boolean {
  const cs = building.cellSize, x = building.x + (gx + 0.5) * cs, y = building.y + (gy + 0.5) * cs;
  const z = heightOnPoly(roof.verts, x, y);
  if (z == null) return false;
  const south = heightOnPoly(roof.verts, x, y + cs * 0.2), east = heightOnPoly(roof.verts, x + cs * 0.2, y);
  return (south != null && south < z - 1e-3) || (east != null && east < z - 1e-3);
}

/** Decks under four cells are bulkhead lids and ledges, not equipment yards. */
function dropSmallDecks(sites: Map<string, RoofSite>): void {
  const seen = new Set<string>();
  for (const [key, start] of [...sites]) {
    if (seen.has(key) || !start.flat) continue;
    const comp = [key], stack = [start];
    seen.add(key);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = siteKey(cur.floor, cur.gx + dx, cur.gy + dy), next = sites.get(k);
        if (!next || !next.flat || seen.has(k)) continue;
        seen.add(k); comp.push(k); stack.push(next);
      }
    }
    if (comp.length < 4) for (const k of comp) sites.delete(k);
  }
}

/** A small top storey already reads as the stair and lift penthouse. */
function hasPenthouse(building: Building): boolean {
  if (building.floors < 2) return false;
  const count = (floor: number) => building.floorTiles.reduce((n, t) => n + (t.floor === floor ? 1 : 0), 0);
  return count(building.floors - 1) <= count(building.floors - 2) * 0.3;
}

/** Stable per building: archetype, frame and lot position, so a town rolls the same roofs every time. */
export function rooftopSeed(building: Pick<Building, "archetypeId" | "w" | "d" | "floors" | "x" | "y">): number {
  return hashSeed(`${building.archetypeId}:${building.w}x${building.d}x${building.floors}:${Math.round(building.x * 8)}:${Math.round(building.y * 8)}`);
}

/** Cells a fixture stands on: its anchor, plus the next one along its axis when it spans two. */
export function rooftopCells(fixture: Pick<RooftopFixture, "gx" | "gy" | "span" | "axis">): { gx: number; gy: number }[] {
  const cells = [{ gx: fixture.gx, gy: fixture.gy }];
  if (fixture.span === 2) cells.push({ gx: fixture.gx + (fixture.axis === "x" ? 1 : 0), gy: fixture.gy + (fixture.axis === "y" ? 1 : 0) });
  return cells;
}

/**
 * Deterministic rooftop equipment for a building's occupancy. Every fixture stands on roof-covered
 * cells clear of skylights, shafts, roof-mounted facade details, bulkhead lids and each other.
 */
export function generateRooftop(building: Building, seed = rooftopSeed(building), region?: RoofRegion): RooftopFixture[] {
  const sites = roofSites(building);
  if (!sites.size) return [];
  const flatByFloor = new Map<number, number>();
  for (const s of sites.values()) if (s.flat) flatByFloor.set(s.floor, (flatByFloor.get(s.floor) ?? 0) + 1);
  const kit = rooftopKit(building);
  const floor = primaryFloor(building, kit, flatByFloor);
  const area = flatByFloor.get(floor) ?? 0;
  const pitchedArea = [...sites.values()].filter(s => !s.flat).length;
  const wants = [
    ...(kit ? kitWants(kit, building, area || pitchedArea, hasPenthouse(building)) : []),
    ...regionalWants(building, region, area || pitchedArea),
  ];
  const placer = new Placer(building, sites, floor, new Rng(mixSeed(seed)));
  for (const kind of wants) placer.place(kind);
  return placer.out;
}

/** Towers put their plant on the highest real deck; everything else uses its biggest one. */
function primaryFloor(building: Building, kit: RooftopKit | null, flatByFloor: ReadonlyMap<number, number>): number {
  let best = building.floors - 1, bestArea = -1;
  for (const [floor, area] of flatByFloor) {
    const better = kit === "office" ? floor > best || bestArea < 0 : area > bestArea || (area === bestArea && floor > best);
    if (better) { best = floor; bestArea = area; }
  }
  return best;
}

class Placer {
  readonly out: RooftopFixture[] = [];
  private readonly taken = new Set<string>();
  private readonly axis: RoofAxis;
  private readonly kitchen: ReadonlySet<string>;

  constructor(
    building: Building,
    private readonly sites: ReadonlyMap<string, RoofSite>,
    private readonly floor: number,
    private readonly rng: Rng,
  ) {
    this.axis = building.w >= building.d ? "x" : "y";
    this.kitchen = kitchenCells(building);
  }

  place(kind: RooftopKind): void {
    const def = ROOFTOP_KINDS[kind];
    const axis: RoofAxis = kind === "duct-run" && this.rng.chance(0.35) ? (this.axis === "x" ? "y" : "x") : this.axis;
    let best: RoofSite | undefined, bestScore = -Infinity;
    for (const site of this.sites.values()) {
      if (!this.fits(site, def, axis)) continue;
      const score = this.score(site, kind, def, axis) + this.rng.next();
      if (score > bestScore) { best = site; bestScore = score; }
    }
    if (!best) return;
    const fixture: RooftopFixture = {
      id: this.out.length + 1, kind, floor: best.floor, gx: best.gx, gy: best.gy, span: def.span, axis,
      heavy: def.heavy, mass: def.mass, salvage: def.salvage, value: def.salvage ? salvageCash(def.salvage, def.scrap ?? def.mass) : 0,
      state: "mounted", fallFloor: best.floor, fallT: 0, fallen: 0, seed: this.rng.int(1, 0x7fffffff),
    };
    for (const c of rooftopCells(fixture)) this.taken.add(siteKey(best.floor, c.gx, c.gy));
    this.out.push(fixture);
  }

  private fits(site: RoofSite, def: RooftopKindDef, axis: RoofAxis): boolean {
    if (site.frontEdge || (!site.flat && !def.pitched)) return false;
    if (site.flat && site.floor !== this.floor) return false;
    for (const c of rooftopCells({ gx: site.gx, gy: site.gy, span: def.span, axis })) {
      const other = this.sites.get(siteKey(site.floor, c.gx, c.gy));
      if (!other || other.frontEdge || other.flat !== site.flat || this.taken.has(siteKey(site.floor, c.gx, c.gy))) return false;
    }
    return true;
  }

  /** Higher is better: flat decks first, heavy plant off the edges and in rows, hoods over the kitchen line. */
  private score(site: RoofSite, kind: RooftopKind, def: RooftopKindDef, axis: RoofAxis): number {
    let score = site.flat ? 4 : 0;
    if (def.heavy && !site.backEdge) score += 2;
    if (!def.heavy && site.backEdge && def.h < 0.7) score += 0.6;
    if (kind === "exhaust-hood" && this.kitchen.has(`${site.gx},${site.gy}`)) score += 5;
    for (const placed of this.out) {
      if (placed.floor !== site.floor) continue;
      const dx = Math.abs(placed.gx - site.gx), dy = Math.abs(placed.gy - site.gy);
      const across = axis === "x" ? dy : dx, along = axis === "x" ? dx : dy;
      // Banks of the same machine line up across the roof with a service aisle between them.
      if (placed.kind === kind && def.heavy) score += along === 0 && across === 2 ? 3 : across === 0 && along === def.span + 1 ? 2.2 : 0;
      else if (kind === "duct-run" && placed.kind === "exhaust-hood") score += dx + dy <= 2 ? 3.5 : 0;
      else if (kind === "mua-box" && placed.kind === "exhaust-hood") score += dx + dy <= 3 ? 1.5 : 0;
      else if (dx + dy <= 1) score -= 1.2;
    }
    return score;
  }
}

/** Ground-plan cells of kitchens, where the grease exhaust rises from. */
function kitchenCells(building: Building): Set<string> {
  const cells = new Set<string>();
  for (const f of building.fixtures) {
    if (f.kind !== "commercial-oven") continue;
    const cs = building.cellSize;
    cells.add(`${Math.floor((f.x + f.w / 2 - building.x) / cs)},${Math.floor((f.y + f.d / 2 - building.y) / cs)}`);
  }
  for (const t of building.floorTiles) if (t.floor === 0 && building.layout.rooms.find(r => r.id === t.roomId)?.kind === "kitchen") cells.add(`${t.gx},${t.gy}`);
  return cells;
}

/** Roof sections of the fixture's floor covering any of its cells. */
export function rooftopSupports(building: Building, fixture: RooftopFixture): RoofSection[] {
  const cells = rooftopCells(fixture);
  return building.roofs.filter(r => r.floor === fixture.floor && roofCoverage(r).some(c => cells.some(s => s.gx === c.gx && s.gy === c.gy)));
}

/** World footprint of a fixture on its cells. */
export function rooftopBox(building: Building, fixture: RooftopFixture): { x: number; y: number; w: number; d: number } {
  const def = ROOFTOP_KINDS[fixture.kind], cs = building.cellSize;
  const along = (fixture.span - 1 + def.l) * cs, across = def.w * cs;
  const cx = building.x + (fixture.gx + 0.5 + (fixture.axis === "x" ? (fixture.span - 1) / 2 : 0)) * cs;
  const cy = building.y + (fixture.gy + 0.5 + (fixture.axis === "y" ? (fixture.span - 1) / 2 : 0)) * cs;
  const w = fixture.axis === "x" ? along : across, d = fixture.axis === "x" ? across : along;
  return { x: cx - w / 2, y: cy - d / 2, w, d };
}

export interface RooftopPose {
  box: { x: number; y: number; w: number; d: number };
  /** Deck height under the fixture before any roof movement. */
  z: number;
  /** Section whose hinge and drop the fixture rides, when that roof is moving. */
  riding?: RoofSection;
  /** Fall of the roof plane across the footprint (pitched roofs), as dz per world unit. */
  slopeX: number;
  slopeY: number;
}

/** Where a standing or falling fixture is; null once it is gone. A mounted fixture never outlives its roof. */
export function rooftopPose(building: Building, fixture: RooftopFixture): RooftopPose | null {
  if (fixture.state === "gone") return null;
  const box = rooftopBox(building, fixture);
  if (fixture.state === "falling") {
    const t = fixture.fallT * fixture.fallT;
    return { box, z: (fixture.fallFloor + 1 - t) * FLOOR_Z, slopeX: 0, slopeY: 0 };
  }
  const supports = rooftopSupports(building, fixture);
  const roof = supports.find(r => r.state !== "gone");
  if (!roof) return null;
  const cx = box.x + box.w / 2, cy = box.y + box.d / 2;
  const z = heightOnPoly(roof.verts, cx, cy) ?? roof.verts[0]!.z;
  const moving = supports.find(r => r.state !== "intact" || r.sag > 0);
  if (roof.style === "flat") return { box, z, riding: moving, slopeX: 0, slopeY: 0 };
  const zx = heightOnPoly(roof.verts, cx + 0.1, cy), zy = heightOnPoly(roof.verts, cx, cy + 0.1);
  return { box, z, riding: moving, slopeX: zx == null ? 0 : (zx - z) / 0.1, slopeY: zy == null ? 0 : (zy - z) / 0.1 };
}

/** A point of the fixture in world space: riding its roof's hinge and drop while that roof moves. */
export function rooftopPoint(pose: RooftopPose, x: number, y: number, up: number): { x: number; y: number; z: number } {
  const p = { x, y, z: pose.z + up };
  return pose.riding ? displacedRoofVerts(pose.riding, [p])[0]! : p;
}

export function rooftopNeedsStep(building: Building): boolean {
  return building.rooftop.some(f => f.state === "falling");
}

/** Burst and cue for a machine breaking open: the particles here, the sound through the event. */
export function machineBreak(particles: ParticlePool, events: WorldEvent[], fx: MachineFx, x: number, y: number, z: number, mag: number): void {
  if (fx === "refrigerant") particles.refrigerantPuff(x, y, z, mag);
  else if (fx === "soot") particles.sootPlume(x, y, z, mag);
  else particles.arcSparks(x, y, z, mag);
  events.push({ kind: "machine-break", x, y, z, mag, fx, material: "metal" });
}

/**
 * The damage paths a dead load uses on its way down, supplied by the structure step so this
 * module stays below the wall and interior code that imports it.
 */
export interface DeadLoadDamage {
  cell(building: Building, cell: Cell, amount: number, nx: number, ny: number, particles: ParticlePool, events: WorldEvent[]): number;
  fixture(building: Building, fixture: InteriorFixture, amount: number, nx: number, ny: number, particles: ParticlePool, events: WorldEvent[]): { cash: number; frags: StructureStepResult["fixtureFrags"] };
  fixtureBox(fixture: InteriorFixture): { x: number; y: number; w: number; d: number };
}

/** Seconds a dead load takes through one storey: the first drop is from rest. */
const STOREY_DROP = 0.34;
const STOREY_DROP_MOVING = 0.2;

/**
 * Rooftop equipment after the roofs have stepped. A mounted fixture lets go the moment any roof
 * under it starts to fall; light gear tears off into debris, heavy plant drops as a dead load.
 */
export function stepRooftop(
  building: Building,
  dt: number,
  particles: ParticlePool,
  events: WorldEvent[],
  result: StructureStepResult,
  damage: DeadLoadDamage,
): void {
  for (const fixture of building.rooftop) {
    if (fixture.state === "mounted") {
      const supports = rooftopSupports(building, fixture);
      const failed = supports.find(r => r.state === "falling" || r.state === "gone");
      if (!failed && supports.length) continue;
      if (fixture.heavy) startDeadLoad(building, fixture);
      else tearOff(building, fixture, failed, particles, events, result);
    } else if (fixture.state === "falling") stepDeadLoad(building, fixture, dt, particles, events, result, damage);
  }
}

function fixtureCenter(building: Building, fixture: RooftopFixture): { x: number; y: number } {
  const box = rooftopBox(building, fixture);
  return { x: box.x + box.w / 2, y: box.y + box.d / 2 };
}

function startDeadLoad(building: Building, fixture: RooftopFixture): void {
  fixture.state = "falling";
  fixture.fallFloor = fixture.floor;
  fixture.fallT = 0;
  fixture.fallen = 0;
  building.visualRevision++;
  building.structureDirty = true;
}

/** Light gear leaves as sheet metal (and glass, for panels and skylights) through the roof debris path. */
function tearOff(building: Building, fixture: RooftopFixture, roof: RoofSection | undefined, particles: ParticlePool, events: WorldEvent[], result: StructureStepResult): void {
  const def = ROOFTOP_KINDS[fixture.kind], box = rooftopBox(building, fixture), c = fixtureCenter(building, fixture);
  const z = (fixture.floor + 1) * FLOOR_Z;
  const dx = roof?.fallDx || 0.2, dy = roof?.fallDy || 0.55;
  fixture.state = "gone";
  building.visualRevision++;
  const sheet = { x: c.x, y: c.y, dx, dy, floor: fixture.floor + 1, source: "roof" as const, panelW: Math.max(0.3, box.w * 0.9), panelD: Math.max(0.2, box.d * 0.6) };
  result.rubbleSpawns.push({ ...sheet, material: "metal", cellSize: 0.3 + def.mass * 0.14 });
  if (def.debris === "glass") result.rubbleSpawns.push({ ...sheet, x: c.x + dx * 0.2, y: c.y + dy * 0.2, material: "glass", cellSize: 0.34 });
  particles.spawn(def.debris === "glass" ? "glass" : "metal", c.x, c.y, z + def.h * 0.5, 5, 2.2, 2.6);
  if (def.fx) machineBreak(particles, events, def.fx, c.x, c.y, z + def.h * 0.6, 0.6);
  if (fixture.value > 0) {
    result.cash += fixture.value;
    events.push({ kind: "snap", x: c.x, y: c.y, z, mag: 0.4, material: "metal", cash: fixture.value, salvage: fixture.salvage });
  }
}

function stepDeadLoad(
  building: Building,
  fixture: RooftopFixture,
  dt: number,
  particles: ParticlePool,
  events: WorldEvent[],
  result: StructureStepResult,
  damage: DeadLoadDamage,
): void {
  building.visualRevision++;
  fixture.fallT += dt / (fixture.fallen === 0 ? STOREY_DROP : STOREY_DROP_MOVING);
  if (fixture.fallT < 1) return;
  fixture.fallen++;
  const floor = fixture.fallFloor;
  const through = crushStorey(building, fixture, floor, particles, events, result, damage);
  if (through && floor > 0) {
    fixture.fallFloor = floor - 1;
    fixture.fallT = 0;
    return;
  }
  breakDeadLoad(building, fixture, floor, particles, events, result);
}

/** Slab resistance in dead-load units: timber floors give way under any plant, concrete only under the big units. */
function slabResistance(material: Material): number {
  return MATERIALS[material].hp / 12;
}

/**
 * The load lands on storey `floor`: it crushes the contents and weak walls it lands on and
 * punches through the slab when it out-weighs it. Returns whether it keeps falling.
 */
function crushStorey(
  building: Building,
  fixture: RooftopFixture,
  floor: number,
  particles: ParticlePool,
  events: WorldEvent[],
  result: StructureStepResult,
  damage: DeadLoadDamage,
): boolean {
  const box = rooftopBox(building, fixture), c = fixtureCenter(building, fixture);
  const impact = fixture.mass * fixture.fallen;
  for (const inside of building.fixtures) {
    if (inside.broken || inside.floor !== floor) continue;
    const b = damage.fixtureBox(inside);
    if (b.x >= box.x + box.w || b.x + b.w <= box.x || b.y >= box.y + box.d || b.y + b.d <= box.y) continue;
    const out = damage.fixture(building, inside, impact * 40, 0, 1, particles, events);
    result.cash += out.cash;
    result.fixtureFrags.push(...out.frags);
  }
  let open = true, punched = false;
  for (const cell of rooftopCells(fixture)) {
    const wall = building.grid[floor]?.[cell.gx]?.[cell.gy];
    if (wall && wall.state !== "gone" && wall.state !== "falling") result.cash += damage.cell(building, wall, impact * 6, 0, 1, particles, events);
    const tile = building.floorTiles.find(t => t.floor === floor && t.gx === cell.gx && t.gy === cell.gy);
    if (!tile || tile.void || tile.state !== "intact") continue;
    if (floor > 0 && impact > slabResistance(building.construction.floor)) {
      tile.state = "falling";
      punched = true;
    } else open = false;
  }
  const z = floor * FLOOR_Z + 0.2;
  if (!open || punched) {
    particles.burst(punched ? (building.construction.floor === "wood" ? "wood" : "concrete") : "metal", c.x, c.y, z, 0.5 + impact * 0.08);
    events.push({ kind: "impact", x: c.x, y: c.y, z, mag: Math.min(2.2, 0.5 + impact * 0.12), material: building.construction.floor, heft: 1.3 });
  }
  if (punched) {
    building.structureDirty = true;
    building.collisionDirty = true;
  }
  return open;
}

/** At rest the unit bursts into mechanical scrap and pays its salvage once. */
function breakDeadLoad(building: Building, fixture: RooftopFixture, floor: number, particles: ParticlePool, events: WorldEvent[], result: StructureStepResult): void {
  const def = ROOFTOP_KINDS[fixture.kind], c = fixtureCenter(building, fixture), z = floor * FLOOR_Z + 0.3;
  fixture.state = "gone";
  building.visualRevision++;
  const rng = new Rng(mixSeed(fixture.seed));
  const pieces = fixture.mass > 6 ? 3 : 2;
  for (let i = 0; i < pieces; i++) {
    const a = rng.range(0, Math.PI * 2);
    result.rubbleSpawns.push({
      x: c.x + Math.cos(a) * 0.25, y: c.y + Math.sin(a) * 0.25, dx: Math.cos(a), dy: Math.sin(a),
      material: i === 0 ? def.debris : "metal", floor, cellSize: Math.sqrt(fixture.mass / pieces) * 0.5,
    });
  }
  particles.burst("metal", c.x, c.y, z, 0.8 + fixture.mass * 0.1);
  if (def.fx) machineBreak(particles, events, def.fx, c.x, c.y, z + 0.3, 1);
  result.cash += fixture.value;
  events.push({ kind: "crush", x: c.x, y: c.y, z, mag: Math.min(1.8, 0.7 + fixture.mass * 0.1), material: "metal", cash: fixture.value, salvage: fixture.salvage });
}

/**
 * A core tower takes its roof plant down inside the falling stack: each unit joins the aggregate
 * mass and pays its salvage here, once, never again through the roof path.
 */
export function collapseRooftop(building: Building, particles: ParticlePool, events: WorldEvent[]): { cash: number; mass: number } {
  const totals: Record<SalvageKind, number> = { copper: 0, mechanical: 0 };
  let mass = 0, vented = false;
  for (const fixture of building.rooftop) {
    if (fixture.state === "gone") continue;
    fixture.state = "gone";
    mass += fixture.mass;
    if (fixture.salvage) totals[fixture.salvage] += fixture.value;
    vented ||= ROOFTOP_KINDS[fixture.kind].fx === "refrigerant";
  }
  if (!mass) return { cash: 0, mass: 0 };
  building.visualRevision++;
  const x = building.x + building.w * building.cellSize / 2, y = building.y + building.d * building.cellSize / 2, z = building.floors * FLOOR_Z;
  if (vented) machineBreak(particles, events, "refrigerant", x, y, z, 1.4);
  for (const kind of ["copper", "mechanical"] as const) {
    if (totals[kind] > 0) events.push({ kind: "crush", x, y, z, mag: 1, material: "metal", cash: totals[kind], salvage: kind });
  }
  return { cash: totals.copper + totals.mechanical, mass };
}

/** Tallest mounted fixture, so culling and occlusion boxes include the plant above the parapet. */
export function rooftopClearance(building: Building): number {
  let top = 0;
  for (const f of building.rooftop) if (f.state !== "gone") top = Math.max(top, ROOFTOP_KINDS[f.kind].h);
  return top;
}
