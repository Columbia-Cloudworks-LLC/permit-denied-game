import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facebookMetadata } from './facebook-metadata.mjs';

test('keeps a large public App ID exact and injects only the app-id meta tag', () => {
  assert.deepEqual(facebookMetadata(' 12345678901234567890 ', true), [
    { tag: 'meta', attrs: { property: 'fb:app_id', content: '12345678901234567890' }, injectTo: 'head' },
  ]);
});
test('local builds can omit configuration; deployment builds cannot', () => {
  assert.deepEqual(facebookMetadata(undefined), []);
  assert.throws(() => facebookMetadata('', true), /required/);
});
test('rejects malformed values instead of inserting markup into HTML', () => {
  for (const value of ['abc', '1.2', '12\" /><script>', '1 2']) {
    assert.throws(() => facebookMetadata(value), /digits/);
  }
});
