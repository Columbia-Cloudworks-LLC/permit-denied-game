import { readFile, writeFile, mkdir, cp, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sharedFingerprint, publicationFiles, safeKey } from './catalog/core.mjs';
import { withCapturePage } from './catalog/preview.mjs';
import { assetPlan, packWorkers } from './catalog/plan.mjs';
import { restorePlanned } from './catalog/restore.mjs';
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
/** The commit stamped into the build; in CI it must be the commit being published. */
async function builtCommit() {
  const { commit: built } = JSON.parse(await readFile(join(build, 'build.json'), 'utf8'));
  if (process.env.DEPLOY_SHA && built !== process.env.DEPLOY_SHA) throw new Error('Build provenance mismatch');
  return built;
}
function run(script, params = []) {
  const result = spawnSync(process.execPath, [script, ...params], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`${script} failed`);
}

if (command === 'plan') {
  const cache = args.includes('--cache') ? r2Store(config.privateBucket) : null;
  const shared = await sharedFingerprint();
  const plans = await withCapturePage(build, async (page, browser) => {
    const catalog = await page.evaluate(() => {
      const capture = window.__assetCapture;
      if (!capture) throw new Error('asset capture binder missing');
      return capture.catalog;
    });
    const runtime = { shared, browser: browser.version(), platform: process.platform, arch: process.arch, node: process.versions.node, exhaustive: false };
    const tasks = [];
    for (const asset of catalog) {
      const inputs = await page.evaluate((id) => {
        const capture = window.__assetCapture;
        if (!capture) throw new Error('asset capture binder missing');
        return capture.inputs(id);
      }, asset.id);
      tasks.push({ id: asset.id, ...await assetPlan(asset, inputs, runtime, cache) });
    }
    return packWorkers(tasks, catalog);
  });
  await mkdir(output, { recursive: true });
  for (const [i, plan] of plans.entries()) await writeFile(join(output, `${i}.json`), JSON.stringify(plan));
  console.log(`${plans.reduce((n, p) => n + p.batches.length, 0)} capture batches across four workers`);
} else if (command === 'capture-plan' || command === 'restore-plan') {
  // restore-plan does only the browserless half and writes what is left to capture, so CI
  // installs Chromium only for workers that still have captures.
  const worker = option('worker', '0');
  const plan = JSON.parse(await readFile(join(option('plans', 'artifacts/catalog-plans'), `${worker}.json`), 'utf8'));
  await mkdir(root, { recursive: true });
  const batches = [...plan.batches];
  // A worker with nothing to capture still writes a shard so its artifact is never empty.
  if (!plan.restored && (plan.restore?.length || !batches.length)) {
    const store = args.includes('--cache') ? r2Store(config.privateBucket) : null;
    const missed = await restorePlanned(plan, store, join(root, `restored-${worker}`), { commit: await builtCommit(), shared: await sharedFingerprint() });
    if (missed.length) batches.push({ catalog: plan.catalog, ids: missed });
    console.log(`Worker ${worker}: restored ${(plan.restore?.length ?? 0) - missed.length} cached assets without a browser`);
  }
  if (command === 'restore-plan') {
    const pending = resolve(option('pending', 'artifacts/catalog-pending'));
    await mkdir(pending, { recursive: true });
    await writeFile(join(pending, `${worker}.json`), JSON.stringify({ catalog: plan.catalog, batches, restore: [], restored: true }));
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `capture=${batches.length > 0}\n`);
    console.log(`Worker ${worker}: ${batches.length} capture batches remain`);
  } else for (const [i, batch] of batches.entries()) {
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
  await pool((await publicationFiles(output, info.file)).filter((key) => key.startsWith('objects/')), 4, async (key) => {
    if (!key) return;
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
} else throw new Error('Expected plan, capture-plan, restore-plan, generate, local, cache, or publish');
