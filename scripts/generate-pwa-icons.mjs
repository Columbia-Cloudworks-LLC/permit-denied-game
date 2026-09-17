import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { GAME_LOGO, MASKABLE_ARTWORK_RATIO, PWA_ICON_DIR, PWA_ICONS, PWA_THEME_RGB } from './pwa.mjs';

const theme = { r: PWA_THEME_RGB[0], g: PWA_THEME_RGB[1], b: PWA_THEME_RGB[2], alpha: 1 };

export async function generatePwaIcons(outputDir = PWA_ICON_DIR, source = GAME_LOGO) {
  await mkdir(outputDir, { recursive: true });
  for (const [name, spec] of Object.entries(PWA_ICONS)) {
    const dest = path.join(outputDir, name);
    if (spec.maskable) {
      const inner = Math.round(spec.size * MASKABLE_ARTWORK_RATIO);
      const artwork = await sharp(source)
        .resize(inner, inner, { fit: 'contain', background: theme })
        .png()
        .toBuffer();
      await sharp({ create: { width: spec.size, height: spec.size, channels: 4, background: theme } })
        .composite([{ input: artwork, gravity: 'center' }])
        .png()
        .toFile(dest);
    } else {
      await sharp(source)
        .resize(spec.size, spec.size, { fit: 'contain', background: theme })
        .png()
        .toFile(dest);
    }
  }
  return outputDir;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/generate-pwa-icons.mjs')) {
  await generatePwaIcons();
  console.log(`Wrote PWA icons to ${PWA_ICON_DIR}`);
}
