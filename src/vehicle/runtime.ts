import { approach, clamp, wrapAngle } from '../game/math';
import { vehicleDefinition } from './definitions';
import type { PartPose, VehicleContact, VehicleState } from './types';
let sequence = 1;
export function resetVehicleIds(): void { sequence = 1; }
export function createVehicle(id: string, x: number, y: number, heading = 0, variant = 0): VehicleState {
    const d = vehicleDefinition(id);
    return { scale: 1, id: sequence++, definitionId: id, variant: ((variant % 2) + 2) % 2, lotId: null, x, y, heading, vx: 0, vy: 0, omega: 0, elev: 0,
        alive: true, layer: 0, odo: 0, laneId: null, route: [], routeIndex: 0, waitT: 0, reversing: false,
        status: 'operational', paid: false, pendingCash: 0, pitch: 0, roll: 0, steer: 0, waypoints: [], waypoint: 0, autonomous: false,
        routeStatus: 'parked', reverseRemaining: 0, delay: 0, retries: 0, sleeping: true, rest: 0, revision: 0, debugParts: false,
        compact: { amount: 0, target: 0, front: 0, rear: 0, sideP: 0, sideN: 0, top: 0, lx: 0, ly: 0 },
        parts: d.parts.map(() => ({ damage: 0, mountDamage: 0, bendX: 0, bendY: 0, crush: 0, detached: false, x: 0, y: 0, z: 0, heading: 0, vx: 0, vy: 0, vz: 0, omega: 0, sleeping: true, rest: 0 })) };
}
type VehicleDef = ReturnType<typeof vehicleDefinition>;
type PartDef = VehicleDef['parts'][number];
type PartState = VehicleState['parts'][number];
const scaledPart = (p: PartDef, scale: number): PartDef => ({ ...p, x: p.x * scale, y: p.y * scale, z: p.z * scale, length: p.length * scale, width: p.width * scale, height: p.height * scale });
/**
 * Crush tuning. `strength` is the hit amount that fully compacts a mass-2 car; `length`, `width`
 * and `height` are the most each dimension gives up; `sag` is how far the roof drops from hits
 * that were not from above. Hits set a target and the body folds toward it at `rate` per second. Past `disabled` the car stops driving and past `wreck` it pays out.
 * A crushed wreck weighs `1 + heft` times its mass to anything shoving it and drags on the ground.
 * Knocks from other vehicles and from walls below `bump` leave no mark and harder ones count for `bumpShare`,
 * so traffic survives a fender-bender.
 */
export const CRUSH = {
    strength: 160, rate: 1.8, length: .45, width: .4, height: .6, sag: .3, disabled: .3, wreck: .65,
    heft: 2.5, drag: 5, knock: .45, bump: 3.5, bumpShare: .5, shedAt: [.35, .75], shedChance: [.8, .4],
} as const;
/**
 * Rail car tuning. On the rails a car rolls along its line under `roll` drag and is pulled back
 * to the centre line at `grip` per second; pushed more than `throw` units off it, it derails.
 * A derailed car is thrown sideways at `kick` units/s or the speed it was shoved at, slides under
 * `slide` drag, lies over by `tip` radians and pays `bonus` once. A car coupled to it (within
 * `coupling` units, end to end) is dragged off at `chain` of that speed, while that is still
 * `chainMin` or more. A sliding car that meets a wall at over `wallSpeed` breaks into it:
 * `wall` damage per unit of speed and mass to the ground-floor cells within `reach`, keeping
 * `carry` of its speed.
 */
