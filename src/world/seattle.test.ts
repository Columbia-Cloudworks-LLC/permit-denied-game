import { describe, expect, it } from 'vitest';
import { ParticlePool } from '../fx/particles';
import { SIM_DT } from '../game/constants';
import { aabbOverlap } from '../game/math';
import { ferryWaterCommands, monorailPieces } from '../render/cityDecor';
import { MONORAIL, monorailCarSlots, monorailPoint, monorailSpanEnds } from '../sim/monorail';
import { stepWorld } from '../sim/worldSim';
import { cellPresent } from '../structure/types';
import { vehicleDefinition } from '../vehicle/definitions';
import { createDozer, stepDozer, type Dozer } from '../vehicle/dozer';
import { FERRY_ID } from '../vehicle/ferry';
import { FERRY } from '../vehicle/runtime';
import { biomeById } from './biomes';
import { boxUnderPlanMonorail, MONORAIL_BEAM, monorailBox, planDecor } from './cityPlan';
import { CITY_PLANS } from './cityPlans';
import { climateById } from './climate';
import { countyAt, countyEnvironment } from './counties';
import { regionalPlacement } from './regionalCatalog';
import { regionById } from './regions';
import { aabbOverlapsRoad } from './roads';
import { surfaceAt, traversalAt } from './terrain';
import { createTown, type Town } from './town';

const plan = CITY_PLANS['US-WA']!;
const line = plan.monorails![0]!;

function seattle(): Town {
  const region = regionById('US-WA')!, county = countyAt('US-WA', 6)!, environment = countyEnvironment(region, 6);
  return createTown({
    district: 'd30', seed: county.seed, campaign: county.level,
    biome: biomeById(environment.biomeId), climate: climateById(environment.climateId), regional: regionalPlacement(region, 6),
  });
}

/** Drive the dozer flat out, blade down, on its heading for `seconds`. Returns the cash the world paid. */
function drive(town: Town, dozer: Dozer, seconds: number, until: () => boolean = () => false): number {
  const particles = new ParticlePool();
  let cash = 0;
  for (let i = 0; i < Math.round(seconds / SIM_DT) && !until(); i++) {
    stepDozer(dozer, { throttle: 1, steer: 0, blade: true }, SIM_DT);
    cash += stepWorld(town, dozer, particles, SIM_DT).cash;
  }
  return cash;
}

/** Let the world run with the dozer parked. */
function wait(town: Town, dozer: Dozer, seconds: number): number {
  const particles = new ParticlePool();
  let cash = 0;
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    stepDozer(dozer, { throttle: 0, steer: 0, blade: true }, SIM_DT);
    cash += stepWorld(town, dozer, particles, SIM_DT).cash;
  }
  return cash;
}

const footprint = (town: Town, id: string) => {
  const b = town.buildings.find(entry => entry.archetypeId === id)!;
  return { x: b.x, y: b.y, w: b.w * b.cellSize, d: b.d * b.cellSize };
};

