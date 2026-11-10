import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { PileField } from '../sim/pile';
import type { DebrisLayer, DebrisShape, Material, Rubble } from '../structure/types';
import { pileLead, pileTint } from './corePileDraw';
import { drawDebris } from './effectsDraw';
import { PAL } from './palette';

/** Seeds are spread the way spawned bodies' are; neighbouring integers would start the stream almost alike. */
function body(material: Material, layer: DebrisLayer, shape: DebrisShape, n = 7): Rubble {
  const seed = Math.imul(n, 0x9e3779b1) >>> 0;
  return {
    id: 1, x: 4, y: 4, vx: 0, vy: 0, vz: 0, heading: 0.4, omega: 0, w: 0.7, d: 0.3, elev: 0, thickness: 0.2, mass: 1,
    material, shape, layer, skin: 'default', seed, hp: 10, damage: 0, crushability: 0.5, friction: 0.5, sleeping: false, sleepT: 0, touchedAt: 0,
  };
}

/** Fill colours a body paints with, in order. */
function fills(r: Rubble): number[] {
  const g = new Graphics();
  const colors: number[] = [];
  const fill = g.fill.bind(g);
  g.fill = ((style: { color: number }) => { colors.push(style.color); return fill(style); }) as typeof g.fill;
  drawDebris(g, r);
  g.destroy();
  return colors;
}

describe('debris reads as its material', () => {
  it('beds brick remnants in mortar and leaves fragments as single bricks', () => {
    const wall = fills(body('brick', 'remnant', 'chunk'));
    expect(wall).toContain(0xb9a48c);
    expect(wall.length).toBeGreaterThan(8);
    const bat = fills(body('brick', 'fragment', 'chunk'));
    expect(bat).not.toContain(0xb9a48c);
    // Shadow plus one box.
    expect(bat.length).toBeLessThanOrEqual(4);
  });

  it('shows rebar on concrete remnants only', () => {
    expect(fills(body('concrete', 'remnant', 'chunk'))).toContain(0x5a3526);
    expect(fills(body('concrete', 'fragment', 'chunk'))).not.toContain(0x5a3526);
  });

  it('splits timber ends into pale splinters and springs panels into boards', () => {
    expect(fills(body('wood', 'remnant', 'beam'))).toContain(0xe2b877);
    const boards = fills(body('wood', 'remnant', 'panel'));
    expect(boards).not.toContain(0xe2b877);
    expect(boards.length).toBeGreaterThanOrEqual(7);
  });

  it('bends steel beams, ribs steel sheets, and rusts some pieces', () => {
    const tones = new Set<number>();
    let rusted = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const beam = fills(body('metal', 'remnant', 'beam', seed));
      // Shadow, then two legs and a flange: more faces than one straight box.
      expect(beam.length).toBeGreaterThanOrEqual(6);
      tones.add(beam[beam.length - 1]!);
      if (beam.includes(0x8a5234)) rusted++;
    }
    expect(tones.size).toBeGreaterThan(8);
    expect(rusted).toBeGreaterThan(3);
    expect(rusted).toBeLessThan(25);
    expect(fills(body('metal', 'remnant', 'panel')).length).toBeGreaterThanOrEqual(7);
    expect(fills(body('metal', 'fragment', 'chunk')).length).toBeLessThanOrEqual(4);
  });

  it('draws glass as flat pale shards with no shadow', () => {
    const shards = fills(body('glass', 'fragment', 'chunk'));
    expect(shards).toEqual([0xffffff, 0xc4e4ec, 0xc4e4ec]);
    expect(shards).not.toContain(PAL.shadow);
  });

  it('keeps roofing panels on their own finish', () => {
    const shingle = fills({ ...body('wood', 'remnant', 'panel'), skin: 'roofing' });
    expect(shingle).toContain(PAL.roofShingle);
    const tin = fills({ ...body('metal', 'remnant', 'panel'), skin: 'roofing' });
    expect(tin).toContain(PAL.roofMetal);
    expect(tin).not.toContain(PAL.roofShingle);
  });

  it('varies tone between pieces of one material', () => {
    const tops = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) tops.add(fills(body('concrete', 'fragment', 'chunk', seed)).at(-1)!);
    expect(tops.size).toBeGreaterThan(6);
  });
});

describe('heap colour follows what fell', () => {
  it('mixes pile materials by mass and names the leading one', () => {
    const pile = new PileField(0, 0, 8, 8);
    const at = (x: number, y: number) => Math.floor(y / pile.cell) * pile.cols + Math.floor(x / pile.cell);
    pile.addMass(2, 2, 4, 'brick');
    pile.addMass(6, 6, 4, 'wood');
    const brick = pileTint(pile, at(2, 2)), wood = pileTint(pile, at(6, 6));
    expect(brick).toBe(0x93463a);
    expect(wood).toBe(0xa9743f);
    expect(pileLead(pile, at(2, 2))).toBe(1);
    expect(pileLead(pile, at(6, 6))).toBe(0);
    // An empty cell falls back to plain rubble grey.
    expect(pileTint(pile, at(4, 0.2))).toBe(PAL.concrete);
    expect(pileLead(pile, at(4, 0.2))).toBe(2);

    pile.addMass(2, 2, 4, 'metal');
    const mixed = pileTint(pile, at(2, 2));
    expect(mixed).not.toBe(brick);
    expect(mixed >> 16).toBeLessThan(brick >> 16);
    expect(mixed >> 16).toBeGreaterThan(0x64);
  });
});
