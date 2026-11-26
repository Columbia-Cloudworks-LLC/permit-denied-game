import { pointInPoly } from '../game/math';
import type { CoverKind, GroundPatch, RoadClass } from '../structure/types';
import { linePoints, pt, type RoadBuilder, type RoadNode } from './roads';
import { groundMixAt, type TerrainSurface } from './terrain';
import type { RailLine } from '../vehicle/rail';

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

/**
 * A baseball diamond painted on the ground: a square of side `size` with home plate in the `home`
 * corner and the outfield fanning to the opposite one. Ground covers only; the stands round it are
 * a landmark package with an open middle.
 */
export interface CityPlanBallfield {
  x: number;
  y: number;
  size: number;
  home: 'nw' | 'ne' | 'sw' | 'se';
}

/**
 * A freight line across the plan: ballast and rails on the ground, with consists of rail cars
 * parked on it that the dozer can shove off the track (`vehicle/rail.ts`). Lots stay off it;
 * a street that crosses it is a level crossing, so keep the consists clear of the streets.
 */
export interface CityPlanRail extends RailLine {
  name: string;
}

/**
 * An elevated beamway on pylons, running along `x = at` or `y = at` from its first pylon to its
 * last. The pylons are props the dozer can break (`monorail-pylon`); a beam that loses a pylon
 * drops, and a car of the parked train that was on it comes down with it (`sim/monorail.ts`).
 * Keep the pylons clear of the cross streets.
 */
export interface CityPlanMonorail {
  name: string;
  axis: 'x' | 'y';
  at: number;
  /** Where each pylon stands along the line, ascending. */
  pylons: readonly number[];
  /** A train parked on the beam: the low end of its first car, and how many cars. */
  train?: { at: number; cars: number };
}

/** A ferry moored on the plan's water, lying along `axis` with its middle at (`x`, `y`), one rail against a pier. */
export interface CityPlanFerry {
  name: string;
  axis: 'x' | 'y';
  x: number;
  y: number;
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
  ballfields?: readonly CityPlanBallfield[];
  rails?: readonly CityPlanRail[];
  monorails?: readonly CityPlanMonorail[];
  ferries?: readonly CityPlanFerry[];
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
  /** Rail lines: the renderer draws the track, and the town parks the cars on it. */
  rails: readonly CityPlanRail[];
  /** Elevated beamways: the town stands their pylons and keeps what is left of the beam. */
  monorails: readonly CityPlanMonorail[];
  /** Moored ferries: the town floats one at each berth. */
  ferries: readonly CityPlanFerry[];
}

export function planDecor(plan: CityPlan | undefined): CityDecor | undefined {
  if (!plan?.fountains?.length && !plan?.canopies?.length && !plan?.rails?.length && !plan?.monorails?.length && !plan?.ferries?.length) return undefined;
  return { fountains: plan.fountains ?? [], canopies: plan.canopies ?? [], rails: plan.rails ?? [], monorails: plan.monorails ?? [], ferries: plan.ferries ?? [] };
}

/** A beamway's size: the top of its pylons, the depth of the beam on them, and how far either side of the line lots are kept off it. */
export const MONORAIL_BEAM = { height: 3.6, depth: 0.6, half: 0.32, clear: 1.3 } as const;

/** The ground under a beamway, out to `pad` either side of its line. */
export function monorailBox(line: CityPlanMonorail, pad: number): { x: number; y: number; w: number; d: number } {
  const from = line.pylons[0]!, to = line.pylons[line.pylons.length - 1]!;
  return line.axis === 'x' ? { x: from, y: line.at - pad, w: to - from, d: pad * 2 } : { x: line.at - pad, y: from, w: pad * 2, d: to - from };
}

/** A box under one of the plan's beamways or too close beside it to build on. */
export function boxUnderPlanMonorail(plan: CityPlan, box: { x: number; y: number; w: number; d: number }): boolean {
  return (plan.monorails ?? []).some(line => {
    const under = monorailBox(line, MONORAIL_BEAM.clear);
    return box.x < under.x + under.w && box.x + box.w > under.x && box.y < under.y + under.d && box.y + box.d > under.y;
  });
}

/** Half the width of a rail line's ballast, and how far either side of the centre line lots are kept off it. */
export const RAIL_BED = { half: 1.25, clear: 1.7 } as const;

/** The ground a rail line takes up, out to `pad` either side of its centre line. */
export function railBox(rail: CityPlanRail, pad: number): { x: number; y: number; w: number; d: number } {
  return rail.axis === 'x'
    ? { x: rail.from, y: rail.at - pad, w: rail.to - rail.from, d: pad * 2 }
    : { x: rail.at - pad, y: rail.from, w: pad * 2, d: rail.to - rail.from };
}

/** A box on a rail line or too close beside it to build on. */
export function boxOnPlanRail(plan: CityPlan, box: { x: number; y: number; w: number; d: number }): boolean {
  return (plan.rails ?? []).some(rail => {
    const bed = railBox(rail, RAIL_BED.clear);
    return box.x < bed.x + bed.w && box.x + box.w > bed.x && box.y < bed.y + bed.d && box.y + box.d > bed.y;
  });
}

