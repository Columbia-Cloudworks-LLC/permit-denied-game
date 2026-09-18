/** Disable birpc's 60s RPC timeout in Vitest worker pools.
 *  Long CPU-bound tests (the accelerated 20-minute sandbox) otherwise fail
 *  with `Timeout calling "onTaskUpdate"` after every assertion has passed. */
const WORKER = /\/workers\/(forks|threads)\.js(?:\?|$)/;

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!WORKER.test(url) || result.source == null) return result;
  const source = (typeof result.source === "string"
    ? result.source
    : Buffer.from(result.source).toString("utf8"))
    .replace(
      "return createForksRpcOptions(v8);",
      "return { ...createForksRpcOptions(v8), timeout: -1 };",
    )
    .replace(
      "return createThreadsRpcOptions(ctx);",
      "return { ...createThreadsRpcOptions(ctx), timeout: -1 };",
    );
  return { ...result, source };
}
