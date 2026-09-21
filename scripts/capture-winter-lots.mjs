import { mkdir } from "node:fs/promises";
import { gameUrl, injectConsent, waitForGame, withGameCapture } from "./capture/harness.mjs";

const OUT = "artifacts/winter-lots";
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

await withGameCapture(async ({ browser, openPage, origin }) => {
  const page = await openPage({ query: scenes[0].query });
  await mkdir(OUT, { recursive: true });

  async function load(target, query) {
    await target.goto(gameUrl(origin, query), { waitUntil: "networkidle" });
    await waitForGame(target);
    await target.evaluate(() => {
      const game = window.__pd;
      const pose = game.dozerSnapshot();
      game.lookAtWorld(pose.x, pose.y, pose.heading, 1.15);
    });
    await target.waitForTimeout(400);
  }

  async function snap(target, file) {
    await target.screenshot({ path: `${OUT}/${file}`, type: "png" });
  }

  for (const shot of scenes) {
    await load(page, shot.query);
    const condition = await page.evaluate(() => window.__pd.townSnapshot().groundCondition);
    if (condition !== shot.want) {
      throw new Error(`${shot.file} expected ${shot.want} ground, got ${condition}`);
    }
    await snap(page, shot.file);
  }

  await load(page, scenes[0].query);
  const lots = await page.evaluate(() =>
    window.__pd.townSnapshot().lots.map((lot) => ({
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
    const patch = window.__pd.townSnapshot().ground.find((g) => g.cover === "driveway" || g.cover === "parking");
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
    const patch = window.__pd.townSnapshot().ground.find((g) => g.cover === "tracks");
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
  await injectConsent(mobile);
  await load(mobile, scenes[0].query);
  await snap(mobile, "snow-mobile-landscape.png");
  await mobile.close();

  if (!seen.has("residence")) throw new Error("missing snow residential lot capture");
  if (![...seen].some((id) => id === "shop" || id === "service")) throw new Error("missing snow commercial lot capture");
  if (!drivewayLot) throw new Error("missing driveway/parking capture");
  if (!tracksLot) throw new Error("missing tracks capture");
  console.log(`wrote winter lots to ${OUT} identities=${[...seen].join(",")}`);
});
