import { expect, it } from 'vitest';
import { DrawCache } from './drawCache';
it('reuses unchanged geometry, invalidates changes, and releases absent objects', () => {
  const cache = new DrawCache();
  let paints = 0;
  const cmd = { key: 'wreck:1', version: 1, run: (g: import('pixi.js').Graphics) => { paints++; g.rect(0, 0, 1, 1).fill(0xff0000); } };
  cache.draw([cmd]);
  const graphic = cache.root.children[0]!;
  cache.draw([cmd]);
  expect(paints).toBe(1);
  expect(cache.root.children[0]).toBe(graphic);
  cache.draw([{ ...cmd, version: 2 }]);
  expect(paints).toBe(2);
  cache.draw([]);
  expect(graphic.destroyed).toBe(true);
  expect(cache.size).toBe(0);
  expect(cache.root.children).toHaveLength(0);
});
it('keeps cached and moving objects in the submitted painter order', () => {
  const cache = new DrawCache();
  const a = { key: 'a', version: 1, run: () => {} }, b = { key: 'b', version: 1, run: () => {} };
  cache.draw([a, b]);
  const [ga, gb] = cache.root.children;
  cache.draw([b, a]);
  expect(cache.root.children).toEqual([gb, ga]);
  cache.clear();
});
