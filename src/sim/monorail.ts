import type { ParticlePool } from '../fx/particles';
import { distToSegment } from '../game/math';
import type { Prop, WorldEvent } from '../structure/types';
import { vehicleDefinition } from '../vehicle/definitions';
import type { Dozer } from '../vehicle/dozer';
import { createVehicle } from '../vehicle/runtime';
import { vehicleLoad } from '../vehicle/world';
import { spawnAsset } from '../world/catalog';
import { MONORAIL_BEAM, type CityPlanMonorail } from '../world/cityPlan';
import type { Town } from '../world/town';
import { destroyProp } from './assets';
import { addDebrisBody } from './debris';
import { applyMonumentImpact } from './monumentImpact';

/**
 * An elevated beamway. Each beam rests on the pylon at either end; when the dozer breaks a pylon
 * the two beams it carried drop onto the street, and any car of the parked train that was on one
 * is pitched off sideways, away from the dozer. It lands as a derailed rail car (`vehicle/rail.ts`),
 * so it slides on into the buildings beside the line and breaks their ground floors.
 */
export const MONORAIL = {
  pylon: 'monorail-pylon', car: 'monorail-car', gap: 0.3,
  /** Seconds a beam takes to come down, and the share of that the end still on its pylon hangs on. */
  fall: 0.8, hang: 0.35,
  /** Half-width of the strike under a landing beam, and what a beam pays. */
  strike: 0.9, beamBonus: 120,
  /** How far beside the line a car lands, the speed it is thrown at, and what it pays. */
  offset: 1.5, kick: 15, carBonus: 400,
} as const;

export interface MonorailSpan {
  from: number;
  to: number;
  phase: 'up' | 'falling' | 'down';
  /** Seconds since it let go. */
  t: number;
  /** Which end lost its pylon first: -1 the low end, 1 the high end, 0 both. */
  lost: -1 | 0 | 1;
}

export interface MonorailCar {
  along: number;
  length: number;
  /** The beam it stands on. */
  span: number;
  phase: 'riding' | 'falling' | 'down';
  t: number;
  /** The side it is pitched off to: +1 south or east, -1 north or west. */
  side: number;
}

export interface MonorailState {
  line: CityPlanMonorail;
  /** One prop per pylon, in the line's order. */
  pylons: Prop[];
  /** Beam `k` runs from pylon `k` to pylon `k + 1`. */
  spans: MonorailSpan[];
  cars: MonorailCar[];
}

/** A point on the line at `along`, `across` units to its south or east side. */
export const monorailPoint = (line: CityPlanMonorail, along: number, across = 0): { x: number; y: number } =>
  line.axis === 'x' ? { x: along, y: line.at + across } : { x: line.at + across, y: along };

/** Where each car of the line's parked train stands: its centre along the line and its length. */
export function monorailCarSlots(line: CityPlanMonorail): { along: number; length: number }[] {
  const length = vehicleDefinition(MONORAIL.car).length;
  return Array.from({ length: line.train?.cars ?? 0 }, (_, i) => ({ along: line.train!.at + i * (length + MONORAIL.gap) + length / 2, length }));
}

/** Stand a line's pylons and park its train. The town adds the pylons to its props. */
export function buildMonorail(line: CityPlanMonorail): MonorailState {
  const pylons = line.pylons.map(along => {
    const at = monorailPoint(line, along);
    const prop = spawnAsset(MONORAIL.pylon, 0, 0, line.axis === 'x' ? 0 : Math.PI / 2);
    prop.x = at.x - prop.w / 2;
    prop.y = at.y - prop.d / 2;
    return prop;
  });
  const spans = line.pylons.slice(0, -1).map((from, k): MonorailSpan => ({ from, to: line.pylons[k + 1]!, phase: 'up', t: 0, lost: 0 }));
  const cars = monorailCarSlots(line).map((slot): MonorailCar => ({
    ...slot, span: Math.max(0, spans.findIndex(span => slot.along <= span.to)), phase: 'riding', t: 0, side: 1,
  }));
  return { line, pylons, spans, cars };
}

/** How high each end of a beam is: `MONORAIL_BEAM.height` standing, 0 on the ground. The end that lost its pylon leads. */
export function monorailSpanEnds(span: MonorailSpan): { low: number; high: number } {
  if (span.phase === 'up') return { low: MONORAIL_BEAM.height, high: MONORAIL_BEAM.height };
  if (span.phase === 'down') return { low: 0, high: 0 };
  const drop = (delay: number) => {
    const p = Math.min(1, Math.max(0, (span.t / MONORAIL.fall - delay) / (1 - delay)));
    return MONORAIL_BEAM.height * (1 - p * p);
  };
  return { low: drop(span.lost === 1 ? MONORAIL.hang : 0), high: drop(span.lost === -1 ? MONORAIL.hang : 0) };
}

