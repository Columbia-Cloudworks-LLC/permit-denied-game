/**
 * The road atlas: projected outlines for all 63 regions, built offline by
 * `scripts/build-atlas-data.mjs` into `public/atlas/north-america-atlas.json` and fetched the first
 * time the overworld opens. When that fetch is unavailable (offline before the first visit,
 * tests, a blocked request) the map falls back to a schematic atlas drawn from the region grid.
 */
import { voronoiCells, ringsToPath, type Point } from './atlasGeometry';
import { REGIONS, type RegionDef } from './regions';

export const ATLAS_URL = '/atlas/north-america-atlas.json';

export interface AtlasCounty {
  /** Voronoi cell, clipped to the region's bounding box; the map clips it to the outline. */
  d: string;
  /** Interior point for the county's number and completion stamp. */
  label: [number, number];
}

export interface AtlasRegion {
  d: string;
  label: [number, number];
  bbox: [number, number, number, number];
  capitol: [number, number];
  /** Map tint, 0–3, so no two neighbors share a color. */
  tint: number;
  /** Counties 1–7 in order; County 7 is the capitol. */
  counties: AtlasCounty[];
}

export interface AtlasData {
  version: 1;
  source: string;
  viewBox: [number, number, number, number];
  graticule: string;
  /** Unclickable neighboring land (Mexico, Greenland, the Caribbean). */
  context: string;
  lakes: string;
  highways: { major: string; minor: string };
  insets: { box: [number, number, number, number]; label: string }[];
  regions: Record<string, AtlasRegion>;
  /** Set on the offline fallback. */
  schematic?: boolean;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function isTuple(value: unknown, length: number): boolean {
  return Array.isArray(value) && value.length === length && value.every(finite);
}

const isPair = (value: unknown) => isTuple(value, 2);

/**
 * Path data goes into markup unescaped, so only the compact path alphabet is accepted. An empty
 * string is fine for optional layers.
 */
const PATH = /^[Mlz0-9.\- ]*$/;
const isPath = (value: unknown, required = false): value is string =>
  typeof value === 'string' && PATH.test(value) && (!required || value.length > 0);

/**
 * Shape check for fetched data: every field the renderer reads, every region in the manifest,
 * seven counties each. Anything else falls back to the schematic map instead of crashing it.
 */
export function isAtlasData(value: unknown, regions: readonly RegionDef[] = REGIONS): value is AtlasData {
  const atlas = value as AtlasData | null;
  if (!atlas || typeof atlas !== 'object' || atlas.version !== 1 || !isTuple(atlas.viewBox, 4)) return false;
  if (!isPath(atlas.graticule) || !isPath(atlas.context) || !isPath(atlas.lakes)) return false;
  if (!atlas.highways || !isPath(atlas.highways.major) || !isPath(atlas.highways.minor)) return false;
  if (!Array.isArray(atlas.insets) || !atlas.insets.every(inset => !!inset && isTuple(inset.box, 4) && typeof inset.label === 'string')) return false;
  if (!atlas.regions || typeof atlas.regions !== 'object') return false;
  return regions.every(({ id }) => {
    const region = atlas.regions[id];
    return !!region && isPath(region.d, true) && isPair(region.label) && isPair(region.capitol) && isTuple(region.bbox, 4)
      && Number.isInteger(region.tint) && region.tint >= 0 && region.tint < 4
      && Array.isArray(region.counties) && region.counties.length === 7
      && region.counties.every(county => !!county && isPath(county.d, true) && isPair(county.label));
  });
}

const TILE = 40;
const GAP = 4;

/** Squares on the old 12 × 9 grid; counties are a capitol hex ringed by six cells. */
export function schematicAtlas(regions: readonly RegionDef[] = REGIONS): AtlasData {
  const entries = regions.map(region => {
    const [col, row] = region.tile;
    const x = col * TILE + GAP / 2, y = row * TILE + GAP / 2, size = TILE - GAP;
    const cx = x + size / 2, cy = y + size / 2;
    const ring = size * 0.3;
    const seeds: Point[] = [];
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (Math.PI / 3) * i;
      seeds.push([cx + ring * Math.cos(a), cy + ring * Math.sin(a)]);
    }
    seeds.push([cx, cy]);
    const bbox: [number, number, number, number] = [x, y, x + size, y + size];
    const cells = voronoiCells(seeds, bbox);
    const atlasRegion: AtlasRegion = {
      d: ringsToPath([[[x, y], [x + size, y], [x + size, y + size], [x, y + size]]]),
      label: [cx, cy],
      bbox,
      capitol: [cx, cy],
      tint: (col + row * 2) % 4,
      // The capitol's number sits just south of the bullseye, still inside its middle cell.
      counties: cells.map((cell, i) => ({ d: ringsToPath([cell]), label: [seeds[i]![0], seeds[i]![1] + (i === 6 ? ring * 0.3 : 0)] })),
    };
    return [region.id, atlasRegion] as const;
  });
  return {
    version: 1,
    source: 'Schematic fallback',
    viewBox: [0, 0, 12 * TILE, 9 * TILE],
    graticule: '',
    context: '',
    lakes: '',
    highways: { major: '', minor: '' },
    insets: [],
    regions: Object.fromEntries(entries),
    schematic: true,
  };
}

let cached: Promise<AtlasData> | undefined;

/**
 * One fetch per page. A failed or malformed response resolves to the schematic atlas, and the
 * next map visit tries the network again.
 */
export function loadAtlas(fetcher: typeof fetch | undefined = globalThis.fetch?.bind(globalThis)): Promise<AtlasData> {
  if (cached) return cached;
  const request = (async () => {
    if (!fetcher) throw new Error('fetch unavailable');
    const response = await fetcher(ATLAS_URL);
    if (!response.ok) throw new Error(`atlas ${response.status}`);
    const data: unknown = await response.json();
    if (!isAtlasData(data)) throw new Error('atlas data malformed');
    return data;
  })();
  // Assigned before any failure can clear it, so a synchronous throw cannot leave the fallback cached.
  const pending: Promise<AtlasData> = request.catch(() => {
    if (cached === pending) cached = undefined;
    return schematicAtlas();
  });
  cached = pending;
  return pending;
}

/** Tests only: forget the cached atlas. */
export function resetAtlasCache(): void {
  cached = undefined;
}
