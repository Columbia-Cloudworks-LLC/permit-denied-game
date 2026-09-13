import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { digest, safeKey } from './core.mjs';

export function r2Store(bucket) {
  const { R2_ACCOUNT_ID: account, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
  if (!account || !accessKeyId || !secretAccessKey || !bucket) throw new Error('R2 account, bucket and scoped credentials are required');
  if (!/^[a-f0-9]{32}$/.test(account)) throw new Error('Invalid R2 account ID');
  const client = new S3Client({ region: 'auto', endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }, maxAttempts: 5 });
  return {
    async get(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
        return Buffer.from(await result.Body.transformToByteArray());
      } catch (e) { if (e.$metadata?.httpStatusCode === 404) return null; throw e; }
    },
    async head(key) {
      try { return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: safeKey(key) })); }
      catch (e) { if (e.$metadata?.httpStatusCode === 404) return null; throw e; }
    },
    async put(key, body, type = 'application/json') {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: safeKey(key), Body: body,
        ContentType: type, CacheControl: 'public, max-age=31536000, immutable', Metadata: { sha256: digest(body) } }));
    },
  };
}

export async function uploadVerified(store, key, bytes, type) {
  const sha = digest(bytes), prior = await store.head(key);
  if (prior && prior.ContentLength === bytes.length && prior.Metadata?.sha256 === sha) return false;
  await store.put(key, bytes, type);
  const check = await store.head(key);
  if (!check || check.ContentLength !== bytes.length || check.Metadata?.sha256 !== sha) throw new Error(`Upload verification failed: ${key}`);
  return true;
}

export async function pool(items, concurrency, action) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await action(items[next++]);
  }));
}
