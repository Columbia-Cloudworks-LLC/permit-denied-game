import { describe, expect, it } from 'vitest';
import { CAMPAIGN_LEVELS } from '../game/campaign';
import { aridRoadColor, dressAridRoads, edgeExitNodes, lowWaterCrossings } from './edgeRoads';
import { CLIMATES, SOILS } from './climate';
import { biomeById } from './biomes';
import { findRoadRoute, indexNetwork, linePoints, RoadBuilder, type RoadSegment } from './roads';
import { createTown } from './town';

/** Lanes that leave the town through an exit node, and lanes that enter from one. */
function exitLanes(town: ReturnType<typeof createTown>) {
  const idx = indexNetwork(town.network);
  const exits = edgeExitNodes(town.network, town);
  const inbound: string[] = [], outbound: string[] = [];
  for (const n of exits) {
    const seg = idx.segmentById.get(n.segmentIds[0]!)!;
    for (const id of seg.laneIds) {
      const lane = idx.laneById.get(id)!;
      const arrivesAtExit = (seg.endId === n.id) === (lane.dir === 1);
      (arrivesAtExit ? outbound : inbound).push(id);
    }
  }
  return { exits, inbound, outbound };
}

describe('edge roads', () => {
  for (const level of CAMPAIGN_LEVELS) {
    it(`runs public roads to the map edge on ${level.id}`, () => {
      const town = createTown({ district: 'd30', seed: 19, campaign: level });
      const { exits, inbound, outbound } = exitLanes(town);
      expect(exits.length, level.id).toBeGreaterThanOrEqual(2);
      // Every entrance can reach some other exit.
      for (const start of inbound) {
        expect(outbound.some(end => findRoadRoute(town.network, start, end)), `${level.id} ${start}`).toBe(true);
      }
    });
  }
});

