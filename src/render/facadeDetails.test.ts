import { expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { ARCHETYPES } from '../world/archetypes';
import { createBuildingFromDefinition } from '../structure/building';
import { onRoof, type FacadeDetailDef } from '../structure/facadeDetails';
import type { Building } from '../structure/types';
import { facadeDetailCommand } from './facadeDetails';
import { getBuildingSurfaces, type WallSpan } from './buildingSurfaces';
import { drawWallSpan } from './facadeDraw';
import { facadeTrimPlan } from '../structure/facadeTrim';
import { shade } from './palette';
import { wallSpanFadeRuns } from './occlusion';
import { displacedRoofVerts } from '../structure/roof';
import { roofCommandDepth } from './interiorDraw';

/** Wall runs on the detail's own face: same side, same row or column. */
function hostWalls(b: Building, detail: FacadeDetailDef) {
  return getBuildingSurfaces(b).walls.filter(s => s.dir === detail.side &&
    (detail.side === 'south' ? s.gy0 === detail.gy : s.gx0 === detail.gx));
}

function expectInFrontOfHost(b: Building, detail: FacadeDetailDef, label: string): void {
  const command = facadeDetailCommand(b, detail)!;
  if (onRoof(detail)) for (const roof of b.roofs)
    expect(command.depth).toBeGreaterThan(roofCommandDepth(b, roof, displacedRoofVerts(roof)));
  const viewers = [{ x: -100, y: -100, heading: 0 }, { x: b.x + 2, y: b.y + b.d * b.cellSize + 1, heading: 0 }];
  for (const span of hostWalls(b, detail)) for (const dozer of viewers) {
    for (const run of wallSpanFadeRuns(b, span, dozer)) expect(command.depth, label).toBeGreaterThan(run.span.depth);
  }
}

it('keeps attachments in front of intact and split host-wall runs at every viewing distance', () => {
  for (const a of ARCHETYPES.filter(a => a.facadeDetails?.length)) {
    const b = createBuildingFromDefinition(a, a.label, 10, 12);
    for (const detail of b.facadeDetails) expectInFrontOfHost(b, detail, `${a.id}/${detail.id}`);
  }
});

/** Records every fill colour a detail paints, so colour overrides can be checked without a canvas. */
function paintedColors(b: Building, detail: FacadeDetailDef): number[] {
  const colors: number[] = [];
  const g = new Proxy({}, { get: (_target, key) => key === 'fill'
    ? (style: number | { color?: number }) => { colors.push(typeof style === 'number' ? style : style.color ?? -1); return g; }
    : () => g });
  facadeDetailCommand(b, detail)!.run(g as never);
  return colors;
}

it('paints signboards, marquees and rooftop signs in their authored colours, and defaults when none are given', () => {
  const colors = { faceColor: 0x123456, trimColor: 0x654321, textColor: 0xabcdef };
  for (const kind of ['signboard', 'marquee', 'rooftop-sign'] as const) {
    const a = ARCHETYPES.find(a => a.facadeDetails?.some(d => d.kind === kind))!;
    const b = createBuildingFromDefinition(a, a.label, 10, 12);
    const detail = b.facadeDetails.find(d => d.kind === kind)!;
    const plain = paintedColors(b, detail);
    expect(plain.length, kind).toBeGreaterThan(3);
    for (const value of Object.values(colors)) expect(plain, kind).not.toContain(value);
    const painted = paintedColors(b, { ...detail, ...colors });
    for (const value of Object.values(colors)) expect(painted, kind).toContain(value);
    expect(painted.length, kind).toBe(plain.length);
  }
});

it('draws a rooftop sign above its canopy roof and removes it with the roof', () => {
  const a = ARCHETYPES.find(a => a.id === 'service-station-canopy')!;
  const b = createBuildingFromDefinition(a, a.label, 10, 12);
  const sign = b.facadeDetails.find(d => d.kind === 'rooftop-sign')!;
  expectInFrontOfHost(b, sign, 'canopy rooftop sign');
  for (const roof of b.roofs) roof.state = 'gone';
  expect(facadeDetailCommand(b, sign)).toBeNull();
});

/** Fill colours one wall run paints, with or without the detail layer. */
function wallColors(b: Building, span: WallSpan, detail: boolean): number[] {
  const g = new Graphics();
  drawWallSpan(g, b, span, 1, detail);
  return g.context.instructions.filter(i => i.action === 'fill').map(i => (i.data as { style: { color: number } }).style.color);
}

const buildById = (id: string) => createBuildingFromDefinition(ARCHETYPES.find(a => a.id === id)!, id, 10, 12);

it('adds procedural trim only at detail range and leaves the bare wall drawing untouched', () => {
  for (const id of ['hardware-store', 'telephone-exchange', 'motel-room-block', 'ranch']) {
    const b = buildById(id);
    let bare = 0, trimmed = 0;
    for (const span of getBuildingSurfaces(b).walls) {
      const plain = wallColors(b, span, false), detailed = wallColors(b, span, true);
      expect(detailed.length, id).toBeGreaterThanOrEqual(plain.length);
      bare += plain.length; trimmed += detailed.length;
    }
    expect(trimmed, id).toBeGreaterThan(bare);
  }
  // Glass houses carry no trim at any range.
  const greenhouse = buildById('greenhouse');
  for (const span of getBuildingSurfaces(greenhouse).walls) expect(wallColors(greenhouse, span, true)).toEqual(wallColors(greenhouse, span, false));
});

it('tears mounted gear off a damaged cell and draws nothing for a cell that is gone', () => {
  const motel = buildById('motel-room-block'), plan = facadeTrimPlan(motel);
  const [key] = [...plan.items].find(([, items]) => items.includes('window-ac'))!;
  const side = key & 1 ? 'east' : 'south', gy = (key >> 1) & 127, gx = (key >> 8) & 127, floor = key >> 15;
  const cell = motel.grid[floor]![gx]![gy]!;
  const hostSpan = () => getBuildingSurfaces(motel).walls.find(s => s.dir === side && s.floor === floor && s.gx0 <= gx && s.gx1 >= gx && s.gy0 <= gy && s.gy1 >= gy);
  const unit = 0xb8b4a4;
  expect(wallColors(motel, hostSpan()!, true)).toContain(unit);
  expect(wallColors(motel, hostSpan()!, false)).not.toContain(unit);
  cell.state = 'cracked'; motel.visualRevision++;
  const cracked = hostSpan()!;
  expect(cracked.gx0 === gx && cracked.gx1 === gx || cracked.gy0 === gy && cracked.gy1 === gy || cracked.visual === 'cracked').toBe(true);
  expect(wallColors(motel, { ...cracked, gx0: gx, gx1: gx, gy0: gy, gy1: gy }, true)).not.toContain(unit);
  cell.state = 'gone'; motel.visualRevision++;
  expect(hostSpan()).toBeUndefined();
});

it('lets brand trim win the awning colour and keeps procedural trim off authored detail cells', () => {
  const brand = 0x12a45c;
  const shop = ARCHETYPES.find(a => a.features.awning && !a.facadeDetails?.length && a.construction.skin !== 'glass')!;
  let styled = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const b = createBuildingFromDefinition(shop, shop.label, 10, 12);
    b.region = { roofs: 'temperate', walls: 'brick-belt', soil: 'dark-loam', seed: seed * 104729 } as Building['region'];
    b.fasciaColor = brand;
    const door = b.cells.find(c => c.doorS)!;
    const span = getBuildingSurfaces(b).walls.find(s => s.dir === 'south' && s.floor === 0 && s.gy0 === door.gy && s.gx0 <= door.gx && s.gx1 >= door.gx)!;
    const colors = wallColors(b, span, true);
    expect(colors.some(c => c === brand || c === shade(brand, 0.8)), `seed ${seed}`).toBe(true);
    if (facadeTrimPlan(b).awning !== 'flat') styled++;
  }
  expect(styled).toBe(12);

  const bakery = buildById('bakery'), sign = bakery.facadeDetails.find(d => d.kind === 'signboard')!;
  const host = getBuildingSurfaces(bakery).walls.find(s => s.dir === 'south' && s.floor === sign.floor && s.gy0 === sign.gy)!;
  const only = { ...host, gx0: sign.gx, gx1: sign.gx + sign.width - 1 };
  expect(wallColors(bakery, only, true)).toEqual(wallColors(bakery, only, false));
});
