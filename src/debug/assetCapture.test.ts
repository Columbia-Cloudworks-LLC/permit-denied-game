import { describe, expect, it, vi } from 'vitest';
import { WorldRenderer } from '../render/WorldRenderer';
import { AssetCaptureSession } from './assetCapture';

function session() {
  const present = vi.fn();
  const capture = new AssetCaptureSession(new WorldRenderer(), present);
  return { capture, api: capture.api(), present };
}

const cellsIn = (snap: ReturnType<AssetCaptureSession['snapshot']>, state: string) =>
  snap.buildings.reduce((n, b) => n + (b.cells[state] ?? 0), 0);

describe('asset capture session', () => {
  it('lists the yard catalog, one entry per facade detail, and the runtime vehicles', () => {
    const { api } = session();
    const ids = api.catalog.map((entry) => entry.id);
    expect(ids).toContain('building:bakery');
    expect(ids).toContain('detail:display-glazing');
    expect(api.catalog.find((entry) => entry.id === 'vehicle:bulldozer')).toMatchObject({ destruction: 'unsupported', variants: 2 });
    expect(api.catalog.find((entry) => entry.id === 'site:farmstead')!.floors).toBeGreaterThan(0);
    expect(api.catalog.find((entry) => entry.id.startsWith('fixture:'))!.floors).toBeGreaterThanOrEqual(2);
    expect(api.layers).toContain('roofs');
  });

  it('loads a building, draws it, and damages it in stages', () => {
    const { api, present } = session();
    const loaded = api.load('building:bakery');
    expect(present).toHaveBeenCalledOnce();
    expect(cellsIn(loaded, 'intact')).toBeGreaterThan(0);
    // A crack takes a third of each south-face cell's strength, which may not change its state.
    expect(cellsIn(api.damage('crack'), 'intact')).toBeLessThanOrEqual(cellsIn(loaded, 'intact'));
    expect(cellsIn(api.damage('supports'), 'intact')).toBeLessThan(cellsIn(loaded, 'intact'));
    const settled = api.advance(30);
    expect(settled.ticks).toBe(30);
    expect(settled.seconds).toBeCloseTo(0.5);
    api.damage('all');
    expect(cellsIn(api.advance(120), 'gone')).toBeGreaterThan(0);
    const drawn = api.render({ roofs: false });
    expect(drawn.debug.roofs).toBe(false);
    expect(drawn.debug.vehicles).toBe(false);
  });

  it('cracks only the captured detail, and breaks fixtures without touching their host', () => {
    const { api } = session();
    const detail = api.load('detail:display-glazing');
    expect(detail.buildings[0]!.details.every((d) => d.kind === 'display-glazing')).toBe(true);
    api.damage('crack');
    const fixtureId = api.catalog.find((entry) => entry.id.startsWith('fixture:'))!.id;
    const fixture = api.load(fixtureId);
    const after = api.damage('breach');
    expect(after.buildings[0]!.brokenFixtures).toBeGreaterThan(fixture.buildings[0]!.brokenFixtures);
    expect(cellsIn(after, 'gone')).toBe(cellsIn(fixture, 'gone'));
  });

  it('breaks props: a scuff on crack, the first one on breach', () => {
    const { api } = session();
    api.load('prop:hay-bale-round');
    const scuffed = api.damage('crack');
    expect(scuffed.props[0]!.broken).toBe(false);
    const breached = api.damage('breach');
    expect(breached.props[0]!.broken).toBe(true);
  });

  it('turns, drives, pushes and crashes a modular vehicle', () => {
    const { api } = session();
    api.load('vehicle:box-truck', 1);
    expect(api.vehicleScenario('heading', 1.2).vehicles[0]!.heading).toBe(1.2);
    api.vehicleScenario('push');
    api.vehicleScenario('travel');
    const hit = api.vehicleScenario('front', 30);
    expect(Math.max(...hit.vehicles[0]!.parts.map((p) => p.damage))).toBeGreaterThan(0);
    api.damage('all');
    expect(api.snapshot().vehicles[0]!.status).not.toBe('operational');
  });

  it('drives the runtime bulldozer and road car, which have no destruction', () => {
    const { api } = session();
    const start = api.load('vehicle:bulldozer', 1).vehicle as { x: number; bladeDown: boolean };
    expect(start.bladeDown).toBe(true);
    const moved = api.advance(60).vehicle as { x: number };
    expect(moved.x).not.toBe(start.x);
    expect(() => api.damage('crack')).toThrow('Runtime vehicles have no production destruction mechanic');
    expect(() => api.vehicleScenario('front')).toThrow('Select a modular vehicle');
    expect(api.load('vehicle:road-vehicle').vehicle).not.toBeNull();
  });

  it('rejects unknown assets, bad variants and out-of-range steps', () => {
    const { api } = session();
    expect(() => api.load('building:nowhere')).toThrow('Unknown capture asset building:nowhere');
    expect(() => api.load('building:bakery', 5)).toThrow('Invalid variant');
    api.load('building:bakery');
    expect(() => api.advance(-1)).toThrow('Expected 0–3600 fixed steps');
    expect(() => api.inputs('nope')).toThrow('Unknown capture asset nope');
  });

  it('reports the production inputs behind a capture', () => {
    const { api } = session();
    expect(api.inputs('site:farmstead').siteBuildings!.length).toBeGreaterThan(0);
    expect(api.inputs(api.catalog.find((entry) => entry.id.startsWith('fixture:'))!.id).fixtureHost!.id).toBe('rivertown');
    expect(api.inputs('building:bakery')).toMatchObject({ seed: 4517, fixtureHost: undefined });
  });
});
