import { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { defaultDebugView } from '../debug/view';
import { createBuildingFromArchetype } from '../structure/building';
import type { GroundKind, GroundMark } from '../structure/types';
import { seasonTrackColor } from '../world/season';
import { getBuildingSurfaces } from './buildingSurfaces';
import { PAL } from './drawIso';
import { drawWallSpan } from './facadeDraw';
import { facadeDetailCommand } from './facadeDetails';
import { drawForestMass } from './forestCanopy';
import { drawGroundMark } from './groundDraw';
import { drawRoofBay } from './roofDraw';
import { siloCommands } from './silos';

/** Fill colours a Graphics recorded, in draw order. */
function fills(g: Graphics): number[] {
  return g.context.instructions
    .filter((instruction) => instruction.action === 'fill')
    .map((instruction) => (instruction.data as { style: { color: number } }).style.color);
}

function draw(run: (g: Graphics) => void): number[] {
  const g = new Graphics();
  run(g);
  return fills(g);
}

describe('glass buildings', () => {
  const greenhouse = createBuildingFromArchetype('greenhouse', 'GREENHOUSE', 0, 0);

  it('draws curtain walls as tinted glass split by metal mullions at every cell', () => {
    const span = getBuildingSurfaces(greenhouse).walls.find((s) => s.dir === 'south')!;
    const colors = draw((g) => drawWallSpan(g, greenhouse, span, 1));
    const cells = span.gx1 - span.gx0 + 1;
    expect(colors).toContain(PAL.glassLit);
    // One mullion per cell edge plus three transoms.
    expect(colors.filter((c) => c === PAL.metal).length).toBeGreaterThanOrEqual(cells + 1 + 3);
  });

  it('shows the roof frame through a glass roof', () => {
    const roof = greenhouse.roofs[0]!;
    expect(roof.material).toBe('glass');
    const colors = draw((g) => drawRoofBay(g, greenhouse, roof, 1));
    expect(colors).toContain(PAL.glassLit);
    expect(colors).toContain(PAL.roofMetal);
  });
});

describe('storefront glazing', () => {
  const bakery = createBuildingFromArchetype('bakery', 'BAKERY', 0, 0);
  const detail = bakery.facadeDetails.find((d) => d.kind === 'display-glazing')!;
  const panes = () => bakery.cells.filter((c) => c.cladding && c.floor === detail.floor);

  it('glints on intact panes, cracks damaged ones and darkens broken ones', () => {
    const intact = draw((g) => facadeDetailCommand(bakery, detail)!.run(g));
    expect(intact).toContain(0x759da1);
    expect(intact).toContain(0x9bb7b8);
    expect(intact).not.toContain(0x36464a);
    for (const cell of panes()) cell.cladding!.hp = cell.cladding!.maxHp / 2;
    expect(draw((g) => facadeDetailCommand(bakery, detail)!.run(g))).toContain(0x36464a);
    for (const cell of panes()) cell.cladding!.hp = 0;
    const broken = draw((g) => facadeDetailCommand(bakery, detail)!.run(g));
    expect(broken).toContain(0x293435);
    expect(broken).not.toContain(0x759da1);
  });
});

describe('silos', () => {
  const elevator = createBuildingFromArchetype('grain-elevator', 'ELEVATOR', 0, 0);

  it('draws each standing silo as one sorted assembly with its feed chute', () => {
    const silos = elevator.silos!.length;
    expect(silos).toBeGreaterThan(0);
    const view = defaultDebugView();
    expect(siloCommands(elevator, view)).toHaveLength(silos * 2);
    view.details = false;
    expect(siloCommands(elevator, view)).toHaveLength(silos);
    view.walls = false;
    view.roofs = false;
    expect(siloCommands(elevator, view)).toHaveLength(0);
  });

  it('cuts a silo off at the inspected floor and drops it once gone', () => {
    const view = defaultDebugView();
    const full = draw((g) => siloCommands(elevator, view)[0]!.run(g)).length;
    view.maxFloor = 0;
    expect(draw((g) => siloCommands(elevator, view)[0]!.run(g)).length).toBeLessThan(full);
    elevator.silos![0]!.phase = 'gone';
    expect(siloCommands(elevator, defaultDebugView())).toHaveLength((elevator.silos!.length - 1) * 2);
  });
});

describe('forest masses', () => {
  const mass = { x: 0, y: 0, w: 6, d: 2 };

  it('thins broadleaf woods to bare thickets in winter and snows on pines', () => {
    const winterOak = draw((g) => drawForestMass(g, { ...mass, species: 'oak' }, 'winter'));
    expect(winterOak).toContain(0x736757);
    expect(winterOak.length).toBeGreaterThan(draw((g) => drawForestMass(g, { ...mass, species: 'oak' }, 'summer')).length);
    expect(draw((g) => drawForestMass(g, { ...mass, species: 'pine' }, 'winter'))).toContain(0xb9c8c7);
    expect(draw((g) => drawForestMass(g, { ...mass, species: 'pine' }, 'summer'))).toContain(0x347850);
    expect(draw((g) => drawForestMass(g, { ...mass, species: 'oak' }, 'autumn'))).toContain(0xa85a28);
    expect(draw((g) => drawForestMass(g, { ...mass, species: 'oak' }, 'spring'))).toContain(0x6a9a44);
  });
});

describe('ground marks', () => {
  const mark = (kind: GroundKind, material: GroundMark['material'] = 'concrete'): GroundMark =>
    ({ x: 0, y: 0, w: 1, d: 0.4, heading: 0.3, kind, material, seed: 1, alpha: 0.5 });

  it('colours chips by material and season tracks by season', () => {
    expect(draw((g) => drawGroundMark(g, mark('chip', 'wood')))).toEqual([PAL.woodDark]);
    expect(draw((g) => drawGroundMark(g, mark('splinter', 'brick')))).toEqual([PAL.brickDark]);
    expect(draw((g) => drawGroundMark(g, mark('chip', 'metal')))).toEqual([PAL.metalDark]);
    expect(draw((g) => drawGroundMark(g, mark('chip', 'glass')))).toEqual([PAL.concreteDark]);
    expect(draw((g) => drawGroundMark(g, mark('season-track'), 'winter'))).toEqual([seasonTrackColor('winter')]);
    for (const kind of ['scrape', 'tire', 'oil', 'crack', 'dust', 'glass'] as const) {
      expect(draw((g) => drawGroundMark(g, mark(kind)))).toHaveLength(1);
    }
  });
});
