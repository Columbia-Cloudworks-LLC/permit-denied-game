// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { PanZoom } from './atlasPanZoom';

let viewport: HTMLElement;
let svg: SVGSVGElement;
let target: SVGPathElement;

const pointer = (type: string, x: number, y: number, id = 1) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, pointerType: 'mouse', button: 0 });

beforeEach(() => {
  document.body.innerHTML = '<div class="atlas-viewport"><svg viewBox="0 0 1000 500"><path d="M0 0h10v10z"/></svg><div class="atlas-zoom"><button data-zoom="in"></button><button data-zoom="out"></button><button data-zoom="reset"></button></div></div>';
  viewport = document.querySelector('.atlas-viewport')!;
  svg = viewport.querySelector('svg')!;
  target = svg.querySelector('path')!;
  // A 1000 × 500 px box: one SVG unit per pixel at zoom 1.
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON() {} } as DOMRect);
});

it('zooms toward a point and clamps between the whole map and the maximum zoom', () => {
  const pz = new PanZoom(viewport, svg, { x: 0, y: 0, w: 1000, h: 500 }, undefined, 8);
  pz.zoomBy(2, 250, 125);
  expect(pz.view).toEqual({ x: 125, y: 62.5, w: 500, h: 250 });
  expect(svg.getAttribute('viewBox')).toBe('125 62.5 500 250');
  expect(viewport.dataset.zoomed).toBe('true');
  pz.zoomBy(1000);
  expect(pz.view.w).toBe(125);
  pz.zoomBy(0.001);
  expect(pz.view).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
});

it('steps and resets from the corner buttons', () => {
  const pz = new PanZoom(viewport, svg, { x: 0, y: 0, w: 1000, h: 500 });
  viewport.querySelector<HTMLButtonElement>('[data-zoom="in"]')!.click();
  expect(pz.zoom).toBeCloseTo(1.6);
  viewport.querySelector<HTMLButtonElement>('[data-zoom="reset"]')!.click();
  expect(pz.zoom).toBe(1);
});

it('treats a press that moves under 5px as a click, and a longer drag as a pan that swallows its click', () => {
  const pz = new PanZoom(viewport, svg, { x: 0, y: 0, w: 1000, h: 500 });
  pz.zoomBy(4);
  const clicks = vi.fn();
  document.body.addEventListener('click', clicks);

  target.dispatchEvent(pointer('pointerdown', 100, 100));
  target.dispatchEvent(pointer('pointermove', 103, 101));
  target.dispatchEvent(pointer('pointerup', 103, 101));
  const before = { ...pz.view };
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(clicks).toHaveBeenCalledOnce();
  expect(pz.view).toEqual(before);

  target.dispatchEvent(pointer('pointerdown', 100, 100));
  target.dispatchEvent(pointer('pointermove', 140, 120));
  target.dispatchEvent(pointer('pointerup', 140, 120));
  expect(pz.view.x).toBeLessThan(before.x);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(clicks).toHaveBeenCalledOnce();
  // Only the one click after the pan is swallowed.
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(clicks).toHaveBeenCalledTimes(2);
});

it('keeps panning when a touch hands its implicit capture from a map path to the viewport', () => {
  const pz = new PanZoom(viewport, svg, { x: 0, y: 0, w: 1000, h: 500 });
  pz.zoomBy(4);
  const start = pz.view.x;
  target.dispatchEvent(pointer('pointerdown', 100, 100));
  target.dispatchEvent(pointer('pointermove', 120, 100));
  // Chromium fires this from the path, bubbling, while the finger is still down.
  target.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }));
  target.dispatchEvent(pointer('pointermove', 220, 100));
  target.dispatchEvent(pointer('pointerup', 220, 100));
  expect(start - pz.view.x).toBeCloseTo(120 / 4, 6);
  // The viewport's own capture loss still ends a drag.
  viewport.dispatchEvent(pointer('pointerdown', 100, 100));
  viewport.dispatchEvent(pointer('pointermove', 140, 100));
  viewport.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }));
  const after = pz.view.x;
  viewport.dispatchEvent(pointer('pointermove', 240, 100));
  expect(pz.view.x).toBe(after);
});

it('zooms in on wheel toward the cursor', () => {
  const pz = new PanZoom(viewport, svg, { x: 0, y: 0, w: 1000, h: 500 });
  const wheel = new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true });
  Object.defineProperties(wheel, { clientX: { value: 800 }, clientY: { value: 400 } });
  viewport.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(true);
  expect(pz.zoom).toBeGreaterThan(1);
  // The point under the cursor stays put.
  const s = 1000 / pz.view.w;
  expect(pz.view.x + 800 / s).toBeCloseTo(800, 6);
});

it('pinches with two pointers', () => {
  const pz = new PanZoom(viewport, svg, { x: 0, y: 0, w: 1000, h: 500 });
  viewport.dispatchEvent(pointer('pointerdown', 400, 250, 1));
  viewport.dispatchEvent(pointer('pointerdown', 600, 250, 2));
  viewport.dispatchEvent(pointer('pointermove', 700, 250, 2));
  expect(pz.zoom).toBeCloseTo(1.5, 1);
});
