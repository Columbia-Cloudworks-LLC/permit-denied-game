import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PWA_ICONS,
  SERVICE_WORKER_FILE,
  assertMaskableSafeZone,
  assertPngSize,
  assertWebAppManifest,
  htmlHasAppleTouchIcon,
  htmlHasManifestLink,
  htmlHasPngFavicon,
  htmlKeepsIcoFavicon,
} from './pwa.mjs';

const OTHER_PAGES = ['catalog/index.html', 'designer/index.html', 'privacy/index.html', 'terms/index.html'];

export async function verifyPwaBuild(root = 'dist') {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  for (const [ok, message] of GAME_HTML_RULES) if (!ok(html)) throw new Error(message);
  for (const page of OTHER_PAGES) {
    const other = await readFile(path.join(root, page), 'utf8');
    if (htmlHasManifestLink(other)) throw new Error(`${page} must not install as the game PWA`);
  }
  const manifest = await readManifest(root);
  assertWebAppManifest(manifest);
  await verifyIcons(root, manifest.icons);
  await verifyServiceWorker(root);
  await verifyServiceWorkerRegistration(root, html);
  console.log('PWA manifest, icons, and service worker verified');
}

/** The game page links the manifest and keeps its ICO, PNG and Apple touch icons. */
const GAME_HTML_RULES = [
  [htmlHasManifestLink, 'Game HTML does not link the web app manifest'],
  [htmlKeepsIcoFavicon, 'Game HTML dropped the ICO favicon'],
  [htmlHasPngFavicon, 'Game HTML is missing a PNG favicon'],
  [htmlHasAppleTouchIcon, 'Game HTML is missing apple-touch-icon'],
];

async function readManifest(root) {
  const source = await readFile(path.join(root, 'manifest.webmanifest'), 'utf8');
  try { return JSON.parse(source); }
  catch { throw new Error('Web app manifest is malformed JSON'); }
}

/** Every listed icon has its stated size, maskable art fits the safe zone, and every packaged icon exists. */
async function verifyIcons(root, icons) {
  for (const icon of icons) {
    const file = path.join(root, icon.src.replace(/^\//, ''));
    const size = Number(String(icon.sizes).split('x')[0]);
    await assertPngSize(file, size);
    if (icon.purpose === 'maskable') await assertMaskableSafeZone(file, size);
  }
  for (const [name, spec] of Object.entries(PWA_ICONS)) {
    await assertPngSize(path.join(root, 'pwa', name), spec.size);
  }
}

/** The worker precaches the shell and keeps the other pages off the game's navigation fallback. */
async function verifyServiceWorker(root) {
  const swPath = path.join(root, SERVICE_WORKER_FILE);
  await access(swPath);
  const sw = await readFile(swPath, 'utf8');
  if (!/precacheAndRoute|createHandlerBoundToURL/.test(sw)) {
    throw new Error('Service worker does not precache the application shell');
  }
  if (!['catalog', 'designer', 'privacy', 'terms'].every(page => sw.includes(page))) {
    throw new Error('Service worker must keep catalog, designer, privacy, and terms off the game navigation fallback');
  }
}

const entryScript = html => html.match(/<script[^>]*src="([^"]+\.js)"/)?.[1];
const readBundle = (root, src) => readFile(path.join(root, src.replace(/^\//, '')), 'utf8');

/** Only the game bundle registers the game service worker. */
async function verifyServiceWorkerRegistration(root, html) {
  const script = entryScript(html);
  if (!script) throw new Error('Game HTML is missing the production entry script');
  const bundle = await readBundle(root, script);
  if (!bundle.includes('serviceWorker') || !bundle.includes('sw.js')) {
    throw new Error('Production bundle does not register the game service worker');
  }
  for (const page of OTHER_PAGES) {
    const otherScript = entryScript(await readFile(path.join(root, page), 'utf8'));
    if (!otherScript) continue;
    const otherBundle = await readBundle(root, otherScript);
    if (otherBundle.includes('sw.js') && otherBundle.includes('serviceWorker.register')) {
      throw new Error(`${page} must not register the game service worker`);
    }
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/verify-pwa.mjs')) {
  await verifyPwaBuild(process.argv[2] || 'dist');
}
