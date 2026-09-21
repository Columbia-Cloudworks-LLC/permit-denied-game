import { mkdir, writeFile } from "node:fs/promises";
import { gameUrl, waitForGame, withGameCapture } from "./capture/harness.mjs";

const OUT = "/cursor/stores/bc-524f4be0-4e64-4fbf-b510-6f6f7ef1c582/media/terrain-features";

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

await withGameCapture(async ({ openPage, origin }) => {
  const page = await openPage({ query: shots[0].query });
  const log = [];
  await mkdir(OUT, { recursive: true });
  for (const shot of shots) {
    await page.goto(gameUrl(origin, shot.query), { waitUntil: "networkidle" });
    await waitForGame(page);
    await page.waitForTimeout(250);
    await page.evaluate(async (kind) => {
      const game = window.__pd;
      const town = game.townSnapshot();
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
        const tree = game.townSnapshot().props.find((p) => p.assetId === "oak" || p.assetId === "pine");
        if (!tree) return;
        game.setDozerPose({ x: tree.x - 1.3, y: tree.y + tree.d * 0.5, heading: 0, bladeDown: true, vx: 6 });
        game.frameDozer(1.7);
      });
      await page.waitForTimeout(1800);
      await page.evaluate(() => window.__pd.frameDozer(1.7));
    }
    if (shot.flatten) {
      await page.evaluate(() => {
        const game = window.__pd;
        const fields = game.townSnapshot().features.filter((f) => f.kind === "field");
        const field =
          fields.find((f) => f.state === "mature") ??
          fields.find((f) => f.state === "short") ??
          fields[0];
        if (!field) return;
        game.setDozerPose({
          x: field.x + 1.1,
          y: field.y + field.d * 0.5,
          heading: field.heading,
          bladeDown: true,
          vx: 5,
        });
        game.frameDozer(1.55);
      });
      await page.waitForTimeout(1800);
      await page.evaluate(() => window.__pd.frameDozer(1.55));
    }
    if (shot.aim === "blocked") {
      await page.evaluate(() => {
        const game = window.__pd;
        const town = game.townSnapshot();
        const forest = town.features.find((f) => f.kind === "forest");
        const water = town.features.find((f) => f.kind === "pond" || f.kind === "lake");
        if (forest) {
          game.setDozerPose({
            x: forest.cx,
            y: forest.cy,
            motionStartX: forest.cx - forest.coreR - 1.4,
            motionStartY: forest.cy,
            vx: 6,
          });
        } else if (water) {
          const cx = water.poly.reduce((s, p) => s + p.x, 0) / water.poly.length;
          const cy = water.poly.reduce((s, p) => s + p.y, 0) / water.poly.length;
          game.setDozerPose({ x: cx, y: cy, motionStartX: cx - 5, motionStartY: cy, vx: 6 });
        }
      });
      await page.waitForTimeout(500);
      await page.evaluate(() => window.__pd.frameDozer(1.5));
    }
    const dest = `${OUT}/${shot.file}`;
    await page.screenshot({ path: dest, type: "png" });
    const info = await page.evaluate(() => {
      const game = window.__pd;
      const town = game.townSnapshot();
      return {
        biome: town.biomeId,
        features: town.features,
        trees: town.props
          .filter((p) => p.assetId === "oak" || p.assetId === "pine" || p.assetId.endsWith("-sapling") || p.assetId.endsWith("-shrub"))
          .map((p) => ({ id: p.assetId, x: p.x, y: p.y })),
        dozer: game.dozerSnapshot(),
        rubble: town.rubble,
        cash: game.snapshot().cash,
        cam: game.cameraSnapshot(),
      };
    });
    log.push({ file: dest, ...shot, ...info });
    console.log("captured", dest, info.biome, info.features.map((f) => f.kind).join(","));
  }
  await writeFile(`${OUT}/capture-log.json`, JSON.stringify(log, null, 2));
});
