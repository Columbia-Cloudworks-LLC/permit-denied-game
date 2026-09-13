import { spawnSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolveNs } from 'node:dns/promises';

// Read only. OAuth output is captured in memory, never printed or written.
// Project operations are pinned to the business account in this public config.
const config = JSON.parse(await readFile('scripts/catalog/cloudflare.json', 'utf8'));
const oauthEnvironment = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG: 'log', WRANGLER_LOG_PATH: 'artifacts/wrangler-logs' };
delete oauthEnvironment.CLOUDFLARE_API_TOKEN;
const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'], {
  encoding: 'utf8', windowsHide: true, env: oauthEnvironment,
});
if (result.status !== 0) throw new Error('Wrangler credentials are unavailable; run wrangler login first');
let token;
try { token = JSON.parse(result.stdout).token; } catch { throw new Error('Unable to read Wrangler credentials'); }
if (!token) throw new Error('An OAuth or API token is required');
async function get(path, credential = token) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${credential}` }, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok || data.success === false) return { available: false, status: response.status, codes: data.errors?.map(e => e.code) };
  return { available: true, data: data.result };
}
const zones = await get(`/zones?account.id=${config.accountId}&name=${config.domain}`);
const buckets = await get(`/accounts/${config.accountId}/r2/buckets`, process.env.CLOUDFLARE_API_TOKEN || token);
const report = { accountId: config.accountId, domain: config.domain, nameservers: await resolveNs(config.domain).catch(error => ({ error: error.code })),
  zones: zones.available ? zones.data.map(z => ({ id: z.id, name: z.name, status: z.status, nameservers: z.name_servers })) : zones,
  r2: buckets.available ? buckets.data : buckets };
await mkdir('artifacts/cloudflare', { recursive: true });
await writeFile('artifacts/cloudflare/status.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
