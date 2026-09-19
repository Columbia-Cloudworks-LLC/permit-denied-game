import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PERMIT_DENIED_PACKAGE_NAME = 'permit-denied';
export const ORIGIN_NAME = 'origin';
export const MAIN_BRANCH = 'main';
export const FETCH_TIMEOUT_MS = 12_000;
export const GIT_TIMEOUT_MS = 20_000;

export const STATES = Object.freeze({
  CURRENT: 'current',
  FAST_FORWARDED: 'fast-forwarded',
  DIRTY: 'dirty',
  AHEAD: 'ahead',
  DIVERGED: 'diverged',
  DETACHED: 'detached',
  NO_REMOTE: 'no-remote',
  FETCH_FAILED: 'fetch-failed',
});

const FORBIDDEN_STACK_HINTS = /\b(ebitengine|go test|go run|build\.bat|one-lot|one lot)\b/i;

export function gitSafePath(repoRoot) {
  return path.resolve(repoRoot).replaceAll('\\', '/');
}

export function runGit(repoRoot, args, { timeoutMs = GIT_TIMEOUT_MS } = {}) {
  const safe = gitSafePath(repoRoot);
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', `safe.directory=${safe}`, '-C', repoRoot, ...args], {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_OPTIONAL_LOCKS: '0',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      const error = new Error(`git ${args.join(' ')} timed out after ${timeoutMs}ms`);
      error.timeout = true;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: stdout.replace(/\s+$/u, ''), stderr: stderr.replace(/\s+$/u, '') });
    });
  });
}

export async function resolveGitRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    try {
      await stat(path.join(dir, '.git'));
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

export async function verifyPermitDeniedRepo(repoRoot) {
  const pkgPath = path.join(repoRoot, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'package.json is missing or unreadable' };
  }
  if (pkg.name !== PERMIT_DENIED_PACKAGE_NAME) {
    return { ok: false, reason: `package name is ${JSON.stringify(pkg.name)}, expected "${PERMIT_DENIED_PACKAGE_NAME}"` };
  }
  return { ok: true };
}

function inspectPorcelain(text) {
  const lines = text.split(/\r?\n/u).filter(Boolean);
  let tracked = false;
  let staged = false;
  let untracked = false;
  for (const line of lines) {
    if (line.startsWith('??') || line.startsWith('!!')) {
      untracked = true;
      continue;
    }
    const x = line[0] ?? ' ';
    const y = line[1] ?? ' ';
    if (x !== ' ' && x !== '?') staged = true;
    if (y !== ' ') tracked = true;
  }
  return { dirty: lines.length > 0, tracked, staged, untracked };
}

function shortSha(sha) {
  if (!sha) return '(unknown)';
  return sha.slice(0, 7);
}

function emptyReport(overrides) {
  return {
    state: STATES.NO_REMOTE,
    freshness: 'unverified',
    branch: null,
    headSha: null,
    originMainSha: null,
    ahead: 0,
    behind: 0,
    dirty: false,
    dirtyTracked: false,
    dirtyStaged: false,
    dirtyUntracked: false,
    fastForwarded: false,
    fromSha: null,
    worktreePreventedUpdate: false,
    summary: '',
    ...overrides,
  };
}

function withSummary(report) {
  return { ...report, summary: formatHumanSummary(report) };
}

export function formatHumanSummary(report) {
  const head = shortSha(report.headSha);
  const origin = shortSha(report.originMainSha);
  const branch = report.branch ?? '(detached)';
  switch (report.state) {
    case STATES.CURRENT:
      return `Repo ${branch} @ ${head} matches origin/main @ ${origin}. Freshness verified. No worktree change.`;
    case STATES.FAST_FORWARDED:
      return `Fast-forwarded ${branch} ${shortSha(report.fromSha)} → ${head} (origin/main). Freshness verified.`;
    case STATES.DIRTY:
      return [
        `DIRTY worktree on ${branch} @ ${head}; fetch only. origin/main @ ${origin} (ahead ${report.ahead}, behind ${report.behind}).`,
        'Preserved tracked, staged, and untracked files. No stash, reset, checkout, or merge.',
      ].join(' ');
    case STATES.AHEAD:
      return `Branch ${branch} @ ${head} is ${report.ahead} commit(s) ahead of origin/main @ ${origin}. Fetch only; no merge/rebase.`;
    case STATES.DIVERGED:
      return `Branch ${branch} @ ${head} has diverged from origin/main @ ${origin} (ahead ${report.ahead}, behind ${report.behind}). Fetch only; no merge/rebase/reset.`;
    case STATES.DETACHED:
      return `DETACHED HEAD @ ${head}. origin/main @ ${origin}. Fetch only; no checkout.`;
    case STATES.NO_REMOTE:
      return report.summary || 'Missing or wrong remote: cannot reach origin/main. Make no changes. Add origin pointing at https://github.com/Columbia-Cloudworks-LLC/permit-denied-game.git';
    case STATES.FETCH_FAILED:
      return `FRESHNESS UNVERIFIED: could not fetch origin (network or credentials). HEAD remains ${head}. Do not treat git status as proof the checkout is current.`;
    default: {
      const exhaustive = report.state;
      throw new Error(`unhandled preflight state: ${exhaustive}`);
    }
  }
}

