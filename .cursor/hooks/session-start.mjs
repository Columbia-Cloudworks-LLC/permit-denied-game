import { formatSessionContext, readStdinJson, runPreflight } from '../../scripts/repo-preflight.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function main() {
  const input = await readStdinJson();
  const mode = input && typeof input.composer_mode === 'string' ? input.composer_mode : 'agent';
  let report;
  try {
    report = await runPreflight({ cwd: repoRoot, requireIdentity: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report = {
      state: 'fetch-failed',
      freshness: 'unverified',
      branch: null,
      headSha: null,
      originMainSha: null,
      ahead: 0,
      behind: 0,
      dirty: false,
      fastForwarded: false,
      worktreePreventedUpdate: false,
      summary: `FRESHNESS UNVERIFIED: session preflight crashed (${message}). Make no changes.`,
    };
  }
  process.stdout.write(`${JSON.stringify({ additional_context: formatSessionContext(report, { mode }) })}\n`);
}

main().catch(() => {
  process.stdout.write(`${JSON.stringify({
    additional_context: 'PERMIT DENIED. TypeScript + Vite + PixiJS v8 client. FRESHNESS UNVERIFIED: sessionStart hook failed open. Run `npm run repo:preflight` before repository-dependent work.',
  })}\n`);
});
