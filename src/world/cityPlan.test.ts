import { describe, expect, it } from 'vitest';
import { aabbOverlap } from '../game/math';
import { ARCHETYPES } from './archetypes';
import { evaluateCampaignComposition } from './campaignComposition';
import { countyAt, countyEnvironment } from './counties';
import { CITY_PLANS } from './cityPlans';
import { CITY_SITES } from './cityPlanSites';
import { biomeById } from './biomes';
import { fountainJetShare, canopyBays } from '../render/cityDecor';
import { boxInLandmarkClearance, planDecor, planIrrigatedAt, planSurfaceAt, type CityPlan } from './cityPlan';
import { aridLandscape, climateById } from './climate';
import { regionalPlacement } from './regionalCatalog';
import { regionById } from './regions';
import { aabbOverlapsRoad, publicStreetsReachable } from './roads';
import { surfaceAt, traversalAt } from './terrain';
import { createTown } from './town';

function buildCity(regionId: string) {
  const region = regionById(regionId)!;
  const county = countyAt(regionId, 6)!;
  const environment = countyEnvironment(region, 6);
  const placement = regionalPlacement(region, 6);
  const town = createTown({
    district: 'd30',
    seed: county.seed,
    campaign: county.level,
    biome: biomeById(environment.biomeId),
    climate: climateById(environment.climateId),
    regional: placement,
  });
  return { town, county, plan: CITY_PLANS[regionId]! };
}

it('lists a real-world site for every planned city, and no others', () => {
  expect(Object.keys(CITY_SITES).sort()).toEqual(Object.keys(CITY_PLANS).sort());
});

describe.each(Object.keys(CITY_PLANS))('city plan %s', regionId => {
  const { town, county, plan } = buildCity(regionId);

  it('names the Downtown county for the city and plays the plan\'s level', () => {
    expect(county.name).toBe(plan.name);
    expect(county.mapName).toBe(plan.name);
    expect(county.level.landmark.buildingId).toBe(plan.landmarks[0]!.buildingId);
    expect(county.level.generation.buildingCount).toBe(plan.fillCount + 1);
    expect(county.level.dollarTarget).toBe(plan.dollarTarget);
  });

  it('stands every landmark exactly where the plan pins it', () => {
    expect(town.diagnostic.issues).toEqual([]);
    for (const [index, pin] of plan.landmarks.entries()) {
      const building = town.buildings.find(entry => entry.archetypeId === pin.buildingId);
      expect(building, pin.buildingId).toBeDefined();
      expect(building!.x).toBeCloseTo(pin.x, 5);
      expect(building!.y).toBeCloseTo(pin.y, 5);
      expect(!!building!.campaignLandmark).toBe(index === 0);
      if (index > 0) expect(building!.regionalSignature).toBe(pin.label);
    }
    expect(town.buildings.filter(building => building.campaignLandmark)).toHaveLength(1);
  });

  it('fills the rest with a legal downtown mix', () => {
    expect(town.buildings).toHaveLength(plan.fillCount + plan.landmarks.length);
    expect(evaluateCampaignComposition(town.buildings, county.level, ARCHETYPES).issues).toEqual([]);
  });

  it('keeps buildings on dry land, off the streets, out of the parks and clear of each other', () => {
    for (const building of town.buildings) {
      const w = building.w * building.cellSize, d = building.d * building.cellSize;
      for (const [x, y] of [[building.x, building.y], [building.x + w, building.y], [building.x, building.y + d], [building.x + w, building.y + d], [building.x + w / 2, building.y + d / 2]] as const) {
        expect(surfaceAt(town.surface, x, y), `${building.archetypeId} at ${x},${y}`).not.toBe('water');
      }
      expect(aabbOverlapsRoad(town.network, building.x, building.y, w, d), `${building.archetypeId} on a street`).toBe(false);
      expect(plan.parks.some(park => aabbOverlap(building.x, building.y, w, d, park.x, park.y, park.w, park.d)), `${building.archetypeId} in a park`).toBe(false);
      for (const other of town.buildings) {
        if (other === building) continue;
        expect(aabbOverlap(building.x, building.y, w, d, other.x, other.y, other.w * other.cellSize, other.d * other.cellSize), `${building.archetypeId} overlaps ${other.archetypeId}`).toBe(false);
      }
    }
  });

  it('spawns the dozer on open ground with every street reachable', () => {
    expect(traversalAt(town.surface, town.spawnX, town.spawnY)).toBe('open');
    expect(publicStreetsReachable(town.network, town.spawnX, town.spawnY)).toBe(true);
  });

  it('builds the same city for the same county', () => {
    const again = buildCity(regionId).town;
    expect(again.buildings.map(building => `${building.archetypeId}@${building.x.toFixed(2)},${building.y.toFixed(2)}`))
      .toEqual(town.buildings.map(building => `${building.archetypeId}@${building.x.toFixed(2)},${building.y.toFixed(2)}`));
  });
});

