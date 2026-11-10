import { expect, it } from 'vitest';
import type { GroundMark } from '../structure/types';
import { MarkLayer } from './markLayer';

const mark = (i: number): GroundMark => ({ x: i % 30, y: Math.floor(i / 30), w: 0.3, d: 0.1, heading: 0, kind: 'chip', material: 'brick', seed: i + 1, alpha: 0.7 });
const all = () => true;

it('repaints only the newest bucket when a mark is added', () => {
  const marks = Array.from({ length: 60 }, (_, i) => mark(i));
  const layer = new MarkLayer();
  expect(layer.update(marks, 'summer', all)).toBe(60);
  expect(layer.rebuilt).toBe(3);
  expect(layer.root.children).toHaveLength(3);

  layer.update(marks, 'summer', all);
  expect(layer.rebuilt).toBe(0);

  marks.push(mark(60));
  layer.update(marks, 'summer', all);
  expect(layer.rebuilt).toBe(1);

  // A tread fading in place repaints the bucket that holds it.
  marks[3]!.alpha *= 0.9;
  layer.update(marks, 'summer', all);
  expect(layer.rebuilt).toBe(1);
  layer.root.destroy({ children: true });
});

it('hides buckets off screen, drops emptied ones, and repaints for a new season', () => {
  const marks = Array.from({ length: 48 }, (_, i) => mark(i));
  const layer = new MarkLayer();
  // The first bucket lies along the first row; the second runs on into the next.
  const shown = layer.update(marks, 'summer', (_x, y, _w, d) => y + d < 0.7);
  expect(shown).toBe(24);
  expect(layer.root.children.map((g) => g.visible)).toEqual([true, false]);

  marks.splice(0, 24);
  layer.update(marks, 'summer', all);
  expect(layer.root.children).toHaveLength(1);
  expect(layer.rebuilt).toBe(1);

  layer.update(marks, 'winter', all);
  expect(layer.rebuilt).toBe(1);
  layer.invalidate();
  expect(layer.root.children.every((g) => g.destroyed)).toBe(true);
});
