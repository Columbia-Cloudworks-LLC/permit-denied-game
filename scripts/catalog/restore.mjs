import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { restoreCapture } from './cache.mjs';
import { pool } from './storage.mjs';

/** The capture folder for a variant. Matches scripts/capture-assets.mjs, which is restated here because editing it changes every capture fingerprint. */
export const variantFolder = (id, variant) => `${id.replaceAll(':', '/')}/variant-${variant}`;

/**
 * Restores a worker's planned cache hits into one capture shard without launching a browser. An asset with any
 * unverifiable variant leaves the shard entirely and is returned for capture, so no variant appears in two shards.
 * @param {{ catalog: any[], restore?: { id: string, keys: string[] }[] }} plan
 * @param {{ get(key: string): Promise<Buffer | null> } | null} store
 */
export async function restorePlanned(plan, store, shard, { commit, shared }) {
  const assets = [], missed = [];
  await mkdir(shard, { recursive: true });
  await pool(plan.restore ?? [], 4, async ({ id, keys }) => {
    const asset = plan.catalog.find(a => a.id === id);
    const records = [];
    for (const [variant, key] of keys.entries()) {
      const record = asset && store && await restoreCapture(store, key, shard, { ...asset, variant, folder: variantFolder(id, variant), exhaustive: false });
      if (!record) break;
      records.push({ ...record, reused: true });
    }
    if (records.length === keys.length && asset?.variants === keys.length) { assets.push(...records); return; }
    missed.push(id);
    for (let variant = 0; variant < keys.length; variant++) await rm(join(shard, variantFolder(id, variant)), { recursive: true, force: true });
  });
  await writeFile(join(shard, 'manifest.json'), JSON.stringify({ version: 1, base: 'r2-cache', shard: 1, shards: 1, filter: '', exhaustive: false,
    assets, errors: [], catalog: plan.catalog, commit, shared }, null, 2));
  return missed;
}
