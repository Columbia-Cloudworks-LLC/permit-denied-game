import { expect, it, vi } from 'vitest';

// A two-frame sheet on a 64x32 texture: each frame becomes UVs within it.
vi.mock('pixi.js', async (orig) => {
  const pixi = await orig<typeof import('pixi.js')>();
  const frame = (x: number, y: number) => ({ frame: { x, y, width: 32, height: 32 } });
  const sheet = {
    texture: { width: 64, height: 32 },
    textures: { 'grass-0': frame(0, 0), 'dirt-0': frame(32, 0) },
  };
  const Assets = Object.assign(Object.create(pixi.Assets), { load: async () => sheet });
  return { ...pixi, Assets };
});

it('maps each sprite sheet frame to UVs within the sheet and bumps the atlas revision', async () => {
  const { ensureTerrainAtlas, terrainAtlasRevision } = await import('./terrainTiles');
  const before = terrainAtlasRevision();
  const atlas = (await ensureTerrainAtlas())!;
  expect(atlas.frames.get('grass-0')).toEqual({ name: 'grass-0', u0: 0, v0: 0, u1: 0.5, v1: 1 });
  expect(atlas.frames.get('dirt-0')).toEqual({ name: 'dirt-0', u0: 0.5, v0: 0, u1: 1, v1: 1 });
  expect(terrainAtlasRevision()).toBe(before + 1);
  expect(await ensureTerrainAtlas()).toBe(atlas);
});
