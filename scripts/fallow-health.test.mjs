import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeCoverageMaps, parseArgs } from './fallow-health.mjs';

test('merges disjoint coverage maps and keeps the first entry for a shared file', () => {
  const vitest = { 'src/a.ts': { s: { 0: 1 } }, 'src/shared.ts': { s: { 0: 2 } } };
  const scripts = { 'scripts/b.mjs': { s: { 0: 3 } }, 'src/shared.ts': { s: { 0: 0 } } };
  assert.deepEqual(mergeCoverageMaps(vitest, scripts), {
    'src/a.ts': { s: { 0: 1 } }, 'src/shared.ts': { s: { 0: 2 } }, 'scripts/b.mjs': { s: { 0: 3 } },
  });
  assert.deepEqual(mergeCoverageMaps(), {});
});

test('splits runner flags from fallow arguments', () => {
  assert.deepEqual(parseArgs([]), { quick: false, reuse: false, fallowArgs: [] });
  assert.deepEqual(parseArgs(['--quick', '--reuse']), { quick: true, reuse: true, fallowArgs: [] });
  assert.deepEqual(parseArgs(['--reuse', '--', '--format', 'json', '--quick']), { quick: false, reuse: true, fallowArgs: ['--format', 'json', '--quick'] });
});
