import { digest, fingerprint } from './core.mjs';

/**
 * Expected capture time for every variant: cached captures are quick, else the last measured time, else a floor-based
 * guess. When every variant is a cache hit, `restore` lists their fingerprints so a worker can restore without a browser.
 */
export async function assetPlan(asset, inputs, runtime, cache) {
  let duration = 0;
  const hits = [];
  for (let variant = 0; variant < asset.variants; variant++) {
    const key = fingerprint(runtime, inputs, variant);
    const record = cache && await cache.get(`captures/${key}.json`);
    if (record) { duration += 5000; hits.push(key); continue; }
    const measured = cache ? await measuredDuration(cache, asset.id, variant) : 0;
    duration += measured > 0 ? measured : Math.max(15000, (asset.floors + 1) * 15000);
  }
  return { duration, restore: hits.length === asset.variants ? hits : null };
}

/** The last recorded capture time for a variant, or 0 when none is usable. */
async function measuredDuration(cache, id, variant) {
  const timing = await cache.get(`timings/${digest(Buffer.from(`${id}/${variant}`))}.json`);
  if (!timing) return 0;
  try {
    const measured = Number(JSON.parse(timing.toString()).durationMs);
    return Number.isFinite(measured) ? measured : 0;
  } catch { return 0; }
}

/**
 * Four workers with bounded batches, rather than an asset-sized CI matrix. Longest tasks go
 * first to the least-loaded worker; a batch closes at eight minutes or twelve assets. Fully
 * cached assets join the worker's restore list instead of a capture batch.
 */
export function packWorkers(tasks, catalog) {
  /** @type {{ catalog: typeof catalog, batches: { catalog: typeof catalog, ids: string[], duration: number }[], restore: { id: string, keys: string[] }[], duration: number }[]} */
  const workers = Array.from({ length: 4 }, () => ({ catalog, batches: [], restore: [], duration: 0 }));
  for (const task of tasks.sort((a, b) => b.duration - a.duration)) {
    const worker = [...workers].sort((a, b) => a.duration - b.duration)[0];
    worker.duration += task.duration;
    if (task.restore) { worker.restore.push({ id: task.id, keys: task.restore }); continue; }
    let batch = worker.batches.at(-1);
    if (!batch || batch.duration + task.duration > 480000 || batch.ids.length >= 12) {
      batch = { catalog, ids: [], duration: 0 }; worker.batches.push(batch);
    }
    batch.ids.push(task.id); batch.duration += task.duration;
  }
  return workers;
}
