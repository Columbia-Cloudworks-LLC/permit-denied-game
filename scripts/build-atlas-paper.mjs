/**
 * Builds the atlas paper art in `public/atlas/` from source photographs:
 *
 *   node scripts/build-atlas-paper.mjs <atlas-paper> <sheet-paper-a> <sheet-paper-b> <globe>
 *
 * A photographed sheet of folded paper becomes a shading overlay: its folds and wrinkles as
 * translucent black (shadow) and white (highlight) pixels, with the photo's own colour and uneven
 * lighting removed. Drawn over the map as an image inside its SVG, that gives real paper relief
 * without a blend mode or filter, which the atlas stack may not use (docs/campaign.md, Compositor
 * rule). Portrait photos are turned on their side so the centre fold runs top to bottom, where
 * the atlas unfolds. The globe is cut to a disc for the atlas cover.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const [atlasSrc, sheetA, sheetB, globeSrc] = process.argv.slice(2);
if (!atlasSrc || !sheetA || !sheetB || !globeSrc) {
  console.error('Usage: node scripts/build-atlas-paper.mjs <atlas-paper> <sheet-paper-a> <sheet-paper-b> <globe>');
  process.exit(1);
}
const out = 'public/atlas';
await mkdir(out, { recursive: true });

/**
 * Relief = each pixel against its blurred surroundings. `gain` sets how hard the wrinkles read;
 * `reach` is the blur radius, so a small one keeps only sharp creases and drops a scan's blotchy
 * tone; `grain` is the pre-blur that removes film grain.
 */
async function paperOverlay(src, file, { width, height, gain, reach = 28, grain = 1.5, alphaQuality = 80 }) {
  const meta = await sharp(src).metadata();
  const base = sharp(src).rotate(meta.height > meta.width ? 90 : 0).resize(width, height, { fit: 'fill' }).greyscale();
  // A light blur first drops film grain, which would otherwise cost most of the file size.
  const sharpPixels = await base.clone().blur(grain).raw().toBuffer();
  const smooth = await base.clone().blur(reach).raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const relief = (sharpPixels[i] - smooth[i]) * gain;
    const value = relief < 0 ? 0 : 255;
    // Shadows carry further than highlights on cream paper, so they get the larger share.
    const strength = Math.abs(relief) * (relief < 0 ? 1 : 0.8);
    // Ease the faintest relief out to nothing; a hard cut-off would band into blotches.
    const alpha = Math.min(255, Math.max(0, strength - 3));
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = value;
    rgba[i * 4 + 3] = alpha;
  }
  const info = await sharp(rgba, { raw: { width, height, channels: 4 } }).webp({ quality: 30, alphaQuality, effort: 6 }).toFile(`${out}/${file}`);
  console.log(`${file}: ${info.size} bytes`);
}

/** The globe photo sits on white: keep the disc, drop the surround. */
async function globeDisc(src, file, size) {
  const { data, info } = await sharp(src).resize(size, size, { fit: 'cover' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const c = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, far = Math.hypot(x - c, y - c) / c;
    const white = Math.min(data[i], data[i + 1], data[i + 2]);
    // Outside the disc the photo is white; fade those pixels out, and anything past the frame.
    if (far > 0.8 && white > 205) data[i + 3] = Math.max(0, Math.round((245 - white) * 6.4));
    if (far > 0.985) data[i + 3] = 0;
  }
  const done = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ quality: 82, alphaQuality: 90 }).toFile(`${out}/${file}`);
  console.log(`${file}: ${done.size} bytes`);
}

await paperOverlay(atlasSrc, 'paper-atlas.webp', { width: 1024, height: 585, gain: 3.7 });
// State sheets draw from two other photographs, and each region mirrors its pick its own way
// (overworldMap.ts `sheetPaper`), so opening another state unfolds a differently creased sheet.
await paperOverlay(sheetA, 'paper-sheet-a.webp', { width: 1024, height: 585, gain: 6, reach: 24, grain: 3 });
await paperOverlay(sheetB, 'paper-sheet-b.webp', { width: 1024, height: 585, gain: 2.8, reach: 9, grain: 1.8, alphaQuality: 62 });
await globeDisc(globeSrc, 'globe.webp', 420);
