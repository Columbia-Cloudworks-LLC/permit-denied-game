import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TERMS_VERSION } from "../terms-version.mjs";
import { gameUrl, reservePort } from "./harness.mjs";

test("consent version is read from src/privacy/state.ts", () => {
  const source = readFileSync(new URL("../../src/privacy/state.ts", import.meta.url), "utf8");
  const match = source.match(/export const TERMS_VERSION = '([^']+)'/);
  assert.equal(TERMS_VERSION, match?.[1]);
  assert.match(TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});

test("game capture URLs pin debug mode without duplicating origin", () => {
  assert.equal(gameUrl("http://127.0.0.1:4176", "sandbox=1&seed=19"), "http://127.0.0.1:4176/?sandbox=1&seed=19&debug=1");
  assert.equal(gameUrl("http://127.0.0.1:4173", "", { debug: false }), "http://127.0.0.1:4173/");
});

test("reservePort yields distinct listening ports", async () => {
  const first = await reservePort();
  const second = await reservePort();
  assert.notEqual(first, 0);
  assert.notEqual(second, 0);
  assert.notEqual(first, second);
});
