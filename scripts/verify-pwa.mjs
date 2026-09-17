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
  if (!htmlHasManifestLink(html)) throw new Error('Game HTML does not link the web app manifest');
  if (!htmlKeepsIcoFavicon(html)) throw new Error('Game HTML dropped the ICO favicon');
  if (!htmlHasPngFavicon(html)) throw new Error('Game HTML is missing a PNG favicon');
  if (!htmlHasAppleTouchIcon(html)) throw new Error('Game HTML is missing apple-touch-icon');

  for (const page of OTHER_PAGES) {
    const other = await readFile(path.join(root, page), 'utf8');
    if (htmlHasManifestLink(other)) throw new Error(`${page} must not install as the game PWA`);
  }

  const manifestSource = await readFile(path.join(root, 'manifest.webmanifest'), 'utf8');
  let manifest;
  try { manifest = JSON.parse(manifestSource); }
  catch { throw new Error('Web app manifest is malformed JSON'); }
  assertWebAppManifest(manifest);

  for (const icon of manifest.icons) {
    const file = path.join(root, icon.src.replace(/^\//, ''));
    const size = Number(String(icon.sizes).split('x')[0]);
    await assertPngSize(file, size);
    if (icon.purpose === 'maskable') await assertMaskableSafeZone(file, size);
  }
  for (const [name, spec] of Object.entries(PWA_ICONS)) {
    await assertPngSize(path.join(root, 'pwa', name), spec.size);
  }

  const swPath = path.join(root, SERVICE_WORKER_FILE);
  await access(swPath);
  const sw = await readFile(swPath, 'utf8');
  if (!/precacheAndRoute|createHandlerBoundToURL/.test(sw)) {
    throw new Error('Service worker does not precache the application shell');
  }
  if (!/catalog/.test(sw) || !/designer/.test(sw) || !/privacy/.test(sw) || !/terms/.test(sw)) {
    throw new Error('Service worker must keep catalog, designer, privacy, and terms off the game navigation fallback');
  }

  const script = html.match(/<script[^>]*src="([^"]+\.js)"/);
  if (!script) throw new Error('Game HTML is missing the production entry script');
  const bundle = await readFile(path.join(root, script[1].replace(/^\//, '')), 'utf8');
  if (!bundle.includes('serviceWorker') || !bundle.includes('sw.js')) {
    throw new Error('Production bundle does not register the game service worker');
  }
  for (const page of OTHER_PAGES) {
    const other = await readFile(path.join(root, page), 'utf8');
    const otherScript = other.match(/<script[^>]*src="([^"]+\.js)"/);
    if (!otherScript) continue;
    const otherBundle = await readFile(path.join(root, otherScript[1].replace(/^\//, '')), 'utf8');
    if (otherBundle.includes('sw.js') && otherBundle.includes('serviceWorker.register')) {
      throw new Error(`${page} must not register the game service worker`);
    }
  }

  console.log('PWA manifest, icons, and service worker verified');
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/verify-pwa.mjs')) {
  await verifyPwaBuild(process.argv[2] || 'dist');
}
