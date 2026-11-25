import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../game/constants';
import { campaignLevelById } from '../game/campaign';
import { ParticlePool } from '../fx/particles';
import { stepWorld } from '../sim/worldSim';
import { createTown } from '../world/town';
import { createDozer, type Dozer } from './dozer';
import { createTraffic, raiseEnforcement, requestPolice, rubbleBetween, seesDozer, sightBlocked, trafficConfigFor, type TrafficConfig } from './traffic';
import type { VehicleState } from './types';


function trafficTown(level: Parameters<typeof campaignLevelById>[0], config?: Partial<TrafficConfig>, police = false) {
  const town = createTown({ district: 'd30', seed: 19, campaign: campaignLevelById(level) });
  town.traffic = createTraffic(town, { ...trafficConfigFor(town, police), ...config });
  // Park the dozer in a far corner so it stays out of the way.
  const dozer = createDozer(town.minX + 1, town.minY + 1, 0);
  return { town, dozer, particles: new ParticlePool() };
}

function run(t: ReturnType<typeof trafficTown>, seconds: number, each?: (time: number) => void): void {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    stepWorld(t.town, t.dozer, t.particles, SIM_DT);
    each?.(i * SIM_DT);
  }
}

const agents = (vehicles: VehicleState[], role?: 'civilian' | 'police') =>
  vehicles.filter(v => v.traffic && v.status === 'operational' && (!role || v.traffic.role === role));