describe('arid road edges', () => {
  const desert = CLIMATES['sonoran-desert'], canyon = CLIMATES.canyonlands, temperate = CLIMATES.temperate;
  const seg = (roadClass: RoadSegment['roadClass'], surface: RoadSegment['surface']) => ({ roadClass, surface }) as RoadSegment;

  /** A crossroads whose east arm runs to the map edge, with a gravel driveway off the west arm. */
  function network() {
    const b = new RoadBuilder();
    const west = b.node(0, 20), mid = b.node(20, 20), east = b.node(40, 20), north = b.node(20, 0), drive = b.node(8, 27);
    b.segment(west, mid, linePoints({ x: 0, y: 20, elev: 0 }, { x: 20, y: 20, elev: 0 }), { roadClass: 'rural' });
    b.segment(mid, east, linePoints({ x: 20, y: 20, elev: 0 }, { x: 40, y: 20, elev: 0 }), { roadClass: 'rural' });
    b.segment(mid, north, linePoints({ x: 20, y: 20, elev: 0 }, { x: 20, y: 0, elev: 0 }), { roadClass: 'residential' });
    const split = b.splitSegment(b.segments[0]!, 0.4).node;
    b.segment(split, drive, linePoints({ x: split.x, y: split.y, elev: 0 }, { x: 8, y: 27, elev: 0 }), { roadClass: 'driveway', surface: 'gravel', width: 1.9 });
    return b.finish({ normalize: false });
  }
  const bounds = { minX: -5, minY: -5, maxX: 40, maxY: 45 };
  const colors = (net: ReturnType<typeof network>, kind: string) => new Set(net.mesh.filter(q => q.kind === kind).map(q => q.color));

  it('leaves a temperate road mesh exactly as built', () => {
    const plain = network(), dressed = network();
    dressAridRoads(dressed, temperate, bounds, () => true);
    expect(dressed.mesh).toEqual(plain.mesh);
  });

  it('turns soft shoulders to the soil verge, bleaches asphalt and lays decomposed granite drives', () => {
    for (const climate of [desert, canyon]) {
      const plain = network(), dressed = network();
      dressAridRoads(dressed, climate, bounds);
      const verge = SOILS[climate.soil].verge;
      expect(colors(dressed, 'shoulder').has(verge)).toBe(true);
      expect(colors(plain, 'shoulder').has(verge)).toBe(false);
      // Curbed residential shoulders stay concrete: only the soft rural ones change.
      expect([...colors(dressed, 'shoulder')].some(c => colors(plain, 'shoulder').has(c))).toBe(true);
      for (const c of colors(plain, 'pavement')) expect(colors(dressed, 'pavement').has(c), c.toString(16)).toBe(false);
      const lum = (c: number) => (c >> 16 & 255) + (c >> 8 & 255) + (c & 255);
      expect(Math.min(...[...colors(dressed, 'pavement')].map(lum))).toBeGreaterThan(Math.min(...[...colors(plain, 'pavement')].map(lum)));
      // Lanes, widths and every original quad's geometry are untouched.
      expect(dressed.segments).toEqual(plain.segments);
      expect(dressed.mesh.slice(0, plain.mesh.length).map(q => ({ ...q, color: 0 }))).toEqual(plain.mesh.map(q => ({ ...q, color: 0 })));
    }
    expect(SOILS[desert.soil].verge).not.toBe(SOILS[canyon.soil].verge);
  });

  it('cracks the edge road in the heat, the same way every time', () => {
    const a = network(), b = network(), base = network().mesh.length;
    dressAridRoads(a, desert, bounds); dressAridRoads(b, desert, bounds);
    const cracks = a.mesh.slice(base);
    expect(cracks.length).toBeGreaterThan(3);
    expect(cracks.every(q => q.kind === 'mark' && q.x > 19 && Math.abs(q.y - 20) < 2.2)).toBe(true);
    expect(a.mesh).toEqual(b.mesh);
  });

  it('pours a concrete low-water crossing only where the edge road fords a wash', () => {
    const wash = (x: number) => x > 28 && x < 31;
    const dry = network(), forded = network();
    dressAridRoads(dry, desert, bounds);
    dressAridRoads(forded, desert, bounds, wash);
    const slabs = forded.mesh.slice(dry.mesh.length);
    expect(slabs.length).toBe(3);
    const [apron] = slabs;
    expect(apron).toMatchObject({ kind: 'pavement' });
    const road = forded.segments.find(s => s.points.some(p => p.x === 40))!;
    expect(apron!.d).toBeGreaterThan(road.width + road.shoulder * 2);
    expect(apron!.x).toBeGreaterThan(28); expect(apron!.x).toBeLessThan(31);
    expect(apron!.w).toBeGreaterThanOrEqual(3); expect(apron!.w).toBeLessThan(6);
    expect(lowWaterCrossings(road, () => false)).toEqual([]);
    // The west arm crosses the same wash line nowhere, and is not an edge road anyway.
    expect(slabs.every(q => q.x > 20)).toBe(true);
  });

  it('colours by surface and class, never touching curbs or lane marks', () => {
    const soil = SOILS[desert.soil];
    expect(aridRoadColor({ kind: 'shoulder', color: 1, d: 0.35 }, seg('rural', 'asphalt'), desert)).toBe(soil.verge);
    expect(aridRoadColor({ kind: 'shoulder', color: 1, d: 0.35 }, seg('residential', 'asphalt'), desert)).toBeUndefined();
    expect(aridRoadColor({ kind: 'shoulder', color: 1, d: 0.14 }, seg('rural', 'asphalt'), desert)).toBeUndefined();
    expect(aridRoadColor({ kind: 'mark', color: 1, d: 0.1 }, seg('rural', 'asphalt'), desert)).toBeUndefined();
    expect(aridRoadColor({ kind: 'pavement', color: 1, d: 2 }, seg('driveway', 'dirt'), desert)).toBe(soil.track);
  });

  it('gives generated desert towns xeriscape lots and no turf, and leaves temperate towns their lawns', () => {
    const biome = biomeById('arid-scrub')!;
    const arid = createTown({ district: 'd10', seed: 19, biome, climate: desert });
    const covers = new Set(arid.ground.map(g => g.cover));
    expect(covers.has('grass')).toBe(false);
    expect(covers.has('planted')).toBe(false);
    expect(covers.has('xeriscape') || covers.has('caliche') || covers.has('gravel')).toBe(true);
    expect(colors(arid.network, 'shoulder').has(SOILS[desert.soil].verge)).toBe(true);
    const green = createTown({ district: 'd10', seed: 19 });
    const greenCovers = new Set(green.ground.map(g => g.cover));
    expect(greenCovers.has('xeriscape')).toBe(false);
    expect(greenCovers.has('caliche')).toBe(false);
    expect(colors(green.network, 'shoulder').has(SOILS[desert.soil].verge)).toBe(false);
  });
});
