import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PWA_THEME_COLOR,
  assertMaskableSafeZone,
  assertPngSize,
  assertSameOriginRef,
  assertWebAppManifest,
  htmlHasAppleTouchIcon,
  htmlHasManifestLink,
  htmlHasPngFavicon,
  htmlKeepsIcoFavicon,
} from './pwa.mjs';
import { generatePwaIcons } from './generate-pwa-icons.mjs';
import { verifyPwaBuild } from './verify-pwa.mjs';

const validManifest = {
  id: '/',
  name: 'PERMIT DENIED',
  short_name: 'PERMIT DENIED',
  start_url: '/',
  scope: '/',
  display: 'fullscreen',
  display_override: ['fullscreen', 'standalone'],
  orientation: 'landscape-primary',
  theme_color: PWA_THEME_COLOR,
  background_color: PWA_THEME_COLOR,
  categories: ['games'],
  icons: [
    { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

test('accepts the game install manifest and rejects origin escapes', () => {
  assert.doesNotThrow(() => assertWebAppManifest(validManifest));
  assert.throws(() => assertWebAppManifest({ ...validManifest, display: 'browser' }), /fullscreen/);
  assert.throws(() => assertWebAppManifest({
    ...validManifest,
    icons: validManifest.icons.map(icon => icon.purpose === 'maskable' ? { ...icon, purpose: 'any maskable' } : icon),
  }), /separate 512 maskable/);
  assert.throws(() => assertSameOriginRef('https://example.com/', 'start_url'), /production origin/);
  assert.throws(() => assertSameOriginRef('//evil.example/app', 'id'), /origin/);
});

test('requires the game HTML to link the manifest without dropping the ICO favicon', () => {
  const html = '<link rel="icon" type="image/x-icon" href="/brand/favicon.ico" /><link rel="icon" type="image/png" sizes="192x192" href="/pwa/icon-192.png" /><link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png" /><link rel="manifest" href="/manifest.webmanifest" />';
  assert.equal(htmlHasManifestLink(html), true);
  assert.equal(htmlKeepsIcoFavicon(html), true);
  assert.equal(htmlHasPngFavicon(html), true);
  assert.equal(htmlHasAppleTouchIcon(html), true);
  assert.equal(htmlHasManifestLink('<link rel="icon" href="/brand/favicon.ico" />'), false);
});

test('committed and generated maskable icons keep artwork inside the Android safe zone', async () => {
  await assertPngSize('public/pwa/icon-192.png', 192);
  await assertPngSize('public/pwa/icon-512.png', 512);
  await assertMaskableSafeZone('public/pwa/icon-maskable-512.png');
  await assertPngSize('public/pwa/apple-touch-icon.png', 180);
  const root = await mkdtemp(path.join(tmpdir(), 'permit-pwa-icons-'));
  try {
    await generatePwaIcons(root);
    await assertMaskableSafeZone(path.join(root, 'icon-maskable-512.png'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('built PWA check fails when the service worker is missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'permit-pwa-dist-'));
  try {
    await mkdir(path.join(root, 'assets'), { recursive: true });
    await mkdir(path.join(root, 'pwa'), { recursive: true });
    await mkdir(path.join(root, 'catalog'), { recursive: true });
    await mkdir(path.join(root, 'designer'), { recursive: true });
    await mkdir(path.join(root, 'privacy'), { recursive: true });
    await mkdir(path.join(root, 'terms'), { recursive: true });
    await writeFile(path.join(root, 'index.html'), '<link rel="icon" type="image/x-icon" href="/brand/favicon.ico"><link rel="icon" type="image/png" href="/pwa/icon-192.png"><link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest"><script src="/assets/game.js"></script>');
    await writeFile(path.join(root, 'catalog/index.html'), '<title>catalog</title>');
    await writeFile(path.join(root, 'designer/index.html'), '<title>designer</title>');
    await writeFile(path.join(root, 'privacy/index.html'), '<title>privacy</title>');
    await writeFile(path.join(root, 'terms/index.html'), '<title>terms</title>');
    await writeFile(path.join(root, 'manifest.webmanifest'), JSON.stringify(validManifest));
    await writeFile(path.join(root, 'assets/game.js'), 'navigator.serviceWorker.register("/sw.js")');
    for (const name of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
      await copyFile(path.join('public/pwa', name), path.join(root, 'pwa', name));
    }
    await assert.rejects(() => verifyPwaBuild(root), /ENOENT|no such file|service worker/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