export function formatSessionContext(report, { mode = 'agent' } = {}) {
  const context = [
    `PERMIT DENIED (${mode} session). TypeScript + Vite + PixiJS v8 client. Same town every run.`,
    report.summary,
    `branch=${report.branch ?? 'DETACHED'} head=${shortSha(report.headSha)} origin/main=${shortSha(report.originMainSha)} state=${report.state} freshness=${report.freshness} fastForwarded=${report.fastForwarded} worktreePreventedUpdate=${report.worktreePreventedUpdate} ahead=${report.ahead} behind=${report.behind}.`,
    'Commands: `npm test` then `npm run build`. Local play: `npm run dev`. Checkout freshness: `npm run repo:preflight`.',
    'Release: protected main — `/release` only (bump 1.0.N, PR, CI, merge). Do not push to main.',
    'Stay on the lot: no campaign/meta, no second map, no ECS, no React wrappers around the canvas.',
    'Do not commit dist/, *.exe, or secrets. Preflight is not part of npm install or the production build.',
  ].join('\n\n');
  if (FORBIDDEN_STACK_HINTS.test(context)) {
    throw new Error('session context leaked obsolete Go/Ebitengine guidance');
  }
  return context;
}

async function gitText(repoRoot, args, options) {
  const result = await runGit(repoRoot, args, options);
  return result;
}

async function revParse(repoRoot, rev) {
  const result = await gitText(repoRoot, ['rev-parse', '--verify', rev]);
  if (result.code !== 0) return null;
  const sha = result.stdout.trim();
  return sha || null;
}

function classifyAfterFetch(snapshot) {
  if (snapshot.detached) return STATES.DETACHED;
  if (snapshot.dirty) return STATES.DIRTY;
  if (snapshot.ahead > 0 && snapshot.behind > 0) return STATES.DIVERGED;
  if (snapshot.ahead > 0) return STATES.AHEAD;
  if (snapshot.behind > 0) return STATES.CURRENT;
  return STATES.CURRENT;
}

