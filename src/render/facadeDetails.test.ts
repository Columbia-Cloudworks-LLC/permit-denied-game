import { expect, it } from 'vitest';
import { ARCHETYPES } from '../world/archetypes';
import { createBuildingFromDefinition } from '../structure/building';
import { onRoof, type FacadeDetailDef } from '../structure/facadeDetails';
import type { Building } from '../structure/types';
import { facadeDetailCommand } from './facadeDetails';
import { getBuildingSurfaces } from './buildingSurfaces';
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
