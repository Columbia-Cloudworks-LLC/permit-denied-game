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
    let best = { nx: 0, ny: 0, depth: Infinity };
    for (const h of [a.heading, b.heading])
        for (const offset of [0, Math.PI / 2]) {
            const axis = axisOverlap(a, b, Math.cos(h + offset), Math.sin(h + offset));
            if (!axis)
                return;
            if (axis.depth < best.depth)
                best = axis;
        }
    return best;
}
/** Overlap of two boxes projected on one axis, with the normal pointing from a to b; undefined when separated. */
function axisOverlap(a: VehicleBox, b: VehicleBox, x: number, y: number): { nx: number; ny: number; depth: number } | undefined {
    const radius = (q: VehicleBox) => Math.abs(Math.cos(q.heading) * x + Math.sin(q.heading) * y) * q.w / 2 + Math.abs(-Math.sin(q.heading) * x + Math.cos(q.heading) * y) * q.d / 2;
    const dist = (b.x - a.x) * x + (b.y - a.y) * y, overlap = radius(a) + radius(b) - Math.abs(dist);
    if (overlap <= 0)
        return;
    const sign = dist >= 0 ? 1 : -1;
    return { nx: x * sign, ny: y * sign, depth: overlap };
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
        town.yard.loads = town.yard.loads.filter(l => !dropYardLoad(town, l, dt));
    const fixed = staticVehicleHash(town);
    let cash = 0;
    vehicleStats.contacts = 0;
    // At most .12 world units of predicted travel per substep, capped to bound work.
    const maxSpeed = Math.max(Math.hypot(dozer.vx, dozer.vy), ...town.vehicles.map(v => Math.hypot(v.vx, v.vy)));
    const steps = Math.min(8, Math.max(1, Math.ceil(maxSpeed * dt / .12))), sub = dt / steps;
    const ctx: SubstepContext = { town, dozer, fixed, dynamic: new SpatialHash<VehicleBox>(4), candidates: [], pending: new Map(), solvedPairs: new Set(), sub, bladeMul };
    for (let step = 0; step < steps; step++)
        runSubstep(ctx, particles);
    for (const v of town.vehicles) {
        hitByRubble(town, v);
        cash += collectWreckCash(v, events);
    }
    const budget = { remaining: Math.max(0, DEBRIS.activeCap - town.rubble.filter(r => !r.sleeping).length) };
    for (const v of town.vehicles)
        stepDetached(v, dt, budget, (x, y) => terrainHeightAt(town.terrain, x, y) + town.pile.heightAt(x, y));
    vehicleStats.active = town.vehicles.filter(v => !v.sleeping).length;
    vehicleStats.sleeping = town.vehicles.length - vehicleStats.active;
    vehicleStats.detached = town.vehicles.reduce((n, v) => n + v.parts.filter(s => s.detached && !s.sleeping).length, 0);
    return cash;
}
/** Rebuild the moving-vehicle hash, step every awake vehicle, then apply each one's gathered contacts. */
function runSubstep(ctx: SubstepContext, particles: ParticlePool): void {
    const { town, dozer } = ctx;
    ctx.dynamic.clear();
    for (const v of town.vehicles)
        for (const b of vehicleBoxes(v))
            insertBox(ctx.dynamic, b);
    ctx.pending = new Map();
    ctx.solvedPairs = new Set();
    for (const v of town.vehicles)
        if (!dormant(v, dozer))
            stepVehicleSubstep(ctx, v);
    for (const [v, list] of ctx.pending) {
        hitVehicle(v, list);
        if (list.some(c => c.impulse > 1))
            particles.burst('metal', list[0]!.x, list[0]!.y, list[0]!.z, .12, v.yardOwner);
    }
}
/** Pay out a vehicle's wreck bounty once, as a cash event. */
function collectWreckCash(v: VehicleState, events: WorldEvent[]): number {
    const cash = v.pendingCash;
    if (!cash)
        return 0;
    events.push({ kind: 'cash', x: v.x, y: v.y, z: 1, mag: 1, cash });
    v.pendingCash = 0;
    return cash;
}
/** A yard test load falls under gravity; true once it lands and loads the vehicle below. */
function dropYardLoad(town: Town, l: NonNullable<NonNullable<Town['yard']>['loads']>[number], dt: number): boolean {
    l.vz -= 12 * dt;
    l.z += l.vz * dt;
    const d = vehicleDefinition(l.vehicle.definitionId);
    if (l.z > l.vehicle.elev + d.height)
        return false;
    vehicleLoad(town, l.vehicle.x, l.vehicle.y, l.z, d.length, Math.abs(l.vz) * 1.5, 'yard-plate');
    return true;
}
const insertBox = (hash: SpatialHash<VehicleBox>, b: VehicleBox) => { const a = boxBounds(b); hash.insert(a.x, a.y, a.w, a.d, b); };
/** Ground-floor cells, fixtures and standing props, rebuilt only when any of them change. */
function staticVehicleHash(town: Town): SpatialHash<VehicleBox> {
    const stamp = town.siteRevision + ':' + town.buildings.map(b => b.id + ',' + b.visualRevision + ',' + b.cells.length).join(';') + ':' + town.props.map(p => p.id + ',' + p.broken + ',' + p.x + ',' + p.y).join(';');
    const cached = staticCache.get(town);
    if (cached?.stamp === stamp)
        return cached.hash;
    const fixed = new SpatialHash<VehicleBox>(4);
    for (const b of town.buildings)
        if (!b.retired)
            insertBuildingBoxes(fixed, b);
    for (const p of town.props)
        if (!p.broken)
            insertBox(fixed, { x: p.x + p.w / 2, y: p.y + p.d / 2, w: p.w, d: p.d, z: p.elev, h: 1, heading: p.heading });
    staticCache.set(town, { stamp, hash: fixed });
    return fixed;
}
function insertBuildingBoxes(fixed: SpatialHash<VehicleBox>, b: Town['buildings'][number]): void {
    for (const c of b.cells)
        if (c.floor === 0 && c.hp > 0) {
            const q = cellWorldBox(b, c);
            insertBox(fixed, { x: q.x + q.w / 2, y: q.y + q.d / 2, w: q.w, d: q.d, z: 0, h: 2, heading: 0 });
        }
    for (const f of b.fixtures)
        if (!f.broken && f.floor === 0)
            insertBox(fixed, { x: f.x + f.w / 2, y: f.y + f.d / 2, w: f.w, d: f.d, z: 0, h: f.h, heading: 0 });
}
/** Parked vehicles far from the dozer, with no loose parts in motion, skip the substep. */
function dormant(v: VehicleState, dozer: Dozer): boolean {
    return v.sleeping && !v.autonomous && Math.hypot(v.x - dozer.x, v.y - dozer.y) > 10 && !v.parts.some(p => p.detached && !p.sleeping);
}
interface SubstepContext {
    town: Town;
    dozer: Dozer;
    fixed: SpatialHash<VehicleBox>;
    dynamic: SpatialHash<VehicleBox>;
    /** Shared query buffer. */
    candidates: VehicleBox[];
    /** Contacts gathered per vehicle this substep, applied together at its end. */
    pending: Map<VehicleState, VehicleContact[]>;
    /** Part pairs already resolved this substep, so each pair is pushed apart once. */
    solvedPairs: Set<string>;
    sub: number;
    bladeMul: number;
}
function queueContact(ctx: SubstepContext, v: VehicleState, c: VehicleContact): void {
    let list = ctx.pending.get(v);
    if (!list) {
        list = [];
        ctx.pending.set(v, list);
    }
    list.push(c);
}
function stepVehicleSubstep(ctx: SubstepContext, v: VehicleState): void {
    const { town, sub } = ctx;
    const d = vehicleDefinition(v.definitionId);
    const prevX = v.x, prevY = v.y;
    stepVehicle(v, sub, obstacleAhead(ctx, v, d));
    if ((town.surface || town.features.length) && terrainTraversalAt(town.features, v.x, v.y, town.surface) !== 'open') {
      const resolved = resolveTraversal(v.x, v.y, prevX, prevY, town.features, town.surface);
      v.x = resolved.x;
      v.y = resolved.y;
      if (resolved.blocked) { v.vx *= 0.2; v.vy *= 0.2; }
    }
    settleOnGround(town, v, d, sub);
    for (const a of vehicleBoxes(v)) {
        const bounds = boxBounds(a);
        solidContacts(ctx, v, a, bounds);
        vehicleContacts(ctx, v, a, bounds);
        dozerContact(ctx, v, a);
        bladeContacts(ctx, v, a);
    }
    v.x = clamp(v.x, town.minX + d.width, town.maxX - d.width);
    v.y = clamp(v.y, town.minY + d.width, town.maxY - d.width);
}
/** Whether a short box just ahead of the nose touches anything solid or another vehicle. */
function obstacleAhead(ctx: SubstepContext, v: VehicleState, d: ReturnType<typeof vehicleDefinition>): boolean {
    const { candidates } = ctx;
    const nose = { x: v.x + Math.cos(v.heading) * (d.length / 2 + .7), y: v.y + Math.sin(v.heading) * (d.length / 2 + .7), w: .6, d: d.width, z: v.elev, h: 1, heading: v.heading };
    const ahead = boxBounds(nose);
    ctx.fixed.query(ahead.x, ahead.y, ahead.w, ahead.d, candidates);
    let obstacle = candidates.some(b => boxContact(nose, b));
    ctx.dynamic.query(ahead.x, ahead.y, ahead.w, ahead.d, candidates);
    obstacle ||= candidates.some(b => b.vehicle !== v && boxContact(nose, b) !== undefined);
    return obstacle;
}
/** Ride the road or terrain, sink into rubble up to ground clearance, and drag through the excess. */
function settleOnGround(town: Town, v: VehicleState, d: ReturnType<typeof vehicleDefinition>, sub: number): void {
    const road = roadSurfaceAt(town.network, v.x, v.y, v.layer), ground = road.on ? road.elev : terrainHeightAt(town.terrain, v.x, v.y);
    const pile = town.pile.sample(v.x, v.y), resistance = Math.max(0, pile.height - d.drive.clearance);
    v.vx *= Math.exp(-resistance * sub * 6 / d.drive.traction);
    v.vy *= Math.exp(-resistance * sub * 6 / d.drive.traction);
    v.elev = ground + Math.min(pile.height, d.drive.clearance);
}
const contactBody = (v: VehicleState, root: number | undefined) => root === undefined ? v : v.parts[root]!;
/** Push a part's assembly out of static boxes and cancel its velocity into them. */
function solidContacts(ctx: SubstepContext, v: VehicleState, a: VehicleBox, bounds: ReturnType<typeof boxBounds>): void {
    ctx.fixed.query(bounds.x, bounds.y, bounds.w, bounds.d, ctx.candidates);
    for (const b of ctx.candidates) {
        const hit = boxContact(a, b);
        if (!hit)
            continue;
        vehicleStats.contacts++;
        const body = contactBody(v, detachedRoot(v, a.part!));
        body.x -= hit.nx * Math.min(.18, hit.depth);
        body.y -= hit.ny * Math.min(.18, hit.depth);
        const impulse = Math.max(0, body.vx * hit.nx + body.vy * hit.ny);
        body.vx -= hit.nx * impulse;
        body.vy -= hit.ny * impulse;
        queueContact(ctx, v, { x: a.x + hit.nx * a.w * .4, y: a.y + hit.ny * a.d * .4, z: a.z + a.h * .5, nx: -hit.nx, ny: -hit.ny, nz: 0, impulse, source: 'solid' });
    }
}
function vehicleContacts(ctx: SubstepContext, v: VehicleState, a: VehicleBox, bounds: ReturnType<typeof boxBounds>): void {
    ctx.dynamic.query(bounds.x, bounds.y, bounds.w, bounds.d, ctx.candidates);
    for (const b of ctx.candidates) {
        const other = b.vehicle!;
        if (other === v)
            continue;
        const pair = v.id < other.id ? `${v.id}:${a.part}/${other.id}:${b.part}` : `${other.id}:${b.part}/${v.id}:${a.part}`;
        if (ctx.solvedPairs.has(pair)) continue;
        const hit = boxContact(a, b);
        if (!hit)
            continue;
        ctx.solvedPairs.add(pair);
        vehicleStats.contacts++;
        collideVehicles(ctx, v, a, other, b, hit);
    }
}
/** Separate two assemblies by mass share and exchange an inelastic impulse along the normal. */
function collideVehicles(ctx: SubstepContext, v: VehicleState, a: VehicleBox, other: VehicleState, b: VehicleBox, hit: { nx: number; ny: number; depth: number }): void {
    const ar = detachedRoot(v, a.part!), br = detachedRoot(other, b.part!), av = contactBody(v, ar), bv = contactBody(other, br);
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
    queueContact(ctx, v, { x, y, z, nx: -hit.nx, ny: -hit.ny, nz: 0, impulse: j * .5, source: `vehicle:${other.id}` });
    queueContact(ctx, other, { x, y, z, nx: hit.nx, ny: hit.ny, nz: 0, impulse: j * .5, source: `vehicle:${v.id}` });
}
/** The dozer body shoves a part above its deck; the lighter side gives way more. */
function dozerContact(ctx: SubstepContext, v: VehicleState, a: VehicleBox): void {
    const { dozer, town } = ctx;
    const dozerBox: VehicleBox = { x: dozer.x, y: dozer.y, w: DOZER.radius * 1.6, d: DOZER.radius * 1.6, z: terrainHeightAt(town.terrain, dozer.x, dozer.y), h: .65, heading: dozer.heading };
    const hit = boxContact(dozerBox, a);
    if (!hit || a.z + a.h <= dozerBox.z + .25)
        return;
    const root = detachedRoot(v, a.part!), body = contactBody(v, root), mass = assemblyMass(v, root);
    const speed = Math.max(0, (dozer.vx - body.vx) * hit.nx + (dozer.vy - body.vy) * hit.ny);
    dozer.x -= hit.nx * Math.min(.08, hit.depth) * mass / (mass + 8);
    dozer.y -= hit.ny * Math.min(.08, hit.depth) * mass / (mass + 8);
    body.x += hit.nx * Math.min(.12, hit.depth) * 8 / (mass + 8);
    body.y += hit.ny * Math.min(.12, hit.depth) * 8 / (mass + 8);
    queueContact(ctx, v, { x: a.x - hit.nx * a.w * .4, y: a.y - hit.ny * a.d * .4, z: a.z + .2, nx: hit.nx, ny: hit.ny, nz: 0, impulse: speed * 1.4, source: 'dozer' });
}
/** Each blade point touching the part applies a crushing load for this substep. */
function bladeContacts(ctx: SubstepContext, v: VehicleState, a: VehicleBox): void {
    const { dozer } = ctx;
    for (const pt of bladePoints(dozer)) {
        const point: VehicleBox = { x: pt.x, y: pt.y, w: .16, d: .16, z: dozer.bladeDown ? .05 : .4, h: .5, heading: dozer.heading };
        if (boxContact(point, a))
            queueContact(ctx, v, { x: pt.x, y: pt.y, z: point.z + .22, nx: Math.cos(dozer.heading), ny: Math.sin(dozer.heading), nz: 0, impulse: 0, load: 24 * ctx.bladeMul, dt: ctx.sub, source: 'blade' });
    }
}
/** Moving debris strikes the first part it touches and bounces off it. */
function hitByRubble(town: Town, v: VehicleState): void {
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
}