describe('Seattle', () => {
  const town = seattle();

  it('stands the Needle over Seattle Center as the objective, with the bay to the west', () => {
    const needle = town.buildings.find(entry => entry.campaignLandmark)!;
    expect(needle.archetypeId).toBe('saucer-needle-tower');
    expect(needle.monument?.definition).toMatchObject({ figure: 'space-needle' });
    // Taller than anything the fill can build beside it.
    expect(needle.monument!.definition.height).toBeGreaterThan(40);
    expect(town.buildings.find(entry => entry.archetypeId === 'science-center-arches')!.monument?.definition.figure).toBe('arches');
    expect(town.buildings.find(entry => entry.archetypeId === 'waterfront-great-wheel')!.monument?.definition.figure).toBe('wheel');
    const seawall = plan.land[0]![0]![0];
    for (const y of [20, 80, 120, 150, 180, 210]) expect(surfaceAt(town.surface, seawall - 3, y), `bay at ${y}`).toBe('water');
    // Seattle Center is north of Denny Way; Pioneer Square and the market are south of it, the market by the water.
    const denny = plan.streets.find(street => street.axis === 'x' && street.roadClass === 'commercial')!.at;
    for (const id of ['saucer-needle-tower', 'science-center-arches', 'garden-glasshouse']) expect(footprint(town, id).y + footprint(town, id).d, id).toBeLessThan(denny);
    expect(footprint(town, 'smith-pyramid-tower').y).toBeGreaterThan(footprint(town, 'public-market-arcade').y);
    expect(footprint(town, 'public-market-arcade').x).toBeLessThan(plan.streets.filter(street => street.axis === 'y')[1]!.at);
  });

  it('builds a shed or a wheel on each finger pier, with water either side', () => {
    for (const id of ['aquarium-pier-shed', 'waterfront-great-wheel', 'curiosity-pier-shed', 'colman-ferry-terminal']) {
      const at = footprint(town, id);
      expect(at.x + at.w, id).toBeLessThan(plan.land[0]![0]![0] + 1.5);
      expect(surfaceAt(town.surface, at.x + at.w / 2, at.y - 2), `${id} north slip`).toBe('water');
      // The pier's street runs along its south side, between the shed and the next slip.
      expect(aabbOverlapsRoad(town.network, at.x, at.y + at.d + 1, at.w, 3), `${id} street`).toBe(true);
    }
  });

  it('carries the monorail down the middle of 5th Avenue on pylons clear of every crossing', () => {
    expect(town.monorails).toHaveLength(1);
    const state = town.monorails![0]!;
    expect(state.pylons).toHaveLength(line.pylons.length);
    expect(state.spans).toHaveLength(line.pylons.length - 1);
    const avenue = plan.streets.find(street => street.axis === line.axis && street.at === line.at)!;
    expect(avenue.roadClass).toBe('arterial');
    for (const [k, pylon] of state.pylons.entries()) {
      expect(pylon.assetId).toBe(MONORAIL.pylon);
      expect(town.props).toContain(pylon);
      const at = monorailPoint(line, line.pylons[k]!);
      expect(pylon.x + pylon.w / 2).toBeCloseTo(at.x, 6);
      expect(pylon.y + pylon.d / 2).toBeCloseTo(at.y, 6);
      expect(traversalAt(town.surface, at.x, at.y)).toBe('open');
      // South of Denny Way every pylon stands in the avenue's median.
      if (line.pylons[k]! > avenue.from) expect(aabbOverlapsRoad(town.network, at.x - 0.2, at.y - 0.2, 0.4, 0.4), `pylon ${k} in the avenue`).toBe(true);
      for (const cross of plan.streets.filter(street => street.axis !== line.axis && street.from <= line.at && street.to >= line.at)) {
        expect(Math.abs(cross.at - line.pylons[k]!), `pylon ${k} at the ${cross.at} crossing`).toBeGreaterThan(4);
      }
    }
    // No beam is longer than its concrete could span, and nothing is built under the line.
    for (const span of state.spans) expect(span.to - span.from).toBeLessThanOrEqual(12);
    const under = monorailBox(line, MONORAIL_BEAM.half);
    for (const building of town.buildings) {
      expect(aabbOverlap(under.x, under.y, under.w, under.d, building.x, building.y, building.w * building.cellSize, building.d * building.cellSize), `${building.archetypeId} under the beam`).toBe(false);
    }
    expect(boxUnderPlanMonorail(plan, { x: line.at - 0.5, y: 36, w: 1, d: 1 })).toBe(true);
    expect(boxUnderPlanMonorail(plan, { x: line.at + 6, y: 36, w: 4, d: 4 })).toBe(false);
    // The train is parked whole on the beam, each car on a beam of its own or shared.
    const slots = monorailCarSlots(line);
    expect(state.cars).toHaveLength(line.train!.cars);
    state.cars.forEach((car, index) => {
      expect(car.along).toBeCloseTo(slots[index]!.along, 9);
      expect(car.along - car.length / 2).toBeGreaterThan(line.pylons[0]!);
      expect(car.along + car.length / 2).toBeLessThan(line.pylons[line.pylons.length - 1]!);
      expect(state.spans[car.span]!.from).toBeLessThanOrEqual(car.along);
      expect(state.spans[car.span]!.to).toBeGreaterThanOrEqual(car.along);
    });
    expect(monorailPieces(state, () => false).length).toBeGreaterThan(state.spans.length + state.cars.length);
  });

  it('moors a ferry against the south side of three piers, across a slip from the next', () => {
    const ferries = town.vehicles.filter(vehicle => vehicle.afloat);
    expect(ferries).toHaveLength(plan.ferries!.length);
    const hull = vehicleDefinition(FERRY_ID);
    for (const ferry of ferries) {
      expect(ferry.definitionId).toBe(FERRY_ID);
      expect(ferry.afloat).toMatchObject({ moored: true, x: ferry.x, y: ferry.y });
      expect(surfaceAt(town.surface, ferry.x, ferry.y)).toBe('water');
      // Its north rail lies just over the pier's edge, where the blade can reach it; its south rail faces open water.
      expect(surfaceAt(town.surface, ferry.x, ferry.y - hull.width / 2 - 0.2)).not.toBe('water');
      expect(surfaceAt(town.surface, ferry.x, ferry.y - hull.width / 2 + 0.6)).toBe('water');
      for (let off = 1; off < 11; off++) expect(surfaceAt(town.surface, ferry.x, ferry.y + hull.width / 2 + off), `slip ${off} south of ${ferry.y}`).toBe('water');
      expect(surfaceAt(town.surface, ferry.x, ferry.y + hull.width / 2 + 13.5)).not.toBe('water');
      expect(ferryWaterCommands(ferry)).toEqual([]);
    }
    expect(planDecor(plan)!.ferries).toEqual(plan.ferries);
    for (const regionId of ['US-IL', 'US-NE', 'US-NV', 'US-NY', 'US-WI']) {
      expect(CITY_PLANS[regionId]!.monorails).toBeUndefined();
      expect(CITY_PLANS[regionId]!.ferries).toBeUndefined();
    }
  });
});

