/**
 * Builds public/atlas/north-america-atlas.json, the overworld road atlas, from public-domain
 * Natural Earth data (v5.1.2, pinned by SHA-256 so the output is byte-for-byte reproducible).
 *
 *   node scripts/build-atlas-data.mjs [--cache <dir>] [--out <file>]
 *
 * Sources download once into the cache (default node_modules/.cache/natural-earth). Coordinates
 * are projected with an Albers equal-area conic for North America; Alaska keeps its natural
 * place beside Yukon and Hawaii is inset at the lower left at the same scale.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  cellLineDensity,
  countyLayout,
  DENSEST_FIRST,
  labelAnchor,
  linesToPath,
  ringArea,
  ringsBBox,
  rankCellsByDensity,
  ringsToPath,
  simplifyLine,
  simplifyRing,
  voronoiCells,
} from '../src/world/atlasGeometry.ts';
import { REGIONS } from '../src/world/regions.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/';

export const SOURCES = {
  admin1: { file: 'ne_50m_admin_1_states_provinces.geojson', sha256: '69a0e06e640b2d505858ae1cb63034e4677f3000b35a98e16312932b98c426b9' },
  admin0: { file: 'ne_50m_admin_0_countries.geojson', sha256: '3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb' },
  lakes: { file: 'ne_50m_lakes.geojson', sha256: 'd350b75978b26fe839b797c2c529b2fb8f47fb3983c03f4964e36d5df9378a52' },
  roads: { file: 'ne_10m_roads.geojson', sha256: '66a0c7b438e92fd124822cc5921cfa11042f48c294ade5e0f03f2c6640fd0248' },
};

/** Seat of government for each region's County 7, as [longitude, latitude]. */
export const CAPITOLS = {
  'US-AL': [-86.3000, 32.3777], 'US-AK': [-134.4197, 58.3019], 'US-AZ': [-112.0740, 33.4484], 'US-AR': [-92.2896, 34.7465],
  'US-CA': [-121.4944, 38.5816], 'US-CO': [-104.9903, 39.7392], 'US-CT': [-72.6734, 41.7658], 'US-DE': [-75.5244, 39.1582],
  'US-FL': [-84.2807, 30.4383], 'US-GA': [-84.3880, 33.7490], 'US-HI': [-157.8583, 21.3069], 'US-ID': [-116.2023, 43.6150],
  'US-IL': [-89.6501, 39.7817], 'US-IN': [-86.1581, 39.7684], 'US-IA': [-93.6250, 41.5868], 'US-KS': [-95.6752, 39.0473],
  'US-KY': [-84.8733, 38.2009], 'US-LA': [-91.1871, 30.4515], 'US-ME': [-69.7795, 44.3106], 'US-MD': [-76.4922, 38.9784],
  'US-MA': [-71.0589, 42.3601], 'US-MI': [-84.5555, 42.7325], 'US-MN': [-93.0900, 44.9537], 'US-MS': [-90.1848, 32.2988],
  'US-MO': [-92.1735, 38.5767], 'US-MT': [-112.0391, 46.5891], 'US-NE': [-96.7026, 40.8136], 'US-NV': [-119.7674, 39.1638],
  'US-NH': [-71.5376, 43.2081], 'US-NJ': [-74.7597, 40.2206], 'US-NM': [-105.9378, 35.6870], 'US-NY': [-73.7562, 42.6526],
  'US-NC': [-78.6382, 35.7796], 'US-ND': [-100.7837, 46.8083], 'US-OH': [-82.9988, 39.9612], 'US-OK': [-97.5164, 35.4676],
  'US-OR': [-123.0351, 44.9429], 'US-PA': [-76.8867, 40.2732], 'US-RI': [-71.4128, 41.8240], 'US-SC': [-81.0348, 34.0007],
  'US-SD': [-100.3510, 44.3683], 'US-TN': [-86.7816, 36.1627], 'US-TX': [-97.7431, 30.2672], 'US-UT': [-111.8910, 40.7608],
  'US-VT': [-72.5754, 44.2601], 'US-VA': [-77.4360, 37.5407], 'US-WA': [-122.9007, 47.0379], 'US-WV': [-81.6326, 38.3498],
  'US-WI': [-89.4012, 43.0731], 'US-WY': [-104.8202, 41.1400],
  'CA-AB': [-113.4938, 53.5461], 'CA-BC': [-123.3656, 48.4284], 'CA-MB': [-97.1384, 49.8951], 'CA-NB': [-66.6431, 45.9636],
  'CA-NL': [-52.7126, 47.5615], 'CA-NS': [-63.5752, 44.6488], 'CA-ON': [-79.3832, 43.6532], 'CA-PE': [-63.1311, 46.2382],
  'CA-QC': [-71.2080, 46.8139], 'CA-SK': [-104.6189, 50.4452], 'CA-NT': [-114.3718, 62.4540], 'CA-NU': [-68.5170, 63.7467],
  'CA-YT': [-135.0568, 60.7212],
};

