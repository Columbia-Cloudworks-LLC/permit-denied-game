import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { load } from "./vitest-rpc-timeout-loader.mjs";

const root = dirname(fileURLToPath(import.meta.url));

describe("vitest RPC timeout loader", () => {
  it("disables birpc timeout on Vitest forks and threads workers", async () => {
    const forks = readFileSync(join(root, "../node_modules/vitest/dist/workers/forks.js"), "utf8");
    const threads = readFileSync(join(root, "../node_modules/vitest/dist/workers/threads.js"), "utf8");
    assert.match(forks, /return createForksRpcOptions\(v8\);/);
    assert.match(threads, /return createThreadsRpcOptions\(ctx\);/);

    const patchedForks = await load(
      pathToFileURL(join(root, "../node_modules/vitest/dist/workers/forks.js")).href,
      {},
      async () => ({ format: "module", shortCircuit: true, source: forks }),
    );
    const patchedThreads = await load(
      pathToFileURL(join(root, "../node_modules/vitest/dist/workers/threads.js")).href,
      {},
      async () => ({ format: "module", shortCircuit: true, source: threads }),
    );
    assert.match(String(patchedForks.source), /timeout: -1/);
    assert.match(String(patchedThreads.source), /timeout: -1/);
    assert.doesNotMatch(String(patchedForks.source), /return createForksRpcOptions\(v8\);/);
  });
});
