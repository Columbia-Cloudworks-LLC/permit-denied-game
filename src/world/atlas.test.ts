import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { isAtlasData, loadAtlas, resetAtlasCache, schematicAtlas, type AtlasData } from './atlas';
import { cellLineDensity, countyLayout, DENSEST_FIRST, labelAnchor, pointInRings, rankCellsByDensity, ringArea, ringsToPath, simplifyLine, voronoiCells, type Point } from './atlasGeometry';
import { COUNTY_ARCHETYPES } from './regionalCatalog';
import { REGIONS } from './regions';

const ATLAS_FILE = fileURLToPath(new URL('../../public/atlas/north-america-atlas.json', import.meta.url));
const committed = JSON.parse(readFileSync(ATLAS_FILE, 'utf8')) as AtlasData;

/** Parse the compact `M x y l dx dy … z` paths back into rings. */
function parsePath(d: string): Point[][] {
  return d.split('M').filter(Boolean).map(part => {
    const [move, rel = ''] = part.replace(/z$/, '').split('l');
    const nums = (text: string) => (text.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
    const [x0, y0] = nums(move!);
    const ring: Point[] = [[x0!, y0!]];
    const deltas = nums(rel);
    for (let i = 0; i < deltas.length; i += 2) {
      const [px, py] = ring.at(-1)!;
      ring.push([px + deltas[i]!, py + deltas[i + 1]!]);
    }
    return ring;
  });
}

describe('atlas geometry', () => {
  const square: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it('encodes compact relative paths that round-trip at 0.1 precision', () => {
    const d = ringsToPath([[[1.04, 2], [3.5, 2], [3.5, 0.3]]]);
    expect(d).toBe('M1 2l2.5 0 0-1.7z');
    expect(parsePath(d)[0]!.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])).toEqual([[1, 2], [3.5, 2], [3.5, 0.3]]);
  });

  it('keeps label anchors inside concave shapes', () => {
    const ell: Point[] = [[0, 0], [10, 0], [10, 2], [2, 2], [2, 10], [0, 10]];
    expect(pointInRings(labelAnchor([ell]), [ell])).toBe(true);
  });

  it('splits a region into seven Voronoi counties with the capitol fixed last', () => {
    const layout = countyLayout([square], [2, 8]);
    expect(layout.seeds).toHaveLength(7);
    expect(layout.seeds[6]).toEqual([2, 8]);
    for (const label of layout.labels) expect(pointInRings(label, [square])).toBe(true);
    const cells = voronoiCells(layout.seeds, [0, 0, 10, 10]);
    const area = cells.reduce((sum, cell) => sum + Math.abs(ringArea(cell)), 0);
    expect(area).toBeCloseTo(100, 6);
    cells.forEach((cell, i) => expect(pointInRings(layout.seeds[i]!, [cell])).toBe(true));
    // Deterministic.
    expect(countyLayout([square], [2, 8])).toEqual(layout);
  });

  it('measures highway density per cell and ranks cells busiest first, ties nearest the capitol', () => {
    const seeds: Point[] = [[2.5, 5], [7.5, 5]];
    // Two roads in the left half, none in the right.
    const density = cellLineDensity(seeds, [square], [[[1, 1], [1, 9]], [[3, 1], [3, 9]]]);
    expect(density[0]).toBeGreaterThan(0);
    expect(density[1]).toBe(0);
    // Busiest cell (1) goes to County 6, the next (2) to County 1, the quietest (0) to County 3.
    expect(rankCellsByDensity([0.1, 0.9, 0.5], [[0, 0], [1, 0], [2, 0]], [0, 0], [6, 1, 3])).toEqual([2, undefined, 0, undefined, undefined, 1]);
    // Equal densities fall back to distance from the capitol.
    expect(rankCellsByDensity([0, 0], [[9, 9], [1, 1]], [0, 0], [6, 1])).toEqual([0, undefined, undefined, undefined, undefined, 1]);
  });

  it('simplifies open lines but keeps both ends', () => {
    expect(simplifyLine([[0, 0], [1, 0.01], [2, 0], [3, 5]], 0.1)).toEqual([[0, 0], [2, 0], [3, 5]]);
  });
});