describe('Seattle monorail', () => {
  it('drops both beams off a broken pylon and pitches the cars on them into the street', () => {
    const town = seattle(), state = town.monorails![0]!;
    // The pylon between the third and fourth cars.
    const k = line.pylons.indexOf(98.5), pylon = state.pylons[k]!;
    const before = town.vehicles.length;
    const dozer = createDozer(line.at, line.pylons[k]! - 5, Math.PI / 2);
    let cash = drive(town, dozer, 8, () => pylon.broken);
    expect(pylon.broken).toBe(true);
    cash += wait(town, dozer, 0.1);
    expect(state.spans[k - 1]!.phase).toBe('falling');
    expect(state.spans[k]!.phase).toBe('falling');
    // Each hangs from the pylon it still has: the end over the broken one leads.
    expect(monorailSpanEnds(state.spans[k - 1]!).high).toBeLessThan(monorailSpanEnds(state.spans[k - 1]!).low);
    expect(monorailSpanEnds(state.spans[k]!).low).toBeLessThan(monorailSpanEnds(state.spans[k]!).high);
    const falling = state.cars.filter(car => car.phase === 'falling');
    expect(falling.map(car => car.span).sort()).toEqual([k - 1, k]);
    const rubble = town.rubble.length;
    cash += wait(town, dozer, MONORAIL.fall + 0.1);
    expect(state.spans[k - 1]!.phase).toBe('down');
    expect(state.spans[k]!.phase).toBe('down');
    expect(town.rubble.length).toBeGreaterThan(rubble + 3);
    // The neighbouring beams and the cars on them are untouched.
    expect(state.spans[k - 2]!.phase).toBe('up');
    expect(state.spans[k + 1]!.phase).toBe('up');
    expect(state.cars.filter(car => car.phase === 'riding')).toHaveLength(line.train!.cars - 2);
    const fallen = town.vehicles.slice(before).filter(vehicle => vehicle.definitionId === MONORAIL.car);
    expect(fallen).toHaveLength(2);
    for (const car of fallen) expect(car.rail).toMatchObject({ derailed: true });
    cash += wait(town, dozer, 3);
    for (const car of fallen) expect(Math.abs(car.x - line.at), 'slid off the line').toBeGreaterThan(MONORAIL.offset);
    expect(cash).toBeGreaterThanOrEqual(2 * MONORAIL.beamBonus + 2 * MONORAIL.carBonus);
    // A car that slid across the avenue broke into the ground floor of a building on it.
    const breached = town.buildings.filter(b => b.cells.some(cell => cell.floor === 0 && !cellPresent(cell)));
    expect(breached.length).toBeGreaterThan(0);
    for (const b of breached) expect(Math.abs(b.x - line.at)).toBeLessThan(14);
  });

  it('leaves the beamway standing while its pylons stand', () => {
    const town = seattle(), state = town.monorails![0]!;
    const dozer = createDozer(town.spawnX, town.spawnY, town.spawnHeading);
    expect(wait(town, dozer, 2)).toBe(0);
    expect(state.spans.every(span => span.phase === 'up')).toBe(true);
    expect(state.cars.every(car => car.phase === 'riding')).toBe(true);
  });
});

describe('Seattle ferries', () => {
  it('holds its berth against a nudge and is cast loose by a ram, to cross the slip and break the next pier', () => {
    const town = seattle();
    const ferry = town.vehicles.filter(vehicle => vehicle.afloat).sort((a, c) => a.y - c.y)[0]!, seat = ferry.afloat!;
    const wheel = town.buildings.find(entry => entry.archetypeId === 'waterfront-great-wheel')!;
    const standing = () => wheel.cells.filter(cell => cell.floor === 0 && cellPresent(cell)).length;
    const whole = standing();
    // Ram it from the pier's street, heading south.
    const dozer = createDozer(ferry.x - 3, seat.y - 6.5, Math.PI / 2);
    let cash = drive(town, dozer, 6, () => !seat.moored);
    expect(seat.moored).toBe(false);
    expect(cash).toBeGreaterThanOrEqual(FERRY.bonus);
    expect(ferry.vy).toBeGreaterThanOrEqual(FERRY.kick * 0.9);
    expect(ferryWaterCommands(ferry).length).toBeGreaterThan(0);
    // The dozer stays ashore.
    let struck = false;
    for (let i = 0; i < 10 / SIM_DT; i++) {
      cash += wait(town, dozer, SIM_DT);
      struck ||= !!seat.splash;
      expect(traversalAt(town.surface, ferry.x, ferry.y)).toBe('water');
      expect(traversalAt(town.surface, dozer.x, dozer.y)).toBe('open');
    }
    expect(struck).toBe(true);
    expect(ferry.y - seat.y).toBeGreaterThan(10);
    // The Great Wheel's plinth took the blow, and the wheel came down with it.
    expect(standing()).toBeLessThan(whole / 2);
    expect(wheel.monument!.phase).not.toBe('standing');
  });
});