/** A point on the gravel ballast of one of the plan's rail lines. */
export function onPlanRailBed(plan: CityPlan, x: number, y: number): boolean {
  return (plan.rails ?? []).some(rail => {
    const bed = railBox(rail, RAIL_BED.half);
    return x >= bed.x && x <= bed.x + bed.w && y >= bed.y && y <= bed.y + bed.d;
  });
}

const FIELD_ARC = 10;

/**
 * Ground patches for the plan's ballfields, in paint order: warning track, outfield turf out to a
 * bowed fence line, the infield skin, the infield turf, the mound, the foul lines and the bases.
 */
export function planBallfieldPatches(plan: CityPlan): GroundPatch[] {
  const patches: GroundPatch[] = [];
  for (const [index, field] of (plan.ballfields ?? []).entries()) {
    const s = field.size, sx = field.home.endsWith('w') ? 1 : -1, sy = field.home.startsWith('n') ? 1 : -1;
    const ox = sx > 0 ? field.x : field.x + s, oy = sy > 0 ? field.y : field.y + s;
    // Field coordinates: (0, 0) is the home corner of the square, +u and +v run along its two walls.
    const at = (u: number, v: number) => ({ x: ox + sx * u, y: oy + sy * v });
    let z = 0.012;
    const paint = (cover: CoverKind, points: readonly (readonly [number, number])[]) => {
      const poly = points.map(([u, v]) => at(u, v));
      const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      patches.push({ x, y, w: Math.max(...xs) - x, d: Math.max(...ys) - y, heading: 0, cover, seed: 7001 + index * 97 + patches.length, z, poly });
      z += 0.002;
    };
    const box = (cover: CoverKind, u: number, v: number, half: number) => paint(cover, [[u - half, v - half], [u + half, v - half], [u + half, v + half], [u - half, v + half]]);
    const track = s * 0.05, plate = s * 0.14, base = s * 0.3, line = Math.max(0.09, s * 0.006);
    const fence = s - plate - track;
    const arc = (radius: (share: number) => number): [number, number][] => Array.from({ length: FIELD_ARC + 1 }, (_, i) => {
      const share = i / FIELD_ARC, a = share * Math.PI / 2;
      // Never past the warning track: the bow flattens against the wall near the foul poles.
      return [Math.min(s - track, plate + Math.cos(a) * radius(share)), Math.min(s - track, plate + Math.sin(a) * radius(share))];
    });
    paint('dirt', [[0, 0], [s, 0], [s, s], [0, s]]);
    // The fence bows out toward centre field.
    paint('grass', [[track, track], [plate + fence, track], ...arc(share => fence * (1 + 0.2 * Math.sin(share * Math.PI))), [track, plate + fence]]);
    paint('dirt', [[plate - s * 0.06, plate - s * 0.06], [plate + base * 1.5, plate - s * 0.06], ...arc(() => base * 1.5), [plate - s * 0.06, plate + base * 1.5]]);
    paint('grass', [[plate + base * 0.13, plate + base * 0.13], [plate + base * 0.87, plate + base * 0.13], [plate + base * 0.87, plate + base * 0.87], [plate + base * 0.13, plate + base * 0.87]]);
    paint('dirt', Array.from({ length: 8 }, (_, i): [number, number] => [plate + base / 2 + Math.cos(i / 8 * Math.PI * 2) * s * 0.045, plate + base / 2 + Math.sin(i / 8 * Math.PI * 2) * s * 0.045]));
    paint('concrete', [[plate, plate - line], [plate + fence, plate - line], [plate + fence, plate + line], [plate, plate + line]]);
    paint('concrete', [[plate - line, plate], [plate + line, plate], [plate + line, plate + fence], [plate - line, plate + fence]]);
    for (const [u, v] of [[0, 0], [base, 0], [base, base], [0, base]] as const) box('concrete', plate + u, plate + v, s * 0.016);
    box('concrete', plate + base / 2, plate + base / 2, s * 0.01);
  }
  return patches;
}

const GROUND_SALT = 0x9d5e7;

/** Surface classifier for the plan: water, park lawn, a rail line's ballast, or the plan's open ground. */
export function planSurfaceAt(plan: CityPlan): (x: number, y: number) => TerrainSurface {
  const land = plan.land.map(toPoly);
  const water = (plan.water ?? []).map(toPoly);
  const ground = plan.ground?.length ? plan.ground : undefined;
  return (x, y) => {
    if (!land.some(ring => pointInPoly(x, y, ring))) return 'water';
    if (water.some(ring => pointInPoly(x, y, ring))) return 'water';
    const park = planParkAt(plan, x, y);
    if (park) return park.cover ?? 'grass';
    if (onPlanRailBed(plan, x, y)) return 'gravel';
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
