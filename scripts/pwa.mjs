import sharp from 'sharp';

/** Shared PWA packaging constants and checks for the game entry point. */

export const PWA_THEME_COLOR = '#222a23';
export const PWA_THEME_RGB = [34, 42, 35];
export const PWA_NAME = 'PERMIT DENIED';
export const PWA_START_URL = '/';
export const PWA_SCOPE = '/';
export const PWA_ID = '/';
export const PWA_DISPLAY = 'fullscreen';
export const PWA_ORIENTATION = 'landscape-primary';
export const MASKABLE_ARTWORK_RATIO = 0.56;
export const GAME_LOGO = 'public/brand/PermitDenied-Logo_521x521.png';
export const PWA_ICON_DIR = 'public/pwa';
export const MANIFEST_FILE = 'public/manifest.webmanifest';
export const SERVICE_WORKER_FILE = 'sw.js';

export const PWA_ICONS = {
  'icon-192.png': { size: 192, maskable: false },
  'icon-512.png': { size: 512, maskable: false },
  'icon-maskable-512.png': { size: 512, maskable: true },
  'apple-touch-icon.png': { size: 180, maskable: false },
};

const OTHER_APP_PATHS = ['/catalog', '/designer', '/privacy', '/terms'];

export function assertSameOriginRef(value, field) {
  if (typeof value !== 'string' || !value) throw new Error(`${field} is missing`);
  if (value.startsWith('/')) {
    if (value.startsWith('//')) throw new Error(`${field} must stay on this origin: ${value}`);
    return;
  }
  let url;
  try { url = new URL(value); }
  catch { throw new Error(`${field} is not a valid URL: ${value}`); }
  if (url.origin !== 'https://permitdenied.app') throw new Error(`${field} escapes the production origin: ${value}`);
}

/** Fixed manifest fields, checked in order; each names what it requires. */
const MANIFEST_RULES = [
  [m => m.name === PWA_NAME && m.short_name === PWA_NAME, 'Manifest name must be PERMIT DENIED'],
  [m => m.id === PWA_ID, 'Manifest id must be /'],
  [m => m.start_url === PWA_START_URL, 'Manifest start_url must be /'],
  [m => m.scope === PWA_SCOPE, 'Manifest scope must be /'],
  [m => m.display === PWA_DISPLAY, 'Manifest display must be fullscreen'],
  [m => m.orientation === PWA_ORIENTATION, 'Manifest orientation must be landscape-primary'],
  [m => m.theme_color === PWA_THEME_COLOR && m.background_color === PWA_THEME_COLOR, 'Manifest colors must match the game theme'],
  [m => Array.isArray(m.categories) && m.categories.includes('games'), 'Manifest categories must include games'],
];

export function assertWebAppManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Manifest is missing or malformed');
  for (const [ok, message] of MANIFEST_RULES) if (!ok(manifest)) throw new Error(message);
  assertDisplayOverride(manifest.display_override);
  for (const field of ['id', 'start_url', 'scope']) assertSameOriginRef(manifest[field], field);
  assertInstallIcons(manifest.icons);
}

/** An optional display_override must still prefer fullscreen and never fall back to browser chrome. */
function assertDisplayOverride(override) {
  if (!Array.isArray(override)) return;
  if (override[0] !== 'fullscreen') throw new Error('display_override must prefer fullscreen');
  if (override.includes('browser') || override.includes('minimal-ui')) {
    throw new Error('display_override must not fall back to browser chrome');
  }
}

/** 192 and 512 any-purpose icons, a separate 512 maskable icon, all PNG on this origin. */
function assertInstallIcons(icons) {
  if (!Array.isArray(icons) || icons.length < 3) throw new Error('Manifest is missing install icons');
  const any192 = icons.some(icon => icon.sizes === '192x192' && (!icon.purpose || icon.purpose === 'any'));
  const any512 = icons.some(icon => icon.sizes === '512x512' && (!icon.purpose || /\bany\b/.test(icon.purpose)));
  const maskable = icons.find(icon => icon.sizes === '512x512' && /\bmaskable\b/.test(icon.purpose || ''));
  if (!any192 || !any512) throw new Error('Manifest needs 192 and 512 any-purpose PNG icons');
  if (!maskable || /\bany\b/.test(maskable.purpose)) throw new Error('Manifest needs a separate 512 maskable icon');
  for (const icon of icons) {
    if (icon.type && icon.type !== 'image/png') throw new Error(`Install icons must be PNG: ${icon.src}`);
    assertSameOriginRef(icon.src, `icon ${icon.src}`);
  }
}

export function htmlHasManifestLink(html) {
  return /rel=["']manifest["']/.test(html) && /href=["']\/manifest\.webmanifest["']/.test(html);
}

export function htmlKeepsIcoFavicon(html) {
  return /rel=["']icon["'][^>]*href=["']\/brand\/favicon\.ico["']/.test(html)
    || /href=["']\/brand\/favicon\.ico["'][^>]*rel=["']icon["']/.test(html);
}

export function htmlHasPngFavicon(html) {
  return /rel=["']icon["'][^>]*type=["']image\/png["']/.test(html)
    || /type=["']image\/png["'][^>]*rel=["']icon["']/.test(html);
}

export function htmlHasAppleTouchIcon(html) {
  return /rel=["']apple-touch-icon["']/.test(html);
}

export function otherAppPath(pathname) {
  return OTHER_APP_PATHS.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function pixelNear(actual, expected, tolerance = 8) {
  return Math.abs(actual[0] - expected[0]) <= tolerance
    && Math.abs(actual[1] - expected[1]) <= tolerance
    && Math.abs(actual[2] - expected[2]) <= tolerance;
}

export async function assertPngSize(file, size) {
  const info = await sharp(file).metadata();
  if (info.format !== 'png' || info.width !== size || info.height !== size) {
    throw new Error(`${file} must be a ${size}x${size} PNG`);
  }
}

export async function assertMaskableSafeZone(file, size = 512) {
  await assertPngSize(file, size);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const samples = [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1], [Math.floor(size / 2), 8], [8, Math.floor(size / 2)]];
  for (const [x, y] of samples) {
    if (!pixelNear(pixel(x, y), PWA_THEME_RGB)) {
      throw new Error(`${file} must keep theme-color padding outside Android's maskable safe zone`);
    }
  }
  if (pixelNear(pixel(Math.floor(size / 2), Math.floor(size / 2)), PWA_THEME_RGB)) {
    throw new Error(`${file} must keep the game artwork inside the maskable safe zone`);
  }
}
