import { chromium } from "playwright";
import { preview } from "vite";
import { mkdir } from "node:fs/promises";

const OUT = "artifacts/winter-lots";
const BASE = "http://127.0.0.1:4177";
const ZOOM = 1.15;

const scenes = [
  {
    file: "snow-overview.png",
    query: "sandbox=1&district=d10&seed=1&topology=tjunction",
    want: "snow",
  },
  {
    file: "clear-overview.png",
    query: "sandbox=1&district=d10&seed=19&topology=curve-farm",
    want: "clear",
  },
];

const snowIdentities = ["residence", "shop", "farm", "contractor", "service", "utility"];

const server = await preview({ preview: { host: "127.0.0.1", port: 4177, strictPort: true, open: false } });
let browser;
try {
  browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    localStorage.setItem("pd.terms", "2026-09-13");
    localStorage.setItem("pd.analytics", "declined");
  });
  await mkdir(OUT, { recursive: true });

  for (const shot of scenes) {
    await load(page, shot.query);
    const condition = await page.evaluate(() => window.__pd.town.groundCondition);
    if (condition !== shot.want) {
      throw new Error(`${shot.file} expected ${shot.want} ground, got ${condition}`);
    }
    await snap(page, shot.file);
  }

  await load(page, scenes[0].query);
  const lots = await page.evaluate(() =>
    window.__pd.town.lots.map((lot) => ({
      id: lot.id,
      identity: lot.identity,
      x: lot.x + lot.w * 0.5,
      y: lot.y + lot.d * 0.5,
    })),
  );
  const seen = new Set();
  for (const identity of snowIdentities) {
    const lot = lots.find((entry) => entry.identity === identity);
    if (!lot) continue;
    seen.add(identity);
    await page.evaluate(
      ({ x, y, zoom }) => window.__pd.lookAtWorld(x, y, 0, zoom),
      { x: lot.x, y: lot.y, zoom: ZOOM },
    );
    await page.waitForTimeout(350);
    await snap(page, `snow-${identity}.png`);
  }

  const drivewayLot = await page.evaluate(() => {
    const town = window.__pd.town;
    const patch = town.ground.find((g) => g.cover === "driveway" || g.cover === "parking");
    if (!patch) return null;
    return { x: patch.x + patch.w * 0.5, y: patch.y + patch.d * 0.5, cover: patch.cover };
  });
  if (drivewayLot) {
    await page.evaluate(
      ({ x, y, zoom }) => window.__pd.lookAtWorld(x, y, 0, zoom),
      { x: drivewayLot.x, y: drivewayLot.y, zoom: ZOOM },
    );
    await page.waitForTimeout(350);
    await snap(page, "snow-driveway.png");
  }

  const tracksLot = await page.evaluate(() => {
    const town = window.__pd.town;
    const patch = town.ground.find((g) => g.cover === "tracks");
    if (!patch) return null;
    return { x: patch.x + patch.w * 0.5, y: patch.y + patch.d * 0.5 };
  });
  if (tracksLot) {
    await page.evaluate(
      ({ x, y, zoom }) => window.__pd.lookAtWorld(x, y, 0, zoom),
      { x: tracksLot.x, y: tracksLot.y, zoom: ZOOM },
    );
    await page.waitForTimeout(350);
    await snap(page, "snow-tracks.png");
  }

  const mobile = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
  await mobile.addInitScript(() => {
    localStorage.setItem("pd.terms", "2026-09-13");
    localStorage.setItem("pd.analytics", "declined");
  });
  await load(mobile, scenes[0].query);
  await snap(mobile, "snow-mobile-landscape.png");
  await mobile.close();

  if (!seen.has("residence")) throw new Error("missing snow residential lot capture");
  if (![...seen].some((id) => id === "shop" || id === "service")) throw new Error("missing snow commercial lot capture");
  if (!drivewayLot) throw new Error("missing driveway/parking capture");
  if (!tracksLot) throw new Error("missing tracks capture");
  console.log(`wrote winter lots to ${OUT} identities=${[...seen].join(",")}`);
} finally {
  await browser?.close();
  await server.close();
}

async function load(page, query) {
  await page.goto(`${BASE}/?${query}`, { waitUntil: "networkidle" });
  await page.locator("#game-root canvas").waitFor();
  await page.waitForFunction(() => window.__pd?.town && window.__pd.lookAtWorld);
  await page.evaluate(() => {
    const game = window.__pd;
    game.lookAtWorld(game.dozer.x, game.dozer.y, game.dozer.heading, 1.15);
  });
  await page.waitForTimeout(400);
}

async function snap(page, file) {
  await page.screenshot({ path: `${OUT}/${file}`, type: "png" });
}
