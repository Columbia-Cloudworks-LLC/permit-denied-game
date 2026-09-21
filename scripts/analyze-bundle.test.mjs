import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVendorChunk, listedJsFromHtml } from "./analyze-bundle.mjs";

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