const RAD = Math.PI / 180;

/** Spherical Albers equal-area conic; returns SVG-oriented [x, y] (y grows south). */
export function albers({ lon0, lat0, lat1, lat2 }) {
  const n = (Math.sin(lat1 * RAD) + Math.sin(lat2 * RAD)) / 2;
  const c = Math.cos(lat1 * RAD) ** 2 + 2 * n * Math.sin(lat1 * RAD);
  const rho0 = Math.sqrt(c - 2 * n * Math.sin(lat0 * RAD)) / n;
  return ([lon, lat]) => {
    const rho = Math.sqrt(c - 2 * n * Math.sin(lat * RAD)) / n;
    const theta = n * (lon - lon0) * RAD;
    return [rho * Math.sin(theta), -(rho0 - rho * Math.cos(theta))];
  };
}

const MAIN = albers({ lon0: -100, lat0: 45, lat1: 40, lat2: 70 });
const HAWAII = albers({ lon0: -157, lat0: 20, lat1: 19, lat2: 22 });
/** Map units across the continental frame. */
const WIDTH = 1000;
const MARGIN = 12;
/** Simplification tolerance in map units; 0.1 is the stored precision. */
const TOLERANCE = 0.12;
/** Islands smaller than this (square map units) are dropped unless they hold the capitol. */
const MIN_ISLAND = 0.6;
/** Secondary highways count for less than expressways when ranking cells. */
const MINOR_WEIGHT = 0.6;

async function source(cache, { file, sha256 }) {
  const path = join(cache, file);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    console.log(`Downloading ${file}`);
    const response = await fetch(NE_BASE + file);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await mkdir(cache, { recursive: true });
    await writeFile(path, bytes);
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== sha256) throw new Error(`${file}: expected sha256 ${sha256}, got ${digest}`);
  return JSON.parse(bytes.toString('utf8'));
}

/** Polygon and MultiPolygon rings as [lon, lat] arrays, with the Aleutians kept west of 180°. */
function lonLatRings(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.flatMap(polygon => polygon.map(ring => ring.slice(0, -1).map(([lon, lat]) => [lon > 0 ? lon - 360 : lon, lat])));
}

