import { createBuildingFromArchetype } from '../structure/building';
import type { Building } from '../structure/types';
import { PileField } from '../sim/pile';
import { invalidateWorldCollision } from '../sim/worldSim';
import { createVehicle } from '../vehicle/runtime';
import { vehicleDefinition } from '../vehicle/definitions';
import type { VehicleState } from '../vehicle/types';
import type { ParticlePool } from '../fx/particles';
import { spawnAsset } from './catalog';
import { emptyTerrain } from './roads';
import { emptyGrassGrid } from './terrain';
import { testVehicleImpact } from './testYard';
import type { HomeYardLayout, HomeZone, Town } from './town';

/**
 * The Home Yard: the player's own construction yard between county runs. One fixed lot, not a
 * town: a service depot with the Heavy Shop apron, a fenced proving ground of respawning test
 * lanes, a lowboy rig at the gate for dispatch, and a trophy lot that fills with county clears.
 *
 * x runs east, y runs south. Range tiers widen the lot to the east.
 */
export interface HomeYardOptions {
  yardTier: number;
  countiesCleared: number;
  lifetimeEarned: number;
}

const BASE_W = 96;
const H = 72;
const LANE_Y = 42;
const LANE_D = 26;

/** Which lane (or the shop) owns each yard building; buildings carry no owner field of their own. */
const owners = new WeakMap<Building, string>();

const PAD = { apron: 0xf2c218, reset: 0x3fb6e8, lowboy: 0xe8743f, trophy: 0xc9b27a } as const;

interface LaneSpec { key: string; label: string; x: number; w: number; tier: number; fill: (town: Town, zone: HomeZone, key: string) => void }

function lanes(): LaneSpec[] {
  return [
    { key: 'lane:A', label: 'LANE A · TIMBER', x: 4, w: 20, tier: 0, fill: (t, z, k) => building(t, z, k, 'cottage', 'TEST SHED') },
    { key: 'lane:B', label: 'LANE B · MASONRY', x: 26, w: 20, tier: 0, fill: (t, z, k) => building(t, z, k, 'corner-shop', 'TEST WALL') },
    { key: 'lane:C', label: 'LANE C · HEAVY CORE', x: 48, w: 20, tier: 0, fill: (t, z, k) => building(t, z, k, 'pump-house', 'TEST BUNKER') },
    { key: 'lane:D', label: 'LANE D · HEAVY IRON', x: 70, w: 22, tier: 0, fill: (t, z, k) => {
      vehicle(t, k, 'tractor-trailer', z.x + 9, z.y + 9, 0);
      vehicle(t, k, 'combine', z.x + 12, z.y + 19, Math.PI);
    } },
    { key: 'lane:E', label: 'LANE E · TOWERS', x: 96, w: 30, tier: 1, fill: (t, z, k) => {
      building(t, { ...z, w: z.w / 2 }, k, 'elevated-water-tower', 'TEST TOWER');
      building(t, { ...z, x: z.x + z.w / 2, w: z.w / 2 }, k, 'grain-elevator', 'TEST ELEVATOR');
    } },
    { key: 'lane:F', label: 'PAD F · OFFICE SLAB', x: 128, w: 34, tier: 2, fill: (t, z, k) => building(t, z, k, 'office-slab-eight', 'TEST SLAB') },
  ];
}

function laneZone(spec: LaneSpec): HomeZone & { key: string; label: string } {
  return { x: spec.x, y: LANE_Y, w: spec.w, d: LANE_D, key: spec.key, label: spec.label };
}

/** Center a building in its zone; the owner key lets the range reset find it again. */
function building(town: Town, zone: HomeZone, key: string, archetype: string, name: string): void {
  const probe = createBuildingFromArchetype(archetype, name, 0, 0);
  const w = probe.w * probe.cellSize, d = probe.d * probe.cellSize;
  const b = createBuildingFromArchetype(archetype, name, zone.x + Math.max(0.5, (zone.w - w) / 2), zone.y + Math.max(0.5, (zone.d - d) / 2));
  owners.set(b, key);
  town.buildings.push(b);
}

