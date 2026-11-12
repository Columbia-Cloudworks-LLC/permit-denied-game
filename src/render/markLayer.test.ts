import type { Graphics } from 'pixi.js';
import { expect, it } from 'vitest';
import type { GroundMark } from '../structure/types';
import { SOILS, type SoilId } from '../world/climate';
import { trackColor, type Footing } from '../world/groundCondition';
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

it('paints dozer tracks in the soil they were pressed into, and repaints when one is retinted', () => {
  const fills = (layer: MarkLayer) => (layer.root.children as Graphics[]).flatMap((g) => g.context.instructions
    .filter((instruction) => instruction.action === 'fill')
    .map((instruction) => (instruction.data as { style: { color: number } }).style.color));
  const track = (i: number, soil: SoilId, footing: Footing): GroundMark =>
    ({ x: i, y: 0, w: 0.86, d: 0.36, heading: 0, kind: 'season-track', material: 'concrete', seed: i, alpha: 0.55, tint: trackColor(footing, SOILS[soil]) });
  const marks = [track(0, 'red-sandstone', 'dry'), track(1, 'pale-caliche', 'dry'), track(2, 'coastal-sand', 'dry'), track(3, 'dark-loam', 'dry')];
  const layer = new MarkLayer();
  // A summer look and a snowless winter's borrowed look paint the same soil colours.
  layer.update(marks, 'summer', all);
  const dry = fills(layer);
  for (const soil of ['red-sandstone', 'pale-caliche', 'coastal-sand', 'dark-loam'] as const) expect(dry).toContain(SOILS[soil].track);
  expect(dry).not.toContain(trackColor('snow', SOILS['dark-loam']));

  // Monsoon mud replaces the caliche track in place: only that bucket repaints.
  marks[1] = track(1, 'pale-caliche', 'mud-wash');
  layer.update(marks, 'summer', all);
  expect(layer.rebuilt).toBe(1);
  expect(fills(layer)).toContain(SOILS['pale-caliche'].mud);
  expect(fills(layer)).not.toContain(SOILS['pale-caliche'].track);

  // Snow tracks only come from a mark pressed into snow.
  marks.push(track(4, 'dark-loam', 'snow'));
  layer.update(marks, 'winter', all);
  expect(fills(layer)).toContain(trackColor('snow', SOILS['dark-loam']));
  layer.root.destroy({ children: true });
});
