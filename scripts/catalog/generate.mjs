import sharp from 'sharp';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SCHEMA, IMAGE_SETTINGS, digest, objectWriter, buildIndexes, safeKey } from './core.mjs';

export async function readCaptures(root) {
  const shards = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    try { shards.push({ folder: e.name, ...JSON.parse(await readFile(join(root, e.name, 'manifest.json'), 'utf8')) }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!shards.length) throw new Error('No capture shards');
  return shards;
}

export function seriesFor(captures, unsupported) {
  const result = [];
  const add = (id, name, predicate) => {
    const frames = captures.filter(c => predicate(c.source));
    if (frames.length) result.push({ id, name, frames });
  };
  add('model', 'Model', file => file === 'model.png');
  if (unsupported) add('motion', 'Vehicle motion', file => file.startsWith('motion/'));
  else {
    add('destruction', 'Destruction', file => file.startsWith('destruction/') && !file.includes('-cutaway') && !file.includes('-no-effects'));
    add('cutaway', 'Destruction · cutaway', file => file.startsWith('destruction/') && file.includes('-cutaway'));
    add('no-effects', 'Destruction · effects hidden', file => file.startsWith('destruction/') && file.includes('-no-effects'));
  }
  for(let heading=0;heading<4;heading++)add('vehicle-'+heading,'Vehicle damage · view '+(heading+1),file=>file.startsWith('vehicle/heading-'+heading+'-'));
  add('vehicle-travel','Vehicle travel',file=>file.startsWith('vehicle/travel-'));
  add('vehicle-wreck','Persistent wreck',file=>file.startsWith('vehicle/wreck-'));
  add('layers', 'Layer studies', file => file.startsWith('layers/'));
  add('floors', 'Floor studies', file => file.startsWith('floors/'));
  return result;
}

export function frameLabel(file) {
  const labels = { '00-intact': 'Intact', '01-damaged': 'Initial damage', '02-breached': 'Frontage breached',
    '03-support-loss': 'Ground support removed', '99-cleared-structure': 'Fully cleared · additional full-damage cleanup' };
  const stem = file.split('/').at(-1).replace('.png', '');
  return labels[stem] || stem.replaceAll('-', ' ');
}

/** Intact host exteriors hide interior fixtures behind roof and walls. */
export const OPAQUE_INTACT_EXTERIORS = Object.freeze(['model.png', 'destruction/00-intact.png']);

export function isOpaqueIntactExterior(file) {
  return OPAQUE_INTACT_EXTERIORS.includes(file);
}

export function thumbnailSource(asset) {
  if (asset.category === 'fixture') return 'floors/00-cutaway.png';
  return 'model.png';
}

function thumbnailCapture(asset) {
  const file = thumbnailSource(asset);
  if (asset.category === 'fixture' && isOpaqueIntactExterior(file)) {
    throw new Error(`${asset.id}: fixture thumbnail sourced from an opaque intact exterior`);
  }
  const capture = asset.captures.find(c => c.file === file);
  if (!capture) throw new Error(`${asset.id}: missing thumbnail source ${file}`);
  if (asset.category === 'fixture' && isOpaqueIntactExterior(capture.file)) {
    throw new Error(`${asset.id}: fixture thumbnail sourced from an opaque intact exterior`);
  }
  const intact = asset.captures.filter(c => isOpaqueIntactExterior(c.file));
  if (asset.category === 'fixture' && intact.some(c => c.sha256 === capture.sha256)) {
    throw new Error(`${asset.id}: fixture thumbnail matches the opaque intact exterior`);
  }
  return capture;
}

export async function generateCatalog(root, output, { commit, version, allowLegacy = false }) {
  const shards = await readCaptures(root), writer = await objectWriter(output);
  const groups = new Map(), images = new Map();
  let screenshotCount = 0, reused = 0;
  for (const shard of shards) {
    if (!allowLegacy && shard.commit !== commit) throw new Error('Capture commit mismatch');
    for (const asset of shard.assets) {
      if (!asset.restorationVerified || (!allowLegacy && !asset.fingerprint)) throw new Error('Unverified capture record');
      const frames = [];
      for (const capture of asset.captures) {
        let image = images.get(capture.sha256);
        if (!image) {
          const bytes = await readFile(join(root, safeKey(shard.folder), safeKey(asset.folder), safeKey(capture.file)));
          if (digest(bytes) !== capture.sha256) throw new Error('Image checksum mismatch during conversion');
          const converted = await sharp(bytes).webp({ lossless: true, effort: IMAGE_SETTINGS.effort }).toBuffer({ resolveWithObject: true });
          image = { file: await writer.put(converted.data, 'webp'), width: converted.info.width, height: converted.info.height };
          images.set(capture.sha256, image);
        }
        frames.push({ ...image, source: capture.file, label: frameLabel(capture.file), seconds: capture.state?.seconds ?? 0 });
        screenshotCount++;
      }
      const model = asset.captures.find(c => c.file === 'model.png');
      if (!model) throw new Error('Missing model');
      const thumbCapture = thumbnailCapture(asset);
      const thumb = await sharp(await readFile(join(root, safeKey(shard.folder), safeKey(asset.folder), safeKey(thumbCapture.file))))
        .resize({ width: IMAGE_SETTINGS.thumbnailWidth, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
      const thumbnail = await writer.put(thumb, 'webp');
      if (!groups.has(asset.id)) groups.set(asset.id, { id: asset.id, name: asset.name || asset.id, category: asset.category,
        thumbnail, thumbnailSource: thumbCapture.file, variants: [] });
      groups.get(asset.id).variants.push({ variant: asset.variant, fingerprint: asset.fingerprint || `legacy-${model.sha256}`,
        destructionUnsupported: asset.destructionUnsupported, series: seriesFor(frames, asset.destructionUnsupported) });
      if (asset.reused) reused++;
    }
  }
  const cards = [];
  for (const asset of groups.values()) {
    asset.variants.sort((a, b) => a.variant - b.variant);
    const detail = await writer.put({ schema: SCHEMA, ...asset });
    cards.push({ id: asset.id, name: asset.name, category: asset.category, thumbnail: asset.thumbnail, variants: asset.variants.length, detail });
  }
  const indexes = await buildIndexes(cards, data => writer.put(data));
  const byId = await (await import('./core.mjs')).buildTree(cards.map(card => ({ key: card.id, card })), data => writer.put(data));
  const release = { schema: SCHEMA, commit, version, assetCount: cards.length,
    variantCount: cards.reduce((n, c) => n + c.variants, 0), screenshotCount, indexes, byId };
  const bytes = Buffer.from(JSON.stringify(release));
  const file = `releases/${digest(bytes)}.json`;
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(output, 'releases'), { recursive: true });
  await writeFile(join(output, file), bytes);
  const result = { file, commit, version, legacy: allowLegacy, ...writer.stats(), assets: cards.length, screenshotCount, reused };
  await writeFile(join(output, 'publication.json'), JSON.stringify(result, null, 2));
  return result;
}
