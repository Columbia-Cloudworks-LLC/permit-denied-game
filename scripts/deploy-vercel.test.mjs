import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { staticDeploymentFiles, deploy } from './deploy-vercel.mjs';
import { githubVanityRedirectRoute } from './github-redirect.mjs';

test('packages static output byte-for-byte in Build Output API format', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'permit-deployment-'));
  try {
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, 'index.html'), '<html>game</html>');
    await writeFile(path.join(root, 'assets', 'image.bin'), Buffer.from([0, 255, 17]));
    const files = await staticDeploymentFiles(root);
    assert.equal(files.length, 3);
    const binary = files.find(f => f.file.endsWith('/assets/image.bin'));
    assert.deepEqual(Buffer.from(binary.data, 'base64'), Buffer.from([0, 255, 17]));
    const config = JSON.parse(Buffer.from(files[0].data, 'base64'));
    assert.equal(config.version, 3);
    assert.deepEqual(config.routes[0], githubVanityRedirectRoute());
    assert.equal(config.routes.find(r => r.src === '/privacy/?').dest, '/privacy/index.html');
    assert.equal(config.routes.find(r => r.src === '/terms/?').dest, '/terms/index.html');
    assert.equal(config.routes[1].headers['referrer-policy'], 'no-referrer');
    assert.equal(config.routes.at(-1).dest, '/index.html');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('refuses an incomplete build', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'permit-deployment-'));
  try { await assert.rejects(staticDeploymentFiles(root), /index.html/); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('catalog routes stay isolated from the game fallback and require a pinned release', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'permit-deployment-'));
  try {
    await mkdir(path.join(root, 'catalog'));
    await writeFile(path.join(root, 'index.html'), '<html>game</html>');
    await writeFile(path.join(root, 'catalog/index.html'), '<html>catalog</html>');
    await assert.rejects(staticDeploymentFiles(root), /release pointer/);
    await writeFile(path.join(root, 'catalog/release.json'), '{}');
    const files = await staticDeploymentFiles(root);
    const config = JSON.parse(Buffer.from(files[0].data, 'base64'));
    const missing = config.routes.findIndex(route => route.src === '/catalog/(.*)');
    assert.equal(config.routes[missing].status, 404);
    assert.ok(missing < config.routes.length - 1);
    assert.equal(config.routes.find(route => route.src === '/catalog/release.json').headers['cache-control'], 'no-store');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('processes prebuilt output through Vercel so project analytics routes are provisioned', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'permit-deployment-'));
  const cwd = process.cwd(), originalFetch = globalThis.fetch;
  const names = ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID', 'DEPLOY_TARGET', 'DEPLOY_SHA', 'DEPLOY_BRANCH', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY'];
  const originalEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const sha = 'a'.repeat(40);
  try {
    await mkdir(path.join(root, 'dist/catalog'), { recursive: true });
    await writeFile(path.join(root, 'dist/index.html'), '<html>verified CI output</html>');
    await writeFile(path.join(root, 'dist/catalog/release.json'), JSON.stringify({ url: `https://assets.permitdenied.app/releases/${'b'.repeat(64)}.json`, commit: sha }));
    process.chdir(root);
    Object.assign(process.env, { VERCEL_TOKEN: 'test', VERCEL_ORG_ID: 'team', VERCEL_PROJECT_ID: 'project', DEPLOY_TARGET: 'preview', DEPLOY_SHA: sha });
    delete process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_STEP_SUMMARY;
    let created = false;
    globalThis.fetch = async (url, options) => {
      assert.equal(url.searchParams.get('teamId'), 'team');
      if (options.method === 'POST') {
        assert.equal(url.pathname, '/v13/deployments');
        assert.equal(url.searchParams.has('prebuilt'), false, 'the shortcut bypasses project analytics route provisioning');
        const body = JSON.parse(options.body);
        assert.equal(body.version, 2);
        assert.equal(body.meta.githubCommitSha, sha);
        assert.ok(body.files.every(file => file.file.startsWith('.vercel/output/')));
        assert.equal(Buffer.from(body.files.find(file => file.file.endsWith('/static/index.html')).data, 'base64').toString(), '<html>verified CI output</html>');
        created = true;
        return Response.json({ id: 'deployment' });
      }
      return Response.json(url.pathname.startsWith('/v9/projects/') ? { name: 'permit-denied' } : { readyState: 'READY', url: 'preview.example.com' });
    };
    assert.equal(await deploy(), 'https://preview.example.com');
    assert.equal(created, true);
  } finally {
    process.chdir(cwd);
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
    await rm(root, { recursive: true, force: true });
  }
});
