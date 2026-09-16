import { readdir, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Upload only compiled files in Build Output API format. Let Vercel process
// that output normally so project integrations, including analytics, get routes.
export async function staticDeploymentFiles(directory) {
  const files = [{ file: '.vercel/output/config.json', data: Buffer.from(JSON.stringify({
    version: 3,
    routes: [
      { src: '/(.*)', headers: { 'referrer-policy': 'no-referrer' }, continue: true },
      { src: '/privacy/?', dest: '/privacy/index.html', headers: { 'cache-control': 'no-cache' } },
      { src: '/terms/?', dest: '/terms/index.html', headers: { 'cache-control': 'no-cache' } },
      { src: '/assets/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
      { src: '/catalog', status: 308, headers: { Location: '/catalog/' } },
      { src: '/catalog/', dest: '/catalog/index.html', headers: { 'cache-control': 'no-cache' } },
      { src: '/catalog/release.json', headers: { 'cache-control': 'no-store' }, continue: true },
      { src: '/designer', status: 308, headers: { Location: '/designer/' } },
      { src: '/designer/', dest: '/designer/index.html', headers: { 'cache-control': 'no-cache' } },
      { src: '/build.json', headers: { 'cache-control': 'no-store' }, continue: true },
      { handle: 'filesystem' },
      { src: '/catalog/(.*)', status: 404 },
      { src: '/designer/(.*)', status: 404 },
      { src: '/(.*)', dest: '/index.html' },
    ],
  })).toString('base64'), encoding: 'base64' }];
  async function visit(relative) {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Deployment output must not contain symlinks');
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) files.push({ file: `.vercel/output/static/${name}`, data: (await readFile(path.join(directory, name))).toString('base64'), encoding: 'base64' });
    }
  }
  await visit('');
  if (!files.some(file => file.file === '.vercel/output/static/index.html')) throw new Error('Missing built index.html');
  if (files.some(file => file.file === '.vercel/output/static/catalog/index.html') && !files.some(file => file.file === '.vercel/output/static/catalog/release.json')) throw new Error('Missing catalog release pointer');
  return files;
}

export async function deploy() {
  const { VERCEL_TOKEN: token, VERCEL_ORG_ID: teamId, VERCEL_PROJECT_ID: projectId, DEPLOY_TARGET: target } = process.env;
  if (!token || !teamId || !projectId || !['production', 'preview'].includes(target)) throw new Error('Missing or invalid deployment configuration');
  const pointer = JSON.parse(await readFile('dist/catalog/release.json', 'utf8'));
  if (!/^https:\/\/assets\.permitdenied\.app\/releases\/[a-f0-9]{64}\.json$/.test(pointer.url) || !/^[a-f0-9]{40}$/.test(process.env.DEPLOY_SHA || '') || pointer.commit !== process.env.DEPLOY_SHA) {
    throw new Error('Deployment requires a verified R2 catalog release for this commit');
  }
  async function api(endpoint, body) {
    const url = new URL(`https://api.vercel.com${endpoint}`);
    url.searchParams.set('teamId', teamId);
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Vercel HTTP ${response.status}: ${data.error?.code || 'unknown'}: ${data.error?.message || 'Request failed'}`);
    return data;
  }
  const project = await api(`/v9/projects/${projectId}`);
  const files = await staticDeploymentFiles('dist');
  const deployment = await api('/v13/deployments', {
    version: 2, name: project.name, project: projectId, files,
    ...(target === 'production' ? { target: 'production' } : {}),
    meta: { githubCommitSha: process.env.DEPLOY_SHA || '', githubCommitRef: process.env.DEPLOY_BRANCH || '' },
  });
  console.log(`Vercel deployment created: ${deployment.id}`);
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await api(`/v13/deployments/${deployment.id}`);
    if (result.readyState === 'READY') {
      if (result.aliasError) throw new Error(`Vercel alias failed: ${result.aliasError.message}`);
      const url = `https://${result.url}`;
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `url=${url}\n`);
      if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${target} deployment\n${url}\n`);
      console.log(`Deployment ready: ${url}`);
      return url;
    }
    if (['ERROR', 'CANCELED'].includes(result.readyState)) throw new Error(`Vercel deployment ${result.readyState}: ${result.errorMessage || result.errorCode || deployment.id}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error(`Timed out waiting for Vercel deployment ${deployment.id}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await deploy();
