import { Container, Graphics, Text } from 'pixi.js';
import { expect, it, vi } from 'vitest';
import { frameIsolateLot, instantiateIsolateDefinition } from '../debug/isolateLot';
import { ParticlePool } from '../fx/particles';
import { archetypeById } from '../world/archetypes';
import { ISO_Z } from '../game/constants';
import type { Building } from '../structure/types';
import { worldToScreen } from '../world/iso';
import { createDozer } from '../vehicle/dozer';
import { createTown } from '../world/town';
import { WorldRenderer } from './WorldRenderer';

function spyPixiAddChildWarnings(): { messages: () => string[]; restore: () => void } {
  const messages: string[] = [];
  const capture = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };
  const warn = vi.spyOn(console, "warn").mockImplementation(capture);
  const group = vi.spyOn(console, "groupCollapsed").mockImplementation(capture);
  return {
    messages: () => messages.filter((message) => /addChild: Only Containers will be allowed to add children/i.test(message)),
    restore: () => {
      warn.mockRestore();
      group.mockRestore();
    },
  };
}

function cacheEntries(renderer: WorldRenderer): Map<string, { graphic: Graphics }> {
  return (renderer as unknown as { drawing: { entries: Map<string, { graphic: Graphics }> } }).drawing.entries;
}

function staticBuildingKey(renderer: WorldRenderer, building: Building): string | undefined {
  return (renderer as unknown as { staticBuildingCmds: WeakMap<Building, { key: string }> }).staticBuildingCmds.get(building)?.key;
}

function dropStaticBuildingCache(renderer: WorldRenderer): void {
  Object.assign(renderer, { staticBuildingCmds: new WeakMap() });
}

/** Camera positions stepping out from a point along each axis, each paired with a short pan back. */
function panProbes(originX: number, originY: number, pan: number) {
  const offsets = [90, 130, 170, 210, 250, 290, 330, 370, 420, 480, 560, 640];
  const directions = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
  return directions.flatMap(({ dx, dy }) => offsets.map((offset) => {
    const x = originX + dx * offset, y = originY + dy * offset;
    return { x, y, panX: x - dx * pan, panY: y - dy * pan };
  }));
}

function framePartialBuilding(
  renderer: WorldRenderer,
  town: ReturnType<typeof createTown>,
  dozer: ReturnType<typeof createDozer>,
  particles: ParticlePool,
  viewW: number,
  viewH: number,
): { edgeKeys: string[]; pannedKeys: string[] } {
  const building = town.buildings[0]!;
  expect(building).toBeTruthy();
  renderer.debug.effects = false;
  renderer.debug.debris = false;
  renderer.debug.terrain = false;
  renderer.zoom = 1.15;
  const mid = worldToScreen(
    building.x + building.w * building.cellSize / 2,
    building.y + building.d * building.cellSize / 2,
  );
  const keysAt = (camX: number, camY: number) => {
    renderer.camX = camX;
    renderer.camY = camY;
    renderer.layout(viewW, viewH, 0, 0);
    renderer.draw(town, dozer, particles, [], 1, false);
    return renderer.submittedKeys();
  };
  for (const probe of panProbes(mid.x * renderer.zoom, mid.y * renderer.zoom, 28)) {
    const edgeKeys = keysAt(probe.x, probe.y);
    if (edgeKeys.length === 0) continue;
    const pannedKeys = keysAt(probe.panX, probe.panY);
    if (pannedKeys.join("\0") !== edgeKeys.join("\0")) return { edgeKeys, pannedKeys };
  }
  throw new Error("no camera offset revealed additional static building commands");
}

it('reuses visible building geometry when panning and zooming, and rebuilds after damage', () => {
  const town = createTown(), renderer = new WorldRenderer();
  town.props = []; town.ground = []; town.lots = []; town.network.mesh = [];
  const dozer = createDozer(-100, -100, 0), particles = new ParticlePool();
  renderer.debug.effects = false; renderer.debug.debris = false;
  renderer.layout(10000, 10000, 0, 0);
  renderer.draw(town, dozer, particles, []);
  const first = renderer.stats.rebuilt;
  renderer.draw(town, dozer, particles, []);
  const stationary = renderer.stats.rebuilt;
  expect(stationary).toBeLessThan(first);
  renderer.camX += 10; renderer.camY += 5; renderer.zoom += .05;
  renderer.layout(10001, 10001, 0, 0);
  renderer.draw(town, dozer, particles, []);
  expect(renderer.stats.rebuilt).toBe(stationary);
  town.buildings[0]!.visualRevision++;
  renderer.draw(town, dozer, particles, []);
  expect(renderer.stats.rebuilt).toBeGreaterThan(stationary);
  renderer.invalidate(); renderer.root.destroy({ children: true });
});

