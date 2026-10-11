import { formatSessionContext, runPreflight } from '../../scripts/repo-preflight.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function emit(additionalContext) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
  })}\n`);
}

async function main() {
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
  emit(formatSessionContext(report));
}

main().catch(() => {
  emit('PERMIT DENIED. TypeScript + Vite + PixiJS v8 client. FRESHNESS UNVERIFIED: SessionStart hook failed open. Run `npm run repo:preflight` before repository-dependent work.');
});
