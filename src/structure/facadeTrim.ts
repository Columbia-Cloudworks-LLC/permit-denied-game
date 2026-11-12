import { hashSeed, mixSeed } from "../game/rng";
import { archetypeById } from "../world/archetypes";
import { onRoof, type FacadeDetailDef } from "./facadeDetails";
import type { Building, Cell, Lot } from "./types";

/** The two faces the camera sees. */
export type FaceSide = "south" | "east";
/** Small gear mounted on one wall cell. It shares the cell's fate and adds no collision. */
export type TrimItemKind =
  | "window-ac" | "meter-bank" | "conduit" | "gas-meter" | "louver"
  | "downspout" | "service-door" | "wall-pack" | "blade-sign";
export type AwningStyle = "flat" | "striped" | "bullnose" | "steel";

/** Which visible face fronts the street, and whether the lot turns a corner. Stamped by `stampStreetFaces`. */
export interface StreetFace { side: FaceSide; corner: boolean }

/**
 * Procedural facade articulation for one building: masonry trim, the street and service roles of
 * its two visible faces, and the gear mounted on individual wall cells. Derived from archetype
 * traits, theme, construction and a per-building seed; never authored per package.
 */
export interface FacadeTrimPlan {
  seed: number;
  street: FaceSide;
  service: FaceSide;
  /** Stringcourse at every upper floor line. */
  belt: boolean;
  /** Roofline frieze on flat-roofed masonry: corbelled brick or a projecting stone cornice. */
  cornice: "none" | "corbel" | "cornice";
  /** Contrasting ground-floor wainscot. */
  plinth: "none" | "stone" | "cmu";
  corners: "none" | "quoins" | "pilasters";
  lintels: "none" | "flat" | "soldier";
  sills: boolean;
  shutters: boolean;
  awning: AwningStyle;
  transom: boolean;
  entryLight: boolean;
  /** Meters ganged on the service wall. */
  meters: number;
  /** Mounted gear by `trimKey`. */
  items: ReadonlyMap<number, readonly TrimItemKind[]>;
  /** Cells an authored facade detail owns: procedural trim stays off them. */
  claimed: ReadonlySet<number>;
}

/** Older walk-up residential forms that cool with window units rather than rooftop plant. */
const WINDOW_AC_USES: readonly string[] = ["boarding-house", "motel-room-block", "urban-apartment", "fourplex", "rowhouse-unit", "garden-apartment-block"];
const WINDOW_AC_MAX_FLOORS = 6;
const HOUSE_THEMES: readonly string[] = ["cottage", "ranch", "colonial", "porch"];
const SHOP_THEMES: readonly string[] = ["storefront", "corner"];
const AWNINGS: readonly AwningStyle[] = ["striped", "bullnose", "steel"];
/** Per-window trim stops above this height: towers read as mass, not sash. */
const FINE_TRIM_FLOORS = 6;

export const trimKey = (side: FaceSide, floor: number, gx: number, gy: number): number =>
  (((floor << 7 | gx) << 7 | gy) << 1) | (side === "east" ? 1 : 0);