export async function runPreflight({
  cwd = process.cwd(),
  requireIdentity = true,
  fetchTimeoutMs = FETCH_TIMEOUT_MS,
} = {}) {
  const startDir = path.resolve(cwd);
  const repoRoot = await resolveGitRoot(startDir);
  if (!repoRoot) {
    return withSummary(emptyReport({
      state: STATES.NO_REMOTE,
      summary: 'Not a git repository. Make no changes. Run this from the permit-denied checkout.',
    }));
  }

  if (requireIdentity) {
    const identity = await verifyPermitDeniedRepo(repoRoot);
    if (!identity.ok) {
      return withSummary(emptyReport({
        state: STATES.NO_REMOTE,
        summary: `Wrong repository (${identity.reason}). Make no changes.`,
      }));
    }
  }

  const headSha = await revParse(repoRoot, 'HEAD');
  const symbolic = await gitText(repoRoot, ['symbolic-ref', '--quiet', 'HEAD']);
  const detached = symbolic.code !== 0;
  const branchResult = await gitText(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = detached || branchResult.stdout.trim() === 'HEAD' ? null : branchResult.stdout.trim();

  const remote = await gitText(repoRoot, ['remote', 'get-url', ORIGIN_NAME]);
  if (remote.code !== 0) {
    return withSummary(emptyReport({
      state: STATES.NO_REMOTE,
      branch,
      headSha,
      summary: 'Missing or wrong remote: origin is not configured. Make no changes. Add origin pointing at https://github.com/Columbia-Cloudworks-LLC/permit-denied-game.git',
    }));
  }

  const status = await gitText(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  const porcelain = inspectPorcelain(status.stdout);
  const originBefore = await revParse(repoRoot, `refs/remotes/${ORIGIN_NAME}/${MAIN_BRANCH}`);

  let fetchError = null;
  try {
    const fetched = await gitText(repoRoot, ['fetch', '--prune', ORIGIN_NAME], { timeoutMs: fetchTimeoutMs });
    if (fetched.code !== 0) {
      fetchError = fetched.stderr || fetched.stdout || `git fetch exited ${fetched.code}`;
    }
  } catch (error) {
    fetchError = error instanceof Error ? error.message : String(error);
  }

  const originMainSha = await revParse(repoRoot, `refs/remotes/${ORIGIN_NAME}/${MAIN_BRANCH}`);
  if (fetchError) {
    return withSummary({
      ...emptyReport({
        state: STATES.FETCH_FAILED,
        freshness: 'unverified',
        branch,
        headSha,
        originMainSha: originMainSha ?? originBefore,
        dirty: porcelain.dirty,
        dirtyTracked: porcelain.tracked,
        dirtyStaged: porcelain.staged,
        dirtyUntracked: porcelain.untracked,
        worktreePreventedUpdate: porcelain.dirty,
      }),
    });
  }

  if (!originMainSha) {
    return withSummary(emptyReport({
      state: STATES.NO_REMOTE,
      branch,
      headSha,
      summary: 'origin exists but origin/main is missing after fetch. Make no changes. The default branch must be main.',
    }));
  }

  const counts = await gitText(repoRoot, ['rev-list', '--left-right', '--count', `HEAD...${ORIGIN_NAME}/${MAIN_BRANCH}`]);
  let ahead = 0;
  let behind = 0;
  if (counts.code === 0) {
    const match = counts.stdout.trim().match(/^(\d+)\s+(\d+)$/u);
    if (match) {
      ahead = Number(match[1]);
      behind = Number(match[2]);
    }
  }

  const snapshot = { detached, dirty: porcelain.dirty, ahead, behind };
  const classified = classifyAfterFetch(snapshot);
  const canFastForward = !detached && !porcelain.dirty && ahead === 0 && behind > 0;

  if (canFastForward) {
    const fromSha = headSha;
    const merged = await gitText(repoRoot, ['merge', '--ff-only', `${ORIGIN_NAME}/${MAIN_BRANCH}`]);
    if (merged.code !== 0) {
      return withSummary({
        state: STATES.DIVERGED,
        freshness: 'verified',
        branch,
        headSha,
        originMainSha,
        ahead,
        behind,
        dirty: porcelain.dirty,
        dirtyTracked: porcelain.tracked,
        dirtyStaged: porcelain.staged,
        dirtyUntracked: porcelain.untracked,
        fastForwarded: false,
        fromSha: null,
        worktreePreventedUpdate: true,
        summary: `Fast-forward of ${branch ?? 'HEAD'} failed; left HEAD at ${shortSha(headSha)}. No reset or non-ff merge.`,
      });
    }
    const newHead = await revParse(repoRoot, 'HEAD');
    return withSummary({
      state: STATES.FAST_FORWARDED,
      freshness: 'verified',
      branch,
      headSha: newHead,
      originMainSha,
      ahead: 0,
      behind: 0,
      dirty: false,
      dirtyTracked: false,
      dirtyStaged: false,
      dirtyUntracked: false,
      fastForwarded: true,
      fromSha,
      worktreePreventedUpdate: false,
    });
  }

  return withSummary({
    state: classified,
    freshness: 'verified',
    branch,
    headSha,
    originMainSha,
    ahead,
    behind,
    dirty: porcelain.dirty,
    dirtyTracked: porcelain.tracked,
    dirtyStaged: porcelain.staged,
    dirtyUntracked: porcelain.untracked,
    fastForwarded: false,
    fromSha: null,
    worktreePreventedUpdate: porcelain.dirty || detached || ahead > 0,
  });
}

export async function readStdinJson() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function printCli(report) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.stderr.write(`${report.summary}\n`);
  if (report.state === STATES.FETCH_FAILED) {
    process.stderr.write('FRESHNESS UNVERIFIED\n');
  }
}

async function main() {
  const hookMode = process.argv.includes('--hook');
  const stdin = hookMode ? await readStdinJson() : null;
  const mode = stdin && typeof stdin.composer_mode === 'string' ? stdin.composer_mode : 'agent';
  const report = await runPreflight({ cwd: process.cwd(), requireIdentity: !process.argv.includes('--allow-any-repo') });
  if (hookMode) {
    process.stdout.write(`${JSON.stringify({ additional_context: formatSessionContext(report, { mode }) })}\n`);
    return;
  }
  printCli(report);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const report = withSummary(emptyReport({
      state: STATES.FETCH_FAILED,
      summary: `FRESHNESS UNVERIFIED: preflight crashed (${message}). Make no changes.`,
    }));
    if (process.argv.includes('--hook')) {
      process.stdout.write(`${JSON.stringify({ additional_context: formatSessionContext(report, { mode: 'agent' }) })}\n`);
    } else {
      printCli(report);
    }
  });
}