function vehicle(town: Town, key: string, id: string, x: number, y: number, heading: number): VehicleState {
  const v = createVehicle(id, x, y, heading);
  v.yardOwner = key;
  town.vehicles.push(v);
  return v;
}

export function populateHomeYard(town: Town, options: HomeYardOptions): Town {
  const tier = Math.max(0, Math.min(3, options.yardTier));
  const specs = lanes().filter(l => l.tier <= tier);
  const maxX = Math.max(BASE_W, ...specs.map(l => l.x + l.w + 4));
  town.minX = 0; town.minY = 0; town.maxX = maxX; town.maxY = H;
  town.pile = new PileField(0, 0, maxX + 2, H + 2);
  town.terrain = emptyTerrain(0, 0, maxX + 2, H + 2);
  town.surface = emptyGrassGrid(0, 0, maxX + 2, H + 2);
  town.buildings = []; town.props = []; town.vehicles = []; town.roadCar = null; town.lots = [];
  const paved = tier >= 3;
  town.ground = [
    { x: 0, y: 0, w: maxX, d: H, heading: 0, cover: paved ? 'concrete' : 'dirt', seed: town.seed, z: 0 },
    { x: 4, y: LANE_Y - 1, w: maxX - 8, d: LANE_D + 2, heading: 0, cover: paved ? 'parking' : 'gravel', seed: town.seed ^ 3, z: 0.005 },
  ];

  // Heavy Shop: a service depot with a painted apron at its door.
  const depot = createBuildingFromArchetype('vehicle-service-depot', 'HEAVY SHOP', 8, 4);
  owners.set(depot, 'shop');
  town.buildings.push(depot);
  const depotW = depot.w * depot.cellSize, depotD = depot.d * depot.cellSize;
  const apron: HomeZone = { x: depot.x + depotW / 2 - 4.5, y: depot.y + depotD + 0.3, w: 9, d: 5 };
  town.ground.push({ x: depot.x - 1, y: depot.y - 1, w: depotW + 2, d: depotD + 8, heading: 0, cover: 'concrete', seed: town.seed ^ 5, z: 0.006 });

  // Lowboy rig at the east gate; its loading ramp is the dispatch pad.
  const rig = vehicleDefinition('tractor-trailer');
  const rigX = maxX - 16, rigY = 12;
  vehicle(town, 'lowboy', 'tractor-trailer', rigX, rigY, 0);
  const lowboy: HomeZone = { x: rigX - rig.length / 2 - 5.5, y: rigY - 2.6, w: 5, d: 5.2 };
  town.ground.push({ x: lowboy.x - 1, y: rigY - 4, w: rig.length + 8, d: 8, heading: 0, cover: 'parking', seed: town.seed ^ 7, z: 0.006 });

  const reset: HomeZone = { x: 40, y: LANE_Y - 9, w: 5, d: 5 };
  const trophy: HomeZone = { x: 6, y: 26, w: 16, d: 9 };

  const laneZones = specs.map(laneZone);
  for (const spec of specs) spec.fill(town, laneZone(spec), spec.key);
  fenceRange(town, maxX);
  dressTrophies(town, trophy, options);
  if (paved) for (let x = 10; x < maxX; x += 18) town.props.push(spawnAsset('light', x, LANE_Y - 2.4));
  for (const x of [maxX - 3, maxX - 1.5]) town.props.push(spawnAsset('traffic-barrel', x, 4));

  const layout: HomeYardLayout = {
    apron, reset, lowboy, trophy, lanes: laneZones,
    exit: { x: apron.x + apron.w / 2, y: apron.y + apron.d + 3, heading: Math.PI / 2 },
    pads: [
      { ...apron, color: PAD.apron, label: 'HEAVY SHOP · STOP HERE' },
      { ...reset, color: PAD.reset, label: 'RESET RANGE' },
      { ...lowboy, color: PAD.lowboy, label: 'LOWBOY · DISPATCH' },
      { ...trophy, color: PAD.trophy, label: 'TROPHY LOT' },
      ...laneZones.map(z => ({ x: z.x + 0.5, y: z.y + z.d - 2.2, w: z.w - 1, d: 1.6, color: 0x6b5a3a, label: z.label })),
    ],
  };
  town.home = layout;
  town.debrisOwnerAt = (x, y) => laneZones.find(z => inside(z, x, y))?.key;
  town.pile.ownerAt = town.debrisOwnerAt;
  town.spawnX = layout.exit.x; town.spawnY = layout.exit.y; town.spawnHeading = layout.exit.heading;
  town.roadSpawnX = 4; town.roadSpawnY = 4; town.roadSpawnHeading = 0;
  town.visualRevision++;
  return town;
}

