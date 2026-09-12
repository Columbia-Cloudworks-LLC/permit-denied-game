import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { staticDeploymentFiles } from './deploy-vercel.mjs';

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
    assert.equal(config.routes.at(-1).dest, '/index.html');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('refuses an incomplete build', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'permit-deployment-'));
  try { await assert.rejects(staticDeploymentFiles(root), /index.html/); }
  finally { await rm(root, { recursive: true, force: true }); }
});
