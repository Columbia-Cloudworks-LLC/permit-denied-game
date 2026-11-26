import type { ParticlePool } from '../fx/particles';
import type { WorldEvent } from '../structure/types';
import { vehicleDefinition } from './definitions';
import { createVehicle, RAIL } from './runtime';
import type { VehicleState } from './types';

/**
 * Freight cars standing on a rail line. A car on the rails rolls along its line and resists
 * everything else, so a slow push only leans on it. Shoved hard enough from the side it leaves the
 * track: it is thrown clear, lies over, drags the cars coupled to it along, and breaks into
 * whatever wall it slides into (`sim/railImpact.ts`). After that it is an ordinary heavy wreck.
 */

/** One rail line and the cars parked on it, as a city plan authors them. */
export interface RailLine {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
  /** Each consist starts at `at` along the line and is laid toward `to`, in the order listed. */
  consists: readonly { at: number; cars: readonly string[] }[];
}

/** Where each car of a line's consists stands: centre along the line and the car's length. */
export function railCarSlots(line: RailLine): { id: string; along: number; length: number }[] {
  const slots: { id: string; along: number; length: number }[] = [];
  for (const consist of line.consists) {
    let cursor = consist.at;
    for (const id of consist.cars) {
      const length = vehicleDefinition(id).length;
      slots.push({ id, along: cursor + length / 2, length });
      cursor += length + RAIL.gap;
    }
  }
  return slots;
}

/** Park every car of the given lines on its track, facing along it. */
export function placeRailCars(lines: readonly RailLine[]): VehicleState[] {
  const cars: VehicleState[] = [];
  for (const line of lines) {
    const heading = line.axis === 'x' ? 0 : Math.PI / 2;
    railCarSlots(line).forEach((slot, index) => {
      const car = line.axis === 'x' ? createVehicle(slot.id, slot.along, line.at, heading, index) : createVehicle(slot.id, line.at, slot.along, heading, index);
      car.rail = { axis: line.axis, at: line.at, from: line.from, to: line.to, heading, derailed: false, side: 0 };
      cars.push(car);
    });
  }
  return cars;
}

const along = (v: VehicleState): number => v.rail!.axis === 'x' ? v.x : v.y;
const across = (v: VehicleState): number => v.rail!.axis === 'x' ? v.y - v.rail!.at : v.x - v.rail!.at;

/** Hold every car that is still on its rails to its line, and derail the ones shoved too far off it. */
export function stepRailCars(town: { vehicles: VehicleState[] }, dt: number, particles: ParticlePool, events: WorldEvent[]): void {
  for (const v of town.vehicles) {
    const seat = v.rail;
    if (!seat || seat.derailed) continue;
    const off = across(v);
    if (Math.abs(off) > RAIL.throw) {
      derail(town.vehicles, v, Math.sign(off), Math.max(RAIL.kick, Math.abs(seat.axis === 'x' ? v.vy : v.vx)), particles, events);
      continue;
    }
    // The flanges give a little and pull back; the car cannot turn or slide while they hold.
    const eased = seat.at + off * Math.exp(-RAIL.grip * dt), half = vehicleDefinition(v.definitionId).length / 2;
    const run = Math.min(seat.to - half, Math.max(seat.from + half, along(v))), stopped = run !== along(v);
    if (seat.axis === 'x') { v.y = eased; v.vy = 0; v.x = run; if (stopped) v.vx = 0; }
    else { v.x = eased; v.vx = 0; v.y = run; if (stopped) v.vy = 0; }
    v.heading = seat.heading;
    v.omega = 0;
  }
}

/** Throw a car off its track toward `side` at `speed`, and pull its coupled neighbours after it. */
function derail(cars: readonly VehicleState[], v: VehicleState, side: number, speed: number, particles: ParticlePool, events: WorldEvent[]): void {
  const seat = v.rail!;
  seat.derailed = true;
  seat.side = side;
  if (seat.axis === 'x') v.vy = side * speed; else v.vx = side * speed;
  // Cars jack-knife alternately, so a dragged consist folds instead of sliding off as one bar.
  v.omega = (v.id % 2 ? 1 : -1) * speed * 0.14;
  v.sleeping = false;
  v.rest = 0;
  v.revision++;
  v.pendingCash += RAIL.bonus;
  particles.burst('metal', v.x, v.y, 0.6, 0.6, v.yardOwner);
  events.push({ kind: 'collapse', x: v.x, y: v.y, z: 0, mag: 1 + speed * 0.08 });
  const pull = speed * RAIL.chain;
  if (pull < RAIL.chainMin) return;
  const length = vehicleDefinition(v.definitionId).length;
  for (const other of cars) {
    const next = other.rail;
    if (!next || next.derailed || next.axis !== seat.axis || next.at !== seat.at) continue;
    const reach = (length + vehicleDefinition(other.definitionId).length) / 2 + RAIL.coupling;
    if (Math.abs(along(other) - along(v)) <= reach) derail(cars, other, side, pull, particles, events);
  }
}

/** Remember the hardest wall a derailed car struck this step. */
export function noteRailHit(v: VehicleState, x: number, y: number, nx: number, ny: number, impulse: number): void {
  const seat = v.rail!;
  if (!seat.hit || impulse > seat.hit.impulse) seat.hit = { x, y, nx, ny, impulse };
}
