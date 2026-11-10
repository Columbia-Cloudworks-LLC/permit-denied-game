import { expect, it } from 'vitest';
import { PILE_TILE } from '../sim/pile';
import { createTown } from '../world/town';
import { PileHintLayer } from './pileHints';

it('redraws only on-screen pile tiles that changed and hides offscreen tiles', () => {
  const town = createTown();
  const pile = town.pile;
  const span = PILE_TILE * pile.cell;
  const ax = pile.ox + span * 1.5, ay = pile.oy + span * 1.5;
  const bx = pile.ox + span * 4.5, by = pile.oy + span * 4.5;
  pile.addMass(ax, ay, 4, 'concrete');
  pile.addMass(bx, by, 4, 'brick');
  const layer = new PileHintLayer();
  const all = () => true;
  layer.update(town, true, all);
  expect(layer.root.children).toHaveLength(2);
  // Only the two tiles the pile has touched; the untouched field is never visited.
  expect(layer.rebuilt).toBe(2);

  layer.update(town, true, all);
  expect(layer.rebuilt).toBe(0);

  pile.compactPoint(ax, ay, 0.4);
  layer.update(town, true, all);
  expect(layer.rebuilt).toBe(1);
  expect(layer.root.children).toHaveLength(2);

  layer.update(town, true, (x, y) => x < pile.ox + span * 3 && y < pile.oy + span * 3);
  expect(layer.root.children.map((g) => g.visible)).toEqual([true, false]);

  // A change off screen waits; it repaints once the tile is back in view.
  pile.compactPoint(bx, by, 0.4);
  layer.update(town, true, (x, y) => x < pile.ox + span * 3 && y < pile.oy + span * 3);
  expect(layer.rebuilt).toBe(0);
  layer.update(town, true, all);
  expect(layer.rebuilt).toBe(1);

  pile.clearArea(bx - 1, by - 1, 2, 2);
  layer.update(town, true, all);
  expect(layer.root.children).toHaveLength(1);
  layer.root.destroy({ children: true });
});

it('spreads a wide change over several frames', () => {
  const town = createTown();
  const pile = town.pile;
  const span = PILE_TILE * pile.cell;
  for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 5; tx++) pile.addMass(pile.ox + span * (tx + 0.5), pile.oy + span * (ty + 0.5), 4, 'concrete');
  const layer = new PileHintLayer();
  const counts: number[] = [];
  for (let frame = 0; frame < 4; frame++) {
    layer.update(town, true, () => true);
    counts.push(layer.rebuilt);
  }
  expect(counts).toEqual([8, 8, 4, 0]);
  expect(layer.root.children).toHaveLength(20);
  layer.root.destroy({ children: true });
});
