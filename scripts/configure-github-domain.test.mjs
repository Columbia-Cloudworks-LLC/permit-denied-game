import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureGithubVanityDomain } from './configure-github-domain.mjs';

test('refuses to attach without Vercel project credentials', async () => {
  await assert.rejects(ensureGithubVanityDomain({ token: '', teamId: 'team', projectId: 'project' }), /configuration/);
});

test('adds github.permitdenied.app when the project does not have it', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ path: url.pathname, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
    if (options.method === 'GET') return Response.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 });
    return Response.json({ name: 'github.permitdenied.app', verified: true });
  };
  const domain = await ensureGithubVanityDomain({ token: 'test', teamId: 'team', projectId: 'project', request });
  assert.equal(domain.name, 'github.permitdenied.app');
  assert.deepEqual(calls.map(call => call.method), ['GET', 'POST']);
  assert.equal(calls[1].path, '/v10/projects/project/domains');
  assert.deepEqual(calls[1].body, { name: 'github.permitdenied.app' });
});

test('does not re-add a verified hostname', async () => {
  let writes = 0;
  const request = async (_url, options) => {
    if (options.method !== 'GET') writes += 1;
    return Response.json({ name: 'github.permitdenied.app', verified: true });
  };
  await ensureGithubVanityDomain({ token: 'test', teamId: 'team', projectId: 'project', request });
  assert.equal(writes, 0);
});

test('leaves an attached hostname in place and clears a domain-level redirect so routing owns the path', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ path: url.pathname, method: options.method, body: options.body ? JSON.parse(options.body) : undefined });
    if (options.method === 'PATCH') return Response.json({ name: 'github.permitdenied.app', redirect: null, verified: true });
    return Response.json({ name: 'github.permitdenied.app', redirect: 'github.com', verified: true });
  };
  await ensureGithubVanityDomain({ token: 'test', teamId: 'team', projectId: 'project', request });
  assert.deepEqual(calls.map(call => call.method), ['GET', 'PATCH']);
  assert.deepEqual(calls[1].body, { redirect: null, redirectStatusCode: null });
});