/** Drop the beams whose pylons are gone, land the ones that are falling, and throw down the cars on them. Returns the cash paid. */
export function stepMonorails(town: Town, dozer: Dozer, dt: number, particles: ParticlePool, events: WorldEvent[]): number {
  let cash = 0;
  for (const state of town.monorails ?? []) {
    const { line } = state;
    state.spans.forEach((span, k) => {
      if (span.phase === 'up') {
        const low = state.pylons[k]!.broken, high = state.pylons[k + 1]!.broken;
        if (!low && !high) return;
        span.phase = 'falling';
        span.t = 0;
        span.lost = low && high ? 0 : low ? -1 : 1;
        // Cars go over on the side away from the dozer; from dead under the beam, toward the camera.
        const across = line.axis === 'x' ? dozer.y - line.at : dozer.x - line.at;
        for (const car of state.cars) if (car.span === k && car.phase === 'riding') Object.assign(car, { phase: 'falling', t: 0, side: across > 0.4 ? -1 : 1 });
        const at = monorailPoint(line, low ? span.from : span.to);
        events.push({ kind: 'snap', x: at.x, y: at.y, z: MONORAIL_BEAM.height, mag: 1.6, material: 'concrete' });
        town.visualRevision++;
        return;
      }
      if (span.phase !== 'falling') return;
      span.t += dt;
      if (span.t >= MONORAIL.fall) cash += landSpan(town, dozer, line, span, particles, events);
    });
    for (const car of state.cars) {
      if (car.phase !== 'falling') continue;
      car.t += dt;
      if (car.t >= MONORAIL.fall) landCar(town, line, car, particles, events);
    }
  }
  return cash;
}

/** A beam hits the street: it breaks into lengths of concrete, flattens the props and loads the traffic under it, and strikes the dozer. */
function landSpan(town: Town, dozer: Dozer, line: CityPlanMonorail, span: MonorailSpan, particles: ParticlePool, events: WorldEvent[]): number {
  span.phase = 'down';
  town.visualRevision++;
  const a = monorailPoint(line, span.from), c = monorailPoint(line, span.to), length = span.to - span.from;
  const pieces = Math.max(2, Math.round(length / 2.6)), heading = line.axis === 'x' ? 0 : Math.PI / 2;
  let cash = MONORAIL.beamBonus;
  for (let i = 0; i < pieces; i++) {
    const at = monorailPoint(line, span.from + (i + 0.5) * length / pieces, (i % 2 ? 1 : -1) * 0.18);
    addDebrisBody(town, {
      x: at.x, y: at.y, w: length / pieces * 0.9, d: MONORAIL_BEAM.half * 2, thickness: MONORAIL_BEAM.depth * 0.8,
      material: 'concrete', layer: 'remnant', shape: 'beam', heading: heading + (i % 2 ? 0.12 : -0.1), mass: 4, seed: i,
    });
    particles.radialDust(at.x, at.y, 1.2, 6);
    vehicleLoad(town, at.x, at.y, MONORAIL_BEAM.height, MONORAIL.strike + 0.4, 6, `beam:${span.from}`);
  }
  for (const prop of town.props) {
    if (prop.broken || prop.assetId === MONORAIL.pylon) continue;
    if (distToSegment(prop.x + prop.w / 2, prop.y + prop.d / 2, a.x, a.y, c.x, c.y) > MONORAIL.strike) continue;
    cash += destroyProp(town, prop, particles, events, (a.x + c.x) / 2, (a.y + c.y) / 2);
  }
  applyMonumentImpact(dozer, { x0: a.x, y0: a.y, x1: c.x, y1: c.y, radius: MONORAIL.strike }, events);
  const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
  events.push({ kind: 'collapse', x: mid.x, y: mid.y, z: 0, mag: 1.9 });
  events.push({ kind: 'cash', x: mid.x, y: mid.y, z: 1.5, mag: 1.4, cash: MONORAIL.beamBonus });
  return cash;
}

/** A car lands beside the line on its side and slides on: from here it is a derailed rail car. */
function landCar(town: Town, line: CityPlanMonorail, car: MonorailCar, particles: ParticlePool, events: WorldEvent[]): void {
  car.phase = 'down';
  town.visualRevision++;
  const at = monorailPoint(line, car.along, car.side * MONORAIL.offset), heading = line.axis === 'x' ? 0 : Math.PI / 2;
  const v = createVehicle(MONORAIL.car, at.x, at.y, heading, 0);
  v.rail = { axis: line.axis, at: line.at, from: line.pylons[0]!, to: line.pylons[line.pylons.length - 1]!, heading, derailed: true, side: car.side };
  if (line.axis === 'x') v.vy = car.side * MONORAIL.kick; else v.vx = car.side * MONORAIL.kick;
  v.omega = (Math.round(car.along) % 2 ? 1 : -1) * 0.9;
  v.sleeping = false;
  v.pendingCash += MONORAIL.carBonus;
  v.yardOwner = town.debrisOwnerAt?.(v.x, v.y);
  town.vehicles.push(v);
  particles.burst('metal', at.x, at.y, 0.6, 1);
  particles.radialDust(at.x, at.y, 1.6, 10);
  events.push({ kind: 'collapse', x: at.x, y: at.y, z: 0, mag: 1.6 });
  events.push({ kind: 'snap', x: at.x, y: at.y, z: 0.5, mag: 1.5, material: 'metal' });
}