it('submits newly visible static pieces after a sub-bucket pan, matching a fresh rebuild', () => {
  for (const id of ['office-slab-eight', 'parking-garage'] as const) {
    const lot = instantiateIsolateDefinition(archetypeById(id));
    const renderer = new WorldRenderer();
    const particles = new ParticlePool();
    lot.town.props = [];
    const { edgeKeys, pannedKeys } = framePartialBuilding(renderer, lot.town, lot.dozer, particles, 280, 200);
    expect(pannedKeys).not.toEqual(edgeKeys);
    expect(pannedKeys.length).toBeGreaterThan(0);
    dropStaticBuildingCache(renderer);
    renderer.draw(lot.town, lot.dozer, particles, [], 1, false);
    expect(renderer.submittedKeys()).toEqual(pannedKeys);
    renderer.invalidate();
    renderer.root.destroy({ children: true });
  }
});

it('keeps isolated intact stats after a static cache hit and DrawCache invalidate', () => {
  const lot = instantiateIsolateDefinition(archetypeById('farmhouse-rear-wing'));
  const renderer = new WorldRenderer();
  const particles = new ParticlePool();
  renderer.debug.effects = false;
  renderer.debug.debris = false;
  frameIsolateLot(renderer, lot.camera, 1280, 960);
  renderer.layout(1280, 960, 0, 0);
  renderer.draw(lot.town, lot.dozer, particles, [], 10, false);
  const first = { visible: renderer.stats.visible, commands: renderer.stats.commands };
  expect(first.visible).toBeGreaterThan(first.commands);
  renderer.invalidate();
  renderer.draw(lot.town, lot.dozer, particles, [], 10, false);
  expect(renderer.stats.visible).toBe(first.visible);
  expect(renderer.stats.commands).toBe(first.commands);
  renderer.invalidate();
  renderer.root.destroy({ children: true });
});

it('draws the neighborhood overlay without parenting labels onto Graphics', () => {
  const warnings = spyPixiAddChildWarnings();
  const town = createTown({ district: 'd10', seed: 19 });
  const renderer = new WorldRenderer();
  const dozer = createDozer(town.spawnX, town.spawnY, town.spawnHeading);
  const particles = new ParticlePool();
  renderer.debug.graph = true;
  renderer.layout(1280, 720, 0, 0);
  renderer.draw(town, dozer, particles, []);
  expect(warnings.messages()).toEqual([]);
  const labels: Text[] = [];
  const walk = (node: Container): void => {
    if (node instanceof Graphics) expect(node.children, 'Graphics must not hold children').toHaveLength(0);
    for (const child of node.children) {
      if (child instanceof Text) labels.push(child);
      if ('children' in child) walk(child as Container);
    }
  };
  walk(renderer.root);
  expect(labels.some((label) => label.parent !== renderer.root)).toBe(true);
  for (const label of labels) {
    expect(label.parent).toBeInstanceOf(Container);
    expect(label.parent instanceof Graphics).toBe(false);
  }
  warnings.restore();
  renderer.invalidate();
  renderer.root.destroy({ children: true });
});

it('rebuilds cached ground when the map ground condition changes', () => {
  const town = createTown();
  expect(town.groundCondition).toBe('clear');
  const renderer = new WorldRenderer();
  const dozer = createDozer(town.spawnX, town.spawnY, town.spawnHeading);
  const particles = new ParticlePool();
  renderer.debug.effects = false;
  renderer.debug.debris = false;
  renderer.layout(640, 360, 0, 0);
  renderer.draw(town, dozer, particles, []);
  expect(renderer.stats.groundRebuilds).toBeGreaterThan(0);
  renderer.draw(town, dozer, particles, []);
  expect(renderer.stats.groundRebuilds).toBe(0);
  town.groundCondition = 'snow';
  renderer.draw(town, dozer, particles, []);
  expect(renderer.stats.groundRebuilds).toBeGreaterThan(0);
  renderer.invalidate();
  renderer.root.destroy({ children: true });
});

it('does not repaint a parked dozer or a settled chip, and reuses airborne effect Graphics', () => {
  const lot = instantiateIsolateDefinition(archetypeById('farmhouse-rear-wing'));
  const renderer = new WorldRenderer(), particles = new ParticlePool();
  renderer.debug.effects = true;
  frameIsolateLot(renderer, lot.camera, 1280, 960);
  renderer.layout(1280, 960, 0, 0);
  const front = lot.town.buildings[0]!;
  const x = front.x + front.w * front.cellSize / 2, y = front.y + front.d * front.cellSize + 3;
  Object.assign(lot.dozer, { x, y });
  const chip = particles.items[0]!, dust = particles.items[1]!;
  Object.assign(chip, { alive: true, settled: true, kind: 'concrete', x: x + 1, y: y + 1, z: 0, life: 5, maxLife: 5, size: .5, rot: 0 });
  Object.assign(dust, { alive: true, settled: false, kind: 'dust', x: x - 1, y: y + 1, z: 1, life: 1, maxLife: 1, size: .5, rot: 0 });
  renderer.draw(lot.town, lot.dozer, particles, [], 1 / 60);
  const entries = cacheEntries(renderer);
  const parked = vi.spyOn(entries.get('dozer')!.graphic, 'clear');
  const settled = vi.spyOn(entries.get('particle:0')!.graphic, 'clear');
  const airborne = entries.get('fx:0')!.graphic;
  dust.z = .8;
  renderer.draw(lot.town, lot.dozer, particles, [], 1 / 60);
  expect(parked).not.toHaveBeenCalled();
  expect(settled).not.toHaveBeenCalled();
  expect(entries.get('fx:0')!.graphic).toBe(airborne);
  lot.dozer.x += .5;
  renderer.draw(lot.town, lot.dozer, particles, [], 1 / 60);
  expect(parked).toHaveBeenCalledTimes(1);
  renderer.invalidate();
  renderer.root.destroy({ children: true });
});

