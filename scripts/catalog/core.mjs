import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const SCHEMA = 1;
export const PAGE_SIZE = 24;
export const IMAGE_SETTINGS = { format: 'webp', lossless: true, effort: 4, thumbnailWidth: 360 };
export function digest(bytes) {
  const payload = /** @type {string | Uint8Array} */ (bytes);
  return createHash('sha256').update(payload).digest('hex');
}
export const normalize = text => text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const fingerprint = (shared, inputs, variant) => digest(JSON.stringify(canonical({ shared, inputs, variant, images: IMAGE_SETTINGS })));
export async function filesUnder(root, relative = '') {
  const result = [];
  for (const e of await readdir(join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${e.name}` : e.name;
    if (e.isSymbolicLink()) throw new Error('Catalog files must not be symlinks');
    if (e.isDirectory()) result.push(...await filesUnder(root, name));
    else result.push(name);
  }
  return result.sort();
}
/** The separate gallery pages stay out of the shared capture fingerprint. */
const GALLERY_DIRS = ['catalog/', 'designer/', 'site/'];

/** Executable game source under src/: not JSON, not tests, not the gallery. */
export function isFingerprintSource(file) {
  return !file.endsWith('.json') && !file.includes('.test.') && !GALLERY_DIRS.some(dir => file.startsWith(dir));
}

export async function sharedFingerprint(root = '.') {
  // JSON definitions are covered by resolved per-asset inputs. All executable
  // source is conservatively included, except the independent gallery.
  const source = (await filesUnder(join(root, 'src'))).filter(isFingerprintSource);
  const names = [...source.map(p => `src/${p}`), 'package-lock.json', 'scripts/capture-assets.mjs',
    'scripts/catalog/core.mjs', 'scripts/catalog/cache.mjs', 'scripts/verify-asset-captures.mjs'];
  return digest(JSON.stringify(await Promise.all(names.sort().map(async p => [p, digest(await readFile(join(root, p)))]))));
}
export function safeKey(key) {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(key) || key.split('/').some(p => p === '..' || p === '.' || !p)) throw new Error('Unsafe object key');
  return key;
}
const LAYER_TOGGLES = ['roofs', 'walls', 'floors', 'contents', 'props', 'debris', 'vehicles', 'details', 'effects', 'terrain', 'roads', 'sites'];
const pad = (n, width) => String(n).padStart(width, '0');

/** Every image a capture run must produce for an asset, in a stable order. */
export function requiredCaptures(asset, exhaustive = false) {
  const files = ['model.png', ...['cutaway', 'structure', 'collision', 'rooms'].map(v => `layers/${v}.png`)];
  for (const layer of LAYER_TOGGLES) for (const mode of ['only', 'without']) files.push(`layers/${mode}-${layer}.png`);
  for (let floor = 0; floor < asset.floors; floor++) for (const view of ['cutaway', 'structure']) files.push(`floors/${pad(floor, 2)}-${view}.png`);
  if (exhaustive) for (let mask = 0; mask < 4096; mask++) files.push(`layers/combination-${pad(mask, 4)}.png`);
  files.push(...behaviourCaptures(asset));
  return files;
}

/** Vehicles crash from each heading; unsupported assets just move; everything else is demolished in stages. */
function behaviourCaptures(asset) {
  if (asset.category === 'vehicle') return vehicleCaptures();
  if (asset.destruction === 'unsupported') return [15, 30, 60, 120, 180].map(frame => `motion/frame-${pad(frame, 4)}.png`);
  return destructionCaptures();
}

function vehicleCaptures() {
  const files = [];
  for(let heading=0;heading<4;heading++){files.push('vehicle/heading-'+heading+'-intact.png');for(const action of ['front','side','rear','overhead'])for(const frame of [0,15,60])files.push('vehicle/heading-'+heading+'-'+action+'-'+frame+'.png');}
  for(const frame of [30,90,180])files.push('vehicle/travel-'+frame+'.png');
  files.push('vehicle/wreck-0.png','vehicle/wreck-180.png','vehicle/wreck-pushed.png');
  return files;
}

function destructionCaptures() {
  const files = ['00-intact', '01-damaged', '02-breached', '03-support-loss', '99-cleared-structure'].map(stage => `destruction/${stage}.png`);
  for (const frame of [6, 15, 30, 60, 90, 120, 180, 240, 360, 600, 900]) for (const view of ['', '-cutaway', '-no-effects']) files.push(`destruction/frame-${pad(frame, 4)}${view}.png`);
  return files;
}

export async function publicationFiles(root, releaseFile) {
  const pending = [safeKey(releaseFile)], visited = new Set(), files = [];
  function references(value) {
    if (typeof value === 'string' && /^objects\/[a-f0-9]{64}\.(json|webp)$/.test(value)) pending.push(value);
    else if (Array.isArray(value)) value.forEach(references);
    else if (value && typeof value === 'object') Object.values(value).forEach(references);
  }
  while (pending.length) {
    const key = pending.pop();
    if (!key || visited.has(key)) continue;
    visited.add(key);
    if (!/^(objects|releases)\/[a-f0-9]{64}\.(json|webp)$/.test(key)) throw new Error('Invalid immutable file reference');
    const data = await readFile(join(root, key));
    const name = key.split('/').at(-1);
    if (!name || name.split('.')[0] !== digest(data)) throw new Error(`Immutable file checksum mismatch: ${key}`);
    files.push(key);
    if (key.endsWith('.json')) references(JSON.parse(data.toString()));
  }
  return files;
}
export async function objectWriter(root) {
  let bytes = 0, count = 0;
  const seen = new Set();
  return {
    async put(data, extension = 'json') {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
      const key = `objects/${digest(buffer)}.${extension}`;
      if (!seen.has(key)) {
        await mkdir(dirname(join(root, key)), { recursive: true });
        await writeFile(join(root, key), buffer); seen.add(key); bytes += buffer.length; count++;
      }
      return key;
    },
    stats: () => ({ bytes, objects: count }),
  };
}

// Immutable B+ tree: every file has at most 24 records or 24 child pointers.
// Prefix search seeks into the tree; even a match covering the whole catalog
// only reads enough leaves to fill the current page.
export async function buildTree(records, put) {
  const sorted = [...records].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  let nodes = [];
  for (let i = 0; i < sorted.length; i += PAGE_SIZE) {
    const items = sorted.slice(i, i + PAGE_SIZE);
    const last = items.at(-1);
    nodes.push({ min: items[0].key, max: last ? last.key : items[0].key, count: items.length, file: await put({ items }) });
  }
  if (!nodes.length) return { file: await put({ items: [] }), count: 0 };
  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i < nodes.length; i += PAGE_SIZE) {
      const children = nodes.slice(i, i + PAGE_SIZE);
      const last = children.at(-1);
      next.push({ min: children[0].min, max: last ? last.max : children[0].min, count: children.reduce((n, c) => n + c.count, 0), file: await put({ children }) });
    }
    nodes = next;
  }
  return nodes[0];
}

export async function buildIndexes(cards, put) {
  const indexes = {};
  for (const [category, items] of categoryGroups(cards)) {
    const browse = items.map(card => ({ key: `${normalize(card.name)}\t${card.id}`, card }));
    const search = items.flatMap(card => [...searchTerms(card)].map(term => ({ key: `${term}\t${card.id}`, card })));
    indexes[category] = { count: items.length, browse: await buildTree(browse, put), search: await buildTree(search, put) };
  }
  return indexes;
}

/** All cards, then each category's cards, in first-seen category order. */
function categoryGroups(cards) {
  const groups = new Map([['all', cards]]);
  for (const card of cards) {
    const group = groups.get(card.category) ?? [];
    if (!groups.has(card.category)) groups.set(card.category, group);
    group.push(card);
  }
  return groups;
}

/** Every word suffix of the name and id, so a search can start at any word. */
function searchTerms(card) {
  const terms = new Set();
  for (const text of [card.name, card.id]) {
    const words = normalize(text).split(' ');
    for (let i = 0; i < words.length; i++) terms.add(words.slice(i).join(' '));
  }
  return terms;
}
