import { expect, it } from 'vitest';
import { pathBox, scribbleCircle } from './overworldMap';

it('measures a path in the atlas compact form', () => {
  expect(pathBox('M202 122l36 0 0 36-36 0z')).toEqual([202, 122, 238, 158]);
  expect(pathBox('M10 10l5-.5 .5 5zM-4 2l1 1-2 3z')).toEqual([-5, 2, 15.5, 14.5]);
  expect(pathBox('')).toEqual([0, 0, 0, 0]);
});

it('scrawls a repeatable loop that rings the box and overshoots its own start', () => {
  const box = [100, 100, 140, 120] as const;
  const d = scribbleCircle(box, 'US-CO', 4);
  expect(scribbleCircle(box, 'US-CO', 4)).toBe(d);
  expect(scribbleCircle(box, 'US-WY', 4)).not.toBe(d);
  const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const points = [];
  // The move, then the end point of each cubic segment.
  for (let i = 0; i < numbers.length; i += i === 0 ? 2 : 6) points.push([numbers[i === 0 ? 0 : i + 4]!, numbers[i === 0 ? 1 : i + 5]!]);
  const angles = points.map(([x, y]) => Math.atan2(y! - 110, x! - 120));
  let swept = 0;
  for (let i = 1; i < angles.length; i++) {
    let step = angles[i]! - angles[i - 1]!;
    if (step < -Math.PI) step += Math.PI * 2;
    swept += step;
  }
  expect(swept).toBeGreaterThan(Math.PI * 2.2);
  // Every point stays outside the box's inner half and within a sane reach of it.
  for (const [x, y] of points) {
    const r = Math.hypot((x! - 120) / 20, (y! - 110) / 10);
    expect(r).toBeGreaterThan(0.9);
    expect(r).toBeLessThan(1.7);
  }
});

it('keeps a tiny region findable with a minimum loop size', () => {
  const d = scribbleCircle([50, 50, 50.4, 50.2], 'US-RI', 8);
  const xs = d.match(/-?\d+(\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 0);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(13);
});

it('gives each region its own sheet of paper, and never the atlas paper', async () => {
  const { ATLAS_PAPER, sheetPaper } = await import('./overworldMap');
  const { REGIONS } = await import('../world/regions');
  const looks = new Set(REGIONS.map(region => JSON.stringify(sheetPaper(region.id))));
  // Two photographs, each mirrored four ways.
  expect(looks.size).toBe(8);
  for (const region of REGIONS) {
    expect(sheetPaper(region.id)).toEqual(sheetPaper(region.id));
    expect(sheetPaper(region.id).href).not.toBe(ATLAS_PAPER.href);
  }
});
