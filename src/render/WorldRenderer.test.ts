import { Container, Graphics, Text } from 'pixi.js';
import { expect, it, vi } from 'vitest';
import { frameIsolateLot, instantiateIsolateDefinition } from '../debug/isolateLot';
import { ParticlePool } from '../fx/particles';
import { archetypeById } from '../world/archetypes';
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

function dropStaticBuildingCache(renderer: WorldRenderer): void {
  Object.assign(renderer, { staticBuildingCmds: new WeakMap() });
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
  const originX = mid.x * renderer.zoom;
  const originY = mid.y * renderer.zoom;
  const pan = 28;
  const offsets = [90, 130, 170, 210, 250, 290, 330, 370, 420, 480, 560, 640];
  for (const axis of ["x", "y"] as const) {
    for (const sign of [1, -1]) {
      for (const offset of offsets) {
        renderer.camX = originX + (axis === "x" ? sign * offset : 0);
        renderer.camY = originY + (axis === "y" ? sign * offset : 0);
        renderer.layout(viewW, viewH, 0, 0);
        renderer.draw(town, dozer, particles, [], 1, false);
        const edgeKeys = renderer.submittedKeys();
        if (edgeKeys.length === 0) continue;
        renderer.camX += axis === "x" ? -sign * pan : 0;
        renderer.camY += axis === "y" ? -sign * pan : 0;
        renderer.layout(viewW, viewH, 0, 0);
        renderer.draw(town, dozer, particles, [], 1, false);
        const pannedKeys = renderer.submittedKeys();
        if (pannedKeys.join("\0") !== edgeKeys.join("\0")) return { edgeKeys, pannedKeys };
      }
    }
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
  renderer.showNhood = true;
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
