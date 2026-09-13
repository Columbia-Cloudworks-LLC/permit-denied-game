import { describe, expect, it } from 'vitest';
import { VEHICLES, vehicleDefinition, validateVehicle } from './definitions';
import { assemblyMass, createVehicle, detachedRoot, hitVehicle, parkVehicle, partPose, runVehicle, stepDetached, stepVehicle } from './runtime';
import { boxContact, stepVehicleWorld, vehicleLoad, vehicleStats } from './world';
import { createTown } from '../world/town';
import { createDozer } from './dozer';
import { ParticlePool } from '../fx/particles';
import { restoreBay, testVehicleImpact, yardVehicleRoute, runYardFleet } from '../world/testYard';
import { SIM_DT, DEBRIS } from '../game/constants';
import type { VehicleContact } from './types';
function contact(v: ReturnType<typeof createVehicle>, id: string, impulse = 8): VehicleContact {
    const d = vehicleDefinition(v.definitionId), p = partPose(v, d.parts.findIndex(p => p.id === id));
    return { x: p.x, y: p.y, z: p.z + p.height * .5, nx: 0, ny: 1, nz: 0, impulse, source: 'test' };
}
const empty = () => { const t = createTown(); t.buildings = []; t.props = []; t.vehicles = []; t.roadCar = null; t.rubble = []; return t; };
describe('modular vehicle contract', () => {
    it('collides with an older sleeping wreck even when the wreck skips its own simulation',()=>{
        const t=empty(),wreck=createVehicle('car',14,10),moving=createVehicle('car',11.5,10),pool=new ParticlePool();
        wreck.status='wreck';wreck.sleeping=true;t.vehicles.push(wreck,moving);moving.vx=6;moving.sleeping=false;
        for(let i=0;i<90;i++)stepVehicleWorld(t,createDozer(2,2,0),pool,[],SIM_DT);
        expect(moving.x).toBeLessThan(wreck.x-1);expect(wreck.x).toBeGreaterThan(14);
    });
    it('discovers twelve configurations with two paints and validated mass budgets', () => {
        expect(VEHICLES).toHaveLength(12);
        for (const d of VEHICLES) {
            expect(() => validateVehicle(d)).not.toThrow();
            expect(d.paints).toHaveLength(2);
            expect(d.parts.length).toBeLessThanOrEqual(16);
        }
        const d = structuredClone(VEHICLES[0]!);
        d.parts[1]!.parent = d.parts[1]!.id;
        expect(() => validateVehicle(d)).toThrow(/cycle/);
    });
    it('hits the contacted wheel, leaves the other side intact and deduplicates blade samples', () => {
        const a = createVehicle('tractor', 10, 10), b = createVehicle('tractor', 10, 10), c = contact(a, 'wheel-1--1', 3);
        hitVehicle(a, [c, c, c, c]);
        hitVehicle(b, [c]);
        expect(a.parts).toEqual(b.parts);
        const def = vehicleDefinition('tractor'), near = def.parts.findIndex(p => p.id === 'wheel-1--1'), far = def.parts.findIndex(p => p.id === 'wheel-1-1');
        expect(a.parts[near]!.damage).toBeGreaterThan(0);
        expect(a.parts[far]!.damage).toBe(0);
    });
    it('resolves the same region after rotating the vehicle', () => {
        const a = createVehicle('tractor', 10, 10, 0), b = createVehicle('tractor', 10, 10, Math.PI / 2);
        hitVehicle(a, [contact(a, 'wheel-1--1', 3)]);
        hitVehicle(b, [contact(b, 'wheel-1--1', 3)]);
        expect(a.parts.map(p => p.damage)).toEqual(b.parts.map(p => p.damage));
    });
    it('moves under gentle impact and accumulates permanent damage under sustained pressure', () => {
        const v = createVehicle('car', 10, 10), c = contact(v, 'cab', .2);
        hitVehicle(v, [c]);
        expect(v.vy).toBeGreaterThan(0);
        expect(v.parts.every(p => p.damage === 0)).toBe(true);
        hitVehicle(v, [{ ...c, impulse: 0, load: 24, dt: .5 }]);
        const damage = v.parts.map(p => p.damage);
        stepVehicle(v, .1);
        expect(v.parts.map(p => p.damage)).toEqual(damage);
    });
    it('detaches a parent with its children without duplicating mass', () => {
        const v = createVehicle('forklift', 10, 10), d = vehicleDefinition('forklift');
        hitVehicle(v, [contact(v, 'mast', 50)]);
        const mast = d.parts.findIndex(p => p.id === 'mast'), fork = d.parts.findIndex(p => p.id === 'fork-1');
        expect(v.parts[mast]!.detached).toBe(true);
        expect(detachedRoot(v, fork)).toBe(mast);
        const roots = v.parts.flatMap((s, i) => s.detached ? [i] : []);
        expect(assemblyMass(v) + roots.reduce((n, i) => n + assemblyMass(v, i), 0)).toBeCloseTo(d.mass, 8);
        v.parts[mast]!.x += 2;
        expect(partPose(v, fork).x).toBeGreaterThan(11);
    });
    it('disables propulsion after engine failure; wreck reward is paid once', () => {
        const v = createVehicle('car', 10, 10);
        hitVehicle(v, [contact(v, 'engine', 100)]);
        expect(v.status).not.toBe('operational');
        for (let i = 0; i < 8; i++)
            testVehicleImpact(v, 'overhead', 30);
        expect(v.status).toBe('wreck');
        const cash = v.pendingCash;
        testVehicleImpact(v, 'overhead', 30);
        expect(v.pendingCash).toBe(cash);
        expect(cash).toBe(vehicleDefinition('car').cash);
        const x = v.x;
        runVehicle(v, [{ x: 30, y: 10 }]);
        expect(v.autonomous).toBe(false);
        expect(v.x).toBe(x);
    });
    it.each(VEHICLES.map(d => d.id))('drives %s and settles after parking', id => {
        const v = createVehicle(id, 10, 10);
        yardVehicleRoute(v);
        for (let i = 0; i < 360; i++)
            stepVehicle(v, SIM_DT);
        expect(Math.hypot(v.x - 10, v.y - 10)).toBeGreaterThan(2);
        expect(v.parts.every((_, i) => Number.isFinite(partPose(v, i).x))).toBe(true);
        parkVehicle(v);
        for (let i = 0; i < 300; i++)
            stepVehicle(v, SIM_DT);
        expect(v.sleeping).toBe(true);
    });
    it('articulates a trailer and releases it at the hitch', () => {
        const v = createVehicle('tractor-trailer', 10, 10);
        const wheel = vehicleDefinition(v.definitionId).parts.findIndex(p=>p.id==='trailer-wheel-1');
        expect(partPose(v,wheel).z).toBe(0);
        yardVehicleRoute(v);
        for (let i = 0; i < 240; i++)
            stepVehicle(v, SIM_DT);
        const i = vehicleDefinition(v.definitionId).parts.findIndex(p => p.role === 'trailer');
        expect(Math.abs(v.parts[i]!.heading)).toBeGreaterThan(.01);
        expect(Math.abs(v.parts[i]!.heading)).toBeLessThanOrEqual(.8);
        hitVehicle(v, [contact(v, 'trailer', 100)]);
        expect(v.parts[i]!.detached).toBe(true);
        expect(assemblyMass(v, i)).toBeGreaterThan(0);
    });
    it('bounds detached bodies, preserves overflow and wakes on another hit', () => {
        const v = createVehicle('tractor-trailer', 10, 10);
        testVehicleImpact(v, 'overhead', 60);
        const detached = v.parts.filter(p => p.detached).length;
        expect(detached).toBeGreaterThan(0);
        stepDetached(v, .02, { remaining: 0 }, () => 0);
        expect(v.parts.filter(p => p.detached)).toHaveLength(detached);
        expect(v.parts.filter(p => p.detached).every(p => p.sleeping && p.z === 0)).toBe(true);
        const i = v.parts.findIndex(p => p.detached);
        hitVehicle(v, [contact(v, vehicleDefinition(v.definitionId).parts[i]!.id, 1)]);
        expect(v.parts[i]!.sleeping).toBe(false);
    });
    it('preserves deck separation and uses oriented collision', () => {
        const a = { x: 0, y: 0, w: 4, d: 1, z: 0, h: 1, heading: Math.PI / 2 };
        expect(boxContact(a, { ...a, x: 1.5, heading: 0 })).toBeDefined();
        expect(boxContact(a, { ...a, z: 3 })).toBeUndefined();
        expect(boxContact(a, { ...a, x: 3 })).toBeUndefined();
    });
    it('makes the dozer dent and push a parked car through production contact', () => {
        const t = empty(), v = createVehicle('car', 10, 10), dozer = createDozer(7.8, 10, 0), pool = new ParticlePool();
        t.vehicles.push(v);
        dozer.bladeDown = true;
        for (let i = 0; i < 120; i++) {
            dozer.vx = 2.5;
            dozer.x += 2.5 * SIM_DT;
            stepVehicleWorld(t, dozer, pool, [], SIM_DT);
        }
        expect(v.parts.some(p => p.damage > 0)).toBe(true);
        expect(v.x).toBeGreaterThan(10);
        expect(v.parts.every(p => Number.isFinite(p.damage))).toBe(true);
    });
    it('resolves a head-on collision with damage and prevents vehicles crossing through each other', () => {
        const t = empty(), a = createVehicle('car', 10, 10), b = createVehicle('car', 13, 10, Math.PI), pool = new ParticlePool();
        t.vehicles.push(a, b);
        a.vx = 6;
        b.vx = -6;
        a.sleeping = b.sleeping = false;
        for (let i = 0; i < 120; i++)
            stepVehicleWorld(t, createDozer(2, 2, 0), pool, [], SIM_DT);
        expect(a.x).toBeLessThan(b.x);
        expect(a.parts.some(p => p.damage > 0) || b.parts.some(p => p.damage > 0)).toBe(true);
        expect(b.x - a.x).toBeGreaterThan(1.2);
    });
    it('brakes, retries and reports a blocked route without teleporting', () => {
        const v = createVehicle('car', 10, 10);
        runVehicle(v, [{ x: 30, y: 10 }]);
        for (let i = 0; i < 1200; i++)
            stepVehicle(v, SIM_DT, true);
        expect(v.routeStatus).toBe('blocked');
        expect(v.autonomous).toBe(false);
        expect(Math.hypot(v.x - 10, v.y - 10)).toBeLessThan(6);
    });
    it('routes downward loads through production damage and retains the wreck', () => {
        const t = empty(), v = createVehicle('car', 10, 10);
        t.vehicles.push(v);
        for (let i = 0; i < 8; i++)
            vehicleLoad(t, 10, 10, 20, 4, 30, 'slab');
        expect(v.status).toBe('wreck');
        const pool = new ParticlePool();
        const cash = stepVehicleWorld(t, createDozer(2, 2, 0), pool, [], SIM_DT);
        expect(cash).toBe(vehicleDefinition('car').cash);
        expect(t.vehicles).toContain(v);
        expect(stepVehicleWorld(t, createDozer(2, 2, 0), pool, [], SIM_DT)).toBe(0);
    });
    it('restores owned moving wrecks without removing a neighbor', () => {
        const t = createTown({ yard: true }), b = t.yard!.bays.find(b => b.vehicle?.definitionId === 'tractor')!, neighbor = t.vehicles.find(v => v !== b.vehicle)!;
        const old = b.vehicle!;
        old.x += 50;
        testVehicleImpact(old, 'overhead', 70);
        restoreBay(t, b, new ParticlePool());
        expect(t.vehicles).not.toContain(old);
        expect(t.vehicles).toContain(neighbor);
        expect(b.vehicle!.status).toBe('operational');
    });
    it('runs all twelve in their production yard bays without self damage', () => {
        const t = createTown({ yard: true }), fleet = t.yard!.bays.flatMap(b => b.vehicle ? [b.vehicle] : []), starts = fleet.map(v => ({ x: v.x, y: v.y }));
        runYardFleet(t);
        const pool = new ParticlePool();
        for (let i = 0; i < 600; i++)
            stepVehicleWorld(t, createDozer(2, 2, 0), pool, [], SIM_DT);
        for (let i = 0; i < fleet.length; i++) {
            expect(fleet[i]!.status, fleet[i]!.definitionId).toBe('operational');
            expect(Math.hypot(fleet[i]!.x - starts[i]!.x, fleet[i]!.y - starts[i]!.y), fleet[i]!.definitionId).toBeGreaterThan(3);
        }
    });
    it('bounds a 120-wreck yard with twelve active vehicles', () => {
        const t = empty();
        t.maxX = 160;
        t.maxY = 160;
        for (let i = 0; i < 132; i++) {
            const v = createVehicle(VEHICLES[i % 12]!.id, 10 + (i % 12) * 10, 10 + Math.floor(i / 12) * 12);
            if (i < 120) {
                for (let j = 0; j < 5; j++)
                    testVehicleImpact(v, 'overhead', 40);
                stepDetached(v, .02, { remaining: 0 }, () => 0);
                v.sleeping = true;
            }
            else
                runVehicle(v, [{ x: v.x + 5, y: v.y }]);
            t.vehicles.push(v);
        }
        const pool = new ParticlePool(), times: number[] = [];
        for (let i = 0; i < 90; i++) {
            const start = performance.now();
            stepVehicleWorld(t, createDozer(2, 2, 0), pool, [], SIM_DT);
            times.push(performance.now() - start);
        }
        expect(t.vehicles).toHaveLength(132);
        expect(vehicleStats.detached).toBeLessThanOrEqual(DEBRIS.activeCap);
        expect(t.vehicles.every(v => Number.isFinite(v.x) && Number.isFinite(v.y))).toBe(true);
        times.sort((a, b) => a - b);
        console.log(JSON.stringify({ scenario: '120-wrecks-12-active', p95Ms: times[Math.floor(times.length * .95)], ...vehicleStats }));
    });
});
