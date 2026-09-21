import { mkdir } from "node:fs/promises";
import { gameUrl, waitForGame, withGameCapture } from "./capture/harness.mjs";

const OUT = "artifacts/terrain";

const shots = [
  { file: "d10-seed19.png", query: "sandbox=1&district=d10&seed=19" },
  { file: "plain-fields.png", query: "sandbox=1&district=d10&seed=334353&topology=curve-farm" },
  { file: "conifer-forest.png", query: "sandbox=1&district=d10&seed=1&topology=tjunction" },
  { file: "winter-lots.png", query: "sandbox=1&district=d10&seed=1&topology=tjunction" },
  { file: "clear-lots.png", query: "sandbox=1&district=d10&seed=19&topology=curve-farm" },
  { file: "downtown.png", query: "mode=challenge&seed=19&level=city-downtown" },
  { file: "classic.png", query: "seed=19" },
];

await withGameCapture(async ({ openPage, origin }) => {
  const page = await openPage({ query: shots[0].query });
  await mkdir(OUT, { recursive: true });
  for (const shot of shots) {
    await page.goto(gameUrl(origin, shot.query), { waitUntil: "networkidle" });
    await waitForGame(page);
    await page.evaluate(() => {
      const game = window.__pd;
      const pose = game.dozerSnapshot();
      game.lookAtWorld(pose.x, pose.y, pose.heading, 1.15);
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${shot.file}`, type: "png" });
  }
});
