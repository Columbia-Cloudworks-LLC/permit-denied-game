import { describe, expect, it } from 'vitest';
import { createTown } from './town';
import { discoverYardAssets, bayBuildings, bayProps, bayVehicles } from './yardCatalog';
import { parseSessionFromSearch, startsAtTitle } from '../game/session';
import { testMapSearch } from './testMapRequest';
import { restoreBay, testVehicleImpact, yardVehicleRoute } from './testYard';
import { boxBounds, vehicleBoxes } from '../vehicle/world';
import { stepWorld } from '../sim/worldSim';
import { ParticlePool } from '../fx/particles';
import { createDozer } from '../vehicle/dozer';
import { addDebrisBody, totalDebrisMass } from '../sim/debris';

const focused = (assetId: string, variant = 0) => createTown({ seed: 81, testMap: { kind: 'asset', assetId, variant } });

describe('focused asset test maps', () => {
  it('constructs every catalog entry and declared variant with only its production objects', () => {
    const assets = discoverYardAssets();
    for (const asset of assets) for (let variant = 0; variant < asset.variants; variant++) {
      const town = focused(asset.id, variant), bay = town.yard!.bays[0]!;
      expect(town.yard!.issues, asset.id).toEqual([]);
      expect(town.yard!.bays, asset.id).toHaveLength(1);
      expect(town.yard!.assets).toHaveLength(assets.length);
      expect(town.buildings).toEqual(bayBuildings(bay));
      expect(town.props).toEqual(bayProps(bay));
      expect(town.vehicles).toEqual(bayVehicles(bay));
      expect(town.lots).toEqual([]); expect(town.roads).toEqual([]);
      expect(town.ground).toHaveLength(1);
      expect(bay.variant).toBe(variant);
      expect(bay.asset.clearance).toBeGreaterThanOrEqual(12);
      expect(town.spawnY).toBeLessThan(town.maxY - 2);
      if (asset.fixture) {
        expect(bay.building!.fixtures).toHaveLength(1);
        expect(bay.building!.fixtures[0]!.floor).toBe(0);
        expect(bay.building!.floors).toBe(asset.fixtureLevels);
      }
    }
  });

  it('keeps all 12 vehicles and their route envelopes inside the focused map', () => {
    for (const asset of discoverYardAssets().filter(a => a.vehicle)) {
      const town = focused(asset.id), bay = town.yard!.bays[0]!, v = bay.vehicle!;
      const dozer = createDozer(town.spawnX, town.spawnY, town.spawnHeading), particles = new ParticlePool();
      yardVehicleRoute(v, 0, bay);
      const route = v.waypoints.map(p => ({ ...p }));
      for (let frame = 0; frame < 900; frame++) {
        stepWorld(town, dozer, particles, { blade: 0, engine: 0, push: 0 }, 1 / 60);
        if (frame % 60 === 0) for (const box of vehicleBoxes(v)) {
          const bounds = boxBounds(box);
          expect(bounds.x, asset.id).toBeGreaterThan(0); expect(bounds.y, asset.id).toBeGreaterThan(0);
          expect(bounds.x + bounds.w, asset.id).toBeLessThan(town.maxX);
          expect(bounds.y + bounds.d, asset.id).toBeLessThan(town.maxY);
        }
      }
      yardVehicleRoute(v, 0, bay);
      expect(v.waypoints).toEqual(route); // restarting a route does not move its loop
    }
  });

  it('restores owned debris that traveled away, pending loads, and followed vehicles repeatedly', () => {
    const town = focused('vehicle:tractor-trailer'), particles = new ParticlePool(), bay = town.yard!.bays[0]!;
    for (let cycle = 0; cycle < 10; cycle++) {
      const original = bay.vehicle!; town.roadCar = original;
      testVehicleImpact(original, 'overhead', 30);
      town.yard!.loads = [{ vehicle: original, z: 4, vz: 0 }];
      const r = addDebrisBody(town, { x: town.maxX + 20, y: town.maxY + 20, w: 1, d: 1, mass: 3, material: 'metal', layer: 'remnant', yardOwner: bay.key });
      expect(r.yardOwner).toBe(bay.key);
      restoreBay(town, bay, particles);
      expect(bay.vehicle).not.toBe(original); expect(town.roadCar).toBe(bay.vehicle);
      expect(town.vehicles).toHaveLength(1); expect(bay.vehicle!.status).toBe('operational');
      expect(town.yard!.loads).toEqual([]); expect(totalDebrisMass(town)).toBe(0);
    }
  });

  it('reports invalid links without loading an unrelated asset', () => {
    for (const [id, variant] of [['missing', 0], ['vehicle:bus', -1], ['vehicle:bus', 2], ['vehicle:bus', NaN]] as const) {
      const town = focused(id, variant);
      expect(town.yard!.issues[0]).toMatch(/catalog/);
      expect(town.yard!.bays).toEqual([]);
      expect(town.buildings.length + town.props.length + town.vehicles.length).toBe(0);
    }
  });

  it('round-trips explicit links and redirects old previews while retaining the Brick job', () => {
    for (const request of [{ kind: 'yard' }, { kind: 'asset', assetId: 'vehicle:bus', variant: 1 }] as const) {
      const search = testMapSearch(request, 81);
      expect(parseSessionFromSearch(search)).toMatchObject({ testMap: request, seed: 81 });
      expect(startsAtTitle(search)).toBe(false);
    }
    for (const [query, id] of [['ranch=1', 'ranch'], ['demo=ranch', 'ranch'], ['demo=rivertown', 'rivertown'], ['demo=steel-warehouse', 'steel-warehouse'], ['tower=1', 'union-tower']]) {
      const rules = parseSessionFromSearch('?' + query);
      expect(rules.testMap).toEqual({ kind: 'asset', assetId: 'building:' + id, variant: 0 });
      expect(rules.demo).toBeUndefined(); expect(rules.towerTest).toBeUndefined();
    }
    expect(parseSessionFromSearch('?tower=1&job=brick')).toMatchObject({ job: true, demo: 'rivertown', testMap: undefined });
  });
});