describe('plan ground', () => {
  const base: CityPlan = { ...CITY_PLANS['US-NV']!, water: [[[10, 10], [20, 10], [20, 20], [10, 20]]], parks: [
    { name: 'Lawn', x: 30, y: 30, w: 10, d: 10 },
    { name: 'Plaza', x: 50, y: 30, w: 10, d: 10, cover: 'gravel' },
  ] };

  it('paints turf everywhere when the plan names no ground, as Chicago and New York City do', () => {
    const surface = planSurfaceAt({ ...base, ground: undefined });
    expect(surface(100, 100)).toBe('grass');
    expect(surface(35, 35)).toBe('grass');
    expect(surface(55, 35)).toBe('gravel');
    expect(surface(15, 15)).toBe('water');
    expect(planIrrigatedAt({ ...base, ground: undefined })).toBeUndefined();
    expect(CITY_PLANS['US-IL']!.ground).toBeUndefined();
    expect(CITY_PLANS['US-NY']!.ground).toBeUndefined();
  });

  it('paints only the plan\'s dry covers outside its water and parks, and waters only the lawns', () => {
    const surface = planSurfaceAt(base), irrigated = planIrrigatedAt(base)!;
    const seen = new Set<string>();
    for (let y = 0.5; y < base.depth; y += 3) for (let x = 0.5; x < base.width; x += 3) {
      const inWater = x > 10 && x < 20 && y > 10 && y < 20;
      const park = base.parks.find(p => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.d);
      if (!inWater && !park) seen.add(surface(x, y));
      expect(irrigated(x, y)).toBe(park?.name === 'Lawn');
    }
    expect([...seen].sort()).toEqual([...new Set(base.ground)].sort());
    expect(surface(35, 35)).toBe('grass');
    expect(surface(55, 35)).toBe('gravel');
    expect(surface(15, 15)).toBe('water');
  });

  it('carries fountains and canopies for the renderer only when a plan has them', () => {
    expect(planDecor(undefined)).toBeUndefined();
    expect(planDecor(CITY_PLANS['US-IL'])).toBeUndefined();
    const decor = planDecor(CITY_PLANS['US-NV'])!;
    expect(decor.fountains.length).toBeGreaterThan(0);
    expect(decor.canopies.length).toBeGreaterThan(0);
  });
});

