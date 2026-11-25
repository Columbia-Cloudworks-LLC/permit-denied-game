import { pointInPoly } from '../game/math';
import type { RoadClass } from '../structure/types';
import { linePoints, pt, type RoadBuilder, type RoadNode } from './roads';
import { groundMixAt, type TerrainSurface } from './terrain';

/**
 * A city plan is the authored geography of one real place, played as a Downtown county:
 * the coastline, the street grid, the parks and where each landmark stands. The town generator
 * still does everything else: it cuts lots along the plan's streets, fills them with the level's
 * ordinary buildings, and dresses them. Plans are data, in the lazy overworld chunk
 * (`cityPlans/`); this module is the startup-safe slice generation runs.
 *
 * Plan coordinates are world units with the origin at the map's north-west corner:
 * +x is east and +y is south.
 */
export type PlanPoint = readonly [x: number, y: number];
export type PlanPolygon = readonly PlanPoint[];

/** One straight street. `axis: 'x'` runs east-west along `y = at`; `'y'` runs north-south along `x = at`. */
export interface CityPlanStreet {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
  roadClass?: RoadClass;
}

export interface CityPlanPark {
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  /** Trees scattered over the lawn; ponds come from the plan's `water`. */
  trees?: number;
  /** Catalog asset planted as the park's tree; absent is `mature-tree`. */
  tree?: string;
  /** Ground of a paved or bare plaza in place of lawn. Lots stay out of it all the same. */
  cover?: PlanGround;
}

/** Open ground a plan may choose where it is not turf. */
export type PlanGround = 'grass' | 'scrub' | 'dirt' | 'gravel' | 'sand';

/** Jets playing on a piece of the plan's water: a row from (`x0`, `y0`) to (`x1`, `y1`). Drawn only. */
export interface CityPlanFountain {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  jets: number;
  /** Peak height of the tallest jet, in world units. */
  height: number;
}

/** A vaulted canopy over one stretch of a street, on columns at the kerb. Drawn only: nothing collides with it. */
export interface CityPlanCanopy {
  name: string;
  axis: 'x' | 'y';
  /** The street's own `at`. */
  at: number;
  from: number;
  to: number;
  /** Half the span across the street, and the height of the crown. */
  halfWidth: number;
  height: number;
  color: number;
}

export interface CityPlanLandmark {
  buildingId: string;
  label: string;
  /** North-west corner of the building footprint. */
  x: number;
  y: number;
  /** Keep ordinary lots this far from the footprint: room for a figure wider than its plinth. */
  clear?: number;
  /** Keep ordinary lots this much further off on the camera side (south and east), so fill does not stand in front of it. */
  view?: number;
}

/** Lots within `r` of a core are downtown-core; the transition ring and edge follow by distance. */
export interface CityPlanCore {
  x: number;
  y: number;
  r: number;
}

export interface CityPlan {
  id: string;
  /** The city's name: the county is called this on the atlas and the HUD. */
  name: string;
  width: number;
  depth: number;
  /** Dry ground. Everything outside these rings is open water. */
  land: readonly PlanPolygon[];
  /** Water cut back out of the land: rivers, ponds, harbour slips. */
  water?: readonly PlanPolygon[];
  /**
   * Dry-ground covers for the open land, mixed in drifts with the middle ones commonest. Absent is
   * turf. With it set, only the parks are lawn, and they stay green under a desert climate.
   */
  ground?: readonly PlanGround[];
  fountains?: readonly CityPlanFountain[];
  canopies?: readonly CityPlanCanopy[];
  streets: readonly CityPlanStreet[];
  parks: readonly CityPlanPark[];
  /** Pinned landmarks. The first is the county's objective; the rest pay as regional signatures. */
  landmarks: readonly CityPlanLandmark[];
  cores: readonly CityPlanCore[];
  /** Ordinary fill buildings between the landmarks. */
  fillCount: number;
  dollarTarget: number;
  timeLimit: number;
  /** Street blocks are smaller than the generic Downtown grid so the plan's blocks read as full. */
  block: { w: number; d: number };
}

const toPoly = (ring: PlanPolygon) => ring.map(([x, y]) => ({ x, y }));

/** A plan's drawn-only dressing, carried on the town for the renderer. */
export interface CityDecor {
  fountains: readonly CityPlanFountain[];
  canopies: readonly CityPlanCanopy[];
}

