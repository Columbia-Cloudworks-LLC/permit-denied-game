import { mkdir, writeFile } from "node:fs/promises";
import { withGameCapture } from "./capture/harness.mjs";

await withGameCapture(async ({ openPage }) => {
  const page = await openPage({
    viewport: { width: 1199, height: 630 },
    debug: false,
    consent: false,
    wait: false,
    pageOptions: { reducedMotion: "reduce", colorScheme: "dark", locale: "en-US", timezoneId: "UTC" },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".operator-menu.title-open .permit-paper.permit-ready").waitFor();
  await page.getByRole("button", { name: "Play", exact: true }).waitFor();
  await page.locator("#game-root canvas").waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  const options = { type: "jpeg", quality: 90, animations: "disabled", caret: "hide" };
  let previous;
  let capture;
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(250);
    const current = await page.screenshot(options);
    if (previous?.equals(current)) {
      capture = current;
      break;
    }
    previous = current;
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join("\n")}`);
  if (!capture) throw new Error("Title screen did not settle into a stable image");
  await mkdir("public/social", { recursive: true });
  await writeFile("public/social/permit-denied-title.jpg", capture);
  console.log(`Captured title screen: 1199 × 630, ${capture.length} bytes`);
}, { debug: false, consent: false, waitForGame: false, viewport: { width: 1199, height: 630 } });
