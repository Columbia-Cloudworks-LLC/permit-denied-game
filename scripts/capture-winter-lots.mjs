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

/** Open a scene and frame the dozer at street zoom. */
async function load(target, origin, query) {
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

async function lookAt(page, spot) {
  await page.evaluate(({ x, y, zoom }) => window.__pd.lookAtWorld(x, y, 0, zoom), { x: spot.x, y: spot.y, zoom: ZOOM });
  await page.waitForTimeout(350);
}

/** Each overview scene, checked for the ground condition it should show. */
async function captureScenes(page, origin) {
  for (const shot of scenes) {
    await load(page, origin, shot.query);
    const condition = await page.evaluate(() => window.__pd.townSnapshot().groundCondition);
    if (condition !== shot.want) {
      throw new Error(`${shot.file} expected ${shot.want} ground, got ${condition}`);
    }
    await snap(page, shot.file);
  }
}

/** One close shot per lot identity the snow scene has; returns the identities captured. */
async function captureSnowLots(page) {
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
    await lookAt(page, lot);
    await snap(page, `snow-${identity}.png`);
  }
  return seen;
}

/** A close shot of the first ground patch with one of these covers; false when the scene has none. */
async function captureCover(page, covers, file) {
  const spot = await page.evaluate((wanted) => {
    const patch = window.__pd.townSnapshot().ground.find((g) => wanted.includes(g.cover));
    return patch ? { x: patch.x + patch.w * 0.5, y: patch.y + patch.d * 0.5 } : null;
  }, covers);
  if (!spot) return false;
  await lookAt(page, spot);
  await snap(page, file);
  return true;
}

function assertWinterCoverage(seen, driveway, tracks) {
  const required = [
    [seen.has("residence"), "missing snow residential lot capture"],
    [seen.has("shop") || seen.has("service"), "missing snow commercial lot capture"],
    [driveway, "missing driveway/parking capture"],
    [tracks, "missing tracks capture"],
  ];
  const missing = required.find(([captured]) => !captured);
  if (missing) throw new Error(missing[1]);
}

await withGameCapture(async ({ browser, openPage, origin }) => {
  const page = await openPage({ query: scenes[0].query });
  await mkdir(OUT, { recursive: true });
  await captureScenes(page, origin);
  await load(page, origin, scenes[0].query);
  const seen = await captureSnowLots(page);
  const driveway = await captureCover(page, ["driveway", "parking"], "snow-driveway.png");
  const tracks = await captureCover(page, ["tracks"], "snow-tracks.png");

  const mobile = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
  await injectConsent(mobile);
  await load(mobile, origin, scenes[0].query);
  await snap(mobile, "snow-mobile-landscape.png");
  await mobile.close();

  assertWinterCoverage(seen, driveway, tracks);
  console.log(`wrote winter lots to ${OUT} identities=${[...seen].join(",")}`);
});
