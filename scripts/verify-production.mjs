import { facebookPageUrl } from './facebook-metadata.mjs';
import { readFile } from 'node:fs/promises';
import { verifyCatalogProduction } from './verify-catalog-production.mjs';
import { assertGithubVanityRedirect, GITHUB_VANITY_HOST } from './github-redirect.mjs';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const id = process.env.FACEBOOK_APP_ID?.trim();
if (!id || !/^\d+$/.test(id)) throw new Error('FACEBOOK_APP_ID is required to verify production');
const pageUrl = facebookPageUrl(process.env.FACEBOOK_PAGE_URL, true);
let lastError;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const response = await fetch('https://permitdenied.app/', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Production returned HTTP ${response.status}`);
    const html = await response.text();
    if (!html.includes(`property="fb:app_id" content="${id}"`)) throw new Error('Production Facebook metadata does not match the repository variable');
    if (!html.includes('rel="manifest"') || !html.includes('/manifest.webmanifest')) throw new Error('Production HTML does not link the web app manifest');
    const manifest = await fetch('https://permitdenied.app/manifest.webmanifest', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!manifest.ok) throw new Error('Production web app manifest is missing');
    const manifestJson = await manifest.json();
    if (manifestJson.name !== 'PERMIT DENIED' || manifestJson.display !== 'fullscreen') throw new Error('Production web app manifest is not the game PWA');
    const worker = await fetch('https://permitdenied.app/sw.js', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!worker.ok || !(await worker.text()).includes('precache')) throw new Error('Production service worker is missing');
    const entry = html.match(/<script[^>]*src="([^"]+)"/);
    if (!entry) throw new Error('Production entry script missing');
    const script = await fetch(new URL(entry[1], 'https://permitdenied.app'), { signal: AbortSignal.timeout(15000) });
    const client = await script.text();
    if (!client.includes(pageUrl)) throw new Error("Production Facebook page URL does not match the repository variable");
    if (!script.ok || !client.includes(`"${version}"`)) throw new Error('Production version does not match this release');
    if (!process.env.DEPLOY_SHA) throw new Error('DEPLOY_SHA is required to verify the catalog release');
    await verifyCatalogProduction('https://permitdenied.app', { version, commit: process.env.DEPLOY_SHA });
    for (const [path, title] of [['privacy', 'Privacy Policy'], ['terms', 'Terms of Use']]) {
      const policy = await fetch(`https://permitdenied.app/${path}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const body = await policy.text();
      if (!policy.ok || !body.includes(`<h1>${title}</h1>`) || body.includes('id="game-root"')) throw new Error(`Production ${path} route is not the legal page`);
    }
    const analytics = await fetch('https://permitdenied.app/_vercel/insights/script.js', { signal: AbortSignal.timeout(15000) });
    if (!analytics.ok || !(analytics.headers.get('content-type') || '').includes('javascript') || !(await analytics.text()).includes('beforeSend')) throw new Error('Production analytics script route is unavailable');
    for (const path of ['/', '/anything']) {
      assertGithubVanityRedirect(await fetch(`https://${GITHUB_VANITY_HOST}${path}`, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15000) }));
    }
    console.log(`Production ${version} and Facebook App ID verified`);
    process.exit(0);
  } catch (error) { lastError = error; }
  if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 5000));
}
throw lastError;