export function planDecor(plan: CityPlan | undefined): CityDecor | undefined {
  if (!plan?.fountains?.length && !plan?.canopies?.length) return undefined;
  return { fountains: plan.fountains ?? [], canopies: plan.canopies ?? [] };
}

const GROUND_SALT = 0x9d5e7;

/** Surface classifier for the plan: water, park lawn, or the plan's open ground. */
export function planSurfaceAt(plan: CityPlan): (x: number, y: number) => TerrainSurface {
  const land = plan.land.map(toPoly);
  const water = (plan.water ?? []).map(toPoly);
  const ground = plan.ground?.length ? plan.ground : undefined;
  return (x, y) => {
    if (!land.some(ring => pointInPoly(x, y, ring))) return 'water';
    if (water.some(ring => pointInPoly(x, y, ring))) return 'water';
    const park = planParkAt(plan, x, y);
    if (park) return park.cover ?? 'grass';
    return ground ? groundMixAt(x, y, GROUND_SALT, ground) : 'grass';
  };
}

/** Park lawns are watered where the plan's open ground is dry; undefined when the whole plan is turf. */
export function planIrrigatedAt(plan: CityPlan): ((x: number, y: number) => boolean) | undefined {
  return plan.ground?.length ? (x, y) => { const park = planParkAt(plan, x, y); return !!park && !park.cover; } : undefined;
}

export function planParkAt(plan: CityPlan, x: number, y: number, pad = 0): CityPlanPark | undefined {
  return plan.parks.find(park => x >= park.x - pad && x <= park.x + park.w + pad && y >= park.y - pad && y <= park.y + park.d + pad);
}

/** A box inside the clear ground a pinned landmark asks for around its footprint. */
export function boxInLandmarkClearance(plan: CityPlan, footprints: ReadonlyMap<string, { x: number; y: number; w: number; d: number }>, box: { x: number; y: number; w: number; d: number }): boolean {
  return plan.landmarks.some(pin => {
    const at = pin.clear || pin.view ? footprints.get(pin.buildingId) : undefined;
    if (!at) return false;
    const pad = pin.clear ?? 0, near = pad + (pin.view ?? 0);
    return box.x < at.x + at.w + near && box.x + box.w > at.x - pad && box.y < at.y + at.d + near && box.y + box.d > at.y - pad;
  });
}

/** A box touches a park when it overlaps the lawn itself (the bounding streets are outside it). */
export function boxInPlanPark(plan: CityPlan, box: { x: number; y: number; w: number; d: number }): boolean {
  return plan.parks.some(park => box.x < park.x + park.w && box.x + box.w > park.x && box.y < park.y + park.d && box.y + box.d > park.y);
}

/**
 * Build the plan's street grid: a node wherever two streets cross or one ends, and a segment
 * between each pair of neighbouring nodes along a street.
 */
export function buildPlanStreets(b: RoadBuilder, plan: CityPlan): void {
  const eps = 0.01;
  const within = (v: number, s: CityPlanStreet) => v >= s.from - eps && v <= s.to + eps;
  for (const street of plan.streets) {
    const stops = new Set<number>([street.from, street.to]);
    for (const other of plan.streets) {
      if (other.axis === street.axis) continue;
      if (within(other.at, street) && within(street.at, other)) stops.add(other.at);
    }
    const ordered = [...stops].sort((a, c) => a - c);
    const nodeAt = (along: number): RoadNode => street.axis === 'x' ? b.node(along, street.at, 0) : b.node(street.at, along, 0);
    for (let i = 0; i < ordered.length - 1; i++) {
      if (ordered[i + 1]! - ordered[i]! < 1) continue;
      const a = nodeAt(ordered[i]!);
      const c = nodeAt(ordered[i + 1]!);
      b.segment(a, c, linePoints(pt(a), pt(c)), { roadClass: street.roadClass ?? 'residential' });
    }
  }
  b.normalizeJunctions();
}

/** Radius for the level's role bands: 0 inside a core, rising to 1 two core-radii beyond its rim. */
export function planRadius(plan: CityPlan, x: number, y: number): number {
  let best = 0.86;
  for (const core of plan.cores) {
    const beyond = Math.hypot(x - core.x, y - core.y) - core.r;
    best = Math.min(best, beyond <= 0 ? 0 : 0.38 + (beyond / (core.r * 2)) * 0.62);
  }
  // Outside every core is still city: the industrial edge only comes from service streets.
  return Math.min(0.86, best);
}
