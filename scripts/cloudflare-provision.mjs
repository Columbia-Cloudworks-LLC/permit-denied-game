import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile('scripts/catalog/cloudflare.json', 'utf8'));
const cors = JSON.parse(await readFile('scripts/catalog/cors.json', 'utf8'));
const apply = process.argv.includes('--apply');
const attach = process.argv.includes('--attach-domain');
const account = `/accounts/${config.accountId}`;
if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCOUNT_ID !== config.accountId) throw new Error('Different Cloudflare account refused');
if (!apply) {
  console.log(JSON.stringify({ accountId: config.accountId, createIfMissing: [config.publicBucket, config.privateBucket], storageClass: 'Standard',
    publicCors: cors, attachDomain: attach ? config.publicOrigin : false, privateBucketPublicAccess: false,
    dnsMigration: 'Not performed by this script. Preserve and verify the existing zone first.' }, null, 2));
  process.exit(0);
}
if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error('A business-account provisioning token is required in CLOUDFLARE_API_TOKEN; the read-only Wrangler login cannot provision R2');
async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method, headers: {
    Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json',
  }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(`Cloudflare ${method} ${path}: HTTP ${response.status}; codes ${data.errors?.map(e => e.code).join(',')}`);
  return data.result;
}
for (const bucket of [config.publicBucket, config.privateBucket]) {
  const listing = await api(`${account}/r2/buckets`);
  if (!listing.buckets?.some(b => b.name === bucket)) await api(`${account}/r2/buckets`, 'POST', { name: bucket, storageClass: 'Standard' });
  console.log(`Bucket ready: ${bucket}`);
}
// Do not attach any domain to the evidence/cache bucket.
await api(`${account}/r2/buckets/${config.publicBucket}/cors`, 'PUT', cors);
console.log('Public bucket CORS configured for GET/HEAD only');
if (attach) {
  const zones = await api(`/zones?account.id=${config.accountId}&name=${config.domain}`);
  if (zones.length !== 1 || zones[0].status !== 'active') throw new Error('An active, verified business-account zone is required before attaching the public domain');
  const domain = new URL(config.publicOrigin).hostname;
  const existing = await api(`${account}/r2/buckets/${config.publicBucket}/domains/custom`);
  if (!existing.domains?.some(d => d.domain === domain && d.enabled)) {
    await api(`${account}/r2/buckets/${config.publicBucket}/domains/custom`, 'POST', { domain, enabled: true, zoneId: zones[0].id, minTLS: '1.2' });
  }
  console.log(`Public domain attached: ${domain}`);
}
