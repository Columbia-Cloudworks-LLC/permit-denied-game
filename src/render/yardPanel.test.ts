// @vitest-environment happy-dom
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { ParticlePool } from '../fx/particles';
import { createDebugBinderState, type DebugBinderState } from '../debug/binderState';
import { createTown, type Town } from '../world/town';
import type { YardBay } from '../world/yardCatalog';
import './domTestShims';
import { YardPanel, type YardControls } from './yardPanel';

let yardTown: Town;
let town: Town;
let state: DebugBinderState;
let controls: { [K in keyof YardControls]: YardControls[K] extends (...args: never[]) => unknown ? ReturnType<typeof vi.fn> : YardControls[K] };
let panel: YardPanel;
const el = <T extends HTMLElement = HTMLElement>(selector: string) => panel.root.querySelector<T>(selector)!;
const click = (name: string) => el(`[data-${name}]`).click();
const input = (selector: string, value: string, event = 'input') => {
  const field = el<HTMLInputElement>(selector);
  field.value = value;
  field.dispatchEvent(new Event(event, { bubbles: true }));
};
const selectBay = (bay: YardBay) => {
  input('[data-search]', bay.asset.id);
  input('[data-assets]', bay.asset.id, 'change');
};

beforeAll(() => { yardTown = createTown({ district: 'classic', yard: true, seed: 3 }); });

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  town = yardTown;
  state = createDebugBinderState();
  const particles = new ParticlePool();
  controls = {
    town: vi.fn(() => town), particles, dozer: vi.fn(() => ({ x: -50, y: -50 })),
    jump: vi.fn(), releaseInput: vi.fn(), preview: vi.fn(), changed: vi.fn(), destroy: vi.fn(),
    frame: vi.fn(), followVehicle: vi.fn(), testAsset: vi.fn(),
  } as typeof controls;
  panel = new YardPanel(document.querySelector<HTMLElement>('#host')!, controls as unknown as YardControls, state);
  panel.reset();
});

it('lists the whole catalog and narrows it by search and filters', () => {
  const total = town.yard!.assets.length;
  expect(el('[data-coverage]').textContent).toBe(`${total} of ${total} assets · buildings, vehicles, props, sites & fixtures`);
  expect(el<HTMLSelectElement>('[data-category]').options[0]!.textContent).toBe('All');
  const asset = town.yard!.assets[0]!;
  input('[data-search]', asset.id);
  expect(state.search).toBe(asset.id);
  expect(el<HTMLSelectElement>('[data-assets]').value).toBe(asset.id);
  input('[data-search]', '');
  input('[data-category]', asset.category);
  const shown = el<HTMLSelectElement>('[data-assets]').options.length;
  expect(shown).toBe(town.yard!.assets.filter(a => a.category === asset.category).length);
  input('[data-search]', 'no-such-asset-anywhere');
  expect(state.assetId).toBe('');
  expect(el<HTMLButtonElement>('[data-test]').disabled).toBe(true);
});

it('opens a focused test for a valid variant and explains a bad one', () => {
  const asset = town.yard!.assets[0]!;
  input('[data-assets]', asset.id, 'change');
  input('[data-variant]', String(asset.variants));
  click('test');
  expect(controls.testAsset).not.toHaveBeenCalled();
  expect(el('[data-status]').textContent).toBe(`Choose an asset and a variant from 0 to ${asset.variants - 1}.`);
  input('[data-variant]', '0');
  click('test');
  expect(controls.testAsset).toHaveBeenCalledWith(asset.id, 0);
});

it('inspects a loaded example and acts on it', () => {
  const bay = town.yard!.bays.find(b => b.baseline && b.building && !b.asset.fixture)!;
  selectBay(bay);
  expect(el('[data-loaded]').hidden).toBe(false);
  const report = el('[data-inspect]').textContent!;
  expect(report).toContain(`${bay.asset.name} · variant ${bay.variant}`);
  expect(report).toMatch(/\d+\/\d+ cells$/);
  expect(el<HTMLButtonElement>('[data-remove]').disabled).toBe(true);
  click('instance-jump');
  expect(controls.jump).toHaveBeenCalledWith(bay.x + bay.w / 2, bay.y + bay.asset.clearance + bay.asset.d + 5);
  click('frame');
  expect(controls.frame).toHaveBeenCalledWith(bay);
  click('destroy');
  expect(controls.destroy).toHaveBeenCalledWith(bay);
  click('debris');
  click('restore');
  expect(controls.changed).toHaveBeenCalledTimes(2);
});

it('drives the selected vehicle through route and impact tests', () => {
  const bay = town.yard!.bays.find(b => b.baseline && b.vehicle)!;
  selectBay(bay);
  expect(el('[data-section="vehicle"]').hidden).toBe(false);
  expect(el('[data-inspect]').textContent).toContain('detached assemblies');
  const vehicle = bay.vehicle!;
  click('regions');
  expect(vehicle.debugParts).toBe(true);
  click('follow');
  expect(controls.followVehicle).toHaveBeenCalledWith(bay);
  click('overhead');
  click('overhead');
  expect(town.yard!.loads!.filter(l => l.vehicle === vehicle)).toHaveLength(1);
  click('front');
  click('run');
  click('stop');
  expect(vehicle.status).toBeDefined();
});

it('previews a batch in the experiment area, then cancels it on edits', () => {
  click('area');
  expect(Number(el<HTMLInputElement>('[data-x]').value)).toBe(8);
  expect(Number(el<HTMLInputElement>('[data-y]').value)).toBe(Math.round(town.yard!.baselineEnd + 6));
  expect(controls.jump).toHaveBeenLastCalledWith(4, town.yard!.baselineEnd + 3);
  click('preview');
  const [plan, valid] = controls.preview.mock.lastCall as [YardBay[], boolean];
  expect(plan.length).toBeGreaterThan(0);
  expect(el<HTMLButtonElement>('[data-place]').disabled).toBe(!valid);
  input('[data-quantity]', '2');
  expect(controls.preview).toHaveBeenLastCalledWith([], true);
  expect(el<HTMLButtonElement>('[data-place]').disabled).toBe(true);
});

it('refreshes the inspector on its own timer only while open', () => {
  const bay = town.yard!.bays.find(b => b.baseline && b.prop)!;
  selectBay(bay);
  const before = el('[data-inspect]').textContent;
  expect(before).toMatch(/HP$/);
  bay.prop!.hp = 0;
  panel.tick(0.2);
  expect(el('[data-inspect]').textContent).toBe(before);
  panel.tick(0.2);
  expect(el('[data-inspect]').textContent).toContain(`0/${bay.prop!.maxHp} HP`);
});