export const RAIL = {
    grip: 5, throw: .42, kick: 6.5, roll: .5, slide: 1.5, tip: .42, bonus: 100,
    coupling: .9, chain: .55, chainMin: 2.4, wallSpeed: 1.5, wall: 1.6, reach: 1.3, carry: .45, gap: .28,
} as const;
/** Repeatable 0–1 value for a vehicle and a slot, so crumpling and shed wheels replay identically. */
function crushNoise(id: number, slot: number): number {
    let h = Math.imul(id | 0, 73856093) ^ Math.imul(slot | 0, 19349663);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** The part in vehicle space, squeezed toward the sides that were hit. Loose parts keep their shape. */
function localPart(v: VehicleState, d: VehicleDef, index: number): PartDef {
    const p = scaledPart(d.parts[index]!, v.scale), k = v.compact;
    if (!k.amount || v.parts[index]!.detached)
        return p;
    // The sides hold shares of the target; the body has folded this fraction of the way there.
    const r = k.amount / k.target, front = k.front * r, rear = k.rear * r, sideP = k.sideP * r, sideN = k.sideN * r, top = k.top * r;
    const sx = 1 - CRUSH.length * (front + rear), sy = 1 - CRUSH.width * (sideP + sideN);
    const sz = 1 - CRUSH.height * top - CRUSH.sag * (k.amount - top);
    const x = (rear - front) * CRUSH.length * d.length * v.scale / 2 + p.x * sx;
    const y = (sideN - sideP) * CRUSH.width * d.width * v.scale / 2 + p.y * sy;
    // Tyres flatten a little but stay round; everything else takes the full squeeze.
    if (p.role === 'wheel')
        return { ...p, x, y, height: p.height * (1 - .3 * k.amount) };
    return { ...p, x, y, z: p.z * sz, length: p.length * sx, width: p.width * sy, height: p.height * sz };
}
export function partPose(v: VehicleState, index: number): PartPose {
    const d = vehicleDefinition(v.definitionId), p = localPart(v, d, index), s = v.parts[index]!;
    const base = { length: p.length * (1 - s.damage * p.deform * .2), width: p.width, height: Math.max(.06, p.height * (1 - s.crush * p.deform)), shearX: s.bendX, shearY: s.bendY, pitch: v.pitch + (p.pitch ?? 0), roll: v.roll };
    if (s.detached)
        return { ...base, x: s.x, y: s.y, z: s.z, heading: s.heading, pitch: 0, roll: 0 };
    const at = {
        x: v.x + Math.cos(v.heading) * p.x - Math.sin(v.heading) * p.y,
        y: v.y + Math.sin(v.heading) * p.x + Math.cos(v.heading) * p.y,
        z: v.elev + Math.max(0, p.z + v.pitch * p.x + v.roll * p.y), heading: v.heading,
    };
    if (p.parent) {
        const pi = d.parts.findIndex(q => q.id === p.parent), pp = localPart(v, d, pi), pose = partPose(v, pi);
        if (p.surface)
            return surfacePose(base, p, pp, pose);
        followParent(v, at, p, pp, v.parts[pi]!, pose);
    }
    if (p.role === 'trailer') {
        at.heading = v.heading + s.heading;
        at.x = v.x + Math.cos(v.heading) * (-d.length * .52) + Math.cos(at.heading) * (p.x + d.length * .52);
        at.y = v.y + Math.sin(v.heading) * (-d.length * .52) + Math.sin(at.heading) * (p.x + d.length * .52);
    }
    if (steeredWheel(d, d.parts[index]!))
        at.heading += v.steer;
    at.heading += s.bendY * .5;
    return { ...base, ...at };
}
/** A panel mounted on a parent's face stretches and shears with that face. */
function surfacePose(base: Omit<PartPose, 'x' | 'y' | 'z' | 'heading'>, p: PartDef, pp: PartDef, pose: PartPose): PartPose {
    const heightRatio = pose.height / pp.height, lengthRatio = pose.length / pp.length;
    const fraction = (p.z - pp.z) / pp.height;
    const a = (p.x - pp.x) * lengthRatio + pose.shearX * fraction;
    const b = p.y - pp.y + pose.shearY * fraction;
    const top = p.surface === 'top';
    return { ...base,
        x: pose.x + Math.cos(pose.heading) * a - Math.sin(pose.heading) * b,
        y: pose.y + Math.sin(pose.heading) * a + Math.cos(pose.heading) * b,
        z: Math.max(0, pose.z + (p.z - pp.z) * heightRatio + pose.pitch * a + pose.roll * b),
        heading: pose.heading, pitch: pose.pitch, roll: pose.roll,
        length: base.length * lengthRatio,
        height: top ? base.height : base.height * heightRatio,
        shearX: base.shearX + (top ? 0 : pose.shearX * p.height / pp.height),
        shearY: base.shearY + (top ? 0 : pose.shearY * p.height / pp.height),
    };
}
/** A child rides its parent once the parent turns or comes loose, then carries the parent's bend and crush. */
function followParent(v: VehicleState, at: { x: number; y: number; z: number; heading: number }, p: PartDef, pp: PartDef, ps: PartState, pose: PartPose): void {
    if (ps.detached || pp.role === 'trailer' || Math.abs(pose.heading - v.heading) > .001) {
        at.x = pose.x + Math.cos(pose.heading) * (p.x - pp.x) - Math.sin(pose.heading) * (p.y - pp.y);
        at.y = pose.y + Math.sin(pose.heading) * (p.x - pp.x) + Math.cos(pose.heading) * (p.y - pp.y);
        at.z = Math.max(0, pose.z + p.z - pp.z);
        at.heading = pose.heading;
    }
    at.x += Math.cos(at.heading) * ps.bendX - Math.sin(at.heading) * ps.bendY;
    at.y += Math.sin(at.heading) * ps.bendX + Math.cos(at.heading) * ps.bendY;
    at.z = Math.max(v.elev, at.z - ps.crush * pp.height * pp.deform * .5);
}
function steeredWheel(d: VehicleDef, p: PartDef): boolean {
    if (p.role !== 'wheel' || p.id.startsWith('trailer'))
        return false;
    return (d.drive.steering === 'front' && p.x > 0) || (d.drive.steering === 'rear' && p.x < 0);
}
export function detachedRoot(v: VehicleState, index: number): number | undefined {
    const d = vehicleDefinition(v.definitionId);
    let i = index;
    while (i >= 0) {
        if (v.parts[i]!.detached)
            return i;
        const parent = d.parts[i]!.parent;
        i = parent ? d.parts.findIndex(p => p.id === parent) : -1;
    }
    return undefined;
}
export function assemblyMass(v: VehicleState, root?: number): number {
    return vehicleDefinition(v.definitionId).parts.reduce((n, p, i) => n + (detachedRoot(v, i) === root ? p.mass : 0), 0);
}
/** How heavy an assembly is to shove: its mass, and more for a crushed hull dragging on the ground. */
export function pushMass(v: VehicleState, root?: number): number {
    const mass = assemblyMass(v, root);
    return root === undefined && v.status !== 'operational' ? mass * (1 + CRUSH.heft * v.compact.amount) : mass;
}
export function hitVehicle(v: VehicleState, contacts: readonly VehicleContact[]): void {
    const d = vehicleDefinition(v.definitionId);
    for (const c of strongestPerSource(contacts)) {
        const nearest = nearestPart(v, d, c);
        if (nearest === undefined)
            continue;
        if (!d.crushable)
            applyContact(v, d, nearest, c);
        else if (detachedRoot(v, nearest) === undefined)
            crushContact(v, d, c);
        else {
            // A wheel that already rolled off is only knocked along.
            pushAssembly(v, d, nearest, c);
            v.revision++;
        }
    }
    updateVehicleStatus(v, d);
}
/** A hit on a crushable hull: compact it from the struck side and pass on only part of the shove. */
function crushContact(v: VehicleState, d: VehicleDef, c: VehicleContact): void {
    const soft = c.source === 'solid' || c.source.startsWith('vehicle:');
    const amount = Math.max(0, c.impulse - (soft ? CRUSH.bump : .45)) * 6 * (soft ? CRUSH.bumpShare : 1) + Math.max(0, c.load ?? 0) * Math.max(0, c.dt ?? 0);
    const f = Math.cos(v.heading), g = Math.sin(v.heading);
    // Hit-rated vehicles (police) crush by counted hits instead, while they still run.
    if (amount > 0 && !(v.wreckAfterHits !== undefined && v.status === 'operational'))
        compactVehicle(v, amount / (CRUSH.strength * Math.sqrt(d.mass / 2)), f * c.nx + g * c.ny, -g * c.nx + f * c.ny, c.nz);
    // Crumpling soaks up the blow, so the hull is shoved rather than thrown.
    const mass = Math.max(.5, pushMass(v)), impulse = c.impulse * CRUSH.knock;
    v.vx += c.nx * impulse / mass;
    v.vy += c.ny * impulse / mass;
    v.omega += ((c.x - v.x) * c.ny - (c.y - v.y) * c.nx) * impulse * .5 / (mass * d.length * d.length);
    v.sleeping = false;
    v.rest = 0;
    v.revision++;
}
/**
 * Raise the compaction target by `delta` of a full crush. `lx`, `ly` and `nz` are the push
 * direction in vehicle space: a push toward the rear folds the front in, a push down drops the roof.
 */
function compactVehicle(v: VehicleState, delta: number, lx: number, ly: number, nz: number): void {
    const k = v.compact;
    delta = Math.min(delta, 1 - k.target);
    if (delta <= 0)
        return;
    const n = Math.hypot(lx, ly, nz);
    const wx = n ? (lx / n) ** 2 : 0, wy = n ? (ly / n) ** 2 : 0, wz = n ? (nz / n) ** 2 : 1;
    if (lx < 0) k.front += delta * wx; else k.rear += delta * wx;
    if (ly < 0) k.sideP += delta * wy; else k.sideN += delta * wy;
    k.top += delta * wz;
    k.target += delta;
    k.lx = lx;
    k.ly = ly;
}
/** Fold the body toward its compaction target; true while it is still folding. */
function advanceCompaction(v: VehicleState, d: VehicleDef, dt: number): boolean {
    const k = v.compact, before = k.amount;
    if (before >= k.target)
        return false;
    k.amount = Math.min(k.target, before + CRUSH.rate * dt);
    d.parts.forEach((p, i) => {
        const s = v.parts[i]!;
        if (s.detached)
            return;
        s.damage = Math.max(s.damage, k.amount);
        if (p.role === 'frame' || p.role === 'wheel' || p.role === 'track')
            return;
        // Panels buckle out of square, each its own way.
        s.bendX = (crushNoise(v.id, i * 2) - .5) * .3 * k.amount * v.scale;
        s.bendY = (crushNoise(v.id, i * 2 + 1) - .5) * .2 * k.amount * v.scale;
    });
    CRUSH.shedAt.forEach((at, slot) => {
        if (before < at && k.amount >= at && crushNoise(v.id, 100 + slot) < CRUSH.shedChance[slot]!)
            shedWheel(v, d, k.lx, k.ly, slot);
    });
    updateVehicleStatus(v, d);
    v.revision++;
    return true;
}
/** The wheel nearest the blow breaks off and rolls away sideways. */
function shedWheel(v: VehicleState, d: VehicleDef, lx: number, ly: number, slot: number): void {
    let pick = -1, best = -Infinity;
    d.parts.forEach((p, i) => {
        const score = -(p.x * lx + p.y * ly);
        if (p.role === 'wheel' && !v.parts[i]!.detached && score > best) {
            best = score;
            pick = i;
        }
    });
    if (pick < 0)
        return;
    const p = d.parts[pick]!, pose = partPose(v, pick), f = Math.cos(v.heading), g = Math.sin(v.heading);
    // Out to its own side, carried along by the push, with a little scatter.
    const ax = lx * .7 + (crushNoise(v.id, 110 + slot) - .5), ay = Math.sign(p.y || 1) + ly * .7, al = Math.hypot(ax, ay) || 1;
    const speed = 3.5 + crushNoise(v.id, 120 + slot) * 2.5;
    const vx = v.vx + (f * ax - g * ay) / al * speed, vy = v.vy + (g * ax + f * ay) / al * speed;
    Object.assign(v.parts[pick]!, { detached: true, x: pose.x, y: pose.y, z: pose.z, heading: Math.atan2(vy, vx), vx, vy, vz: 1.2, omega: 0, sleeping: false, rest: 0 });
}
const contactStrength = (c: VehicleContact) => c.impulse + (c.load ?? 0) * (c.dt ?? 0);
/** Finite contacts only, keeping the strongest from each source. */
function strongestPerSource(contacts: readonly VehicleContact[]): Iterable<VehicleContact> {
    const unique = new Map<string, VehicleContact>();
    for (const c of contacts) {
        if (![c.x, c.y, c.z, c.nx, c.ny, c.nz, c.impulse, c.load ?? 0, c.dt ?? 0].every(Number.isFinite))
            continue;
        const old = unique.get(c.source);
        if (!old || contactStrength(c) > contactStrength(old))
            unique.set(c.source, c);
    }
    return unique.values();
}
/** The part whose box is closest to the contact, within reach. */
function nearestPart(v: VehicleState, d: VehicleDef, c: VehicleContact): number | undefined {
    let nearest = -1, distance = Infinity;
    for (let i = 0; i < d.parts.length; i++) {
        const p = partPose(v, i), dx = c.x - p.x, dy = c.y - p.y, a = Math.cos(p.heading) * dx + Math.sin(p.heading) * dy, b = -Math.sin(p.heading) * dx + Math.cos(p.heading) * dy;
        const dist = Math.hypot(Math.max(0, Math.abs(a) - p.length / 2), Math.max(0, Math.abs(b) - p.width / 2), Math.max(p.z - c.z, 0, c.z - p.z - p.height));
        const score = dist + partTargetBias(d.parts[i]!, v.parts[i]!);
        if (score < distance) {
            nearest = i;
            distance = score;
        }
    }
    return nearest < 0 || distance > .8 ? undefined : nearest;
}
/** Skin beats the frame when regions overlap; do not repeatedly target already missing glass. */
function partTargetBias(p: PartDef, s: PartState): number {
    if (p.role === 'frame')
        return .025;
    return p.role === 'glass' && s.damage >= 1 ? 2 : 0;
}
/** Damage, bend and crush the struck part, pass some damage up its parents, detach it if its mount fails, and push its assembly. */
function applyContact(v: VehicleState, d: VehicleDef, nearest: number, c: VehicleContact): void {
    const p = d.parts[nearest]!, s = v.parts[nearest]!, pose = partPose(v, nearest);
    const amount = Math.max(0, c.impulse - .45) * 6 + Math.max(0, c.load ?? 0) * Math.max(0, c.dt ?? 0);
    const nx = Math.cos(pose.heading) * c.nx + Math.sin(pose.heading) * c.ny, ny = -Math.sin(pose.heading) * c.nx + Math.cos(pose.heading) * c.ny;
    s.damage = clamp(s.damage + amount / p.strength, 0, 1);
    s.mountDamage += amount / p.mount;
    s.bendX = clamp(s.bendX + nx * amount / p.strength * .35, -p.deform, p.deform);
    s.bendY = clamp(s.bendY + ny * amount / p.strength * .35, -p.deform, p.deform);
    s.crush = clamp(s.crush + amount / p.strength * (c.nz < 0 ? 1 : .3), 0, 1);
    damageParents(v, d, p, amount, c.nz);
    if (s.mountDamage >= 1 && p.parent && p.role !== 'engine' && !s.detached && detachedRoot(v, nearest) === undefined) {
        Object.assign(s, { detached: true, x: pose.x, y: pose.y, z: pose.z, heading: pose.heading, vx: v.vx - v.omega * (pose.y - v.y), vy: v.vy + v.omega * (pose.x - v.x), vz: Math.max(0, c.nz) * c.impulse * .2, omega: ny * .8, sleeping: false, rest: 0 });
    }
    pushAssembly(v, d, nearest, c);
    v.revision++;
}
/** Each parent up the chain takes a shrinking share of the hit. */
function damageParents(v: VehicleState, d: VehicleDef, p: PartDef, amount: number, nz: number): void {
    let parent = p.parent, factor = .25;
    while (parent) {
        const j = d.parts.findIndex(q => q.id === parent), q = d.parts[j]!, t = v.parts[j]!;
        t.damage = clamp(t.damage + amount * factor / q.strength, 0, 1);
        t.crush = clamp(t.crush + amount * factor / q.strength * (nz < 0 ? 1 : .12), 0, 1);
        parent = q.parent;
        factor *= .6;
    }
}
/** The impulse moves the whole vehicle, or only the loose assembly the part now belongs to. */
function pushAssembly(v: VehicleState, d: VehicleDef, nearest: number, c: VehicleContact): void {
    const root = detachedRoot(v, nearest), mass = Math.max(.5, assemblyMass(v, root));
    if (root !== undefined) {
        const body = v.parts[root]!;
        body.vx += c.nx * c.impulse / mass;
        body.vy += c.ny * c.impulse / mass;
        body.sleeping = false;
        body.rest = 0;
        return;
    }
    v.vx += c.nx * c.impulse / mass;
    v.vy += c.ny * c.impulse / mass;
    v.omega += ((c.x - v.x) * c.ny - (c.y - v.y) * c.nx) * c.impulse / (mass * d.length * d.length);
    v.sleeping = false;
    v.rest = 0;
}
/** A wrecked frame or mostly ruined mass wrecks the vehicle; a dead engine or half the running gear disables it. */
function updateVehicleStatus(v: VehicleState, d: VehicleDef): void {
    if (v.wreckAfterHits !== undefined) {
        if ((v.hits ?? 0) >= v.wreckAfterHits)
            v.status = 'wreck';
        settleStatus(v, d);
        return;
    }
    if (d.crushable) {
        if (v.compact.amount >= CRUSH.wreck)
            v.status = 'wreck';
        else if (v.compact.amount >= CRUSH.disabled && v.status === 'operational')
            v.status = 'disabled';
        settleStatus(v, d);
        return;
    }
    const frame = v.parts[0]!.damage, engine = v.parts[d.parts.findIndex(p => p.role === 'engine')]!.damage;
    const supports = d.parts.map((p, i) => ({ p, s: v.parts[i]! })).filter(({ p }) => (p.role === 'wheel' || p.role === 'track') && !p.id.startsWith('trailer'));
    const lost = supports.filter(({ s }) => s.detached || s.damage > .85).length;
    if (frame >= .85 || v.parts.reduce((n, s, i) => n + s.damage * d.parts[i]!.mass, 0) / d.mass > .72)
        v.status = 'wreck';
    else if (engine >= .9 || lost >= Math.ceil(supports.length / 2))
        v.status = 'disabled';
    settleStatus(v, d);
}
/** A vehicle out of operation parks; a wreck pays its bounty once. */
function settleStatus(v: VehicleState, d: VehicleDef): void {
    if (v.status !== 'operational') {
        v.control = undefined;
        v.autonomous = false;
        v.routeStatus = 'parked';
    }
    if (v.status === 'wreck' && !v.paid) {
        v.paid = true;
        v.pendingCash += d.cash;
    }
}
/** Count one heavy hit against a hit-rated vehicle; true when that hit wrecks it. */
export function countVehicleHit(v: VehicleState): boolean {
    if (v.wreckAfterHits === undefined || v.status === 'wreck')
        return false;
    v.hits = (v.hits ?? 0) + 1;
    const d = vehicleDefinition(v.definitionId), share = 1 / v.wreckAfterHits;
    // Show the count on the body: a crushable hull folds in from the nose a step per hit.
    if (d.crushable)
        compactVehicle(v, share, -1, 0, 0);
    // Otherwise skin and glass dent and crush a step per hit.
    else d.parts.forEach((p, i) => {
        if (p.role !== 'panel' && p.role !== 'glass' && p.role !== 'cab')
            return;
        const s = v.parts[i]!;
        s.damage = clamp(s.damage + share * .9, 0, 1);
        s.crush = clamp(s.crush + share * .35, 0, 1);
        s.bendY = clamp(s.bendY + (i % 2 ? 1 : -1) * share * .25 * p.deform, -p.deform, p.deform);
    });
    v.revision++;
    updateVehicleStatus(v, d);
    return (v.status as VehicleState['status']) === 'wreck';
}
export function runVehicle(v: VehicleState, waypoints: {
    x: number;
    y: number;
}[], delay = 0): void {
    if (v.status !== 'operational')
        return;
    v.loop = true;
    v.waypoints = waypoints.map(p => ({ ...p }));
    v.waypoint = 0;
    v.autonomous = true;
    v.sleeping = false;
    v.routeStatus = 'driving';
    v.delay = delay;
    v.retries = 0;
    v.waitT = 0;
    v.reverseRemaining = 0;
    v.reversing = false;
}
export function parkVehicle(v: VehicleState): void { v.autonomous = false; v.routeStatus = 'parked'; v.waypoints = []; }
export function stepVehicle(v: VehicleState, dt: number, obstacle = false): void {
    const d = vehicleDefinition(v.definitionId), f = Math.cos(v.heading), g = Math.sin(v.heading);
    if (advanceCompaction(v, d, dt)) {
        v.sleeping = false;
        v.rest = 0;
    }
    if (v.delay > 0) {
        v.delay -= dt;
        v.routeStatus = 'waiting';
        return;
    }
    if (v.control && v.status === 'operational')
        driveControlled(v, d, v.control, dt, f, g);
    else if (v.autonomous && v.status === 'operational' && v.waypoints.length) {
        if (!driveRoute(v, d, dt, obstacle, f, g))
            return;
    }
    else {
        // A crushed hull scrapes along on its belly.
        const base = v.rail ? (v.rail.derailed ? RAIL.slide : RAIL.roll) : 2.8;
        const drag = Math.exp(-(base + (v.status === 'operational' ? 0 : CRUSH.drag * v.compact.amount)) * dt);
        v.vx *= drag;
        v.vy *= drag;
        v.steer *= drag;
    }
    if (!v.sleeping)
        integrateVehicle(v, dt, f, g);
    settleSuspension(v, d, dt, f, g);
}
/** Steer and drive toward the current waypoint. False when the vehicle parks at the end of a one-way route. */
function driveRoute(v: VehicleState, d: VehicleDef, dt: number, obstacle: boolean, f: number, g: number): boolean {
    const target = v.waypoints[v.waypoint]!, dx = target.x - v.x, dy = target.y - v.y;
    if (Math.hypot(dx, dy) < Math.max(.35, d.length * .25)) {
        if (v.waypoint === v.waypoints.length - 1 && v.loop === false) {
            parkVehicle(v);
            v.vx = 0;
            v.vy = 0;
            return false;
        }
        v.waypoint = (v.waypoint + 1) % v.waypoints.length;
    }
    const angle = wrapAngle(Math.atan2(dy, dx) - v.heading);
    trackObstruction(v, dt, obstacle);
    const reverse = v.reversing;
    v.routeStatus = v.autonomous ? (reverse ? 'reversing' : obstacle ? 'waiting' : 'driving') : v.routeStatus;
    const running = d.parts.flatMap((p, i) => (p.role === 'wheel' || p.role === 'track') && !p.id.startsWith('trailer') ? [v.parts[i]!.damage] : []);
    const runningHealth = 1 - running.reduce((a, b) => a + b, 0) / Math.max(1, running.length);
    const health = Math.max(.1, (1 - v.parts[1]!.damage) * runningHealth);
    const speed = routeSpeed(v, d, reverse, obstacle, angle, health);
    const along = v.vx * f + v.vy * g, next = approach(along, speed, d.drive.accel * dt);
    turnToward(v, d, angle, next, runningHealth, dt);
    const damping = Math.exp(-d.drive.traction * Math.max(.2, runningHealth) * 10 * dt);
    v.vx = next * Math.cos(v.heading) + (v.vx - along * f) * damping;
    v.vy = next * Math.sin(v.heading) + (v.vy - along * g) * damping;
    v.sleeping = false;
    return true;
}
/** Bicycle model under an AI driver: approach the target speed, turn by steer angle over wheelbase. */
function driveControlled(v: VehicleState, d: VehicleDef, c: NonNullable<VehicleState['control']>, dt: number, f: number, g: number): void {
    const running = d.parts.flatMap((p, i) => (p.role === 'wheel' || p.role === 'track') && !p.id.startsWith('trailer') ? [v.parts[i]!.damage] : []);
    const health = Math.max(.15, 1 - running.reduce((a, b) => a + b, 0) / Math.max(1, running.length));
    const along = v.vx * f + v.vy * g;
    const next = approach(along, c.speed * health, c.accel * dt);
    v.steer = approach(v.steer, clamp(c.steer, -.65, .65), dt * 3.2);
    const turn = Math.tan(v.steer) * next / (d.drive.wheelbase * v.scale);
    v.heading = wrapAngle(v.heading + turn * dt);
    const damping = Math.exp(-d.drive.traction * health * 10 * dt);
    v.vx = next * Math.cos(v.heading) + (v.vx - along * f) * damping;
    v.vy = next * Math.sin(v.heading) + (v.vy - along * g) * damping;
    v.sleeping = false;
    v.routeStatus = c.speed < 0 ? 'reversing' : Math.abs(c.speed) < .05 ? 'waiting' : 'driving';
}
/** Steer toward the waypoint; tracks turn in place, wheels turn by speed over wheelbase. Trailers lag the turn. */
function turnToward(v: VehicleState, d: VehicleDef, angle: number, speed: number, runningHealth: number, dt: number): void {
    const flip = d.drive.steering === 'rear' ? -1 : 1;
    v.steer = approach(v.steer, clamp(angle, -.65, .65) * flip * Math.max(.25, runningHealth), dt * 2);
    const rate = d.drive.steering === 'tracks' ? clamp(angle, -d.drive.turn, d.drive.turn) : flip * Math.tan(v.steer) * speed / d.drive.wheelbase;
    const turnDelta = rate * dt;
    v.heading = wrapAngle(v.heading + turnDelta);
    for (let i = 0; i < d.parts.length; i++)
        if (d.parts[i]!.role === 'trailer' && !v.parts[i]!.detached)
            v.parts[i]!.heading = clamp(v.parts[i]!.heading - turnDelta, -.8, .8);
}
/** Backs off briefly after two seconds blocked; parks as blocked after three tries. */
function trackObstruction(v: VehicleState, dt: number, obstacle: boolean): void {
    if (v.reversing) {
        v.reverseRemaining -= dt;
        if (v.reverseRemaining <= 0) {
            v.reversing = false;
            v.waitT = 0;
        }
        return;
    }
    v.waitT = obstacle ? v.waitT + dt : Math.max(0, v.waitT - dt);
    if (v.waitT <= 2)
        return;
    v.retries++;
    v.waitT = 0;
    if (v.retries >= 3) {
        parkVehicle(v);
        v.routeStatus = 'blocked';
    }
    else {
        v.reversing = true;
        v.reverseRemaining = .8;
    }
}
/** Slow reverse, stopped for an obstacle, else cruise slowed by turn angle and damage. */
function routeSpeed(v: VehicleState, d: VehicleDef, reverse: boolean, obstacle: boolean, angle: number, health: number): number {
    if (!v.autonomous)
        return 0;
    if (reverse)
        return -d.drive.speed * .3;
    return obstacle ? 0 : d.drive.speed * Math.max(.12, 1 - Math.abs(angle) / 1.4) * health;
}
function integrateVehicle(v: VehicleState, dt: number, f: number, g: number): void {
    v.x += v.vx * dt;
    v.y += v.vy * dt;
    v.heading = wrapAngle(v.heading + v.omega * dt);
    v.omega *= Math.exp(-4 * dt);
    v.odo += (v.vx * f + v.vy * g) * dt;
    v.rest = Math.hypot(v.vx, v.vy) < .025 && Math.abs(v.omega) < .02 && !v.autonomous ? v.rest + dt : 0;
    if (v.rest > .5) {
        v.sleeping = true;
        v.vx = 0;
        v.vy = 0;
    }
    v.revision++;
}
/** Damaged or missing wheels sag the body; trailers swing back in line behind the tractor. */
function settleSuspension(v: VehicleState, d: VehicleDef, dt: number, f: number, g: number): void {
    let roll = 0, pitch = 0;
    for (let i = 0; i < d.parts.length; i++) {
        const p = d.parts[i]!, s = v.parts[i]!;
        if (p.role === 'wheel' || p.role === 'track') {
            const sag = s.detached ? .24 : s.damage * .15;
            roll -= Math.sign(p.y) * sag;
            pitch -= Math.sign(p.x) * sag * .4;
        }
        if (p.role === 'trailer' && !s.detached)
            s.heading = clamp(s.heading - v.omega * dt - (v.vx * f + v.vy * g) * Math.sin(s.heading) * dt / d.length, -.8, .8);
    }
    // A derailed car lies over toward the side it left the track on: that side of the body goes down.
    const seat = v.rail?.derailed ? v.rail : undefined;
    const tip = seat ? -Math.sign((seat.axis === 'x' ? f : -g) * seat.side || 1) * RAIL.tip : 0;
    v.roll = approach(v.roll, clamp(roll, -.22, .22) + tip, dt * (seat ? 1.6 : .6));
    v.pitch = approach(v.pitch, clamp(pitch, -.16, .16), dt * .6);
}
export function stepDetached(v: VehicleState, dt: number, budget: {
    remaining: number;
}, support: (x: number, y: number) => number): void {
    let count = 0;
    for (let i = 0; i < v.parts.length; i++) {
        const s = v.parts[i]!;
        if (!s.detached || s.sleeping)
            continue;
        const floor = support(s.x, s.y);
        if (count++ >= 6 || budget.remaining <= 0) {
            // Over the per-vehicle or global budget: drop the piece to rest where it is.
            s.z = floor;
            s.vx = s.vy = s.vz = s.omega = 0;
            s.sleeping = true;
        }
        else {
            budget.remaining--;
            fallLoosePart(s, dt, floor, vehicleDefinition(v.definitionId).parts[i]!.role === 'wheel');
        }
        v.revision++;
    }
}
/** Ballistic fall with a small bounce; a loose wheel rolls on with less drag. */
function fallLoosePart(s: PartState, dt: number, floor: number, wheel: boolean): void {
    s.vz -= 12 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z += s.vz * dt;
    s.heading += s.omega * dt;
    if (s.z <= floor) {
        s.z = floor;
        s.vz = Math.abs(s.vz) > .8 ? -s.vz * .15 : 0;
        const drag = Math.exp(-(wheel ? 1.1 : 4) * dt);
        s.vx *= drag;
        s.vy *= drag;
        s.omega *= drag;
    }
    if (Math.hypot(s.vx, s.vy, s.vz) < .08) {
        s.rest += dt;
        if (s.rest > .5)
            s.sleeping = true;
    }
    else
        s.rest = 0;
}