/** Stable 0..1 roll for one decision of one building. */
export function trimRoll(seed: number, salt: number): number {
  return mixSeed((seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0) / 0x1_0000_0000;
}

const EMPTY_ITEMS: ReadonlyMap<number, readonly TrimItemKind[]> = new Map();
const NO_ITEMS: readonly TrimItemKind[] = [];
const cache = new WeakMap<Building, { seed: number; details: readonly FacadeDetailDef[]; face: StreetFace | undefined; plan: FacadeTrimPlan }>();

function trimSeed(b: Building): number {
  return b.region?.seed ?? hashSeed(`${b.archetypeId}:${Math.round(b.x * 8)}:${Math.round(b.y * 8)}`);
}

function archetypeUses(id: string): readonly string[] {
  try {
    return archetypeById(id).traits?.use ?? [];
  } catch {
    return [];
  }
}

/** A south window as the wall renderer draws it: authored, colonial upper sash, or a masonry ground floor. */
export function southWindowed(b: Building, cell: Cell): boolean {
  if (cell.doorS || cell.loadingS) return false;
  return cell.windowS || (b.theme === "colonial" && cell.floor > 0) || (b.construction.walls === "masonry" && cell.floor === 0);
}

export const faceWindowed = (b: Building, cell: Cell, side: FaceSide): boolean =>
  side === "east" ? cell.windowE : southWindowed(b, cell);

/** Window units only on the listed older residential forms. */
export function usesWindowAc(b: Building): boolean {
  if (b.kind !== "house" || b.floors > WINDOW_AC_MAX_FLOORS) return false;
  return b.theme === "walkup" || archetypeUses(b.archetypeId).some(use => WINDOW_AC_USES.includes(use));
}

/**
 * Scupper and downspout positions on a face `count` cells long: the quarter points, snapped to
 * cell boundaries. Returned as the index of the cell whose leading edge carries the pipe.
 */
export function downspoutCells(count: number): number[] {
  const out: number[] = [];
  for (const at of [Math.round(count / 4), Math.round(count * 3 / 4)]) {
    if (at >= 1 && at <= count - 1 && !out.includes(at)) out.push(at);
  }
  return out;
}

/** The longest exposed ground-floor run of one face, outermost on ties, ordered along the wall. */
export function faceRun(b: Building, side: FaceSide): Cell[] {
  const planes = new Map<number, Cell[]>();
  for (const cell of b.cells) {
    if (cell.floor !== 0 || !cell.exterior[side]) continue;
    const plane = side === "south" ? cell.gy : cell.gx;
    const run = planes.get(plane);
    if (run) run.push(cell); else planes.set(plane, [cell]);
  }
  let best: Cell[] = [], bestPlane = -1;
  for (const [plane, run] of planes) {
    if (run.length > best.length || (run.length === best.length && plane > bestPlane)) { best = run; bestPlane = plane; }
  }
  return best.sort((a, c) => side === "south" ? a.gx - c.gx : a.gy - c.gy);
}

function claimedCells(b: Building): Set<number> {
  const claimed = new Set<number>();
  for (const d of b.facadeDetails) {
    if (onRoof(d)) continue;
    for (let i = 0; i < d.width; i++) {
      claimed.add(trimKey(d.side, d.floor, d.gx + (d.side === "south" ? i : 0), d.gy + (d.side === "east" ? i : 0)));
    }
  }
  return claimed;
}

/** Trim is for walled buildings: glass houses, canopies, decks, silos and tanks carry none. */
function trimless(b: Building): boolean {
  return b.construction.skin === "glass" || !!b.canopy || !!b.openDecks || !!b.silos?.length || !!b.elevatedTank;
}

export function facadeTrimPlan(b: Building): FacadeTrimPlan {
  const seed = trimSeed(b);
  const hit = cache.get(b);
  if (hit && hit.seed === seed && hit.details === b.facadeDetails && hit.face === b.streetFace) return hit.plan;
  const plan = buildPlan(b, seed);
  cache.set(b, { seed, details: b.facadeDetails, face: b.streetFace, plan });
  return plan;
}

function buildPlan(b: Building, seed: number): FacadeTrimPlan {
  const street: FaceSide = b.streetFace?.side ?? "south";
  const service: FaceSide = street === "south" ? "east" : "south";
  const base: FacadeTrimPlan = {
    seed, street, service, belt: false, cornice: "none", plinth: "none", corners: "none", lintels: "none",
    sills: false, shutters: false, awning: "flat", transom: false, entryLight: false, meters: 0,
    items: EMPTY_ITEMS, claimed: new Set(),
  };
  if (trimless(b)) return base;
  const roll = (salt: number) => trimRoll(seed, salt);
  const skin = b.construction.skin;
  const brick = skin === "brick", masonry = brick || skin === "concrete";
  const civic = b.theme === "civic", shop = SHOP_THEMES.includes(b.theme);
  const industrial = b.kind === "industrial" || b.theme === "warehouse";
  const fine = b.floors <= FINE_TRIM_FLOORS;
  const claimed = claimedCells(b);
  return {
    ...base,
    claimed,
    belt: masonry && !industrial && b.floors >= 2 && (civic || roll(1) < 0.8),
    cornice: b.roof !== "flat" || !masonry || industrial ? "none" : brick && !civic ? "corbel" : "cornice",
    plinth: plinthFor(b, masonry, civic, shop, industrial, roll(2)),
    corners: !masonry ? "none" : civic ? (roll(3) < 0.5 ? "pilasters" : "quoins") : b.theme === "corner" || b.streetFace?.corner ? "quoins" : "none",
    lintels: !fine || !masonry || industrial ? "none" : brick && roll(4) < 0.5 ? "soldier" : "flat",
    sills: fine && !industrial && (masonry || roll(5) < 0.5),
    shutters: fine && b.kind === "house" && HOUSE_THEMES.includes(b.theme) && (b.theme === "colonial" || roll(6) < 0.6),
    awning: b.features.awning ? AWNINGS[Math.floor(roll(7) * AWNINGS.length)]! : "flat",
    transom: (shop || civic || b.theme === "walkup") && roll(8) < 0.75,
    entryLight: roll(9) < 0.8,
    meters: b.kind === "house" && b.theme !== "walkup" ? 1 : 2 + Math.floor(roll(10) * 3),
    items: mountItems(b, seed, street, service, claimed, { shop, industrial, civic }),
  };
}

function plinthFor(b: Building, masonry: boolean, civic: boolean, shop: boolean, industrial: boolean, roll: number): FacadeTrimPlan["plinth"] {
  if (!masonry) return "none";
  if (civic) return "stone";
  if (industrial) return roll < 0.5 ? "cmu" : "none";
  if (shop || b.kind === "shop") return roll < 0.6 ? (b.construction.skin === "brick" ? "stone" : "cmu") : "none";
  return b.theme === "walkup" && roll < 0.4 ? "stone" : "none";
}

/** Place every mounted item: service gear on the service face, a blade sign on the street face, window units anywhere. */
function mountItems(
  b: Building, seed: number, street: FaceSide, service: FaceSide, claimed: ReadonlySet<number>,
  role: { shop: boolean; industrial: boolean; civic: boolean },
): ReadonlyMap<number, readonly TrimItemKind[]> {
  const items = new Map<number, TrimItemKind[]>();
  const add = (side: FaceSide, cell: Cell, kind: TrimItemKind) => {
    const key = trimKey(side, cell.floor, cell.gx, cell.gy);
    // Some packages author a wall position as already open.
    if (claimed.has(key) || cell.state === "gone") return;
    const list = items.get(key);
    if (list) list.push(kind); else items.set(key, [kind]);
  };
  /** The same wall position on every floor above `cell` that still faces `side`. */
  const riser = (side: FaceSide, cell: Cell, kind: TrimItemKind) => {
    for (let floor = 1; floor < b.floors; floor++) {
      const above = b.grid[floor]?.[cell.gx]?.[cell.gy];
      if (!above?.exterior[side]) break;
      add(side, above, kind);
    }
  };
  const commercial = b.kind !== "house" || role.civic;
  const run = faceRun(b, service);
  if (run.length) {
    for (const at of downspoutCells(run.length)) { add(service, run[at]!, "downspout"); riser(service, run[at]!, "downspout"); }
    add(service, run[0]!, "meter-bank");
    riser(service, run[0]!, "conduit");
    if (!role.industrial || b.construction.skin !== "metal") add(service, run[run.length - 1]!, "gas-meter");
    const mid = run[run.length >> 1]!;
    if (commercial) add(service, mid, "louver");
    const blank = commercial && service === "east" ? run.filter(cell => !cell.windowE && !claimed.has(trimKey(service, 0, cell.gx, cell.gy))) : [];
    const door = blank.length ? blank[Math.floor(trimRoll(seed, 11) * blank.length)]! : undefined;
    if (door) add(service, door, "service-door");
    if (commercial) add(service, door ?? mid, "wall-pack");
  }
  if (b.kind === "shop" && (role.shop || trimRoll(seed, 12) < 0.4)) {
    const front = faceRun(b, street);
    const end = front.length ? front[trimRoll(seed, 13) < 0.5 ? 0 : front.length - 1]! : undefined;
    const mount = end && b.floors > 1 ? b.grid[1]?.[end.gx]?.[end.gy] ?? end : end;
    if (mount?.exterior[street]) add(street, mount, "blade-sign");
  }
  if (usesWindowAc(b)) {
    for (const cell of b.cells) for (const side of ["south", "east"] as const) {
      if (!cell.exterior[side] || !faceWindowed(b, cell, side)) continue;
      const key = trimKey(side, cell.floor, cell.gx, cell.gy);
      if (trimRoll(seed, 64 + key) < 0.38) add(side, cell, "window-ac");
    }
  }
  return items;
}

/** A door cell whose stock awning box gives way to the plan's styled one. Authored detail cells keep the stock box. */
export function awningStyled(b: Building, plan: FacadeTrimPlan, cell: Cell): boolean {
  return b.features.awning && plan.awning !== "flat" && cell.state === "intact" && !plan.claimed.has(trimKey("south", cell.floor, cell.gx, cell.gy));
}

/** Gear to draw on one cell face: only while the cell stands undamaged. */
export function trimItemsAt(plan: FacadeTrimPlan, cell: Cell, side: FaceSide): readonly TrimItemKind[] {
  if (cell.state !== "intact") return NO_ITEMS;
  return plan.items.get(trimKey(side, cell.floor, cell.gx, cell.gy)) ?? NO_ITEMS;
}

/**
 * Record which visible face of each lot building fronts its street. Buildings stay axis-aligned
 * with their doors on the south face, so a lot that faces east shows its street side there and
 * every other lot fronts south. Runs once on a finished layout.
 */
export function stampStreetFaces(buildings: readonly Building[], lots: readonly Lot[]): void {
  const byId = new Map(lots.map(lot => [lot.id, lot]));
  for (const building of buildings) {
    const lot = building.lotId ? byId.get(building.lotId) : undefined;
    if (!lot) continue;
    // Lot heading runs from the frontage to the rear, so the street lies behind it.
    building.streetFace = { side: -Math.cos(lot.heading) > 0.7 ? "east" : "south", corner: !!lot.cornerLot };
    building.visualRevision++;
  }
}