describe('Las Vegas', () => {
  const { town, plan } = buildCity('US-NV');
  const footprint = (id: string) => {
    const b = town.buildings.find(entry => entry.archetypeId === id)!;
    return { x: b.x, y: b.y, w: b.w * b.cellSize, d: b.d * b.cellSize };
  };

  it('resolves to a snowless desert, so the open ground is drawn as bare soil', () => {
    expect(aridLandscape(town.climate)).toBe(true);
    expect(town.climate.id).toBe('mojave-desert');
  });

  it('has no turf outside its watered parks and no water but the fountain lake', () => {
    const lawns = plan.parks.filter(park => !park.cover);
    const lake = plan.water![0]!;
    const [lx0, lx1] = [Math.min(...lake.map(p => p[0])), Math.max(...lake.map(p => p[0]))];
    const [ly0, ly1] = [Math.min(...lake.map(p => p[1])), Math.max(...lake.map(p => p[1]))];
    let turf = 0, watered = 0, wet = 0;
    for (let iy = 0; iy < town.surface.rows; iy++) for (let ix = 0; ix < town.surface.cols; ix++) {
      const x = town.surface.ox + ix + 0.5, y = town.surface.oy + iy + 0.5, i = iy * town.surface.cols + ix;
      const kind = surfaceAt(town.surface, x, y);
      const onLawn = lawns.some(park => x >= park.x && x <= park.x + park.w && y >= park.y && y <= park.y + park.d);
      if (town.surface.irrigated![i]) { watered++; expect(onLawn, `${x},${y}`).toBe(true); }
      if (kind === 'grass' && !onLawn) turf++;
      if (kind === 'water') { wet++; expect(x > lx0 - 1 && x < lx1 + 1 && y > ly0 - 1 && y < ly1 + 1, `${x},${y}`).toBe(true); }
    }
    expect(turf).toBe(0);
    expect(watered).toBeGreaterThan(400);
    expect(wet).toBeGreaterThan(150);
  });

  it('stands its landmarks in their real order down the Strip, either side of it', () => {
    const strip = plan.streets.find(street => street.roadClass === 'arterial')!;
    expect(strip).toMatchObject({ axis: 'y', from: 0, to: plan.depth });
    const south = (id: string) => footprint(id).y;
    const order = ['strat-needle-tower', 'venetian-campanile-resort', 'caesars-forum-palace', 'bellagio-crescent-resort', 'luxor-glass-pyramid', 'vegas-welcome-sign'];
    for (let i = 1; i < order.length; i++) expect(south(order[i]!), order[i]).toBeGreaterThan(south(order[i - 1]!));
    const west = (id: string) => footprint(id).x + footprint(id).w < strip.at;
    expect(['strat-needle-tower', 'caesars-forum-palace', 'bellagio-crescent-resort', 'luxor-glass-pyramid', 'luxor-sphinx'].every(west)).toBe(true);
    expect(['venetian-campanile-resort', 'desert-orb-arena', 'paris-lattice-tower', 'linq-observation-wheel'].some(west)).toBe(false);
    // The Sphere stands behind the Venetian, the wheel behind the Strip frontage, the sphinx before the pyramid.
    expect(footprint('desert-orb-arena').x).toBeGreaterThan(footprint('venetian-campanile-resort').x + footprint('venetian-campanile-resort').w);
    expect(footprint('luxor-sphinx').x).toBeGreaterThan(footprint('luxor-glass-pyramid').x + footprint('luxor-glass-pyramid').w);
    // The lake lies between the Bellagio and the Strip.
    const lakeX = plan.water![0]!.map(p => p[0]);
    expect(Math.min(...lakeX)).toBeGreaterThan(footprint('bellagio-crescent-resort').x + footprint('bellagio-crescent-resort').w);
    expect(Math.max(...lakeX)).toBeLessThan(strip.at);
  });

  it('keeps ordinary buildings out of the clear ground a drawn figure asks for', () => {
    const cleared = plan.landmarks.filter(pin => pin.clear);
    expect(cleared.length).toBeGreaterThanOrEqual(3);
    expect(cleared.some(pin => pin.view)).toBe(true);
    for (const pin of cleared) {
      // `view` reaches further on the camera side only: south and east.
      const at = footprint(pin.buildingId), pad = pin.clear!, near = pad + (pin.view ?? 0);
      for (const other of town.buildings) {
        if (other.campaignLandmark || other.cityLandmark) continue;
        expect(aabbOverlap(at.x - pad, at.y - pad, at.w + pad + near, at.d + pad + near, other.x, other.y, other.w * other.cellSize, other.d * other.cellSize), `${other.archetypeId} crowds ${pin.buildingId}`).toBe(false);
      }
    }
  });

  it('reaches a sightline only toward the camera', () => {
    const pinned: CityPlan = { ...plan, landmarks: [{ buildingId: 'x', label: 'X', x: 50, y: 50, clear: 2, view: 10 }] };
    const footprints = new Map([['x', { x: 50, y: 50, w: 10, d: 10 }]]);
    const lot = (x: number, y: number) => boxInLandmarkClearance(pinned, footprints, { x, y, w: 4, d: 4 });
    // South-east of the footprint, inside the sightline; the same distance north-west is free.
    expect(lot(66, 66)).toBe(true);
    expect(lot(40, 40)).toBe(false);
    expect(lot(45, 45)).toBe(true);
    expect(lot(73, 73)).toBe(false);
    // A pin that asks for nothing keeps nothing clear.
    expect(boxInLandmarkClearance({ ...plan, landmarks: [{ buildingId: 'x', label: 'X', x: 50, y: 50 }] }, footprints, { x: 52, y: 52, w: 4, d: 4 })).toBe(false);
  });

  it('plays its fountains on the lake and hangs its canopy over a street it has', () => {
    const decor = town.cityDecor!;
    for (const fountain of decor.fountains) {
      for (let i = 0; i < fountain.jets; i++) {
        const t = fountain.jets > 1 ? i / (fountain.jets - 1) : 0.5;
        expect(surfaceAt(town.surface, fountain.x0 + (fountain.x1 - fountain.x0) * t, fountain.y0 + (fountain.y1 - fountain.y0) * t)).toBe('water');
        for (const time of [0, 0.7, 3.1, 12.4]) {
          const share = fountainJetShare(i, fountain.jets, time);
          expect(share).toBeGreaterThan(0);
          expect(share).toBeLessThanOrEqual(1);
        }
      }
    }
    for (const canopy of decor.canopies) {
      const street = plan.streets.find(entry => entry.axis === canopy.axis && entry.at === canopy.at)!;
      expect(street, canopy.name).toBeDefined();
      expect(canopy.from).toBeGreaterThanOrEqual(street.from);
      expect(canopy.to).toBeLessThanOrEqual(street.to);
      const bays = canopyBays(canopy);
      expect(bays[0]!.from).toBe(canopy.from);
      expect(bays[bays.length - 1]!.to).toBeCloseTo(canopy.to, 6);
      // Its columns stand clear of the pavement, and no building stands under the vault.
      for (const building of town.buildings) {
        expect(aabbOverlap(canopy.from, canopy.at - canopy.halfWidth, canopy.to - canopy.from, canopy.halfWidth * 2, building.x, building.y, building.w * building.cellSize, building.d * building.cellSize), `${building.archetypeId} under the canopy`).toBe(false);
      }
    }
  });

  it('scatters native desert flora and keeps rock off the streets', () => {
    const flora = town.props.filter(prop => ['joshua-tree', 'creosote-bush', 'yucca-scrub'].includes(prop.assetId));
    expect(flora.length).toBeGreaterThan(10);
    for (let iy = 0; iy < town.surface.rows; iy++) for (let ix = 0; ix < town.surface.cols; ix++) {
      const x = town.surface.ox + ix + 0.5, y = town.surface.oy + iy + 0.5;
      if (surfaceAt(town.surface, x, y) === 'rock') expect(aabbOverlapsRoad(town.network, x - 0.5, y - 0.5, 1, 1), `rock on a street at ${x},${y}`).toBe(false);
    }
  });
});
