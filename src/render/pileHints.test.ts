import { expect, it } from 'vitest';
import { PILE_TILE } from '../sim/pile';
import { createTown } from '../world/town';
import { PileHintLayer } from './pileHints';

it('redraws only pile tiles that changed and hides offscreen tiles', () => {
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
  const first = layer.rebuilt;
  expect(first).toBe(pile.tilesX * pile.tilesY);

  layer.update(town, true, all);
  expect(layer.rebuilt).toBe(0);

  pile.compactPoint(ax, ay, 0.4);
  layer.update(town, true, all);
  expect(layer.rebuilt).toBe(1);
  expect(layer.root.children).toHaveLength(2);

  layer.update(town, true, (x, y) => x < pile.ox + span * 3 && y < pile.oy + span * 3);
  expect(layer.root.children.map((g) => g.visible)).toEqual([true, false]);

  pile.clearArea(bx - 1, by - 1, 2, 2);
  layer.update(town, true, all);
  expect(layer.root.children).toHaveLength(1);
  layer.root.destroy({ children: true });
});
