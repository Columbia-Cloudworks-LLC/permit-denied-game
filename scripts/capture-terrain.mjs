import { chromium } from "playwright";
import { preview } from "vite";
import { mkdir } from "node:fs/promises";

const OUT = "artifacts/terrain";
const BASE = "http://127.0.0.1:4176";

const shots = [
  { file: "d10-seed19.png", query: "sandbox=1&district=d10&seed=19" },
  { file: "plain-fields.png", query: "sandbox=1&district=d10&seed=334353&topology=curve-farm" },
  { file: "conifer-forest.png", query: "sandbox=1&district=d10&seed=1&topology=tjunction" },
  { file: "winter-lots.png", query: "sandbox=1&district=d10&seed=1&topology=tjunction" },
  { file: "clear-lots.png", query: "sandbox=1&district=d10&seed=19&topology=curve-farm" },
  { file: "downtown.png", query: "mode=challenge&seed=19&level=city-downtown" },
  { file: "classic.png", query: "seed=19" },
];

const server = await preview({ preview: { host: "127.0.0.1", port: 4176, strictPort: true, open: false } });
let browser;
try {
  browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    localStorage.setItem("pd.terms", "2026-09-13");
    localStorage.setItem("pd.analytics", "declined");
  });
  await mkdir(OUT, { recursive: true });
  for (const shot of shots) {
    await page.goto(`${BASE}/?${shot.query}`, { waitUntil: "networkidle" });
    await page.locator("#game-root canvas").waitFor();
    await page.waitForFunction(() => window.__pd?.town && window.__pd.lookAtWorld);
    await page.evaluate(() => {
      const game = window.__pd;
      game.lookAtWorld(game.dozer.x, game.dozer.y, game.dozer.heading, 1.15);
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${shot.file}`, type: "png" });
  }
} finally {
  await browser?.close();
  await server.close();
}
