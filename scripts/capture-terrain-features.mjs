import { chromium } from "playwright";
import { preview } from "vite";
import { mkdir, writeFile } from "node:fs/promises";

const OUT = "/cursor/stores/bc-524f4be0-4e64-4fbf-b510-6f6f7ef1c582/media/terrain-features";
const BASE = "http://127.0.0.1:4174";

const shots = [
  {
    file: "agricultural-field.png",
    query: "sandbox=1&district=d10&seed=334353&topology=curve-farm",
    aim: "field",
    note: "agricultural-plain crop field",
  },
  {
    file: "forest-edge-core.png",
    query: "sandbox=1&district=d10&seed=1&topology=tjunction",
    aim: "forest",
    note: "dense forest core with destructible edge",
  },
  {
    file: "pond-or-river.png",
    query: "sandbox=1&district=d10&seed=600&topology=county",
    aim: "water",
    note: "lake or pond beside the lot",
  },
  {
    file: "tree-destruction.png",
    query: "sandbox=1&district=d10&seed=1&topology=tjunction",
    aim: "tree",
    smash: true,
    note: "oak/pine topple and wood debris",
  },
  {
    file: "crop-flattening.png",
    query: "sandbox=1&district=d10&seed=334353&topology=curve-farm",
    aim: "field",
    flatten: true,
    note: "blade/tracks churn crop rows",
  },
  {
    file: "failed-traversal.png",
    query: "sandbox=1&district=d10&seed=600&topology=county",
    aim: "blocked",
    note: "dozer stopped at water or forest core",
  },
];

const server = await preview({ preview: { host: "127.0.0.1", port: 4174, strictPort: true, open: false } });
let browser;
const log = [];
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
    await page.waitForFunction(() => window.__pd?.town?.features);
    await page.waitForTimeout(250);
    await page.evaluate(async (kind) => {
      const game = window.__pd;
      const town = game.town;
      const forest = town.features.find((f) => f.kind === "forest");
      const water = town.features.find((f) => f.kind === "pond" || f.kind === "lake" || f.kind === "river");
      const fields = town.features.filter((f) => f.kind === "field");
      const field =
        fields.find((f) => f.state === "mature") ??
        fields.find((f) => f.state === "short") ??
        fields.find((f) => f.state === "stubble") ??
        fields[0];
      const tree = town.props.find((p) => p.assetId === "oak" || p.assetId === "pine");
      const look = (x, y, heading = 0, zoom = 1.45) => game.lookAtWorld(x, y, heading, zoom);
      if (kind === "field" && field) look(field.x + field.w * 0.5, field.y + field.d * 0.5, field.heading);
      else if (kind === "forest" && forest) look(forest.cx + forest.coreR + 2.4, forest.cy, Math.PI);
      else if (kind === "water" && water) {
        if (water.kind === "river") look(water.path[1].x + 2.4, water.path[1].y, 0);
        else {
          const maxX = Math.max(...water.poly.map((p) => p.x));
          const cy = water.poly.reduce((s, p) => s + p.y, 0) / water.poly.length;
          look(maxX + 3.4, cy, Math.PI);
        }
      } else if (kind === "tree" && tree) look(tree.x - 1.8, tree.y + tree.d * 0.5, 0, 1.7);
      else if (kind === "blocked") {
        if (forest) look(forest.cx - forest.coreR - 1.8, forest.cy, 0);
        else if (water && water.kind !== "river") {
          const minX = Math.min(...water.poly.map((p) => p.x));
          const cy = water.poly.reduce((s, p) => s + p.y, 0) / water.poly.length;
          look(minX - 3.2, cy, 0);
        }
      }
      await document.fonts.ready;
    }, shot.aim);
    await page.waitForTimeout(500);
    if (shot.smash) {
      await page.evaluate(() => {
        const game = window.__pd;
        const tree = game.town.props.find((p) => p.assetId === "oak" || p.assetId === "pine");
        if (!tree) return;
        game.dozer.x = tree.x - 1.3;
        game.dozer.y = tree.y + tree.d * 0.5;
        game.dozer.heading = 0;
        game.dozer.bladeDown = true;
        game.dozer.vx = 6;
        game.frameDozer(1.7);
      });
      await page.waitForTimeout(1800);
      await page.evaluate(() => window.__pd.frameDozer(1.7));
    }
    if (shot.flatten) {
      await page.evaluate(() => {
        const game = window.__pd;
        const fields = game.town.features.filter((f) => f.kind === "field");
        const field =
          fields.find((f) => f.state === "mature") ??
          fields.find((f) => f.state === "short") ??
          fields[0];
        if (!field) return;
        game.dozer.x = field.x + 1.1;
        game.dozer.y = field.y + field.d * 0.5;
        game.dozer.heading = field.heading;
        game.dozer.bladeDown = true;
        game.dozer.vx = 5;
        game.frameDozer(1.55);
      });
      await page.waitForTimeout(1800);
      await page.evaluate(() => window.__pd.frameDozer(1.55));
    }
    if (shot.aim === "blocked") {
      await page.evaluate(() => {
        const game = window.__pd;
        const forest = game.town.features.find((f) => f.kind === "forest");
        const water = game.town.features.find((f) => f.kind === "pond" || f.kind === "lake");
        if (forest) {
          game.dozer.x = forest.cx;
          game.dozer.y = forest.cy;
          game.dozer.motionStartX = forest.cx - forest.coreR - 1.4;
          game.dozer.motionStartY = forest.cy;
          game.dozer.vx = 6;
        } else if (water) {
          const cx = water.poly.reduce((s, p) => s + p.x, 0) / water.poly.length;
          const cy = water.poly.reduce((s, p) => s + p.y, 0) / water.poly.length;
          game.dozer.x = cx;
          game.dozer.y = cy;
          game.dozer.motionStartX = cx - 5;
          game.dozer.motionStartY = cy;
          game.dozer.vx = 6;
        }
      });
      await page.waitForTimeout(500);
      await page.evaluate(() => window.__pd.frameDozer(1.5));
    }
    const dest = `${OUT}/${shot.file}`;
    await page.screenshot({ path: dest, type: "png" });
    const info = await page.evaluate(() => {
      const game = window.__pd;
      return {
        biome: game.town.biome.id,
        features: game.town.features.map((f) => {
          if (f.kind === "field") return { kind: f.kind, x: f.x, y: f.y, w: f.w, d: f.d, crop: f.crop, state: f.state };
          if (f.kind === "forest") return { kind: f.kind, cx: f.cx, cy: f.cy, coreR: f.coreR, canopyR: f.canopyR };
          if (f.kind === "river") return { kind: f.kind, path: f.path, halfWidth: f.halfWidth };
          return { kind: f.kind, poly: f.poly };
        }),
        trees: game.town.props
          .filter((p) => p.assetId === "oak" || p.assetId === "pine" || p.assetId.endsWith("-sapling") || p.assetId.endsWith("-shrub"))
          .map((p) => ({ id: p.assetId, x: p.x, y: p.y })),
        dozer: { x: game.dozer.x, y: game.dozer.y, bladeDown: game.dozer.bladeDown },
        rubble: game.town.rubble.length,
        cash: game.cash,
        cam: { x: game.renderer.camX, y: game.renderer.camY, zoom: game.renderer.zoom },
      };
    });
    log.push({ file: dest, ...shot, ...info });
    console.log("captured", dest, info.biome, info.features.join(","));
  }
  await writeFile(`${OUT}/capture-log.json`, JSON.stringify(log, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())));
}
