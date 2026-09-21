import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  STATES,
  formatSessionContext,
  gitSafePath,
  runGit,
  runPreflight,
} from './repo-preflight.mjs';

const leftovers = [];

after(async () => {
  await Promise.all(leftovers.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function gitOk(repoRoot, args) {
  const result = await runGit(repoRoot, [
    '-c',
    'user.name=Preflight Test',
    '-c',
    'user.email=preflight@permitdenied.test',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'init.defaultBranch=main',
    ...args,
  ]);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.code}): ${result.stderr || result.stdout}`);
  }
  return result;
}

async function shaOf(repoRoot, rev = 'HEAD') {
  const result = await runGit(repoRoot, ['rev-parse', '--verify', rev]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}

async function makeHarness() {
  const root = await mkdtemp(path.join(tmpdir(), 'pd-preflight-'));
  leftovers.push(root);
  const work = path.join(root, 'work');
  const remote = path.join(root, 'remote.git');
  await mkdir(work, { recursive: true });
  await gitOk(work, ['init', '-b', 'main']);
  await writeFile(path.join(work, 'README.md'), 'seed\n');
  await gitOk(work, ['add', 'README.md']);
  await gitOk(work, ['commit', '-m', 'seed']);
  await gitOk(root, ['clone', '--bare', work, remote]);
  await gitOk(work, ['remote', 'add', 'origin', remote]);
  await gitOk(work, ['push', '-u', 'origin', 'main']);
  return { root, work, remote, sha: await shaOf(work) };
}

async function advanceRemote(harness, message) {
  const other = path.join(harness.root, `other-${message}`);
  await gitOk(harness.root, ['clone', harness.remote, other]);
  await writeFile(path.join(other, `${message}.txt`), `${message}\n`);
  await gitOk(other, ['add', `${message}.txt`]);
  await gitOk(other, ['commit', '-m', message]);
  await gitOk(other, ['push', 'origin', 'main']);
  return shaOf(other);
}

async function stashList(repoRoot) {
  const result = await runGit(repoRoot, ['stash', 'list']);
  return result.stdout.trim();
}

test('gitSafePath never emits backslashes in the safe.directory override', () => {
  assert.equal(gitSafePath(process.cwd()).includes('\\'), false);
});

test('clean main that matches origin/main stays current with no worktree change', async () => {
  const harness = await makeHarness();
  const before = await shaOf(harness.work);
  const report = await runPreflight({ cwd: harness.work, requireIdentity: false });
  assert.equal(report.state, STATES.CURRENT);
  assert.equal(report.freshness, 'verified');
  assert.equal(report.fastForwarded, false);
  assert.equal(report.branch, 'main');
  assert.equal(report.headSha, before);
  assert.equal(report.originMainSha, before);
  assert.equal(report.ahead, 0);
  assert.equal(report.behind, 0);
  assert.equal(await shaOf(harness.work), before);
});

test('clean main behind origin/main fast-forwards to the fetched origin/main SHA', async () => {
  const harness = await makeHarness();
  const fromSha = harness.sha;
  const remoteSha = await advanceRemote(harness, 'ahead-on-origin');
  const report = await runPreflight({ cwd: harness.work, requireIdentity: false });
  assert.equal(report.state, STATES.FAST_FORWARDED);
  assert.equal(report.freshness, 'verified');
  assert.equal(report.fastForwarded, true);
  assert.equal(report.fromSha, fromSha);
  assert.equal(report.headSha, remoteSha);
  assert.equal(report.originMainSha, remoteSha);
  assert.equal(await shaOf(harness.work), remoteSha);
  assert.equal(await shaOf(harness.work, 'origin/main'), remoteSha);
});

test('dirty main fetches only and preserves tracked, staged, and untracked bytes while behind', async () => {
  const harness = await makeHarness();
  const fromSha = harness.sha;
  await advanceRemote(harness, 'remote-while-dirty');
  const tracked = 'tracked-change\n';
  const staged = 'staged-change\n';
  const untracked = 'untracked-secret\n';
  await writeFile(path.join(harness.work, 'README.md'), tracked);
  await writeFile(path.join(harness.work, 'staged.txt'), staged);
  await gitOk(harness.work, ['add', 'staged.txt']);
  await writeFile(path.join(harness.work, 'loose.txt'), untracked);
  const report = await runPreflight({ cwd: harness.work, requireIdentity: false });
  assert.equal(report.state, STATES.DIRTY);
  assert.equal(report.freshness, 'verified');
  assert.equal(report.fastForwarded, false);
  assert.equal(report.worktreePreventedUpdate, true);
  assert.equal(report.behind > 0, true);
  assert.equal(await shaOf(harness.work), fromSha);
  assert.equal(await stashList(harness.work), '');
  assert.equal(await readFile(path.join(harness.work, 'README.md'), 'utf8'), tracked);
  assert.equal(await readFile(path.join(harness.work, 'staged.txt'), 'utf8'), staged);
  assert.equal(await readFile(path.join(harness.work, 'loose.txt'), 'utf8'), untracked);
  const porcelain = await runGit(harness.work, ['status', '--porcelain=v1', '--untracked-files=all']);
  assert.match(porcelain.stdout, /README\.md/);
  assert.match(porcelain.stdout, /staged\.txt/);
  assert.match(porcelain.stdout, /\?\? loose\.txt/);
});

test('clean feature branch with zero unique commits fast-forwards to origin/main', async () => {
  const harness = await makeHarness();
  const fromSha = harness.sha;
  await gitOk(harness.work, ['checkout', '-b', 'topic']);
  const remoteSha = await advanceRemote(harness, 'main-moved');
  const report = await runPreflight({ cwd: harness.work, requireIdentity: false });
  assert.equal(report.state, STATES.FAST_FORWARDED);
  assert.equal(report.branch, 'topic');
  assert.equal(report.fromSha, fromSha);
  assert.equal(report.headSha, remoteSha);
  assert.equal(await shaOf(harness.work), remoteSha);
  const branch = await runGit(harness.work, ['rev-parse', '--abbrev-ref', 'HEAD']);
  assert.equal(branch.stdout.trim(), 'topic');
});

test('feature branch with unique commits is reported ahead and never merged', async () => {
  const harness = await makeHarness();
  const fromSha = harness.sha;
  await gitOk(harness.work, ['checkout', '-b', 'topic']);
  await writeFile(path.join(harness.work, 'unique.txt'), 'mine\n');
  await gitOk(harness.work, ['add', 'unique.txt']);
  await gitOk(harness.work, ['commit', '-m', 'unique']);
  const topicSha = await shaOf(harness.work);
  const report = await runPreflight({ cwd: harness.work, requireIdentity: false });
  assert.equal(report.state, STATES.AHEAD);
  assert.equal(report.ahead, 1);
  assert.equal(report.behind, 0);
  assert.equal(report.fastForwarded, false);
  assert.equal(await shaOf(harness.work), topicSha);
  assert.notEqual(topicSha, fromSha);
  assert.equal(await readFile(path.join(harness.work, 'unique.txt'), 'utf8'), 'mine\n');
});

test('diverged branch is reported and left untouched', async () => {
  const harness = await makeHarness();
  await gitOk(harness.work, ['checkout', '-b', 'topic']);
  await writeFile(path.join(harness.work, 'unique.txt'), 'mine\n');
  await gitOk(harness.work, ['add', 'unique.txt']);
  await gitOk(harness.work, ['commit', '-m', 'unique']);
  const topicSha = await shaOf(harness.work);
  const remoteSha = await advanceRemote(harness, 'origin-moved');
  const report = await runPreflight({ cwd: harness.work, requireIdentity: false });
  assert.equal(report.state, STATES.DIVERGED);
  assert.equal(report.ahead, 1);
  assert.equal(report.behind, 1);
  assert.equal(report.fastForwarded, false);
  assert.equal(await shaOf(harness.work), topicSha);
  assert.notEqual(topicSha, remoteSha);
  assert.equal(await readFile(path.join(harness.work, 'unique.txt'), 'utf8'), 'mine\n');
});

test('detached HEAD fetches only and does not check out a branch', async () => {
  const harness = await makeHarness();
  const fromSha = harness.sha;
  await gitOk(harness.work, ['checkout', '--detach', 'HEAD']);
  await advanceRemote(harness, 'while-detached');
  const report = await runPreflight({ cwd: harness.work, requireIdentity: false });
  assert.equal(report.state, STATES.DETACHED);
  assert.equal(report.branch, null);
  assert.equal(report.fastForwarded, false);
  assert.equal(await shaOf(harness.work), fromSha);
  const symbolic = await runGit(harness.work, ['symbolic-ref', '--quiet', 'HEAD']);
  assert.notEqual(symbolic.code, 0);
});

test('missing origin makes no changes and reports no-remote', async () => {
  const harness = await makeHarness();
  const fromSha = harness.sha;
  await gitOk(harness.work, ['remote', 'remove', 'origin']);
  const report = await runPreflight({ cwd: harness.work, requireIdentity: false });
  assert.equal(report.state, STATES.NO_REMOTE);
  assert.equal(report.freshness, 'unverified');
  assert.equal(report.fastForwarded, false);
  assert.equal(await shaOf(harness.work), fromSha);
  assert.match(report.summary, /origin/i);
});

test('fetch failure exits without moving HEAD and prints FRESHNESS UNVERIFIED', async () => {
  const harness = await makeHarness();
  const fromSha = harness.sha;
  await gitOk(harness.work, ['remote', 'set-url', 'origin', path.join(harness.root, 'missing.git')]);
  const report = await runPreflight({ cwd: harness.work, requireIdentity: false, fetchTimeoutMs: 8_000 });
  assert.equal(report.state, STATES.FETCH_FAILED);
  assert.equal(report.freshness, 'unverified');
  assert.equal(report.fastForwarded, false);
  assert.equal(await shaOf(harness.work), fromSha);
  assert.match(report.summary, /FRESHNESS UNVERIFIED/);
  assert.equal(await stashList(harness.work), '');
});

test('requireIdentity refuses a foreign git checkout without touching HEAD', async () => {
  const harness = await makeHarness();
  const fromSha = harness.sha;
  const report = await runPreflight({ cwd: harness.work, requireIdentity: true });
  assert.equal(report.state, STATES.NO_REMOTE);
  assert.equal(await shaOf(harness.work), fromSha);
  assert.match(report.summary, /Wrong repository|package/i);
});

test('session context names the TypeScript stack and omits Go/Ebitengine guidance', () => {
  const context = formatSessionContext({
    state: STATES.CURRENT,
    freshness: 'verified',
    branch: 'main',
    headSha: 'abcdef1234567890',
    originMainSha: 'abcdef1234567890',
    ahead: 0,
    behind: 0,
    dirty: false,
    fastForwarded: false,
    worktreePreventedUpdate: false,
    summary: 'Repo main @ abcdef1 matches origin/main @ abcdef1. Freshness verified. No worktree change.',
  }, { mode: 'agent' });
  assert.match(context, /TypeScript \+ Vite \+ PixiJS v8/);
  assert.match(context, /npm test/);
  assert.match(context, /npm run build/);
  assert.match(context, /npm run dev/);
  assert.match(context, /Time Challenge campaign/);
  assert.doesNotMatch(context, /Ebitengine/i);
  assert.doesNotMatch(context, /go test/i);
  assert.doesNotMatch(context, /build\.bat/i);
  assert.doesNotMatch(context, /one-lot/i);
  assert.doesNotMatch(context, /no campaign/i);
});
