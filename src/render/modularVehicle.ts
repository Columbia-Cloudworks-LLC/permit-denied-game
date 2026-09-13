import type { Graphics } from 'pixi.js';
import { vehicleDefinition } from '../vehicle/definitions';
import { partPose, detachedRoot } from '../vehicle/runtime';
import type { VehicleState } from '../vehicle/types';
import { depthKey, worldBoundsToScreen, worldToScreen, type ScreenAabb } from '../world/iso';
import { cross, faceVisible, orderVehicleFaces, type VehicleFace, type Vertex } from './vehiclePainter';
export function vehicleAssemblies(v: VehicleState): (number | undefined)[] {
    return [undefined, ...v.parts.flatMap((s, i) => s.detached ? [i] : [])];
}
interface RenderGroup { roots: (number | undefined)[]; bounds: ScreenAabb; depth: number }
const groupCache = new WeakMap<VehicleState, { version: string; groups: RenderGroup[] }>();
/** Nearby detached pieces must share painter order with their wreck. Once their
 * screen bounds separate, they can be culled and sorted independently in the town. */
export function vehicleRenderGroups(v: VehicleState): RenderGroup[] {
    const version = [v.revision,v.x,v.y,v.heading,v.elev,v.pitch,v.roll,v.steer].join(':');
    const cached = groupCache.get(v);
    if(cached?.version === version)return cached.groups;
    const groups: RenderGroup[] = vehicleAssemblies(v).map(root => {
        const bounds = {minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
        const pose = partPose(v,root??0);
        v.parts.forEach((_,i)=>{
            if(detachedRoot(v,i)!==root)return;
            const p=partPose(v,i),r=(p.length+p.width)/2+Math.abs(p.shearX)+Math.abs(p.shearY);
            const tilt=Math.abs(p.pitch)*p.length/2+Math.abs(p.roll)*p.width/2;
            const b=worldBoundsToScreen(p.x-r,p.y-r,r*2,r*2,Math.max(0,p.z-tilt),p.z+p.height+tilt);
            bounds.minX=Math.min(bounds.minX,b.minX);bounds.minY=Math.min(bounds.minY,b.minY);
            bounds.maxX=Math.max(bounds.maxX,b.maxX);bounds.maxY=Math.max(bounds.maxY,b.maxY);
        });
        return {roots:[root],bounds,depth:depthKey(pose.x,pose.y,pose.z+pose.height/2)};
    });
    for(let changed=true;changed;) {
        changed=false;
        outer:for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++) {
            const a=groups[i]!,b=groups[j]!,x=a.bounds,y=b.bounds;
            if(x.minX>y.maxX||x.maxX<y.minX||x.minY>y.maxY||x.maxY<y.minY)continue;
            a.roots.push(...b.roots);x.minX=Math.min(x.minX,y.minX);x.minY=Math.min(x.minY,y.minY);
            x.maxX=Math.max(x.maxX,y.maxX);x.maxY=Math.max(x.maxY,y.maxY);
            groups.splice(j,1);changed=true;break outer;
        }
    }
    groupCache.set(v,{version,groups});return groups;
}
const shade = (c: number, m: number) => ((Math.min(255, ((c >> 16) & 255) * m) | 0) << 16) | ((Math.min(255, ((c >> 8) & 255) * m) | 0) << 8) | (Math.min(255, (c & 255) * m) | 0);
const vertex = (x: number, y: number, z: number): Vertex => ({ x, y, z });
function partFaces(v: VehicleState, i: number): VehicleFace[] {
    const d = vehicleDefinition(v.definitionId), p = d.parts[i]!, s = v.parts[i]!, q = partPose(v, i);
    if (p.role === 'glass' && s.damage > .7)
        return [];
    const color = p.color === 'paint' ? d.paints[v.variant]! : p.color === 'glass' ? 0x588695 : p.color === 'dark' ? 0x292e2b : 0x778079;
    const faces: VehicleFace[] = [];
    const transform = ({ x: a, y: b, z }: Vertex): Vertex => {
        // Decoration follows the same deformed surface as its panel.
        const t = z / q.height, x = a + q.shearX * t, y = b + q.shearY * t;
        return { x: q.x + Math.cos(q.heading) * x - Math.sin(q.heading) * y,
            y: q.y + Math.sin(q.heading) * x + Math.cos(q.heading) * y,
            z: Math.max(0, q.z + z + q.pitch * x + q.roll * y) };
    };
    const poly = (points: Vertex[], tint: number) => {
        const world = points.map(transform);
        if (faceVisible(world))
            faces.push({ points: world, color: tint, part: p.id });
    };
    const topHeight = (a: number) => q.height * (p.shape === 'slope' ? 1 - .4 * (a / q.length + .5) : 1);
    const skin = (a: number, b: number, t: number) => vertex(a, b, topHeight(a) * t);
    const strip = (a: Vertex, b: Vertex, normal: Vertex, tint: number, width = .025) => {
        const side = cross(vertex(b.x - a.x, b.y - a.y, b.z - a.z), normal);
        const length = Math.hypot(side.x, side.y, side.z);
        if (length < 1e-7)
            return;
        const k = width / (length * 2), offset = (p: Vertex, s: number) => vertex(p.x + side.x * k * s, p.y + side.y * k * s, p.z + side.z * k * s);
        poly([offset(a, 1), offset(b, 1), offset(b, -1), offset(a, -1)], tint);
    };
    const frontNormal = vertex(1, 0, 0), topNormal = vertex(0, 0, 1);
    if (p.shape === 'wheel' || p.shape === 'track') {
        const track = p.shape === 'track', radius = q.height / 2;
        const rim = (angle: number, b: number) => vertex(track ? Math.cos(angle) * radius + Math.sign(Math.cos(angle)) * (q.length - q.height) / 2 : Math.cos(angle) * q.length / 2, b, radius + Math.sin(angle) * radius);
        const rings = [-1, 1].map(side => Array.from({ length: 16 }, (_, k) => rim(k * Math.PI / 8, side * q.width / 2)));
        for (let k = 0; k < 16; k++)
            poly([rings[0]![k]!, rings[1]![k]!, rings[1]![(k + 1) % 16]!, rings[0]![(k + 1) % 16]!], shade(color, k % 2 ? .8 : 1));
        poly(rings[0]!, shade(color, .85));
        poly([...rings[1]!].reverse(), shade(color, .7));
        for (const side of [-1, 1]) {
            const normal = vertex(0, side, 0), b = side * (q.width / 2 + .002);
            const disc = (a: number, z: number, r: number, tint: number) => {
                const points = Array.from({ length: 12 }, (_, k) => { const angle = k * Math.PI / 6; return vertex(a + Math.cos(angle) * r, b, z + Math.sin(angle) * r); });
                poly(side < 0 ? points : points.reverse(), tint);
            };
            for (const a of track ? [-q.length * .3, 0, q.length * .3] : [0]) {
                disc(a, radius, radius * (track ? .37 : .43), 0x747d70);
                const angle = v.odo / Math.max(.1, radius);
                strip(vertex(a, b + side * .002, radius), vertex(a + Math.cos(angle) * radius * .34, b + side * .002, radius + Math.sin(angle) * radius * .34), normal, 0xb5b8a1, .035);
            }
        }
        if (track) {
            const phase = (v.odo / Math.max(.1, q.length)) % 1;
            for (let k = 0; k < 24; k++) {
                const angle = (k + phase) * Math.PI / 12;
                poly([rim(angle - .022, -q.width * .5), rim(angle - .022, q.width * .5), rim(angle + .022, q.width * .5), rim(angle + .022, -q.width * .5)], 0x62695e);
            }
        }
        return faces;
    }
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const bottom = corners.map(([a, b]) => skin(a! * q.length / 2, b! * q.width / 2, 0));
    const top = corners.map(([a, b]) => skin(a! * q.length / 2, b! * q.width / 2, 1));
    // Mounted glazing exposes only its outward face. A detached pane has thickness.
    const mounted = p.role === 'glass' && p.surface && !s.detached;
    if (!mounted)
        poly(top, shade(color, 1.2));
    for (let k = 0; k < 4; k++) {
        if (mounted && k !== ({ left: 0, front: 1, right: 2, top: -1 }[p.surface!]))
            continue;
        poly([bottom[k]!, bottom[(k + 1) % 4]!, top[(k + 1) % 4]!, top[k]!], shade(color, [.72, .92, .62, .85][k]!));
    }
    if (p.role === 'cab' || p.id.startsWith('side-')) {
        const enclosed = d.parts.some(p => p.id === 'side-1');
        for (const side of [-1, 1]) {
            if (p.id.startsWith('side-') && Math.sign(p.y) !== side)
                continue;
            if (p.role === 'cab' && enclosed)
                continue;
            if (p.id.startsWith('side-') && d.parts.some(p => p.id === 'windows-1'))
                continue;
            const a0 = enclosed ? q.length * .3 : -q.length * .37, a1 = enclosed ? q.length * .46 : q.length * .36;
            const b = side * (q.width / 2 + .003), normal = vertex(0, side, 0);
            if (s.damage < .7) {
                const points = [skin(a0, b, .38), skin(a1, b, .38), skin(a1, b, .86), skin(a0, b, .86)];
                poly(side < 0 ? points : points.reverse(), 0x46727d);
            }
            const seam = enclosed ? q.length * .28 : 0;
            strip(skin(seam, b + side * .002, .04), skin(seam, b + side * .002, .95), normal, shade(color, .5));
            strip(skin(a0, b + side * .004, .3), skin(a0 + (a1 - a0) * .23, b + side * .004, .3), normal, 0xd4d2b4, .035);
        }
    }
    if (p.id === 'hood' || p.role === 'engine') {
        const a = q.length / 2 + .002;
        for (let k = 0; k < 5; k++)
            strip(skin(a, -q.width * .34 + k * q.width * .17, .12), skin(a, -q.width * .34 + k * q.width * .17, .82), frontNormal, 0x283a32, .025);
        if (p.id === 'hood')
            for (const side of [-1, 1]) {
                const points = Array.from({ length: 12 }, (_, k) => { const angle = k * Math.PI / 6; return skin(a + .002, side * q.width * .33 + Math.cos(angle) * q.height * .16, .45 + Math.sin(angle) * .2); });
                poly(points, 0xe4d8a0);
            }
    }
    if (p.role === 'frame')
        for (const side of [-1, 1])
            strip(skin(-q.length * .47, side * q.width * .36, 1.003), skin(q.length * .47, side * q.width * .36, 1.003), topNormal, 0x303934, .035);
    if (s.damage > .12 && p.role !== 'glass') {
        strip(skin(-q.length * .3, 0, 1.003), skin(q.length * .12, q.width * .18, 1.003), topNormal, shade(color, .5), .022);
        strip(skin(q.length * .12, q.width * .18, 1.003), skin(q.length * .32, -q.width * .1, 1.003), topNormal, shade(color, .55), .015);
    }
    if (p.role === 'glass') {
        if (p.surface === 'front') {
            const a = q.length / 2 + .002;
            strip(skin(a, 0, .02), skin(a, 0, .98), frontNormal, 0x283936, .025);
        }
        else if (p.surface === 'left' || p.surface === 'right') {
            const side = p.surface === 'left' ? -1 : 1, b = side * (q.width / 2 + .002);
            for (let n = 1; n < 6; n++)
                strip(skin(q.length * (n / 6 - .5), b, .01), skin(q.length * (n / 6 - .5), b, .99), vertex(0, side, 0), 0x283936, .04);
        }
    }
    return faces;
}
export function vehicleFaces(v: VehicleState, root?: number | readonly (number | undefined)[]): VehicleFace[] {
    const roots = Array.isArray(root) ? root : [root];
    return orderVehicleFaces(v.parts.flatMap((_, i) => roots.includes(detachedRoot(v, i)) ? partFaces(v, i) : []));
}
export function drawVehicleAssembly(g: Graphics, v: VehicleState, root: number | undefined | readonly (number | undefined)[]): void {
    for (const face of vehicleFaces(v, root)) {
        g.poly(face.points.flatMap(p => { const t = worldToScreen(p.x, p.y, p.z); return [t.x, t.y]; })).fill(face.color);
    }
    if (v.debugParts) {
        const d = vehicleDefinition(v.definitionId);
        v.parts.forEach((s, i) => {
            if (!(Array.isArray(root) ? root : [root]).includes(detachedRoot(v, i)))
                return;
            const q = partPose(v, i), a = worldToScreen(q.x, q.y, q.z + q.height);
            g.circle(a.x, a.y, 3).fill(s.damage > .5 ? 0xed6654 : 0x99dd77);
            const parent = d.parts[i]!.parent;
            if (parent) {
                const pose = partPose(v, d.parts.findIndex(p => p.id === parent)), b = worldToScreen(pose.x, pose.y, pose.z + pose.height);
                g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: s.detached ? 0xff7755 : 0x9ddd77, width: 1 });
            }
        });
    }
}
