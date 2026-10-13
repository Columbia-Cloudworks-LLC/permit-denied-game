import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APP_CHUNK_BUDGET_BYTES,
  INITIAL_GAME_JS_BUDGET_BYTES,
  VENDOR_CHUNK_BUDGET_BYTES,
  assertBundleBudget,
  isVendorChunk,
  listedJsFromHtml,
} from "./analyze-bundle.mjs";

describe("bundle listing", () => {
  it("collects the module entry and modulepreload hrefs", () => {
    const html = `
      <script type="module" crossorigin src="/assets/game-abc.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/pixi-def.js">
      <link href="/assets/town-ghi.js" rel="modulepreload">
      <link rel="stylesheet" href="/assets/index.css">
    `;
    assert.deepEqual(listedJsFromHtml(html).sort(), [
      "/assets/game-abc.js",
      "/assets/pixi-def.js",
      "/assets/town-ghi.js",
    ]);
  });

  it("treats pixi and analytics hashes as vendor chunks", () => {
    assert.equal(isVendorChunk("/assets/pixi-abc123.js"), true);
    assert.equal(isVendorChunk("assets/analytics-9.js"), true);
    assert.equal(isVendorChunk("/assets/game-abc.js"), false);
  });
});

describe("assertBundleBudget", () => {
  const report = (initialBytes, chunks) => ({ listed: chunks.map((c) => c.href), chunks, initialBytes });

  it("passes a bundle inside every budget", () => {
    assert.doesNotThrow(() => assertBundleBudget(report(1000, [
      { href: "assets/index.js", bytes: APP_CHUNK_BUDGET_BYTES, vendor: false },
      { href: "assets/pixi.js", bytes: VENDOR_CHUNK_BUDGET_BYTES, vendor: true },
    ])));
  });

  it("lists every budget a bundle exceeds, marking vendor chunks", () => {
    assert.throws(() => assertBundleBudget(report(INITIAL_GAME_JS_BUDGET_BYTES + 1, [
      { href: "assets/index.js", bytes: APP_CHUNK_BUDGET_BYTES + 1, vendor: false },
      { href: "assets/pixi.js", bytes: VENDOR_CHUNK_BUDGET_BYTES + 1, vendor: true },
    ])), (error) => {
      assert.match(error.message, /initial game JS \d+ bytes exceeds/);
      assert.match(error.message, /assets\/index\.js \d+ bytes exceeds \d+\n/);
      assert.match(error.message, /assets\/pixi\.js \d+ bytes exceeds \d+ \(vendor\)/);
      return true;
    });
  });
});