function lonLatLines(geometry) {
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Greedy DSatur coloring: four tints so neighbors never match. */
function fourColor(ids, neighbors) {
  const color = new Map();
  while (color.size < ids.length) {
    let pick = '', best = [-1, -1, ''];
    for (const id of ids) {
      if (color.has(id)) continue;
      const near = neighbors.get(id) ?? new Set();
      const saturation = new Set([...near].filter(n => color.has(n)).map(n => color.get(n))).size;
      const key = [saturation, near.size, id];
      if (key[0] > best[0] || (key[0] === best[0] && (key[1] > best[1] || (key[1] === best[1] && id < best[2])))) { best = key; pick = id; }
    }
    const used = new Set([...(neighbors.get(pick) ?? [])].map(n => color.get(n)));
    let tint = 0;
    while (used.has(tint)) tint++;
    color.set(pick, tint % 4);
  }
  return color;
}

const round1 = value => Math.round(value * 10) / 10;
const pt = ([x, y]) => [round1(x), round1(y)];

export async function buildAtlas(cache) {
  const [admin1, admin0, lakes, roads] = await Promise.all([
    source(cache, SOURCES.admin1), source(cache, SOURCES.admin0), source(cache, SOURCES.lakes), source(cache, SOURCES.roads),
  ]);
  const features = new Map(admin1.features.map(f => [f.properties.iso_3166_2, f]));

  // Raw projected rings, before fitting to the frame.
  const raw = new Map();
  for (const region of REGIONS) {
    const feature = features.get(region.id);
    if (!feature) throw new Error(`Natural Earth has no ${region.id}`);
    const project = region.id === 'US-HI' ? HAWAII : MAIN;
    const rings = lonLatRings(feature.geometry)
      .filter(ring => region.id !== 'US-HI' || ring.every(([lon]) => lon > -161)) // main islands only
      .map(ring => ring.map(project));
    raw.set(region.id, { rings, capitol: project(CAPITOLS[region.id]) });
  }

  // Fit the continental frame (everything but Hawaii) to WIDTH units.
  const [minX, minY, maxX, maxY] = ringsBBox([...raw].filter(([id]) => id !== 'US-HI').flatMap(([, r]) => r.rings));
  const scale = WIDTH / (maxX - minX);
  const fit = ([x, y]) => [(x - minX) * scale + MARGIN, (y - minY) * scale + MARGIN];
  const frameH = (maxY - minY) * scale + MARGIN * 2;
  const frameW = WIDTH + MARGIN * 2;

  // Hawaii keeps the continental scale, framed in the lower-left inset.
  const hawaii = raw.get('US-HI');
  const [hx0, hy0, hx1, hy1] = ringsBBox(hawaii.rings);
  const pad = 8;
  const insetW = (hx1 - hx0) * scale + pad * 2, insetH = (hy1 - hy0) * scale + pad * 2 + 6;
  const insetX = MARGIN + 10, insetY = frameH - MARGIN - insetH - 70;
  const fitHawaii = ([x, y]) => [(x - hx0) * scale + insetX + pad, (y - hy0) * scale + insetY + pad + 6];

  const highwayLines = expressway => roads.features
    .filter(f => ['USA', 'CAN'].includes(f.properties.sov_a3) && f.properties.type === 'Major Highway'
      && (expressway ? f.properties.expressway === 1 && f.properties.scalerank <= 5 : f.properties.expressway !== 1 && f.properties.scalerank <= 7))
    .flatMap(f => lonLatLines(f.geometry))
    .filter(line => line.every(([lon]) => lon > -161)) // Hawaii's roads would need the inset projection
    .map(line => simplifyLine(line.map(p => fit(MAIN(p))), TOLERANCE * 2));

  const majorLines = highwayLines(true), minorLines = highwayLines(false);

  const regions = {};
  const vertexOwners = new Map();
  for (const region of REGIONS) {
    const { rings, capitol } = raw.get(region.id);
    const place = region.id === 'US-HI' ? fitHawaii : fit;
    const fitted = rings.map(ring => ring.map(place));
    const cap = place(capitol);
    for (const ring of fitted) for (const p of ring) {
      const key = `${Math.round(p[0] * 20)},${Math.round(p[1] * 20)}`;
      const owners = vertexOwners.get(key) ?? new Set();
      owners.add(region.id);
      vertexOwners.set(key, owners);
    }
    const largest = Math.max(...fitted.map(ring => Math.abs(ringArea(ring))));
    const kept = fitted
      .filter(ring => Math.abs(ringArea(ring)) >= Math.min(MIN_ISLAND, largest) || pointInRing(cap, ring))
      .map(ring => simplifyRing(ring, TOLERANCE))
      .filter(ring => ring.length >= 3);
    const bbox = ringsBBox(kept);
    const layout = countyLayout(kept, cap);
    // Busy cells get the urban archetypes, quiet ones the farmland (Hawaii has no mapped roads,
    // so its ranking falls back to distance from the capitol).
    const major = cellLineDensity(layout.seeds, kept, region.id === 'US-HI' ? [] : majorLines);
    const minor = cellLineDensity(layout.seeds, kept, region.id === 'US-HI' ? [] : minorLines);
    const density = major.slice(0, 6).map((m, i) => m + MINOR_WEIGHT * minor[i]);
    const cellFor = rankCellsByDensity(density, layout.seeds.slice(0, 6), cap, DENSEST_FIRST);
    const seeds = [...cellFor.map(i => layout.seeds[i]), layout.seeds[6]];
    const labels = [...cellFor.map(i => layout.labels[i]), layout.labels[6]];
    const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
    const cellBox = [bbox[0] - span, bbox[1] - span, bbox[2] + span, bbox[3] + span];
    regions[region.id] = {
      d: ringsToPath(kept),
      label: pt(labelAnchor(kept)),
      bbox: bbox.map(round1),
      capitol: pt(cap),
      tint: 0,
      counties: voronoiCells(seeds, cellBox).map((cell, i) => ({ d: ringsToPath([cell]), label: pt(labels[i]) })),
    };
  }

  // Neighbors share border vertices in Natural Earth; color from that adjacency.
  const shared = new Map();
  for (const owners of vertexOwners.values()) {
    if (owners.size < 2) continue;
    for (const a of owners) for (const b of owners) if (a < b) shared.set(`${a}|${b}`, (shared.get(`${a}|${b}`) ?? 0) + 1);
  }
  const neighbors = new Map(REGIONS.map(r => [r.id, new Set()]));
  for (const [pair, count] of shared) {
    if (count < 2) continue;
    const [a, b] = pair.split('|');
    neighbors.get(a).add(b);
    neighbors.get(b).add(a);
  }
  const tints = fourColor(REGIONS.map(r => r.id), neighbors);
  for (const region of REGIONS) regions[region.id].tint = tints.get(region.id);

  const inFrame = ring => {
    const [x0, y0, x1, y1] = ringsBBox(ring);
    return x1 > 0 && y1 > 0 && x0 < frameW && y0 < frameH;
  };
  const landRings = list => list
    .map(ring => ring.map(p => fit(MAIN(p))))
    .filter(ring => inFrame([ring]) && Math.abs(ringArea(ring)) >= MIN_ISLAND)
    .map(ring => simplifyRing(ring, TOLERANCE * 2))
    .filter(ring => ring.length >= 3);

  const context = landRings(admin0.features
    .filter(f => ['MEX', 'GRL', 'CUB', 'BHS', 'GTM', 'BLZ', 'HTI', 'DOM', 'JAM', 'RUS'].includes(f.properties.ADM0_A3))
    .flatMap(f => lonLatRings(f.geometry)));

  const lakeRings = landRings(lakes.features
    .filter(f => f.properties.scalerank <= 2)
    .flatMap(f => lonLatRings(f.geometry))
    .filter(ring => ring.every(([lon, lat]) => lon < -50 && lon > -170 && lat > 24)));

  const graticule = [];
  for (let lon = -180; lon <= -40; lon += 10) {
    const line = [];
    for (let lat = 15; lat <= 85; lat += 2.5) line.push(fit(MAIN([lon, lat])));
    graticule.push(line);
  }
  for (let lat = 20; lat <= 80; lat += 10) {
    const line = [];
    for (let lon = -190; lon <= -30; lon += 2.5) line.push(fit(MAIN([lon, lat])));
    graticule.push(line);
  }

  return {
    version: 1,
    source: 'Natural Earth 1:50m admin-1, lakes and countries; 1:10m roads (v5.1.2, public domain). Albers equal-area conic, Hawaii inset.',
    viewBox: [0, 0, round1(frameW), round1(frameH)],
    graticule: linesToPath(graticule.map(line => simplifyLine(line, TOLERANCE))),
    context: ringsToPath(context),
    lakes: ringsToPath(lakeRings),
    highways: { major: linesToPath(majorLines), minor: linesToPath(minorLines) },
    insets: [{ box: [round1(insetX), round1(insetY), round1(insetW), round1(insetH)], label: 'HAWAII' }],
    regions,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const arg = name => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const cache = arg('--cache') ?? join(ROOT, 'node_modules', '.cache', 'natural-earth');
  const out = arg('--out') ?? join(ROOT, 'public', 'atlas', 'north-america-atlas.json');
  const atlas = await buildAtlas(cache);
  const text = `${JSON.stringify(atlas)}\n`;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, text);
  console.log(`Wrote ${out} (${text.length} bytes, ${Object.keys(atlas.regions).length} regions)`);
}
