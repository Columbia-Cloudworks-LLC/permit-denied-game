import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../game/constants';
import { campaignLevelById } from '../game/campaign';
import { ParticlePool } from '../fx/particles';
import { stepWorld } from '../sim/worldSim';
import { createTown } from '../world/town';
import { createDozer, type Dozer } from './dozer';
import { createTraffic, requestPolice, seesDozer, sightBlocked, trafficConfigFor, type TrafficConfig } from './traffic';
import type { VehicleState } from './types';

const NO_UPGRADES = { blade: 0, engine: 0, push: 0 };

function trafficTown(level: Parameters<typeof campaignLevelById>[0], config?: Partial<TrafficConfig>, police = false) {
  const town = createTown({ district: 'd30', seed: 19, campaign: campaignLevelById(level) });
  town.traffic = createTraffic(town, { ...trafficConfigFor(town, police), ...config });
  // Park the dozer in a far corner so it stays out of the way.
  const dozer = createDozer(town.minX + 1, town.minY + 1, 0);
  return { town, dozer, particles: new ParticlePool() };
}

function run(t: ReturnType<typeof trafficTown>, seconds: number, each?: (time: number) => void): void {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    stepWorld(t.town, t.dozer, t.particles, NO_UPGRADES, SIM_DT);
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
    expect(downtown.police).toBeGreaterThan(county.police);
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

  it('turns around or reroutes when the dozer blocks the road ahead', () => {
    const t = trafficTown('county', { civilians: 1 });
    t.town.vehicles = t.town.vehicles.filter(v => !v.traffic);
    run(t, 4);
    const v = agents(t.town.vehicles)[0]!;
    expect(v).toBeTruthy();
    // Drop the dozer onto the car's path, in plain view.
    const a = v.traffic!;
    const p = a.path[Math.min(a.path.length - 1, a.pathIndex + 9)]!;
    Object.assign(t.dozer, createDozer(p.x, p.y, v.heading + Math.PI) as Dozer);
    const start = v.heading;
    let reacted = false;
    run(t, 6, () => { if (v.traffic!.mode !== 'cruise') reacted = true; });
    expect(reacted).toBe(true);
    expect(v.status).toBe('operational');
    const turned = Math.abs(Math.atan2(Math.sin(v.heading - start), Math.cos(v.heading - start)));
    const dist = Math.hypot(v.x - t.dozer.x, v.y - t.dozer.y);
    expect(turned > 1.5 || dist > 6 || !t.town.vehicles.includes(v)).toBe(true);
  });

  it('sends police that chase the dozer and wreck after three hits', () => {
    const t = trafficTown('county', { civilians: 0, policeDelay: 1 }, true);
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

  it('queues a sandbox police car on request', () => {
    const t = trafficTown('county', { civilians: 0 }, false);
    expect(t.town.traffic!.config.police).toBe(0);
    requestPolice(t.town.traffic!);
    run(t, 1);
    expect(agents(t.town.vehicles, 'police')).toHaveLength(1);
  });
});
