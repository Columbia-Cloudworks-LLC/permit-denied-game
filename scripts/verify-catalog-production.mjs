import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function verifyCatalogProduction(origin, expected) {
  async function get(url) {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    assert.ok(response.ok, `Catalog HTTP ${response.status}: ${url}`); return response;
  }
  const page = await get(`${origin}/catalog/`);
  assert.ok((await page.text()).includes('THE DEMOLITION COLLECTION'), 'Wrong catalog page');
  const pointer = await (await get(`${origin}/catalog/release.json`)).json();
  assert.equal(pointer.commit, expected.commit); assert.equal(pointer.version, expected.version);
  const url = new URL(pointer.url);
  assert.equal(url.origin, 'https://assets.permitdenied.app');
  const release = await (await get(url)).json();
  assert.equal(release.commit, expected.commit); assert.equal(release.version, expected.version); assert.equal(release.schema, 1);
  assert.ok(release.assetCount > 0);
  async function first(tree) {
    const node = await (await get(`${url.origin}/${tree.file}`)).json();
    return node.items ? node.items[0].card : first(node.children[0]);
  }
  const card = await first(release.indexes.all.browse);
  const thumbnail = await get(`${url.origin}/${card.thumbnail}`);
  assert.ok(thumbnail.headers.get('content-type')?.includes('image/webp'));
  assert.ok(thumbnail.headers.get('cache-control')?.includes('immutable'));
  const detailResponse = await fetch(`${url.origin}/${card.detail}`, { headers: { Origin: origin }, signal: AbortSignal.timeout(20000) });
  assert.ok(detailResponse.ok); assert.equal(detailResponse.headers.get('access-control-allow-origin'), '*');
  const detail = await detailResponse.json();
  const series = detail.variants[0].series.find(s => s.id === 'destruction') || detail.variants[0].series[0];
  await get(`${url.origin}/${series.frames[0].file}`); await get(`${url.origin}/${series.frames.at(-1).file}`);
  console.log(`Catalog ${expected.commit}: ${release.assetCount} assets, MIME, caching, CORS and sample frames verified`);
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/verify-catalog-production.mjs')) {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  if (!process.env.DEPLOY_SHA) throw new Error('DEPLOY_SHA required');
  await verifyCatalogProduction(process.env.CATALOG_VERIFY_ORIGIN || 'https://permitdenied.app', { commit: process.env.DEPLOY_SHA, version });
}
