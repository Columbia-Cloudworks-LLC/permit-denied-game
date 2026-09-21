import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Uncompressed JS listed by the game HTML (entry + modulepreload). */
export const INITIAL_GAME_JS_BUDGET_BYTES = 1_850_000;
/** Matches `build.chunkSizeWarningLimit` in vite.config.ts (kB → bytes). */
export const APP_CHUNK_BUDGET_BYTES = 650 * 1024;
export const VENDOR_CHUNK_BUDGET_BYTES = 650 * 1024;

/**
 * @param {string} html
 * @returns {string[]}
 */
export function listedJsFromHtml(html) {
  const files = new Set();
  for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"/gi)) {
    files.add(decodeURIComponent(match[1]));
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel\s*=\s*["']modulepreload["']/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+\.js)["']/i);
    if (href) files.add(decodeURIComponent(href[1]));
  }
  return [...files];
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isVendorChunk(filePath) {
  const name = path.basename(filePath);
  return /(?:^|-)pixi[.-]/.test(name) || /(?:^|-)analytics[.-]/.test(name);
}

/**
 * @param {string} root
 * @param {string} href
 */
export function distFile(root, href) {
  return path.join(root, href.replace(/^\//, ""));
}

/**
 * @param {string} root
 */
export async function analyzeGameBundle(root = "dist") {
  const html = await readFile(path.join(root, "index.html"), "utf8");
  const listed = listedJsFromHtml(html);
  if (listed.length === 0) throw new Error("Game HTML lists no JavaScript modules");
  const chunks = [];
  let initialBytes = 0;
  for (const href of listed) {
    const file = distFile(root, href);
    const size = (await stat(file)).size;
    initialBytes += size;
    chunks.push({ href, bytes: size, vendor: isVendorChunk(href) });
  }
  return { listed, chunks, initialBytes };
}

/**
 * @param {{ listed: string[], chunks: { href: string, bytes: number, vendor: boolean }[], initialBytes: number }} report
 */
export function assertBundleBudget(report) {
  const oversize = [];
  if (report.initialBytes > INITIAL_GAME_JS_BUDGET_BYTES) {
    oversize.push(`initial game JS ${report.initialBytes} bytes exceeds ${INITIAL_GAME_JS_BUDGET_BYTES}`);
  }
  for (const chunk of report.chunks) {
    const limit = chunk.vendor ? VENDOR_CHUNK_BUDGET_BYTES : APP_CHUNK_BUDGET_BYTES;
    if (chunk.bytes > limit) {
      oversize.push(`${chunk.href} ${chunk.bytes} bytes exceeds ${limit}${chunk.vendor ? " (vendor)" : ""}`);
    }
  }
  if (oversize.length) throw new Error(`Bundle budget exceeded:\n- ${oversize.join("\n- ")}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const report = await analyzeGameBundle(process.argv[2] || "dist");
  console.log(JSON.stringify({
    initialBytes: report.initialBytes,
    budgetBytes: INITIAL_GAME_JS_BUDGET_BYTES,
    chunks: report.chunks,
  }, null, 2));
  assertBundleBudget(report);
  console.log(`Initial game JS ${report.initialBytes} bytes within ${INITIAL_GAME_JS_BUDGET_BYTES}`);
}