function inside(z: HomeZone, x: number, y: number, pad = 0): boolean {
  return x >= z.x - pad && x <= z.x + z.w + pad && y >= z.y - pad && y <= z.y + z.d + pad;
}

/** A chain-link line along the range's north edge, open in front of the reset pad. */
function fenceRange(town: Town, maxX: number): void {
  for (let x = 3; x < maxX - 3; x += 1) {
    if (x > 36 && x < 50) continue;
    town.props.push(spawnAsset('fence', x, LANE_Y - 1.6));
  }
}

/** Clears and lifetime cash fill the trophy lot: crushed cruisers, confiscated signs, salvaged caps. */
function dressTrophies(town: Town, lot: HomeZone, options: HomeYardOptions): void {
  const cruisers = Math.min(6, Math.floor(options.countiesCleared / 3));
  for (let i = 0; i < cruisers; i++) {
    const v = vehicle(town, 'trophy', 'police-cruiser', lot.x + 2.6 + (i % 3) * 5, lot.y + 2.2 + Math.floor(i / 3) * 4.4, 0.15 * (i % 2 ? 1 : -1));
    testVehicleImpact(v, 'overhead', 14);
  }
  const milestones: [boolean, string][] = [
    [options.countiesCleared >= 1, 'stop-sign'],
    [options.countiesCleared >= 7, 'billboard'],
    [options.lifetimeEarned >= 20000, 'transformer'],
    [options.lifetimeEarned >= 100000, 'grain-bin'],
    [options.lifetimeEarned >= 400000, 'propane-tank'],
  ];
  let x = lot.x + lot.w + 1.2;
  for (const [earned, asset] of milestones) {
    if (!earned) continue;
    town.props.push(spawnAsset(asset, x, lot.y + 1.5));
    x += 3.2;
  }
}

/**
 * Rebuild every proving-ground lane the dozer is not standing in. Debris, marks, pile and wreck
 * owned by a lane go with it. Returns the lanes that stayed as they were.
 */
export function resetRange(town: Town, dozer: { x: number; y: number }, options: HomeYardOptions, particles?: ParticlePool): string[] {
  const home = town.home;
  if (!home) return [];
  const skipped: string[] = [];
  const specs = lanes().filter(l => l.tier <= Math.max(0, Math.min(3, options.yardTier)));
  for (const spec of specs) {
    const zone = home.lanes.find(z => z.key === spec.key);
    if (!zone) continue;
    if (inside(zone, dozer.x, dozer.y, 1.5)) { skipped.push(spec.label); continue; }
    clearLane(town, zone, spec.key, particles);
    spec.fill(town, zone, spec.key);
  }
  town.visualRevision++;
  town.siteRevision++;
  invalidateWorldCollision();
  return skipped;
}

function clearLane(town: Town, zone: HomeZone, key: string, particles?: ParticlePool): void {
  const owned = (o: { yardOwner?: string; x: number; y: number }) => o.yardOwner === key || (o.yardOwner === undefined && inside(zone, o.x, o.y));
  const gone = new Set<Building>(town.buildings.filter(b => owners.get(b) === key));
  town.buildings = town.buildings.filter(b => !gone.has(b));
  const ids = new Set([...gone].map(b => b.id));
  town.collapsedSites = town.collapsedSites.filter(s => !ids.has(s.buildingId));
  town.vehicles = town.vehicles.filter(v => v.yardOwner !== key);
  town.rubble = town.rubble.filter(r => !owned(r));
  town.marks = town.marks.filter(m => !owned(m));
  town.pile.removeOwner(key);
  town.pile.clearArea(zone.x, zone.y, zone.w, zone.d);
  if (particles) for (const p of particles.items) if (p.yardOwner === key || inside(zone, p.x, p.y)) p.alive = false;
}
