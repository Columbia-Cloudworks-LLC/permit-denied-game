import type { RoadVehicle } from '../structure/types';
export type PartRole = 'frame' | 'engine' | 'panel' | 'cab' | 'wheel' | 'track' | 'glass' | 'equipment' | 'trailer';
export interface VehiclePart {
    pitch?: number;
    /** Skin attachments follow the parent's compressed dimensions and shear. */
    surface?: 'front' | 'left' | 'right' | 'top';
    id: string;
    parent: string | null;
    role: PartRole;
    x: number;
    y: number;
    z: number;
    length: number;
    width: number;
    height: number;
    mass: number;
    strength: number;
    mount: number;
    deform: number;
    color: 'paint' | 'dark' | 'glass' | 'steel' | 'beacon' | 'siren';
    shape: 'box' | 'slope' | 'wheel' | 'track';
}
export interface VehicleDefinition {
    id: string;
    name: string;
    family: string;
    length: number;
    width: number;
    height: number;
    mass: number;
    cash: number;
    paints: [
        number,
        number
    ];
    parts: VehiclePart[];
    drive: {
        steering: 'front' | 'rear' | 'tracks';
        speed: number;
        accel: number;
        turn: number;
        wheelbase: number;
        traction: number;
        clearance: number;
        push: number;
    };
}
export interface PartState {
    damage: number;
    mountDamage: number;
    bendX: number;
    bendY: number;
    crush: number;
    detached: boolean;
    x: number;
    y: number;
    z: number;
    heading: number;
    vx: number;
    vy: number;
    vz: number;
    omega: number;
    sleeping: boolean;
    rest: number;
}
export interface VehicleState extends RoadVehicle {
    scale: number;
    id: number;
    definitionId: string;
    variant: number;
    lotId: string | null;
    yardOwner?: string;
    status: 'operational' | 'disabled' | 'wreck';
    paid: boolean;
    pendingCash: number;
    parts: PartState[];
    omega: number;
    pitch: number;
    roll: number;
    steer: number;
    waypoints: {
        x: number;
        y: number;
    }[];
    waypoint: number;
    autonomous: boolean;
    reverseRemaining: number;
    roadDemo?: boolean;
    loop?: boolean;
    routeStatus: 'parked' | 'driving' | 'waiting' | 'reversing' | 'blocked';
    delay: number;
    retries: number;
    sleeping: boolean;
    rest: number;
    revision: number;
    debugParts: boolean;
    /** Direct drive from an AI driver: signed target speed and front-wheel angle. Bypasses waypoints. */
    control?: VehicleControl;
    /** Heavy vehicles that wreck on a hit count instead of accumulated part damage. */
    wreckAfterHits?: number;
    hits?: number;
    /** Traffic driver state; absent for parked and yard vehicles. */
    traffic?: TrafficAgent;
}
export interface VehicleControl {
    speed: number;
    steer: number;
    /** Acceleration toward the target speed, world units/s². */
    accel: number;
}
export type TrafficRole = 'civilian' | 'police';
export type TrafficMode = 'cruise' | 'flee' | 'turn-forward' | 'turn-reverse' | 'pursue' | 'ram' | 'recoil';
export interface TrafficAgent {
    role: TrafficRole;
    mode: TrafficMode;
    /** Lane ids of the current route and the sampled points along them. */
    lanes: string[];
    path: { x: number; y: number; lane: number }[];
    pathIndex: number;
    exitLane: string;
    cruise: number;
    modeT: number;
    turnStartHeading: number;
    /** Where and when the driver last saw the dozer, in simulation seconds. */
    sawX: number;
    sawY: number;
    sawAt: number;
    repathAt: number;
    stuckT: number;
    /** Seconds spent pressing on without moving. */
    jamT: number;
    hitCd: number;
    /** Strongest dozer contact speed since the driver last read it. */
    dozerContact: number;
    bladeContact: number;
    /** Police: closing speed of its own nose striking the dozer this step. */
    ramContact: number;
    /** Police: no direct charge before this time, after getting stuck on the way in. */
    ramAfter: number;
    ramFails: number;
    swerve: number;
}
export interface VehicleContact {
    x: number;
    y: number;
    z: number;
    nx: number;
    ny: number;
    nz: number;
    impulse: number;
    source: string;
    load?: number;
    dt?: number;
}
export interface PartPose {
    x: number;
    y: number;
    z: number;
    heading: number;
    length: number;
    width: number;
    height: number;
    shearX: number;
    shearY: number;
    pitch: number;
    roll: number;
}
