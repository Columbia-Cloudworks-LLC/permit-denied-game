import { describe, expect, it } from 'vitest';
import { ParticlePool } from '../fx/particles';
import { SIM_DT } from '../game/constants';
import { applyRailHits } from '../sim/railImpact';
import { createBuildingFromArchetype } from '../structure/building';
import { cellPresent, type WorldEvent } from '../structure/types';
import { createTown } from '../world/town';
import { vehicleDefinition } from './definitions';
import { createDozer, type Dozer } from './dozer';
import { placeRailCars, railCarSlots, type RailLine } from './rail';
import { RAIL } from './runtime';
import { stepVehicleWorld } from './world';

const LINE: RailLine = { axis: 'x', at: 20, from: 4, to: 60, consists: [{ at: 10, cars: ['boxcar', 'tank-car', 'boxcar', 'tank-car', 'freight-locomotive'] }] };

function yard(line: RailLine = LINE) {
  const town = createTown();
  town.buildings = []; town.props = []; town.rubble = []; town.roadCar = null;
  town.minX = 0; town.minY = 0; town.maxX = 80; town.maxY = 60;
  town.vehicles = placeRailCars([line]);
  return { town, cars: town.vehicles, particles: new ParticlePool(), events: [] as WorldEvent[] };
}

/** Drive a dozer at a steady velocity for `seconds`, whatever it runs into; returns the cash paid. */
function drive(world: ReturnType<typeof yard>, dozer: Dozer, vx: number, vy: number, seconds: number): number {
  let cash = 0;
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    dozer.vx = vx; dozer.vy = vy;
    dozer.x += vx * SIM_DT; dozer.y += vy * SIM_DT;
    cash += stepVehicleWorld(world.town, dozer, world.particles, world.events, SIM_DT);
    cash += applyRailHits(world.town, world.particles, world.events);
  }
  return cash;
}

describe('rail cars', () => {
  it('are plate-steel rolling stock the dozer cannot crush', () => {
    for (const id of ['freight-locomotive', 'boxcar', 'tank-car']) {
      const d = vehicleDefinition(id);
      expect(d.family).toBe('rail');
      expect(d.crushable).toBe(false);
      expect(d.mass).toBeGreaterThan(10);
      expect(d.parts[1]!.role).toBe('engine');
      expect(d.parts.filter(part => part.role === 'wheel')).toHaveLength(4);
    }
  });

  it('park end to end on their line, facing along it, without touching', () => {
    const { cars } = yard();
    const slots = railCarSlots(LINE);
    expect(cars).toHaveLength(5);
    cars.forEach((car, index) => {
      expect(car.definitionId).toBe(LINE.consists[0]!.cars[index]);
      expect(car.y).toBe(LINE.at);
      expect(car.x).toBeCloseTo(slots[index]!.along, 9);
      expect(car.heading).toBe(0);
      expect(car.rail).toMatchObject({ axis: 'x', at: 20, derailed: false });
      if (index) expect(car.x - slots[index]!.length / 2 - (cars[index - 1]!.x + slots[index - 1]!.length / 2)).toBeCloseTo(RAIL.gap, 9);
    });
    expect(placeRailCars([{ ...LINE, axis: 'y' }])[0]).toMatchObject({ x: LINE.at, heading: Math.PI / 2 });
  });

  it('stay on the rails under a slow push and settle back on the centre line', () => {
    const world = yard(), car = world.cars[2]!;
    const dozer = createDozer(car.x, LINE.at + 2.2, -Math.PI / 2);
    drive(world, dozer, 0, -1, 2.5);
    expect(car.rail!.derailed).toBe(false);
    expect(Math.abs(car.y - LINE.at)).toBeLessThan(RAIL.throw);
    expect(car.heading).toBe(0);
    // Back the dozer off: the flanges pull the car home.
    dozer.y = LINE.at + 8;
    drive(world, dozer, 0, 0, 1.5);
    expect(car.y).toBeCloseTo(LINE.at, 2);
    expect(world.cars.every(other => !other.rail!.derailed)).toBe(true);
  });

  it('roll along the line when shoved from the end, and stop at the end of the track', () => {
    const world = yard({ ...LINE, consists: [{ at: 40, cars: ['boxcar'] }] }), car = world.cars[0]!;
    const start = car.x;
    drive(world, createDozer(car.x - 5, LINE.at, 0), 4, 0, 6);
    expect(car.rail!.derailed).toBe(false);
    expect(car.x).toBeGreaterThan(start + 3);
    expect(car.y).toBeCloseTo(LINE.at, 6);
    expect(car.x).toBeLessThanOrEqual(LINE.to - vehicleDefinition('boxcar').length / 2 + 1e-9);
  });

  it('derail when rammed from the side, pay once, and drag their coupled neighbours off', () => {
    const world = yard(), car = world.cars[2]!;
    const cash = drive(world, createDozer(car.x, LINE.at + 3, -Math.PI / 2), 0, -7, 0.6);
    expect(car.rail).toMatchObject({ derailed: true, side: -1 });
    expect(car.y).toBeLessThan(LINE.at - RAIL.throw);
    // The cars coupled either side are pulled after it; the ends of the consist stay on the track.
    expect(world.cars.map(other => other.rail!.derailed)).toEqual([false, true, true, true, false]);
    expect(world.cars.filter(other => other.rail!.derailed).every(other => other.rail!.side === -1)).toBe(true);
    expect(cash).toBeGreaterThanOrEqual(RAIL.bonus * 3);
    expect(world.events.filter(event => event.kind === 'collapse')).toHaveLength(3);
    // Nothing more is owed however long the wreck is left lying.
    const later = drive(world, createDozer(70, 50, 0), 0, 0, 3);
    expect(later).toBe(0);
    // It lies over toward the side it left on, and comes to rest.
    expect(Math.abs(car.roll)).toBeGreaterThan(0.3);
    expect(Math.hypot(car.vx, car.vy)).toBeLessThan(0.1);
  });

  it('break into the wall a derailed car slides into', () => {
    const world = yard({ ...LINE, consists: [{ at: 27, cars: ['boxcar'] }] }), car = world.cars[0]!;
    const shop = createBuildingFromArchetype('corner-shop', 'SHOP', 0, 0);
    // Its south wall stands a little over two units north of the centre line.
    shop.x = car.x - shop.w * shop.cellSize / 2;
    shop.y = LINE.at - 3 - shop.d * shop.cellSize;
    world.town.buildings = [createBuildingFromArchetype('corner-shop', 'SHOP', shop.x, shop.y)];
    const wall = world.town.buildings[0]!;
    const standing = () => wall.cells.filter(cell => cell.floor === 0 && cellPresent(cell) && cell.state === 'intact').length;
    const before = standing();
    drive(world, createDozer(car.x, LINE.at + 3, -Math.PI / 2), 0, -7, 0.5);
    drive(world, createDozer(70, 50, 0), 0, 0, 2);
    expect(car.rail!.derailed).toBe(true);
    expect(standing()).toBeLessThan(before);
    expect(world.events.some(event => event.kind === 'impact')).toBe(true);
  });
});