it('keeps a still wreck on the static cache and slides clear core floors without repainting', () => {
  const lot = instantiateIsolateDefinition(archetypeById('office-slab-eight'));
  const renderer = new WorldRenderer(), particles = new ParticlePool();
  renderer.debug.effects = false;
  renderer.debug.debris = false;
  frameIsolateLot(renderer, lot.camera, 1280, 960);
  renderer.layout(1280, 960, 0, 0);
  const b = lot.town.buildings.find((building) => building.coreCollapse)!;
  lot.dozer.x = b.x - 40; lot.dozer.y = b.y - 40;
  const draw = () => renderer.draw(lot.town, lot.dozer, particles, [], 1 / 60, false);
  // A tower in its warning phase is damaged but holds still: no per-frame live rebuild.
  b.cells.find((cell) => cell.floor === 0)!.state = 'gone';
  b.coreCollapse!.phase = 'warning';
  b.visualRevision++;
  draw();
  expect(staticBuildingKey(renderer, b)).toMatch(new RegExp(`^${b.visualRevision}:`));
  draw();
  expect(renderer.stats.rebuilt).toBe(0);
  // A falling cell moves without a revision bump, so the building goes live.
  b.cells.find((cell) => cell.state === 'intact')!.state = 'falling';
  b.visualRevision++;
  draw();
  expect(staticBuildingKey(renderer, b)).not.toMatch(new RegExp(`^${b.visualRevision}:`));
  // Floors above the pile keep their standing geometry and only shift down the screen.
  b.coreCollapse!.phase = 'falling';
  b.coreCollapse!.drop = .5;
  b.visualRevision++;
  draw();
  const entries = cacheEntries(renderer);
  const shell = entries.get([...entries.keys()].find((key) => key.startsWith(`core:${b.id}:3:`))!)!.graphic;
  const repaint = vi.spyOn(shell, 'clear');
  b.coreCollapse!.drop = 1.5;
  b.visualRevision++;
  draw();
  expect(repaint).not.toHaveBeenCalled();
  expect(shell.y).toBeCloseTo(1.5 * ISO_Z);
  renderer.invalidate();
  renderer.root.destroy({ children: true });
});

it('reuses a near building build while the dozer is parked and its fades have landed', () => {
  const lot = instantiateIsolateDefinition(archetypeById('office-slab-eight'));
  const renderer = new WorldRenderer(), particles = new ParticlePool();
  renderer.debug.effects = false;
  frameIsolateLot(renderer, lot.camera, 1280, 960);
  renderer.layout(1280, 960, 0, 0);
  const b = lot.town.buildings.find((building) => building.coreCollapse)!;
  Object.assign(lot.dozer, { x: b.x + b.w * b.cellSize / 2, y: b.y - 1.5, heading: Math.PI / 2 });
  const internals = renderer as unknown as {
    nearBuildingCmds: WeakMap<Building, { cmds: unknown[]; fades: string[] }>;
    fades: { values: Map<string, number> };
  };
  const draw = () => renderer.draw(lot.town, lot.dozer, particles, [], 1 / 60);
  for (let i = 0; i < 90; i++) draw();
  const parked = internals.nearBuildingCmds.get(b)!;
  expect(parked.fades.length).toBeGreaterThan(0);
  const hidden = renderer.dozerHidden, commands = renderer.stats.commands;
  for (let i = 0; i < 5; i++) draw();
  expect(internals.nearBuildingCmds.get(b)).toBe(parked);
  expect(renderer.stats.rebuilt).toBe(0);
  expect(renderer.stats.commands).toBe(commands);
  expect(renderer.dozerHidden).toBe(hidden);
  // Reuse keeps the sampled fades alive instead of letting the frame end drop them.
  for (const key of parked.fades) expect(internals.fades.values.has(key)).toBe(true);
  lot.dozer.x += .5;
  draw();
  expect(internals.nearBuildingCmds.get(b)).not.toBe(parked);
  renderer.invalidate();
  renderer.root.destroy({ children: true });
});

it('forgets split runs and debris poses on invalidate, so a reloaded scene paints as it did fresh', () => {
  const renderer = new WorldRenderer();
  const internals = renderer as unknown as { chunkSplits: { lastSplit: Map<string, number> }; debrisPoses: Map<number, string> };
  internals.chunkSplits.lastSplit.set('chunk:b1:a:b:3', 1);
  internals.debrisPoses.set(7, '0:0:0:0');
  renderer.invalidate();
  expect(internals.chunkSplits.lastSplit.size).toBe(0);
  expect(internals.debrisPoses.size).toBe(0);
  renderer.root.destroy({ children: true });
});
