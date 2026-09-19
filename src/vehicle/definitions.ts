import type { PartRole, VehicleDefinition, VehiclePart } from './types';
interface Source {
    id: string;
    name: string;
    family: 'passenger' | 'truck' | 'tractor' | 'machine';
    body: 'sedan' | 'hatchback' | 'pickup' | 'van' | 'box' | 'bus' | 'tractor' | 'combine' | 'forklift' | 'skid' | 'excavator' | 'trailer';
    length: number;
    width: number;
    height: number;
    mass: number;
    cash: number;
    paints: [
        number,
        number
    ];
    speed: number;
    steering: 'front' | 'rear' | 'tracks';
}
/** Assemblies use local +X forward. Children are placed in vehicle space, then inherit parent displacement. */
export function buildVehicle(s: Source): VehicleDefinition {
    const { length: l, width: w, height: h } = s;
    const parts: VehiclePart[] = [];
    const add = (id: string, role: PartRole, x: number, y: number, z: number, length: number, width: number, height: number, parent = 'frame', shape: VehiclePart['shape'] = 'box', color: VehiclePart['color'] = 'paint') => {
        const strong = role === 'frame' || role === 'engine';
        parts.push({ id, parent: id === 'frame' ? null : parent, role, x, y, z, length, width, height,
            mass: strong ? 8 : role === 'trailer' ? 5 : role === 'cab' ? 3 : 1,
            strength: strong ? 85 : role === 'glass' ? 6 : role === 'wheel' || role === 'track' ? 35 : 24,
            mount: strong ? 1e6 : role === 'trailer' ? 65 : 38,
            deform: strong ? .24 : .68, color, shape });
    };
    const tracked = s.steering === 'tracks', tractor = s.body === 'tractor' || s.body === 'trailer';
    add('frame', 'frame', 0, 0, .22, l * .86, w * .64, .22, '', 'box', 'steel');
    const passenger = s.family === 'passenger';
    add('engine', 'engine', tractor || passenger ? .22 * l : -.26 * l, 0, passenger ? .28 : .4, l * .26, w * .53, passenger ? .24 : h * .25, 'frame', 'box', 'dark');
    if (tracked) {
        for (const side of [-1, 1])
            add(`track-${side}`, 'track', 0, side * w * .37, 0, l * .86, w * .25, .48, 'frame', 'track', 'dark');
    }
    else {
        for (const end of [-1, 1])
            for (const side of [-1, 1]) {
                const diameter = tractor ? (end < 0 ? .96 : .58) : s.body === 'combine' ? (end > 0 ? 1 : .65) : Math.min(.7, h * .36);
                add(`wheel-${end}-${side}`, 'wheel', end * l * .32, side * w * .43, 0, diameter, w * .16, diameter, 'frame', 'wheel', 'dark');
            }
    }
    const enclosed = s.body === 'bus' || s.body === 'van';
    const cabX = enclosed ? -.04*l : tractor ? -.2 * l : s.family === 'truck' ? .27 * l : s.body === 'combine' ? .18 * l : -.05 * l;
    const cabL = l * (enclosed ? .88 : .34), cabW = w * (enclosed ? .76 : .68), cabH = h - .58;
    add('cab', 'cab', cabX, 0, .48, cabL, cabW, cabH);
    // A thin pane on the front skin, with a painted reveal on every edge.
    add('glass', 'glass', cabX + cabL / 2 + .01, 0, .48 + cabH * .39, .02, cabW * .86, cabH * .49, 'cab', 'box', 'glass');
    parts.at(-1)!.surface = 'front';
    add('roof', 'panel', cabX, 0, h - .1, cabL + .04, cabW + (enclosed ? .1 : .06), .1, 'cab');
    parts.at(-1)!.surface = 'top';
    if (s.body === 'sedan' || s.body === 'hatchback' || tractor) {
        add('hood', 'panel', .3 * l, 0, .58, l * .33, w * .7, h * .23, 'frame', 'slope');
        for (const side of [-1, 1])
            add(`fender-${side}`, 'panel', -.27 * l, side * w * .32, .62, l * .3, w * .22, .15);
    }
    if (s.body === 'pickup' || s.body === 'box') {
        add('cargo', 'equipment', -.23 * l, 0, .48, l * .48, w * .88, s.body === 'box' ? h * .8 : .38);
        if (s.body === 'pickup')
            add('bed-floor', 'panel', -.23 * l, 0, .89, l * .39, w * .65, .06, 'cargo', 'box', 'dark');
    }
    if (s.body === 'van' || s.body === 'bus') {
        for (const side of [-1, 1])
            add(`side-${side}`, 'panel', cabX, side * (cabW / 2 + .015), .48, cabL, .04, cabH);
        if (s.body === 'bus')
            for (const side of [-1, 1]) {
                add(`windows-${side}`, 'glass', cabX, side * (cabW / 2 + .045), .48 + cabH * .44, cabL * .86, .02, cabH * .42, `side-${side}`, 'box', 'glass');
                parts.at(-1)!.surface = side < 0 ? 'left' : 'right';
            }
    }
    if (s.body === 'combine') {
        add('hopper', 'equipment', -.24 * l, .08 * w, .6, l * .48, w * .84, h * .73);
        add('header', 'equipment', .61 * l, 0, .15, .75, w * 1.45, .48);
        add('feeder', 'equipment', .46 * l, 0, .23, l * .35, w * .32, .24, 'header', 'box', 'steel');
        add('auger', 'equipment', -.18 * l, -.63 * w, h * .68, l * .6, .2, .2, 'hopper', 'box', 'steel');
        add('auger-elbow', 'equipment', -.38 * l, -.42 * w, h * .68, .2, w * .44, .2, 'auger', 'box', 'steel');
    }
    if (s.body === 'forklift') {
        add('counterweight', 'equipment', -.38 * l, 0, .35, l * .22, w * .85, .7);
        add('mast', 'equipment', .46 * l, 0, .1, .18, w * .6, h * 1.2, 'frame', 'box', 'steel');
        for (const side of [-1, 1])
            add(`fork-${side}`, 'equipment', .7 * l, side * w * .2, .1, l * .46, .12, .08, 'mast', 'box', 'steel');
    }
    if (s.body === 'skid' || s.body === 'excavator') {
        add('arm', 'equipment', .27 * l, -.3 * w, .68, l * .85, .18, .22, 'cab', 'slope');
        if (s.body === 'skid') {
            add('bucket', 'equipment', .76 * l, 0, .12, l * .26, w * .85, .38, 'arm', 'slope', 'steel');
            Object.assign(parts.find(p => p.id === 'arm')!, { z: .65, pitch: -.26 });
        }
        if (s.body === 'excavator')
            add('boom', 'equipment', .45 * l, -.3 * w, .9, .24, .23, h * .7, 'arm', 'slope');
    }
    if (s.body === 'trailer') {
        add('trailer', 'trailer', -l * 1.04, 0, .34, l * .85, w * 1.03, .48);
        add('drawbar', 'equipment', -l * .53, 0, .28, l * .3, .12, .12, 'trailer', 'box', 'steel');
        for (const side of [-1, 1])
            add(`trailer-wheel-${side}`, 'wheel', -l * 1.15, side * w * .47, 0, .64, .2, .64, 'trailer', 'wheel', 'dark');
    }
    if (s.body === 'excavator') {
        const arm = parts.find(p => p.id === 'arm')!, boom = parts.find(p => p.id === 'boom')!;
        Object.assign(arm, { x: l * .21, y: 0, z: 1.35, length: l * .55, height: .22, pitch: .7 });
        Object.assign(boom, { x: l * .61, y: 0, z: 1.2, length: l * .4, height: .18, pitch: -1.15, parent: 'arm' });
        const tip = boom.x + boom.length / 2, mouth = w * .32;
        add('coupler', 'equipment', tip, 0, .5, .22, .2, .22, 'boom', 'box', 'steel');
        add('bucket', 'equipment', tip + .12, 0, .26, .12, mouth, .4, 'coupler', 'box', 'steel');
        add('bucket-floor', 'equipment', tip + .28, 0, .2, .32, mouth, .07, 'bucket', 'box', 'steel');
        add('bucket-lip', 'equipment', tip + .46, 0, .2, .07, mouth + .04, .13, 'bucket', 'box', 'steel');
        for (const side of [-1, 1])
            add(`bucket-side-${side}`, 'equipment', tip + .28, side * (mouth / 2 - .02), .26, .3, .05, .22, 'bucket', 'box', 'steel');
        Object.assign(parts.find(p => p.id === 'bucket-floor')!, { pitch: -.22 });
    }
    if (tractor)
        for (const p of parts)
            if (p.id.startsWith('fender'))
                Object.assign(p, { z: .98, height: .1, y: Math.sign(p.y) * w * .425, width: w * .17 });
    if(s.family==='passenger'){
      add('body-shell','panel',0,0,.24,l*.92,w*.76,.3);
      add('rear-deck','panel',-.34*l,0,.52,l*.25,w*.72,s.body==='hatchback'?.25:.13);
    }
    const shares = parts.reduce((n, p) => n + p.mass, 0);
    for (const p of parts) {
        p.mass = s.mass * p.mass / shares;
        p.strength *= Math.sqrt(s.mass / 2);
        p.mount *= Math.sqrt(s.mass / 2);
    }
    const d: VehicleDefinition = { ...s, parts, drive: { steering: s.steering, speed: s.speed, accel: s.family === 'passenger' ? 9.2 : 2,
            turn: tracked ? 1.4 : .65, wheelbase: l * .64, traction: tracked ? .9 : .65, clearance: tracked || tractor ? .28 : .13, push: s.mass * .65 } };
    validateVehicle(d);
    return d;
}
export function validateVehicle(d: VehicleDefinition): void {
    const fail = (reason: string): never => { throw new Error(`Vehicle ${d.id}: ${reason}`); };
    if (!d.id || !d.name || ![d.length, d.width, d.height, d.mass, d.drive.speed, d.drive.accel, d.drive.wheelbase].every(v => Number.isFinite(v) && v > 0))
        fail('invalid dimensions or movement');
    if (d.parts.length > 16 || d.parts.length < 2)
        fail('expected 2–16 damage regions');
    if (new Set(d.parts.map(p => p.id)).size !== d.parts.length)
        fail('duplicate part');
    if (d.parts.filter(p => p.parent === null).length !== 1)
        fail('expected one root');
    for (const p of d.parts) {
        if (![p.length, p.width, p.height, p.mass, p.strength, p.mount].every(v => Number.isFinite(v) && v > 0) || ![p.x, p.y, p.z, p.deform].every(Number.isFinite))
            fail(`invalid part ${p.id}`);
        const seen = new Set([p.id]);
        let parent = p.parent;
        while (parent) {
            if (seen.has(parent))
                fail('attachment cycle');
            seen.add(parent);
            const q = d.parts.find(v => v.id === parent);
            if (!q)
                fail(`unknown parent ${parent}`);
            parent = q!.parent;
        }
    }
    if (Math.abs(d.parts.reduce((n, p) => n + p.mass, 0) - d.mass) > 1e-6)
        fail('mass mismatch');
    if (d.paints.length !== 2)
        fail('expected two paints');
}
const sources = import.meta.glob<Source>('../world/data/vehicles/**/*.vehicle.json', { eager: true, import: 'default' });
export const VEHICLES = Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)).map(([path, s]) => {
    try {
        return buildVehicle(s);
    }
    catch (e) {
        throw new Error(`${path}: ${String(e)}`);
    }
});
if (new Set(VEHICLES.map(d => d.id)).size !== VEHICLES.length)
    throw new Error('Duplicate vehicle definition ID');
export function vehicleDefinition(id: string): VehicleDefinition { const d = VEHICLES.find(d => d.id === id); if (!d)
    throw new Error(`Unknown vehicle ${id}`); return d; }
