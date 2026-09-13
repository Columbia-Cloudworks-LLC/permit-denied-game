import { readFile, writeFile, mkdir, cp, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fingerprint, sharedFingerprint, publicationFiles, safeKey, digest } from './catalog/core.mjs';
import { withCapturePage } from './catalog/preview.mjs';
import { generateCatalog, readCaptures } from './catalog/generate.mjs';
import { r2Store, uploadVerified, pool } from './catalog/storage.mjs';
import { saveCapture } from './catalog/cache.mjs';

const args = process.argv.slice(2), command = args[0];
const option = (name, fallback) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = resolve(option('captures', 'artifacts/catalog'));
const output = resolve(option('output', 'artifacts/catalog-public'));
const build = resolve(option('build', 'dist'));
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const config = JSON.parse(await readFile('scripts/catalog/cloudflare.json', 'utf8'));
if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCOUNT_ID !== config.accountId) throw new Error('Refusing a different Cloudflare account');
process.env.R2_ACCOUNT_ID = config.accountId;
process.env.R2_PRIVATE_BUCKET ||= config.privateBucket;
const commit = process.env.DEPLOY_SHA || 'local';
function run(script, params = []) {
  const result = spawnSync(process.execPath, [script, ...params], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`${script} failed`);
}

if (command === 'plan') {
  const cache = args.includes('--cache') ? r2Store(config.privateBucket) : null;
  const shared = await sharedFingerprint();
  const plans = await withCapturePage(build, async (page, browser) => {
    const catalog = await page.evaluate(() => window.__assetCapture.catalog);
    const runtime = { shared, browser: browser.version(), platform: process.platform, arch: process.arch, node: process.versions.node, exhaustive: false };
    const tasks = [];
    for (const asset of catalog) {
      const inputs = await page.evaluate(id => window.__assetCapture.inputs(id), asset.id);
      let duration = 0;
      for (let variant = 0; variant < asset.variants; variant++) {
        const key = fingerprint(runtime, inputs, variant);
        const record = cache && await cache.get(`captures/${key}.json`);
        const timing = !record && cache && await cache.get(`timings/${digest(Buffer.from(`${asset.id}/${variant}`))}.json`);
        let measured = 0;
        try { measured = timing ? Number(JSON.parse(timing).durationMs) : 0; } catch {}
        duration += record ? 5000 : (Number.isFinite(measured) && measured > 0 ? measured : Math.max(15000, (asset.floors + 1) * 15000));
      }
      tasks.push({ id: asset.id, duration });
    }
    // Four workers with bounded batches, rather than an asset-sized CI matrix.
    const workers = Array.from({ length: 4 }, () => ({ catalog, batches: [], duration: 0 }));
    for (const task of tasks.sort((a, b) => b.duration - a.duration)) {
      const worker = [...workers].sort((a, b) => a.duration - b.duration)[0];
      let batch = worker.batches.at(-1);
      if (!batch || batch.duration + task.duration > 480000 || batch.ids.length >= 12) {
        batch = { catalog, ids: [], duration: 0 }; worker.batches.push(batch);
      }
      batch.ids.push(task.id); batch.duration += task.duration;
      worker.duration += task.duration;
    }
    return workers;
  });
  await mkdir(output, { recursive: true });
  for (const [i, plan] of plans.entries()) await writeFile(join(output, `${i}.json`), JSON.stringify(plan));
  console.log(`${plans.reduce((n, p) => n + p.batches.length, 0)} capture batches across four workers`);
} else if (command === 'capture-plan') {
  const worker = option('worker', '0');
  const plan = JSON.parse(await readFile(join(option('plans', 'artifacts/catalog-plans'), `${worker}.json`), 'utf8'));
  await mkdir(root, { recursive: true });
  const batches = plan.batches.length ? plan.batches : [{ catalog: plan.catalog, ids: [] }];
  for (const [i, batch] of batches.entries()) {
    const path = join(root, `plan-${worker}-${i}.json`);
    await writeFile(path, JSON.stringify(batch));
    run('scripts/capture-assets.mjs', [`--plan=${path}`, `--output=${join(root, `batch-${worker}-${i}`)}`, `--preview-dir=${build}`,
      `--port=${4200 + Number(worker)}`,
      ...(args.includes('--cache') ? ['--cache'] : [])]);
  }
} else if (command === 'generate' || command === 'local') {
  if (command === 'local') run('scripts/capture-assets.mjs', [`--output=${join(root, 'local')}`, `--preview-dir=${build}`]);
  run('scripts/verify-asset-captures.mjs', [root]);
  const result = await generateCatalog(root, output, { commit, version, allowLegacy: args.includes('--allow-legacy') });
  console.log(JSON.stringify(result));
  if (command === 'local' || args.includes('--local-preview')) {
    await mkdir(join(build, 'catalog'), { recursive: true });
    await cp(output, join(build, 'catalog/data'), { recursive: true });
    await writeFile(join(build, 'catalog/release.json'), JSON.stringify({ url: `/catalog/data/${result.file}`, commit, version }));
  }
} else if (command === 'cache') {
  run('scripts/verify-asset-captures.mjs', [root]);
  const store = r2Store(config.privateBucket);
  for (const shard of await readCaptures(root)) for (const record of shard.assets) {
    if (!record.reused) await saveCapture(store, record, join(root, shard.folder));
  }
} else if (command === 'publish') {
  const info = JSON.parse(await readFile(join(output, 'publication.json'), 'utf8'));
  if (info.commit !== commit || info.version !== version || info.legacy || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Catalog publication requires verified provenance from a real commit');
  const store = r2Store(config.publicBucket);
  let uploaded = 0, bytes = 0;
  await pool((await publicationFiles(output, info.file)).filter(key => key.startsWith('objects/')), 4, async key => {
    const data = await readFile(join(output, key));
    if (await uploadVerified(store, key, data, key.endsWith('.webp') ? 'image/webp' : 'application/json')) { uploaded++; bytes += data.length; }
  });
  const release = await readFile(join(output, safeKey(info.file)));
  await uploadVerified(store, info.file, release, 'application/json');
  await mkdir(join(build, 'catalog'), { recursive: true });
  await writeFile(join(build, 'catalog/release.json'), JSON.stringify({ url: `${config.publicOrigin}/${info.file}`, commit, version }));
  const summary = `Catalog: ${info.assets} assets, ${info.reused} reused variants; ${uploaded} new objects, ${bytes} uploaded bytes. Retained objects are not deleted.\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
} else throw new Error('Expected plan, generate, local, cache, or publish');
