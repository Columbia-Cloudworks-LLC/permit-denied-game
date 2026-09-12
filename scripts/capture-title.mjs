import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';

// Match the published og:image dimensions. Capture the real production page,
// without scenario URLs, saved preferences, or screenshot-only game behavior.
const server = await preview({ preview: { host: '127.0.0.1', port: 4173, strictPort: true, open: false } });
let browser;
try {
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({
    viewport: { width: 1199, height: 630 }, deviceScaleFactor: 1,
    reducedMotion: 'reduce', colorScheme: 'dark', locale: 'en-US', timezoneId: 'UTC',
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error('Title page did not load successfully');
  await page.locator('.operator-menu.title-open .permit-paper.permit-ready').waitFor();
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor();
  await page.locator('#game-root canvas').waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
  });
  // Require consecutive identical frames: never publish a half-rendered canvas
  // or an unfinished title animation. A changing title fails instead of churning git.
  const options = { type: 'jpeg', quality: 90, animations: 'disabled', caret: 'hide' };
  let previous;
  let capture;
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(250);
    const current = await page.screenshot(options);
    if (previous?.equals(current)) { capture = current; break; }
    previous = current;
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join('\n')}`);
  if (!capture) throw new Error('Title screen did not settle into a stable image');
  await mkdir('public/social', { recursive: true });
  await writeFile('public/social/permit-denied-title.jpg', capture);
  console.log(`Captured title screen: 1199 × 630, ${capture.length} bytes`);
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
