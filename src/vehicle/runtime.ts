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
        parts: d.parts.map(() => ({ damage: 0, mountDamage: 0, bendX: 0, bendY: 0, crush: 0, detached: false, x: 0, y: 0, z: 0, heading: 0, vx: 0, vy: 0, vz: 0, omega: 0, sleeping: true, rest: 0 })) };
}
export function partPose(v: VehicleState, index: number): PartPose {
    const d = vehicleDefinition(v.definitionId), raw = d.parts[index]!, scale = v.scale;
    const scaled = (p: typeof raw) => ({ ...p, x: p.x * scale, y: p.y * scale, z: p.z * scale, length: p.length * scale, width: p.width * scale, height: p.height * scale });
    const p = scaled(raw), s = v.parts[index]!;
    const base = { length: p.length * (1 - s.damage * p.deform * .2), width: p.width, height: Math.max(.06, p.height * (1 - s.crush * p.deform)), shearX: s.bendX, shearY: s.bendY, pitch: v.pitch + (p.pitch ?? 0), roll: v.roll };
    if (s.detached)
        return { ...base, x: s.x, y: s.y, z: s.z, heading: s.heading, pitch: 0, roll: 0 };
    let x = v.x + Math.cos(v.heading) * p.x - Math.sin(v.heading) * p.y;
    let y = v.y + Math.sin(v.heading) * p.x + Math.cos(v.heading) * p.y;
    let z = v.elev + Math.max(0, p.z + v.pitch * p.x + v.roll * p.y), heading = v.heading;
    if (p.parent) {
        const pi = d.parts.findIndex(q => q.id === p.parent), pp = scaled(d.parts[pi]!), ps = v.parts[pi]!;
        const pose = partPose(v, pi), delta = pose.heading - v.heading;
        if (p.surface) {
            const heightRatio = pose.height / pp.height, lengthRatio = pose.length / pp.length;
            const fraction = (p.z - pp.z) / pp.height;
            const a = (p.x - pp.x) * lengthRatio + pose.shearX * fraction;
            const b = p.y - pp.y + pose.shearY * fraction;
            return { ...base,
                x: pose.x + Math.cos(pose.heading) * a - Math.sin(pose.heading) * b,
                y: pose.y + Math.sin(pose.heading) * a + Math.cos(pose.heading) * b,
                z: Math.max(0, pose.z + (p.z - pp.z) * heightRatio + pose.pitch * a + pose.roll * b),
                heading: pose.heading, pitch: pose.pitch, roll: pose.roll,
                length: base.length * lengthRatio,
                height: p.surface === 'top' ? base.height : base.height * heightRatio,
                shearX: base.shearX + (p.surface === 'top' ? 0 : pose.shearX * p.height / pp.height),
                shearY: base.shearY + (p.surface === 'top' ? 0 : pose.shearY * p.height / pp.height),
            };
        }
        if (ps.detached || pp.role === 'trailer' || Math.abs(delta) > .001) {
            x = pose.x + Math.cos(pose.heading) * (p.x - pp.x) - Math.sin(pose.heading) * (p.y - pp.y);
            y = pose.y + Math.sin(pose.heading) * (p.x - pp.x) + Math.cos(pose.heading) * (p.y - pp.y);
            z = Math.max(0, pose.z + p.z - pp.z);
            heading = pose.heading;
        }
        x += Math.cos(heading) * ps.bendX - Math.sin(heading) * ps.bendY;
        y += Math.sin(heading) * ps.bendX + Math.cos(heading) * ps.bendY;
        z = Math.max(v.elev, z - ps.crush * pp.height * pp.deform * .5);
    }
    if (p.role === 'trailer') {
        heading = v.heading + s.heading;
        x = v.x + Math.cos(v.heading) * (-d.length * .52) + Math.cos(heading) * (p.x + d.length * .52);
        y = v.y + Math.sin(v.heading) * (-d.length * .52) + Math.sin(heading) * (p.x + d.length * .52);
    }
    if (p.role === 'wheel' && !p.id.startsWith('trailer') && ((d.drive.steering === 'front' && p.x > 0) || (d.drive.steering === 'rear' && p.x < 0)))
        heading += v.steer;
    heading += s.bendY * .5;
    return { ...base, x, y, z, heading };
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
export function hitVehicle(v: VehicleState, contacts: readonly VehicleContact[]): void {
    const d = vehicleDefinition(v.definitionId);
    const unique = new Map<string, VehicleContact>();
    for (const c of contacts) {
        if (![c.x, c.y, c.z, c.nx, c.ny, c.nz, c.impulse, c.load ?? 0, c.dt ?? 0].every(Number.isFinite))
            continue;
        const old = unique.get(c.source);
        if (!old || c.impulse + (c.load ?? 0) * (c.dt ?? 0) > old.impulse + (old.load ?? 0) * (old.dt ?? 0))
            unique.set(c.source, c);
    }
    for (const c of unique.values()) {
        let nearest = -1, distance = Infinity;
        for (let i = 0; i < d.parts.length; i++) {
            const p = partPose(v, i), dx = c.x - p.x, dy = c.y - p.y, a = Math.cos(p.heading) * dx + Math.sin(p.heading) * dy, b = -Math.sin(p.heading) * dx + Math.cos(p.heading) * dy;
            const dist = Math.hypot(Math.max(0, Math.abs(a) - p.length / 2), Math.max(0, Math.abs(b) - p.width / 2), Math.max(p.z - c.z, 0, c.z - p.z - p.height));
            // Skin beats the frame when regions overlap; do not repeatedly target already missing glass.
            const bias = d.parts[i]!.role === 'frame' ? .025 : d.parts[i]!.role === 'glass' && v.parts[i]!.damage >= 1 ? 2 : 0;
            if (dist + bias < distance) {
                nearest = i;
                distance = dist + bias;
            }
        }
        if (nearest < 0 || distance > .8)
            continue;
        const p = d.parts[nearest]!, s = v.parts[nearest]!, pose = partPose(v, nearest);
        const amount = Math.max(0, c.impulse - .45) * 6 + Math.max(0, c.load ?? 0) * Math.max(0, c.dt ?? 0);
        const nx = Math.cos(pose.heading) * c.nx + Math.sin(pose.heading) * c.ny, ny = -Math.sin(pose.heading) * c.nx + Math.cos(pose.heading) * c.ny;
        s.damage = clamp(s.damage + amount / p.strength, 0, 1);
        s.mountDamage += amount / p.mount;
        s.bendX = clamp(s.bendX + nx * amount / p.strength * .35, -p.deform, p.deform);
        s.bendY = clamp(s.bendY + ny * amount / p.strength * .35, -p.deform, p.deform);
        s.crush = clamp(s.crush + amount / p.strength * (c.nz < 0 ? 1 : .3), 0, 1);
        let parent = p.parent, factor = .25;
        while (parent) {
            const j = d.parts.findIndex(q => q.id === parent), q = d.parts[j]!, t = v.parts[j]!;
            t.damage = clamp(t.damage + amount * factor / q.strength, 0, 1);
            t.crush = clamp(t.crush + amount * factor / q.strength * (c.nz < 0 ? 1 : .12), 0, 1);
            parent = q.parent;
            factor *= .6;
        }
        if (s.mountDamage >= 1 && p.parent && p.role !== 'engine' && !s.detached && detachedRoot(v, nearest) === undefined) {
            Object.assign(s, { detached: true, x: pose.x, y: pose.y, z: pose.z, heading: pose.heading, vx: v.vx - v.omega * (pose.y - v.y), vy: v.vy + v.omega * (pose.x - v.x), vz: Math.max(0, c.nz) * c.impulse * .2, omega: ny * .8, sleeping: false, rest: 0 });
        }
        const root = detachedRoot(v, nearest), mass = Math.max(.5, assemblyMass(v, root));
        if (root === undefined) {
            v.vx += c.nx * c.impulse / mass;
            v.vy += c.ny * c.impulse / mass;
            v.omega += ((c.x - v.x) * c.ny - (c.y - v.y) * c.nx) * c.impulse / (mass * d.length * d.length);
            v.sleeping = false;
            v.rest = 0;
        }
        else {
            const body = v.parts[root]!;
            body.vx += c.nx * c.impulse / mass;
            body.vy += c.ny * c.impulse / mass;
            body.sleeping = false;
            body.rest = 0;
        }
        v.revision++;
    }
    const frame = v.parts[0]!.damage, engine = v.parts[d.parts.findIndex(p => p.role === 'engine')]!.damage;
    const supports = d.parts.map((p, i) => ({ p, s: v.parts[i]! })).filter(({ p }) => (p.role === 'wheel' || p.role === 'track') && !p.id.startsWith('trailer'));
    const lost = supports.filter(({ s }) => s.detached || s.damage > .85).length;
    if (frame >= .85 || v.parts.reduce((n, s, i) => n + s.damage * d.parts[i]!.mass, 0) / d.mass > .72)
        v.status = 'wreck';
    else if (engine >= .9 || lost >= Math.ceil(supports.length / 2))
        v.status = 'disabled';
    if (v.status !== 'operational') {
        v.autonomous = false;
        v.routeStatus = 'parked';
    }
    if (v.status === 'wreck' && !v.paid) {
        v.paid = true;
        v.pendingCash += d.cash;
    }
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
    if (v.delay > 0) {
        v.delay -= dt;
        v.routeStatus = 'waiting';
        return;
    }
    if (v.autonomous && v.status === 'operational' && v.waypoints.length) {
        const target = v.waypoints[v.waypoint]!, dx = target.x - v.x, dy = target.y - v.y;
        if (Math.hypot(dx, dy) < Math.max(.35, d.length * .25)) {
            if (v.waypoint === v.waypoints.length - 1 && v.loop === false) {
                parkVehicle(v);
                v.vx = 0;
                v.vy = 0;
                return;
            }
            v.waypoint = (v.waypoint + 1) % v.waypoints.length;
        }
        const angle = wrapAngle(Math.atan2(dy, dx) - v.heading);
        if (v.reversing) {
            v.reverseRemaining -= dt;
            if (v.reverseRemaining <= 0) {
                v.reversing = false;
                v.waitT = 0;
            }
        }
        else {
            v.waitT = obstacle ? v.waitT + dt : Math.max(0, v.waitT - dt);
            if (v.waitT > 2) {
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
        }
        const reverse = v.reversing;
        v.routeStatus = v.autonomous ? (reverse ? 'reversing' : obstacle ? 'waiting' : 'driving') : v.routeStatus;
        const running = d.parts.flatMap((p, i) => (p.role === 'wheel' || p.role === 'track') && !p.id.startsWith('trailer') ? [v.parts[i]!.damage] : []);
        const runningHealth = 1 - running.reduce((a, b) => a + b, 0) / Math.max(1, running.length);
        const health = Math.max(.1, (1 - v.parts[1]!.damage) * runningHealth);
        const speed = v.autonomous ? (reverse ? -d.drive.speed * .3 : obstacle ? 0 : d.drive.speed * Math.max(.12, 1 - Math.abs(angle) / 1.4) * health) : 0;
        const along = v.vx * f + v.vy * g, next = approach(along, speed, d.drive.accel * dt);
        v.steer = approach(v.steer, clamp(angle, -.65, .65) * (d.drive.steering === 'rear' ? -1 : 1) * Math.max(.25, runningHealth), dt * 2);
        const rate = d.drive.steering === 'tracks' ? clamp(angle, -d.drive.turn, d.drive.turn) : (d.drive.steering === 'rear' ? -1 : 1) * Math.tan(v.steer) * next / d.drive.wheelbase;
        const turnDelta = rate * dt;
        v.heading = wrapAngle(v.heading + turnDelta);
        for (let i = 0; i < d.parts.length; i++)
            if (d.parts[i]!.role === 'trailer' && !v.parts[i]!.detached)
                v.parts[i]!.heading = clamp(v.parts[i]!.heading - turnDelta, -.8, .8);
        const damping = Math.exp(-d.drive.traction * Math.max(.2, runningHealth) * 10 * dt);
        v.vx = next * Math.cos(v.heading) + (v.vx - along * f) * damping;
        v.vy = next * Math.sin(v.heading) + (v.vy - along * g) * damping;
        v.sleeping = false;
    }
    else {
        const drag = Math.exp(-2.8 * dt);
        v.vx *= drag;
        v.vy *= drag;
        v.steer *= drag;
    }
    if (!v.sleeping) {
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
    v.roll = approach(v.roll, clamp(roll, -.22, .22), dt * .6);
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
            s.z = floor;
            s.vx = s.vy = s.vz = s.omega = 0;
            s.sleeping = true;
            v.revision++;
            continue;
        }
        budget.remaining--;
        s.vz -= 12 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
        s.heading += s.omega * dt;
        if (s.z <= floor) {
            s.z = floor;
            s.vz = Math.abs(s.vz) > .8 ? -s.vz * .15 : 0;
            const drag = Math.exp(-(vehicleDefinition(v.definitionId).parts[i]!.role === 'wheel' ? 1.1 : 4) * dt);
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
        v.revision++;
    }
}
