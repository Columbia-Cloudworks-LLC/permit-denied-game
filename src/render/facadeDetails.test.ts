import { expect, it } from 'vitest';
import { ARCHETYPES } from '../world/archetypes';
import { createBuildingFromDefinition } from '../structure/building';
import { facadeDetailCommand } from './facadeDetails';
import { getBuildingSurfaces } from './buildingSurfaces';
import { wallSpanFadeRuns } from './occlusion';
import { displacedRoofVerts } from '../structure/roof';
import { roofCommandDepth } from './interiorDraw';

it('keeps attachments in front of intact and split host-wall runs at every viewing distance', () => {
  for (const a of ARCHETYPES.filter(a => a.facadeDetails?.length)) {
    const b = createBuildingFromDefinition(a, a.label, 10, 12);
    for (const detail of b.facadeDetails) {
      const command = facadeDetailCommand(b, detail)!;
      if ((detail.kind === 'roof-duct' || detail.kind === 'dormer')) for (const roof of b.roofs)
        expect(command.depth).toBeGreaterThan(roofCommandDepth(b, roof, displacedRoofVerts(roof)));
      for (const span of getBuildingSurfaces(b).walls.filter(s => s.dir === detail.side &&
        (detail.side === 'south' ? s.gy0 === detail.gy : s.gx0 === detail.gx))) {
        for (const dozer of [{x:-100,y:-100,heading:0}, {x:b.x+2,y:b.y+b.d*b.cellSize+1,heading:0}]) {
          for (const run of wallSpanFadeRuns(b, span, dozer)) expect(command.depth, `${a.id}/${detail.id}`).toBeGreaterThan(run.span.depth);
        }
      }
    }
  }
});
