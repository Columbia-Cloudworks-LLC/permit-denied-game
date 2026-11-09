import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { albers, CAPITOLS, SOURCES } from './build-atlas-data.mjs';
import { REGIONS } from '../src/world/regions.ts';

test('every region has a capitol coordinate inside North America', () => {
  assert.deepEqual(Object.keys(CAPITOLS).sort(), REGIONS.map(r => r.id).sort());
  for (const [id, [lon, lat]] of Object.entries(CAPITOLS)) {
    assert.ok(lon < -50 && lon > -170, `${id} longitude`);
    assert.ok(lat > 18 && lat < 72, `${id} latitude`);
  }
});

test('Natural Earth sources are pinned to a release and a digest', () => {
  for (const { file, sha256 } of Object.values(SOURCES)) {
    assert.match(file, /^ne_(?:10|50)m_[a-z0-9_]+\.geojson$/);
    assert.match(sha256, /^[0-9a-f]{64}$/);
  }
});

test('Albers projects its origin to zero, north up and east right', () => {
  const project = albers({ lon0: -100, lat0: 45, lat1: 40, lat2: 70 });
  const [x0, y0] = project([-100, 45]);
  assert.ok(Math.abs(x0) < 1e-12 && Math.abs(y0) < 1e-12);
  assert.ok(project([-100, 50])[1] < 0, 'north is up (smaller y)');
  assert.ok(project([-90, 45])[0] > 0, 'east is right');
});

test('the committed atlas matches the manifest', async () => {
  const atlas = JSON.parse(await readFile(new URL('../public/atlas/north-america-atlas.json', import.meta.url), 'utf8'));
  assert.equal(atlas.version, 1);
  assert.deepEqual(Object.keys(atlas.regions).sort(), REGIONS.map(r => r.id).sort());
  for (const region of Object.values(atlas.regions)) assert.equal(region.counties.length, 7);
});
