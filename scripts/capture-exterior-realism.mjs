import { captureShots } from "./capture/harness.mjs";

/**
 * 1080p evidence for the exterior realism pass: rooftop kits and facades on focused test pads,
 * and whole towns in each climate. Needs a production build (`npm run build:dist`).
 * `node scripts/capture-exterior-realism.mjs [name-filter]`
 */
const OUT = "artifacts/exterior-realism";
const pad = (id, zoom = 1.5) => ({ file: `pad-${id}.png`, query: `testAsset=building:${id}`, pad: true, zoom });
const town = (file, query, mode = "street") => ({ file, query, mode });

const SHOTS = [
  pad("roadside-diner", 2), pad("small-grocery", 1.8), pad("data-hall", 1.3), pad("mid-rise-office-slab", 1.2),
  pad("walkup", 1.8), pad("ranch", 2.2), pad("cold-storage-depot", 1.2), pad("motel-room-block", 1.6), pad("city-hall", 1.2),
  // Driven shots: the dozer rams the pad's building so the roof plant comes down.
  { ...pad("hardware-store", 1.7), file: "breach-hardware-store.png", ram: 5200 },
  { ...pad("small-grocery", 1.7), file: "breach-small-grocery.png", ram: 6500 },
  town("sonoran-winter.png", "mode=sandbox&region=US-AZ&county=2&season=winter"),
  town("sonoran-summer-haboob.png", "mode=sandbox&region=US-AZ&county=2&season=summer&weather=dust"),
  town("sonoran-monsoon.png", "mode=sandbox&region=US-AZ&county=4&season=summer&weather=storm"),
  town("canyonlands-overview.png", "sandbox=1&level=county&seed=19&biome=arid-scrub&climate=canyonlands&season=summer", "overview"),
  town("canyonlands-street.png", "sandbox=1&level=village&seed=19&biome=arid-scrub&climate=canyonlands&season=summer"),
  town("gulf-summer.png", "mode=sandbox&region=US-FL&county=4&season=summer"),
  town("temperate-winter.png", "mode=sandbox&region=US-IL&county=5&season=winter"),
  town("plains-overview.png", "mode=sandbox&region=US-KS&county=1&season=summer", "overview"),
  town("alpine-overview.png", "mode=sandbox&region=US-CO&county=2&season=autumn", "overview"),
  town("sonoran-overview.png", "mode=sandbox&region=US-AZ&county=1&season=summer", "overview"),
  town("arizona-suburb.png", "mode=sandbox&region=US-AZ&county=4&season=summer"),
];

const filter = process.argv[2];
const shots = filter ? SHOTS.filter((shot) => shot.file.includes(filter)) : SHOTS;
if (!shots.length) throw new Error(`no shot matches ${filter}`);

await captureShots(OUT, shots, async (page, shot) => {
  // Shots are of the world: the HUD and the debug binder stay out of frame.
  await page.addStyleTag({ content: "body > *:not(#game-root), #game-root > *:not(canvas) { display: none !important; }" });
  await page.evaluate(({ pad, zoom, mode }) => {
    const game = window.__pd;
    // A focused pad parks the dozer clear of its subject; keep it there and only zoom.
    if (pad) game.frameDozer(zoom);
    else game.lookAtTown(mode);
  }, shot);
  await page.waitForTimeout(900);
  if (shot.ram) {
    // Blade down, full ahead into the subject; the camera follows the dozer.
    await page.locator("#game-root canvas").focus();
    await page.keyboard.down("Space");
    await page.keyboard.down("w");
    await page.waitForTimeout(shot.ram);
    await page.screenshot({ path: `${OUT}/${shot.file.replace(".png", "-mid.png")}` });
    await page.waitForTimeout(1500);
    await page.keyboard.up("w");
    await page.keyboard.up("Space");
  }
  await page.screenshot({ path: `${OUT}/${shot.file}` });
  console.log(`${shot.file}: ${JSON.stringify(await page.evaluate(() => {
    const { climateId, look, frozen, groundCondition, weather, hazard } = window.__pd.townSnapshot();
    return { climateId, look, frozen, groundCondition, weather, hazard };
  }))}`);
}, { viewport: { width: 1920, height: 1080 } });
