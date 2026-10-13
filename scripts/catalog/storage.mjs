import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { digest, safeKey } from './core.mjs';

/** Account and scoped keys from the environment; all are required and the account must be well-formed. */
export function r2Credentials(env, bucket) {
  const { R2_ACCOUNT_ID: account, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (![account, accessKeyId, secretAccessKey, bucket].every(Boolean)) throw new Error('R2 account, bucket and scoped credentials are required');
  if (!/^[a-f0-9]{32}$/.test(account)) throw new Error('Invalid R2 account ID');
  return { account, accessKeyId, secretAccessKey };
}

/** R2 answers a missing key with a 404; anything else is a real failure. */
export function isNotFound(error) {
  return /** @type {{ $metadata?: { httpStatusCode?: number } }} */ (error)?.$metadata?.httpStatusCode === 404;
}

/** Null for a missing key, rethrowing every other failure. */
async function orNullWhenMissing(request) {
  try { return await request(); }
  catch (e) { if (isNotFound(e)) return null; throw e; }
}

export function r2Store(bucket) {
  const { account, accessKeyId, secretAccessKey } = r2Credentials(process.env, bucket);
  const client = new S3Client({ region: 'auto', endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }, maxAttempts: 5 });
  return {
    get(key) {
      return orNullWhenMissing(async () => {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
        if (!result.Body) throw new Error('R2 get returned no body');
        return Buffer.from(await result.Body.transformToByteArray());
      });
    },
    head(key) {
      return orNullWhenMissing(() => client.send(new HeadObjectCommand({ Bucket: bucket, Key: safeKey(key) })));
    },
    async put(key, body, type = 'application/json') {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: safeKey(key), Body: body,
        ContentType: type, CacheControl: 'public, max-age=31536000, immutable', Metadata: { sha256: digest(body) } }));
    },
  };
}

export async function uploadVerified(store, key, bytes, type) {
  const sha = digest(bytes), prior = await store.head(key);
  if (matchesUpload(prior, bytes, sha)) return false;
  await store.put(key, bytes, type);
  for (let attempt = 0; attempt < 5; attempt++) {
    const check = await store.head(key);
    if (matchesUpload(check, bytes, sha)) return true;
    await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
  }
  throw new Error(`Upload verification failed: ${key}`);
}

/**
 * @param {{ ContentLength?: number, Metadata?: { sha256?: string } } | null} object
 * @param {Uint8Array} bytes
 * @param {string} sha
 */
function matchesUpload(object, bytes, sha) {
  return !!object && object.ContentLength === bytes.length && object.Metadata?.sha256 === sha;
}

export async function pool(items, concurrency, action) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await action(items[next++]);
  }));
}
