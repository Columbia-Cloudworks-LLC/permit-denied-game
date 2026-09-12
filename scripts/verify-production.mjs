import { readFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const id = process.env.FACEBOOK_APP_ID?.trim();
if (!id || !/^\d+$/.test(id)) throw new Error('FACEBOOK_APP_ID is required to verify production');
let lastError;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const response = await fetch('https://permitdenied.app/', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Production returned HTTP ${response.status}`);
    const html = await response.text();
    if (!html.includes(`property="fb:app_id" content="${id}"`)) throw new Error('Production Facebook metadata does not match the repository variable');
    const entry = html.match(/<script[^>]*src="([^"]+)"/);
    if (!entry) throw new Error('Production entry script missing');
    const script = await fetch(new URL(entry[1], 'https://permitdenied.app'), { signal: AbortSignal.timeout(15000) });
    if (!script.ok || !(await script.text()).includes(`"${version}"`)) throw new Error('Production version does not match this release');
    console.log(`Production ${version} and Facebook App ID verified`);
    process.exit(0);
  } catch (error) { lastError = error; }
  if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 5000));
}
throw lastError;