describe('atlas data', () => {
  it('ships a committed road atlas for all 63 regions within its size budget', () => {
    expect(isAtlasData(committed)).toBe(true);
    expect(committed.schematic).toBeUndefined();
    expect(Object.keys(committed.regions).sort()).toEqual(REGIONS.map(r => r.id).sort());
    expect(readFileSync(ATLAS_FILE, 'utf8').length).toBeLessThan(400_000);
  });

  it('puts every capitol and county label inside its region, and every county on the map', () => {
    for (const region of REGIONS) {
      const shape = committed.regions[region.id]!;
      const rings = parsePath(shape.d);
      const [x0, y0, x1, y1] = shape.bbox;
      const pad = Math.max(x1 - x0, y1 - y0) * 0.05 + 0.5;
      const [cx, cy] = shape.capitol;
      expect(cx > x0 - pad && cx < x1 + pad && cy > y0 - pad && cy < y1 + pad, `${region.id} capitol`).toBe(true);
      // Labels let clicks through to the cell, so every number, County 7 included, must sit
      // inside the outline and its own cell or tapping it selects nothing.
      shape.counties.forEach((county, i) => {
        expect(pointInRings(county.label, rings), `${region.id} county ${i + 1} label`).toBe(true);
        expect(pointInRings(county.label, parsePath(county.d)), `${region.id} county ${i + 1} cell`).toBe(true);
      });
      // County 7's number clears the bullseye drawn at the capitol.
      const unit = Math.max(x1 - x0 + 2 * (Math.max(x1 - x0, y1 - y0) * 0.08 + 1), (y1 - y0) * 1.12 + 2 * (Math.max(x1 - x0, y1 - y0) * 0.08 + 1)) / 100;
      const [lx, ly] = shape.counties[6]!.label;
      expect(Math.hypot(lx - cx, ly - cy), `${region.id} capitol label clearance`).toBeGreaterThan(unit * 3);
      expect(shape.tint).toBeGreaterThanOrEqual(0);
      expect(shape.tint).toBeLessThan(4);
    }
  });

  it('ranks Downtown, Suburban, Industrial, Main Street, Roadside, then Rural from busiest to quietest', () => {
    const byIndex = new Map(COUNTY_ARCHETYPES.map(a => [a.index, a.id]));
    expect(DENSEST_FIRST.map(index => byIndex.get(index))).toEqual(['downtown', 'suburban', 'industrial', 'main-street', 'roadside', 'rural']);
  });

  it('puts the downtown county on busier highway than the rural county', () => {
    const lines = [...parsePath(committed.highways.major), ...parsePath(committed.highways.minor)];
    let busier = 0, roads = 0;
    for (const region of REGIONS) {
      const shape = committed.regions[region.id]!;
      const rings = parsePath(shape.d);
      // Re-derive each county's seed-free cell density from the stored cells' labels.
      const density = cellLineDensity(shape.counties.map(c => c.label), rings, lines.filter(l => l.length > 1));
      if (density.slice(0, 6).every(d => d === 0)) continue;
      roads++;
      if (density[5]! >= density[0]!) busier++;
    }
    expect(roads).toBeGreaterThan(50);
    // Labels approximate the cells, so allow a few near-ties to flip.
    expect(busier / roads).toBeGreaterThan(0.85);
  });

  it('gives every one of Counties 1–6 a clickable share of its region', () => {
    for (const region of REGIONS) {
      const shape = committed.regions[region.id]!;
      const rings = parsePath(shape.d), cells = shape.counties.map(c => parsePath(c.d));
      const [x0, y0, x1, y1] = shape.bbox;
      const counts = cells.map(() => 0);
      let total = 0;
      for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) {
        const p: Point = [x0 + ((x1 - x0) * (i + 0.5)) / 60, y0 + ((y1 - y0) * (j + 0.5)) / 60];
        if (!pointInRings(p, rings)) continue;
        total++;
        const k = cells.findIndex(cell => pointInRings(p, cell));
        if (k >= 0) counts[k]!++;
      }
      for (let k = 0; k < 6; k++) expect(counts[k]! / total, `${region.id} county ${k + 1}`).toBeGreaterThan(0.03);
    }
  });

  it('builds a schematic fallback from the region grid', () => {
    const atlas = schematicAtlas();
    expect(atlas.schematic).toBe(true);
    expect(isAtlasData(atlas)).toBe(true);
    expect(isAtlasData({ ...atlas, regions: {} })).toBe(false);
    // Everything the renderer reads is checked, and path data cannot carry markup.
    expect(isAtlasData({ ...committed, insets: undefined })).toBe(false);
    expect(isAtlasData({ ...committed, highways: { major: '' } })).toBe(false);
    expect(isAtlasData({ ...committed, viewBox: [0, 0, 'x', 1] })).toBe(false);
    expect(isAtlasData({ ...committed, lakes: '"/><script>alert(1)</script>' })).toBe(false);
    const regions = { ...committed.regions, 'US-IL': { ...committed.regions['US-IL']!, tint: 7 } };
    expect(isAtlasData({ ...committed, regions })).toBe(false);
  });

  it('fetches once, caches, and falls back to the schematic atlas on failure', async () => {
    resetAtlasCache();
    const ok = vi.fn(() => Promise.resolve(new Response(JSON.stringify(committed))));
    const first = await loadAtlas(ok as unknown as typeof fetch);
    expect(first.schematic).toBeUndefined();
    expect(await loadAtlas(ok as unknown as typeof fetch)).toBe(first);
    expect(ok).toHaveBeenCalledOnce();

    resetAtlasCache();
    const failing = vi.fn(() => Promise.reject(new Error('offline')));
    expect((await loadAtlas(failing as unknown as typeof fetch)).schematic).toBe(true);
    // A failed fetch is not cached: the next visit tries again.
    const bad = vi.fn(() => Promise.resolve(new Response('{"version":1}')));
    expect((await loadAtlas(bad as unknown as typeof fetch)).schematic).toBe(true);
    expect(bad).toHaveBeenCalledOnce();
    expect((await loadAtlas(undefined)).schematic).toBe(true);
    // Even a synchronous failure is not cached.
    resetAtlasCache();
    expect((await loadAtlas((() => { throw new Error('no'); }) as unknown as typeof fetch)).schematic).toBe(true);
    const later = vi.fn(() => Promise.resolve(new Response(JSON.stringify(committed))));
    expect((await loadAtlas(later as unknown as typeof fetch)).schematic).toBeUndefined();
    expect(later).toHaveBeenCalledOnce();
    resetAtlasCache();
  });
});
