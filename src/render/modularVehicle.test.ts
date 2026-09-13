import { describe, expect, it } from 'vitest';
import { VEHICLES, vehicleDefinition } from '../vehicle/definitions';
import { createVehicle, hitVehicle, partPose, stepDetached } from '../vehicle/runtime';
import { worldToScreen, screenToWorld } from '../world/iso';
import { ISO_H, ISO_Z } from '../game/constants';
import { vehicleFaces, vehicleRenderGroups } from './modularVehicle';
import { cross, orderVehicleFaces, type VehicleFace, type Vertex } from './vehiclePainter';
const subtract = (a: Vertex, b: Vertex): Vertex => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vertex, b: Vertex) => a.x * b.x + a.y * b.y + a.z * b.z;
// Independent pixel-ray check of painter output. Later paint must be nearer the camera.
function sample(face: VehicleFace, x: number, y: number): number | undefined {
    const points = face.points.map(p => worldToScreen(p.x, p.y, p.z));
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i]!, b = points[j]!;
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x)
            inside = !inside;
    }
    if (!inside)
        return;
    const a = face.points[0]!, n = cross(subtract(face.points[1]!, a), subtract(face.points[2]!, a));
    const o = { ...screenToWorld(x, y), z: 0 }, view = { x: 1, y: 1, z: 2 * ISO_H / ISO_Z };
    return dot(n, subtract(a, o)) / dot(n, view);
}
describe('vehicle surface rendering', () => {
    it('orders an overlapping detached roof with its wreck and releases distant pieces for culling', () => {
        const v=createVehicle('bus',10,10),d=vehicleDefinition(v.definitionId),i=d.parts.findIndex(p=>p.id==='roof');
        const p=partPose(v,i);
        hitVehicle(v,[{x:p.x,y:p.y,z:p.z+p.height,nx:0,ny:0,nz:-1,impulse:60,source:'falling-plate'}]);
        expect(v.parts[i]!.detached).toBe(true);
        expect(vehicleRenderGroups(v).some(g=>g.roots.includes(undefined)&&g.roots.includes(i))).toBe(true);
        v.parts[i]!.x+=30;v.revision++;
        expect(vehicleRenderGroups(v).some(g=>g.roots.length===1&&g.roots[0]===i)).toBe(true);
        const cached=vehicleRenderGroups(v), revision=v.revision;
        stepDetached(v,1/60,{remaining:0},()=>0);
        expect(v.revision).toBeGreaterThan(revision);
        expect(vehicleRenderGroups(v)).not.toBe(cached);
        expect(v.parts[i]!.z).toBe(0);
    });
    it('splits crossing faces so each side of the intersection paints correctly', () => {
        const face = (part: string, points: Vertex[]): VehicleFace => ({ part, points, color: 0 });
        const flat = face('flat', [{ x: -2, y: -2, z: 1 }, { x: 2, y: -2, z: 1 }, { x: 2, y: 2, z: 1 }, { x: -2, y: 2, z: 1 }]);
        const slope = face('slope', [{ x: -2, y: -2, z: 0 }, { x: 2, y: -2, z: 2 }, { x: 2, y: 2, z: 2 }, { x: -2, y: 2, z: 0 }]);
        for (const input of [[flat, slope], [slope, flat]]) {
            const ordered = orderVehicleFaces(input);
            expect(ordered.length).toBeGreaterThan(2);
            for (const x of [-.8, .8]) {
                const pixel = worldToScreen(x, 0, 1), hits = ordered.map(f => sample(f, pixel.x, pixel.y)).filter((t): t is number => t !== undefined);
                expect(hits.at(-1)).toBeCloseTo(Math.max(...hits), 5);
            }
        }
    });
    it('insets every windshield below its roof and keeps it attached under cab compression', () => {
        for (const d of VEHICLES) {
            const v = createVehicle(d.id, 10, 10, .7), ci = d.parts.findIndex(p => p.id === 'cab'), gi = d.parts.findIndex(p => p.id === 'glass');
            const cab = d.parts[ci]!, glass = d.parts[gi]!;
            expect(glass.length).toBeLessThan(.03);
            expect(glass.width).toBeLessThan(cab.width);
            expect(glass.z + glass.height).toBeLessThan(cab.z + cab.height);
            const before = partPose(v, gi), c = partPose(v, ci);
            // Production contact compresses the cab, below the attachment failure threshold.
            hitVehicle(v, [{ x: c.x, y: c.y, z: c.z + c.height * .2, nx: 0, ny: 0, nz: -1, impulse: 2, source: 'roof-test' }]);
            const after = partPose(v, gi), parent = partPose(v, ci);
            expect(after.z).toBeLessThan(before.z);
            expect(after.z + after.height).toBeLessThan(parent.z + parent.height);
            const roof = partPose(v, d.parts.findIndex(p => p.id === 'roof'));
            expect(roof.z).toBeCloseTo(parent.z + parent.height, 5);
        }
    });
    it('culls rear-facing headlights, windshields and edge-on wheel hubs', () => {
        const rear = vehicleFaces(createVehicle('car', 0, 0, Math.PI));
        expect(rear.some(f => f.part === 'glass')).toBe(false);
        expect(rear.some(f => f.color === 0xe4d8a0)).toBe(false);
        const front = vehicleFaces(createVehicle('car', 0, 0, 0));
        expect(front.some(f => f.part === 'glass')).toBe(true);
        expect(front.some(f => f.color === 0xe4d8a0)).toBe(true);
        const edge = vehicleFaces(createVehicle('car', 0, 0, Math.PI / 4));
        expect(edge.some(f => f.color === 0x747d70 || f.color === 0xb5b8a1)).toBe(false);
    });
    it('keeps passenger engines inside the body instead of breaking through the rear deck', () => {
        for (const id of ['car', 'hatchback']) {
            const d = vehicleDefinition(id), engine = d.parts.find(p => p.role === 'engine')!, hood = d.parts.find(p => p.id === 'hood')!;
            expect(engine.x).toBeGreaterThan(0);
            expect(engine.z + engine.height).toBeLessThanOrEqual(hood.z);
        }
    });
    it('paints the nearest surface across the complete roster and eight headings', () => {
        let largest = 0;
        for (const d of VEHICLES)
            for (let heading = 0; heading < 8; heading++) {
                const v = createVehicle(d.id, 0, 0, heading * Math.PI / 4), faces = vehicleFaces(v);
                largest = Math.max(largest, faces.length);
                const projected = faces.flatMap(f => f.points.map(p => worldToScreen(p.x, p.y, p.z)));
                const minX = Math.min(...projected.map(p => p.x)), maxX = Math.max(...projected.map(p => p.x));
                const minY = Math.min(...projected.map(p => p.y)), maxY = Math.max(...projected.map(p => p.y));
                for (let ix = 0; ix < 17; ix++)
                    for (let iy = 0; iy < 11; iy++) {
                        const x = minX + (maxX - minX) * (ix + .37) / 17, y = minY + (maxY - minY) * (iy + .61) / 11;
                        const hits = faces.map(f => sample(f, x, y)).filter((t): t is number => t !== undefined && Number.isFinite(t));
                        if (hits.length > 1)
                            expect(hits.at(-1), `${d.id} heading ${heading} pixel ${ix},${iy}`).toBeCloseTo(Math.max(...hits), 4);
                    }
                expect(faces.every(f => f.points.every(p => [p.x, p.y, p.z].every(Number.isFinite)))).toBe(true);
            }
        expect(largest).toBeLessThan(1500);
    });
});
