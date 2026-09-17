import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GITHUB_VANITY_HOST } from './github-redirect.mjs';

export async function ensureGithubVanityDomain({
  token = process.env.VERCEL_TOKEN,
  teamId = process.env.VERCEL_ORG_ID,
  projectId = process.env.VERCEL_PROJECT_ID,
  request = fetch,
} = {}) {
  if (!token || !teamId || !projectId) throw new Error('Missing or invalid deployment configuration');
  async function api(endpoint, method = 'GET', body) {
    const url = new URL(`https://api.vercel.com${endpoint}`);
    url.searchParams.set('teamId', teamId);
    const response = await request(url, {
      method, signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok && !(method === 'GET' && response.status === 404)) {
      throw new Error(`Vercel HTTP ${response.status}: ${data.error?.code || 'unknown'}: ${data.error?.message || 'Request failed'}`);
    }
    return { ok: response.ok, data };
  }
  const existing = await api(`/v9/projects/${projectId}/domains/${encodeURIComponent(GITHUB_VANITY_HOST)}`);
  if (existing.ok) {
    if (existing.data.redirect) {
      await api(`/v9/projects/${projectId}/domains/${encodeURIComponent(GITHUB_VANITY_HOST)}`, 'PATCH', { redirect: null, redirectStatusCode: null });
    }
    return existing.data;
  }
  return (await api(`/v10/projects/${projectId}/domains`, 'POST', { name: GITHUB_VANITY_HOST })).data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const domain = await ensureGithubVanityDomain();
  console.log(`github.permitdenied.app attached${domain.verified === false ? ' (pending verification)' : ''}`);
}
