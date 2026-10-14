import { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { defaultDebugView } from '../debug/view';
import { createBuildingFromArchetype } from '../structure/building';
import type { GroundKind, GroundMark } from '../structure/types';
import { seasonTrackColor } from '../world/season';
import { getBuildingSurfaces } from './buildingSurfaces';
import { PAL } from './drawIso';
import { drawFaceCracks, drawWallSpan } from './facadeDraw';
import { facadeDetailCommand } from './facadeDetails';
import { drawForestMass } from './forestCanopy';
import { drawGroundMark } from './groundDraw';
import { shade } from './palette';
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
    expect(draw((g) => drawGroundMark(g, mark('season-track'), 'winter'))).toEqual([seasonTrackColor('winter'), shade(seasonTrackColor('winter'), 0.62)]);
    for (const kind of ['scrape', 'oil', 'crack', 'dust', 'glass'] as const) {
      expect(draw((g) => drawGroundMark(g, mark(kind)))).toHaveLength(1);
    }
  });

  it('presses grouser grooves into a tread in its surface tint', () => {
    const mud = 0x2a1f12;
    expect(draw((g) => drawGroundMark(g, { ...mark('tire'), tint: mud }))).toEqual([mud, shade(mud, 0.62)]);
  });
});

describe('facade fractures', () => {
  const strokes = (g: Graphics) => g.context.instructions.filter((i) => i.action === 'stroke').length;

  it('draws one stable spalled fracture per cracked cell on either face', () => {
    const ranch = createBuildingFromArchetype('ranch', 'CRACK', 0, 0);
    for (const dir of ['south', 'east'] as const) {
      const span = { ...getBuildingSurfaces(ranch).walls.find((s) => s.dir === dir)!, visual: 'cracked' as const };
      const cells = dir === 'south' ? span.gx1 - span.gx0 + 1 : span.gy1 - span.gy0 + 1;
      const g = new Graphics();
      drawWallSpan(g, ranch, span, 1);
      expect(strokes(g)).toBe(cells);
      expect(fills(g).filter((c) => c === PAL.crack)).toHaveLength(cells);
    }
    const once = new Graphics(), twice = new Graphics();
    drawFaceCracks(once, 2, 7, 0, 0, 2, 0, 0, 2, 1);
    drawFaceCracks(twice, 2, 7, 0, 0, 2, 0, 0, 2, 1);
    expect({ ...once.bounds }).toEqual({ ...twice.bounds });
  });
});
