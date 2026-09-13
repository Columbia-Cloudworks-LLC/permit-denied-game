import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { digest } from './catalog/core.mjs';
import { r2Store, uploadVerified } from './catalog/storage.mjs';

const config = JSON.parse(await readFile('scripts/catalog/cloudflare.json', 'utf8'));
if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCOUNT_ID !== config.accountId) throw new Error('Different Cloudflare account refused');
process.env.R2_ACCOUNT_ID = config.accountId;
const bytes = Buffer.from(JSON.stringify({ schema: 1, purpose: 'permit-denied-catalog-storage-verification' }));
const key = `objects/${digest(bytes)}.json`;
for (const bucket of [config.publicBucket, config.privateBucket]) {
  const store = r2Store(bucket);
  await uploadVerified(store, key, bytes, 'application/json');
  assert.deepEqual(await store.get(key), bytes, 'Stored bytes differ');
  assert.equal(await uploadVerified(store, key, bytes, 'application/json'), false, 'Repeated upload should be deduplicated');
  console.log(`${bucket}: write, metadata, exact readback, and idempotent reuse verified`);
}
