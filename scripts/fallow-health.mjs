// `npm run health`: measure real test coverage, then score it with `fallow health`.
// Without coverage, fallow estimates it statically and flags any untested
// function at cyclomatic 5+ as CRAP. Vitest covers src/; c8 covers the
// operational scripts and Claude hooks run by `node --test`.
//
//   npm run health                 unit + integration coverage (about 15 minutes)
//   npm run health -- --quick      unit coverage only
//   npm run health -- --reuse      rescore the last coverage without rerunning tests
//   npm run -s health -- -- <args> pass the rest to `fallow health` (e.g. --format json > report.json)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Relative to ROOT: commands run there, and a Windows shell would split an absolute path at its spaces.
const MERGED = 'coverage/coverage-final.json';
const VITEST_JSON = 'coverage/vitest/coverage-final.json';
const SCRIPTS_DIR = 'coverage/scripts';

/** Coverage maps from the two runners cover disjoint files; a shared file keeps the first map. */
export function mergeCoverageMaps(...maps) {
  const merged = {};
  for (const map of maps) for (const [file, data] of Object.entries(map)) merged[file] ??= data;
  return merged;
}

export function parseArgs(argv) {
  const split = argv.indexOf('--');
  const own = split < 0 ? argv : argv.slice(0, split);
  return { quick: own.includes('--quick'), reuse: own.includes('--reuse'), fallowArgs: split < 0 ? [] : argv.slice(split + 1) };
}

/** @param {string} command @param {string[]} args @param {'inherit' | 2} [stdout] 2 sends the child's stdout to our stderr. */
function run(command, args, stdout = 'inherit') {
  // Windows resolves npx through a .cmd shim, which needs a shell.
  return spawnSync(command, args, { cwd: ROOT, stdio: ['ignore', stdout, 'inherit'], shell: process.platform === 'win32' }).status ?? 1;
}

const readMap = file => existsSync(path.join(ROOT, file)) ? JSON.parse(readFileSync(path.join(ROOT, file), 'utf8')) : {};

function collectCoverage(quick) {
  rmSync(path.join(ROOT, 'coverage'), { recursive: true, force: true });
  mkdirSync(path.join(ROOT, 'coverage'), { recursive: true });
  const projects = quick ? ['--project', 'unit'] : ['--project', 'unit', '--project', 'integration'];
  // Instrumentation slows the timing-bounded generation tests; `npm test` stays the correctness gate.
  // Test chatter goes to stderr so stdout carries only the fallow report (e.g. --format json).
  const vitest = run('npx', ['vitest', 'run', ...projects, '--coverage.enabled', '--coverage.reportOnFailure'], 2);
  // An explicit --exclude replaces c8's default, which would drop the *.test.mjs files themselves;
  // --all scores scripts and hooks no test runs at 0% instead of leaving them to fallow's estimate.
  const scripts = run('npx', ['c8', '--reporter=json', `--report-dir=${SCRIPTS_DIR}`, '--include=scripts/**', '--include=.claude/hooks/**',
    '--exclude=coverage/**', '--all', 'node', '--test', 'scripts/*.test.mjs'], 2);
  if (vitest || scripts) console.warn('Some tests failed under coverage; the scores below still use what ran.');
  writeFileSync(path.join(ROOT, MERGED), JSON.stringify(mergeCoverageMaps(readMap(VITEST_JSON), readMap(`${SCRIPTS_DIR}/coverage-final.json`))));
}

function main() {
  const { quick, reuse, fallowArgs } = parseArgs(process.argv.slice(2));
  if (!reuse || !existsSync(path.join(ROOT, MERGED))) collectCoverage(quick);
  process.exitCode = run('npx', ['fallow', 'health', '--coverage', MERGED, ...fallowArgs]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
