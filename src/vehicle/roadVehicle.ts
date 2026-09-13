import { createVehicle, stepVehicle, runVehicle } from './runtime';
import type { VehicleState } from './types';
import { ROAD } from "../game/constants";
import { len } from "../game/math";
type RoadVehicle = VehicleState;
import { findRoadRoute } from "../world/roads";
import { indexNetwork, nearestLane, samplePolyline, } from "../world/roads";
import { pickVerificationRoute } from "../world/routing";
import type { Town } from "../world/town";
export function createRoadVehicle(x: number = ROAD.spawnX, y: number = ROAD.spawnY, heading: number = ROAD.spawnHeading, route: string[] = [], layer = 0): RoadVehicle {
    return {
        ...createVehicle('car', x, y, heading),
        autonomous: true, roadDemo: true,
        x,
        y,
        heading,
        vx: 0,
        vy: 0,
        odo: 0,
        alive: true,
        layer,
        elev: 0,
        laneId: route[0] ?? null,
        route,
        routeIndex: 0,
        waitT: 0,
        reversing: false,
    };
}
export function roadSpeed(v: RoadVehicle): number {
    return len(v.vx, v.vy);
}
export function attachRoadRoute(town: Town, v: RoadVehicle): void {
    if (v.route.length)
        return;
    const demo = pickVerificationRoute(town.network);
    if (demo && demo.length) {
        v.route = demo;
        v.routeIndex = 0;
        v.laneId = demo[0] ?? null;
        return;
    }
    const start = nearestLane(town.network, v.x, v.y, v.layer);
    const lanes = town.network.lanes.filter((l) => l.dir === 1);
    let path: string[] | null = start ? [start.id] : null;
    if (start) {
        for (let i = lanes.length - 1; i >= 0; i--) {
            const dest = lanes[i]!;
            if (dest.id === start.id)
                continue;
            const found = findRoadRoute(town.network, start.id, dest.id);
            if (found && found.length >= 2) {
                path = found;
                break;
            }
        }
    }
    if (!path)
        return;
    v.route = path;
    v.routeIndex = 0;
    v.laneId = path[0] ?? null;
}
export function stepRoadVehicle(v: RoadVehicle, town: Town, dt: number): void {
    if (!v.alive)
        return;
    if (!town.vehicles.includes(v))
        town.vehicles.push(v);
    attachRoadRoute(town, v);
    if (!v.waypoints.length && v.route.length) {
        const start = nearestLane(town.network, v.x, v.y, v.layer);
        if (start && start.id !== v.route[0]) {
            const approach = findRoadRoute(town.network, start.id, v.route[0]!);
            if (approach)
                v.route = [...approach.slice(0, -1), ...v.route];
        }
        const idx = indexNetwork(town.network);
        const points = v.route.flatMap(id => {
            const lane = idx.laneById.get(id), seg = lane ? idx.segmentById.get(lane.segmentId) : undefined;
            if (!lane || !seg)
                return [];
            const count = Math.max(4, Math.ceil(seg.points.reduce((n, p, i) => i ? n + Math.hypot(p.x - seg.points[i - 1]!.x, p.y - seg.points[i - 1]!.y) : 0, 0) / 1.5));
            return Array.from({ length: count + 1 }, (_, i) => samplePolyline(seg.points, lane.dir === 1 ? i / count : 1 - i / count));
        });
        let nearest = 0;
        for (let i = 1; i < points.length; i++)
            if (Math.hypot(points[i]!.x - v.x, points[i]!.y - v.y) < Math.hypot(points[nearest]!.x - v.x, points[nearest]!.y - v.y))
                nearest = i;
        runVehicle(v, points.slice(Math.min(nearest + 1, points.length - 1)));
        v.loop = false;
    }
    stepVehicle(v, dt);
}
