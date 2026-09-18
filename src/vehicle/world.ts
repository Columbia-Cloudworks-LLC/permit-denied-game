import { clamp } from '../game/math';
import { DEBRIS, DOZER } from '../game/constants';
import type { Town } from '../world/town';
import { terrainHeightAt, roadSurfaceAt } from '../world/roads';
import { resolveTraversal, terrainTraversalAt } from '../world/terrainFeatures';
import { cellWorldBox } from '../structure/types';
import type { WorldEvent } from '../structure/types';
import type { ParticlePool } from '../fx/particles';
import { SpatialHash } from '../sim/spatial';
import { bladePoints, type Dozer } from './dozer';
import { createVehicle, hitVehicle, partPose, detachedRoot, assemblyMass, stepVehicle, stepDetached } from './runtime';
import { vehicleDefinition, VEHICLES } from './definitions';
import type { VehicleState, VehicleContact } from './types';
export function migrateVehicles(town: Town): void {
    const ids = new Set(VEHICLES.map(v => v.id));
    town.props = town.props.filter(p => {
        if (!ids.has(p.assetId))
            return true;
        const v = createVehicle(p.assetId, p.x + p.w / 2, p.y + p.d / 2, p.heading, p.variant);
        const def = vehicleDefinition(p.assetId);
        v.scale = Math.min(p.w / def.length, p.d / def.width);
        v.lotId = p.lotId;
        v.elev = p.elev;
        v.yardOwner = town.debrisOwnerAt?.(v.x, v.y);
        town.vehicles.push(v);
        return false;
    });
    if (town.roadCar && !town.vehicles.includes(town.roadCar))
        town.vehicles.push(town.roadCar);
}
export interface VehicleBox {
    x: number;
    y: number;
    w: number;
    d: number;
    z: number;
    h: number;
    heading: number;
    vehicle?: VehicleState;
    part?: number;
}
export function vehicleBoxes(v: VehicleState): VehicleBox[] {
    const d = vehicleDefinition(v.definitionId);
    return d.parts.flatMap((p, i) => {
        if (p.role === 'glass' || p.role === 'panel')
            return [];
        const q = partPose(v, i), tilt = Math.abs(q.pitch) * q.length / 2 + Math.abs(q.roll) * q.width / 2;
        return [{ x: q.x, y: q.y, w: q.length, d: q.width, z: Math.max(0, q.z - tilt), h: q.height + tilt * 2, heading: q.heading, vehicle: v, part: i }];
    });
}
export function boxBounds(b: VehicleBox): {
    x: number;
    y: number;
    w: number;
    d: number;
} {
    const w = Math.abs(Math.cos(b.heading)) * b.w + Math.abs(Math.sin(b.heading)) * b.d, d = Math.abs(Math.sin(b.heading)) * b.w + Math.abs(Math.cos(b.heading)) * b.d;
    return { x: b.x - w / 2, y: b.y - d / 2, w, d };
}
/** SAT in world space; height intervals prevent contact between different decks. */
export function boxContact(a: VehicleBox, b: VehicleBox): {
    nx: number;
    ny: number;
    depth: number;
} | undefined {
    if (a.z + a.h < b.z + .01 || b.z + b.h < a.z + .01)
        return;
    let depth = Infinity, nx = 0, ny = 0;
    for (const h of [a.heading, b.heading])
        for (const offset of [0, Math.PI / 2]) {
            const x = Math.cos(h + offset), y = Math.sin(h + offset);
            const radius = (q: VehicleBox) => Math.abs(Math.cos(q.heading) * x + Math.sin(q.heading) * y) * q.w / 2 + Math.abs(-Math.sin(q.heading) * x + Math.cos(q.heading) * y) * q.d / 2;
            const dist = (b.x - a.x) * x + (b.y - a.y) * y, overlap = radius(a) + radius(b) - Math.abs(dist);
            if (overlap <= 0)
                return;
            if (overlap < depth) {
                depth = overlap;
                nx = x * (dist >= 0 ? 1 : -1);
                ny = y * (dist >= 0 ? 1 : -1);
            }
        }
    return { nx, ny, depth };
}
export function vehicleLoad(town: Town, x: number, y: number, z: number, radius: number, impulse: number, source: string): void {
    for (const v of town.vehicles) {
        const c: VehicleContact[] = [];
        for (let i = 0; i < v.parts.length; i++) {
            const p = partPose(v, i);
            if (Math.hypot(p.x - x, p.y - y) <= radius)
                c.push({ x: p.x, y: p.y, z: Math.min(z, p.z + p.height), nx: 0, ny: 0, nz: -1, impulse, source: `${source}:${i}` });
        }
        hitVehicle(v, c);
    }
}
export const vehicleStats = { active: 0, sleeping: 0, detached: 0, contacts: 0 };
const staticCache = new WeakMap<Town, {
    stamp: string;
    hash: SpatialHash<VehicleBox>;
}>();
export function stepVehicleWorld(town: Town, dozer: Dozer, particles: ParticlePool, events: WorldEvent[], dt: number, bladeMul = 1): number {
    migrateVehicles(town);
    if (town.yard?.loads)
        town.yard.loads = town.yard.loads.filter(l => { l.vz -= 12 * dt; l.z += l.vz * dt; const d = vehicleDefinition(l.vehicle.definitionId); if (l.z <= l.vehicle.elev + d.height) {
            vehicleLoad(town, l.vehicle.x, l.vehicle.y, l.z, d.length, Math.abs(l.vz) * 1.5, 'yard-plate');
            return false;
        } return true; });
    const stamp = town.siteRevision + ':' + town.buildings.map(b => b.id + ',' + b.visualRevision + ',' + b.cells.length).join(';') + ':' + town.props.map(p => p.id + ',' + p.broken + ',' + p.x + ',' + p.y).join(';');
    const cached = staticCache.get(town), rebuild = cached?.stamp !== stamp;
    const fixed = rebuild ? new SpatialHash<VehicleBox>(4) : cached.hash, dynamic = new SpatialHash<VehicleBox>(4);
    const insert = (hash: SpatialHash<VehicleBox>, b: VehicleBox) => { const a = boxBounds(b); hash.insert(a.x, a.y, a.w, a.d, b); };
    if (rebuild)
        for (const b of town.buildings)
            if (!b.retired) {
                for (const c of b.cells)
                    if (c.floor === 0 && c.hp > 0) {
                        const q = cellWorldBox(b, c);
                        insert(fixed, { x: q.x + q.w / 2, y: q.y + q.d / 2, w: q.w, d: q.d, z: 0, h: 2, heading: 0 });
                    }
                for (const f of b.fixtures)
                    if (!f.broken && f.floor === 0)
                        insert(fixed, { x: f.x + f.w / 2, y: f.y + f.d / 2, w: f.w, d: f.d, z: 0, h: f.h, heading: 0 });
            }
    if (rebuild) {
        for (const p of town.props)
            if (!p.broken)
                insert(fixed, { x: p.x + p.w / 2, y: p.y + p.d / 2, w: p.w, d: p.d, z: p.elev, h: 1, heading: p.heading });
        staticCache.set(town, { stamp, hash: fixed });
    }
    const candidates: VehicleBox[] = [];
    let cash = 0;
    vehicleStats.contacts = 0;
    // At most .12 world units of predicted travel per substep, capped to bound work.
    const maxSpeed = Math.max(Math.hypot(dozer.vx, dozer.vy), ...town.vehicles.map(v => Math.hypot(v.vx, v.vy)));
    const steps = Math.min(8, Math.max(1, Math.ceil(maxSpeed * dt / .12))), sub = dt / steps;
    for (let step = 0; step < steps; step++) {
        dynamic.clear();
        for (const v of town.vehicles)
            for (const b of vehicleBoxes(v))
                insert(dynamic, b);
        const pending = new Map<VehicleState, VehicleContact[]>();
        const solvedPairs = new Set<string>();
        const queue = (v: VehicleState, c: VehicleContact) => { let list = pending.get(v); if (!list) {
            list = [];
            pending.set(v, list);
        } list.push(c); };
        for (const v of town.vehicles) {
            if (v.sleeping && !v.autonomous && Math.hypot(v.x - dozer.x, v.y - dozer.y) > 10 && !v.parts.some(p => p.detached && !p.sleeping))
                continue;
            const d = vehicleDefinition(v.definitionId), nose = { x: v.x + Math.cos(v.heading) * (d.length / 2 + .7), y: v.y + Math.sin(v.heading) * (d.length / 2 + .7), w: .6, d: d.width, z: v.elev, h: 1, heading: v.heading };
            const ahead = boxBounds(nose);
            fixed.query(ahead.x, ahead.y, ahead.w, ahead.d, candidates);
            let obstacle = candidates.some(b => boxContact(nose, b));
            dynamic.query(ahead.x, ahead.y, ahead.w, ahead.d, candidates);
            obstacle ||= candidates.some(b => b.vehicle !== v && boxContact(nose, b) !== undefined);
            const prevX = v.x, prevY = v.y;
            stepVehicle(v, sub, obstacle);
            if ((town.surface || town.features.length) && terrainTraversalAt(town.features, v.x, v.y, town.surface) !== 'open') {
              const resolved = resolveTraversal(v.x, v.y, prevX, prevY, town.features, town.surface);
              v.x = resolved.x;
              v.y = resolved.y;
              if (resolved.blocked) { v.vx *= 0.2; v.vy *= 0.2; }
            }
            const road = roadSurfaceAt(town.network, v.x, v.y, v.layer), ground = road.on ? road.elev : terrainHeightAt(town.terrain, v.x, v.y);
            const pile = town.pile.sample(v.x, v.y), resistance = Math.max(0, pile.height - d.drive.clearance);
            v.vx *= Math.exp(-resistance * sub * 6 / d.drive.traction);
            v.vy *= Math.exp(-resistance * sub * 6 / d.drive.traction);
            v.elev = ground + Math.min(pile.height, d.drive.clearance);
            const contacts = vehicleBoxes(v);
            for (const a of contacts) {
                const bounds = boxBounds(a);
                fixed.query(bounds.x, bounds.y, bounds.w, bounds.d, candidates);
                for (const b of candidates) {
                    const hit = boxContact(a, b);
                    if (!hit)
                        continue;
                    vehicleStats.contacts++;
                    const root = detachedRoot(v, a.part!), body = root === undefined ? v : v.parts[root]!;
                    body.x -= hit.nx * Math.min(.18, hit.depth);
                    body.y -= hit.ny * Math.min(.18, hit.depth);
                    const impulse = Math.max(0, body.vx * hit.nx + body.vy * hit.ny);
                    body.vx -= hit.nx * impulse;
                    body.vy -= hit.ny * impulse;
                    queue(v, { x: a.x + hit.nx * a.w * .4, y: a.y + hit.ny * a.d * .4, z: a.z + a.h * .5, nx: -hit.nx, ny: -hit.ny, nz: 0, impulse, source: 'solid' });
                }
                dynamic.query(bounds.x, bounds.y, bounds.w, bounds.d, candidates);
                for (const b of candidates) {
                    const other = b.vehicle!;
                    if (other === v)
                        continue;
                    const pair = v.id < other.id ? `${v.id}:${a.part}/${other.id}:${b.part}` : `${other.id}:${b.part}/${v.id}:${a.part}`;
                    if (solvedPairs.has(pair)) continue;
                    const hit = boxContact(a, b);
                    if (!hit)
                        continue;
                    solvedPairs.add(pair);
                    vehicleStats.contacts++;
                    const ar = detachedRoot(v, a.part!), br = detachedRoot(other, b.part!), av = ar === undefined ? v : v.parts[ar]!, bv = br === undefined ? other : other.parts[br]!;
                    const massA = assemblyMass(v, ar), massB = assemblyMass(other, br), share = massB / (massA + massB);
                    const correction = Math.min(.1, hit.depth);
                    av.x -= hit.nx * correction * share;
                    av.y -= hit.ny * correction * share;
                    bv.x += hit.nx * correction * (1 - share);
                    bv.y += hit.ny * correction * (1 - share);
                    const speed = Math.max(0, (av.vx - bv.vx) * hit.nx + (av.vy - bv.vy) * hit.ny), j = speed / (1 / massA + 1 / massB);
                    av.vx -= hit.nx * j / massA;
                    av.vy -= hit.ny * j / massA;
                    bv.vx += hit.nx * j / massB;
                    bv.vy += hit.ny * j / massB;
                    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, z = Math.max(a.z, b.z) + .1;
                    queue(v, { x, y, z, nx: -hit.nx, ny: -hit.ny, nz: 0, impulse: j * .5, source: `vehicle:${other.id}` });
                    queue(other, { x, y, z, nx: hit.nx, ny: hit.ny, nz: 0, impulse: j * .5, source: `vehicle:${v.id}` });
                }
                const dozerBox: VehicleBox = { x: dozer.x, y: dozer.y, w: DOZER.radius * 1.6, d: DOZER.radius * 1.6, z: terrainHeightAt(town.terrain, dozer.x, dozer.y), h: .65, heading: dozer.heading };
                const hit = boxContact(dozerBox, a);
                if (hit && a.z + a.h > dozerBox.z + .25) {
                    const root = detachedRoot(v, a.part!), body = root === undefined ? v : v.parts[root]!, mass = assemblyMass(v, root);
                    const speed = Math.max(0, (dozer.vx - body.vx) * hit.nx + (dozer.vy - body.vy) * hit.ny);
                    dozer.x -= hit.nx * Math.min(.08, hit.depth) * mass / (mass + 8);
                    dozer.y -= hit.ny * Math.min(.08, hit.depth) * mass / (mass + 8);
                    body.x += hit.nx * Math.min(.12, hit.depth) * 8 / (mass + 8);
                    body.y += hit.ny * Math.min(.12, hit.depth) * 8 / (mass + 8);
                    queue(v, { x: a.x - hit.nx * a.w * .4, y: a.y - hit.ny * a.d * .4, z: a.z + .2, nx: hit.nx, ny: hit.ny, nz: 0, impulse: speed * 1.4, source: 'dozer' });
                }
                for (const pt of bladePoints(dozer)) {
                    const point: VehicleBox = { x: pt.x, y: pt.y, w: .16, d: .16, z: dozer.bladeDown ? .05 : .4, h: .5, heading: dozer.heading };
                    if (boxContact(point, a))
                        queue(v, { x: pt.x, y: pt.y, z: point.z + .22, nx: Math.cos(dozer.heading), ny: Math.sin(dozer.heading), nz: 0, impulse: 0, load: 24 * bladeMul, dt: sub, source: 'blade' });
                }
            }
            v.x = clamp(v.x, town.minX + d.width, town.maxX - d.width);
            v.y = clamp(v.y, town.minY + d.width, town.maxY - d.width);
        }
        for (const [v, list] of pending) {
            hitVehicle(v, list);
            if (list.some(c => c.impulse > 1))
                particles.burst('metal', list[0]!.x, list[0]!.y, list[0]!.z, .12, v.yardOwner);
        }
    }
    for (const v of town.vehicles) {
        for (const r of town.rubble) {
            if (r.sleeping)
                continue;
            for (const b of vehicleBoxes(v)) {
                const other = { x: r.x, y: r.y, w: r.w, d: r.d, z: r.elev, h: r.thickness, heading: r.heading }, hit = boxContact(b, other);
                if (!hit)
                    continue;
                const impulse = Math.max(0, -((r.vx - v.vx) * hit.nx + (r.vy - v.vy) * hit.ny)) + Math.max(0, -r.vz) * r.mass;
                hitVehicle(v, [{ x: r.x, y: r.y, z: r.elev, nx: -hit.nx, ny: -hit.ny, nz: r.vz < -.5 ? -1 : 0, impulse, source: `debris:${r.id}` }]);
                r.vx += hit.nx * .1;
                r.vy += hit.ny * .1;
                r.vz = Math.max(r.vz, 0);
                break;
            }
        }
        if (v.pendingCash) {
            cash += v.pendingCash;
            events.push({ kind: 'cash', x: v.x, y: v.y, z: 1, mag: 1, cash: v.pendingCash });
            v.pendingCash = 0;
        }
    }
    const budget = { remaining: Math.max(0, DEBRIS.activeCap - town.rubble.filter(r => !r.sleeping).length) };
    for (const v of town.vehicles)
        stepDetached(v, dt, budget, (x, y) => terrainHeightAt(town.terrain, x, y) + town.pile.heightAt(x, y));
    vehicleStats.active = town.vehicles.filter(v => !v.sleeping).length;
    vehicleStats.sleeping = town.vehicles.length - vehicleStats.active;
    vehicleStats.detached = town.vehicles.reduce((n, v) => n + v.parts.filter(s => s.detached && !s.sleeping).length, 0);
    return cash;
}