describe('traffic', () => {
  it('scales density with the kind of map', () => {
    const county = trafficConfigFor({ campaignLevel: 'county', district: 'd30' }, true);
    const downtown = trafficConfigFor({ campaignLevel: 'city-downtown', district: 'd30' }, true);
    const township = trafficConfigFor({ campaignLevel: 'township', district: 'd30' }, true);
    expect(downtown.civilians).toBeGreaterThan(township.civilians);
    expect(township.civilians).toBeGreaterThan(county.civilians);
    // Code Enforcement caps at two cruisers on every Time Challenge map; the run's alert decides how many roll.
    expect([county.police, downtown.police]).toEqual([2, 2]);
    expect(trafficConfigFor({ campaignLevel: 'county', district: 'd30' }, false).police).toBe(0);
  });

  it('drives cars through town and out of the exits without crashing into each other', () => {
    const t = trafficTown('suburb');
    expect(t.town.traffic).toBeTruthy();
    const ids = new Set<number>();
    let maxSpeed = 0;
    run(t, 60, () => {
      for (const v of agents(t.town.vehicles)) { ids.add(v.id); maxSpeed = Math.max(maxSpeed, Math.hypot(v.vx, v.vy)); }
    });
    const live = new Set(agents(t.town.vehicles).map(v => v.id));
    const left = [...ids].filter(id => !live.has(id) && !t.town.vehicles.some(v => v.id === id));
    expect(left.length).toBeGreaterThan(0);
    // Faster than the dozer's top speed, so a car can get away.
    expect(maxSpeed).toBeGreaterThan(8.6);
    // Nobody was wrecked by other traffic while the dozer sat idle in a corner.
    const wrecked = t.town.vehicles.filter(v => v.traffic && v.status !== 'operational');
    expect(wrecked).toHaveLength(0);
  });

  it('only sees the dozer inside the forward cone and not through buildings', () => {
    const t = trafficTown('county');
    const v = agents(t.town.vehicles)[0] ?? (() => { run(t, 6); return agents(t.town.vehicles)[0]!; })();
    const f = Math.cos(v.heading), g = Math.sin(v.heading);
    const ahead = createDozer(v.x + f * 8, v.y + g * 8, 0);
    const behind = createDozer(v.x - f * 8, v.y - g * 8, 0);
    const blocked = sightBlocked(t.town, v.x, v.y, ahead.x, ahead.y);
    expect(seesDozer(t.town, v, ahead)).toBe(!blocked);
    expect(seesDozer(t.town, v, behind)).toBe(false);
    const b = t.town.buildings[0]!;
    const cx = b.x + b.w * b.cellSize / 2, cy = b.y + b.d * b.cellSize / 2;
    expect(sightBlocked(t.town, cx - b.w * b.cellSize, cy, cx + b.w * b.cellSize, cy)).toBe(true);
  });

  /** One civilian on an otherwise empty map, a few seconds into its drive. */
  function loneDriver() {
    const t = trafficTown('county', { civilians: 1 });
    t.town.vehicles = t.town.vehicles.filter(v => !v.traffic);
    run(t, 4);
    const v = agents(t.town.vehicles)[0]!;
    expect(v).toBeTruthy();
    return { t, v };
  }

  it('brakes for a dozer parked in the road ahead, then goes around it or turns back, without touching it', () => {
    const { t, v } = loneDriver();
    // Drop the dozer onto the car's path, facing it.
    const a = v.traffic!;
    const p = a.path[Math.min(a.path.length - 1, a.pathIndex + 12)]!;
    Object.assign(t.dozer, createDozer(p.x, p.y, v.heading + Math.PI) as Dozer);
    const start = v.heading;
    let reacted = false, slowest = Infinity;
    run(t, 9, () => {
      if (v.traffic!.mode !== 'cruise') reacted = true;
      slowest = Math.min(slowest, Math.hypot(v.vx, v.vy));
    });
    expect(slowest).toBeLessThan(1);
    expect(reacted).toBe(true);
    expect(v.status).toBe('operational');
    expect(v.compact.target).toBe(0);
    const turned = Math.abs(Math.atan2(Math.sin(v.heading - start), Math.cos(v.heading - start)));
    const f = Math.cos(start), g = Math.sin(start);
    const past = (v.x - t.dozer.x) * f + (v.y - t.dozer.y) * g > 2;
    expect(turned > 1.5 || past || !t.town.vehicles.includes(v)).toBe(true);
  });

  it('pays the dozer no mind when it is behind the car or well off to the side', () => {
    for (const place of ['behind', 'aside'] as const) {
      const { t, v } = loneDriver();
      const f = Math.cos(v.heading), g = Math.sin(v.heading);
      // Twelve units back down the road, or level with the car but out in the lots.
      const at = place === 'behind' ? { x: v.x - f * 12, y: v.y - g * 12 } : { x: v.x + f * 4 - g * 9, y: v.y + g * 4 + f * 9 };
      Object.assign(t.dozer, createDozer(at.x, at.y, v.heading) as Dozer);
      let slowest = Infinity;
      const modes = new Set<string>();
      run(t, 1.5, () => {
        if (!t.town.vehicles.includes(v)) return;
        modes.add(v.traffic!.mode);
        slowest = Math.min(slowest, Math.hypot(v.vx, v.vy));
      });
      expect([...modes], place).toEqual(['cruise']);
      expect(slowest, place).toBeGreaterThan(2.5);
    }
  });

  it('keeps a busy town moving: cars get through, nobody is wrecked and nobody sits stuck', () => {
    const t = trafficTown('suburb');
    const seen = new Set<number>();
    let samples = 0, stopped = 0, longest = 0;
    run(t, 90, time => {
      const live = agents(t.town.vehicles, 'civilian');
      for (const v of live) {
        seen.add(v.id);
        longest = Math.max(longest, v.traffic!.stuckT);
      }
      if (Math.round(time / SIM_DT) % 30) return;
      samples += live.length;
      stopped += live.filter(v => Math.hypot(v.vx, v.vy) < 0.5).length;
    });
    const left = [...seen].filter(id => !t.town.vehicles.some(v => v.id === id)).length;
    // Twice the old traffic, and it still drains: well over one car a three seconds out through the exits.
    expect(t.town.traffic!.config.civilians).toBe(14);
    expect(left).toBeGreaterThan(25);
    expect(stopped / samples).toBeLessThan(0.4);
    expect(longest).toBeLessThan(25);
    expect(t.town.vehicles.filter(v => v.traffic && v.status !== 'operational')).toHaveLength(0);
  });

  it('sends police that chase the dozer and wreck after three hits', () => {
    const t = trafficTown('county', { civilians: 0, policeDelay: 1 }, true);
    raiseEnforcement(t.town.traffic!, 1);
    t.town.vehicles = t.town.vehicles.filter(v => !v.traffic);
    t.dozer = createDozer((t.town.minX + t.town.maxX) / 2, (t.town.minY + t.town.maxY) / 2, 0);
    let closest = Infinity, hits = 0;
    const startHeat = t.dozer.heat;
    run(t, 40, () => {
      for (const v of t.town.vehicles.filter(q => q.traffic?.role === 'police')) {
        closest = Math.min(closest, Math.hypot(v.x - t.dozer.x, v.y - t.dozer.y));
        hits = Math.max(hits, v.hits ?? 0);
      }
    });
    expect(closest).toBeLessThan(3);
    expect(hits).toBeGreaterThan(0);
    expect(t.dozer.heat + t.dozer.track).toBeGreaterThan(startHeat);
    const wrecks = t.town.vehicles.filter(v => v.traffic?.role === 'police' && v.status === 'wreck');
    for (const w of wrecks) expect(w.hits).toBe(3);
  });

  it('holds Code Enforcement back until the run raises an alert, then escalates to two cruisers and never stands down', () => {
    const t = trafficTown('county', { civilians: 0, policeDelay: 1, policeCooldown: 1 }, true);
    t.town.vehicles = t.town.vehicles.filter(v => !v.traffic);
    t.dozer = createDozer((t.town.minX + t.town.maxX) / 2, (t.town.minY + t.town.maxY) / 2, 0);
    const cruisers = () => t.town.vehicles.filter(v => v.traffic?.role === 'police').length;
    run(t, 12);
    expect(cruisers()).toBe(0);
    expect(raiseEnforcement(t.town.traffic!, 1)).toBe(true);
    expect(raiseEnforcement(t.town.traffic!, 1)).toBe(false);
    run(t, 4);
    expect(cruisers()).toBe(1);
    expect(raiseEnforcement(t.town.traffic!, 5)).toBe(true);
    expect(t.town.traffic!.alert).toBe(2);
    run(t, 6);
    expect(cruisers()).toBeGreaterThanOrEqual(2);
    expect(raiseEnforcement(t.town.traffic!, 0)).toBe(false);
    expect(t.town.traffic!.alert).toBe(2);
  });

  it('runs the same pursuit twice from the same seed and alert times (replay determinism)', () => {
    const play = () => {
      const t = trafficTown('township', { policeDelay: 1, policeCooldown: 2 }, true);
      t.dozer = createDozer((t.town.minX + t.town.maxX) / 2, (t.town.minY + t.town.maxY) / 2, 0);
      run(t, 3);
      raiseEnforcement(t.town.traffic!, 1);
      run(t, 6);
      raiseEnforcement(t.town.traffic!, 2);
      run(t, 10);
      return JSON.stringify([t.dozer.x, t.dozer.y, t.dozer.heat, t.dozer.track,
        t.town.vehicles.map(v => [v.id, v.definitionId, v.status, v.x, v.y, v.heading, v.traffic?.role, v.traffic?.mode])]);
    };
    expect(play()).toBe(play());
  });

  it('never dispatches Code Enforcement where the cap is zero (Sandbox)', () => {
    const t = trafficTown('county', { civilians: 0 }, false);
    expect(raiseEnforcement(t.town.traffic!, 2)).toBe(false);
    run(t, 8);
    expect(agents(t.town.vehicles, 'police')).toHaveLength(0);
  });

  it('treats rubble heaped between cruiser and dozer as cover, but not the dozer\'s own work face', () => {
    const t = trafficTown('county', { civilians: 0 }, true);
    const x = (t.town.minX + t.town.maxX) / 2, y = (t.town.minY + t.town.maxY) / 2;
    const heights = new Map<string, number>();
    const pile = { heightAt: (px: number, py: number) => heights.get(`${Math.round(px)},${Math.round(py)}`) ?? 0 };
    const town = { pile } as unknown as Pick<typeof t.town, 'pile'>;
    expect(rubbleBetween(town, x, y, x + 16, y)).toBe(false);
    heights.set(`${Math.round(x + 8)},${Math.round(y)}`, 1.2);
    expect(rubbleBetween(town, x, y, x + 16, y)).toBe(true);
    heights.clear();
    heights.set(`${Math.round(x + 15)},${Math.round(y)}`, 1.2);
    expect(rubbleBetween(town, x, y, x + 16, y)).toBe(false);
  });

  it('queues a sandbox police car on request', () => {
    const t = trafficTown('county', { civilians: 0 }, false);
    expect(t.town.traffic!.config.police).toBe(0);
    requestPolice(t.town.traffic!);
    run(t, 1);
    expect(agents(t.town.vehicles, 'police')).toHaveLength(1);
  });
});
