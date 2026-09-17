import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GITHUB_REPOSITORY_URL, GITHUB_VANITY_HOST, assertGithubVanityRedirect, githubVanityRedirectRoute } from './github-redirect.mjs';

test('issues a host-matched 308 to the GitHub repository URL', () => {
  const route = githubVanityRedirectRoute();
  assert.equal(route.src, '/(.*)');
  assert.deepEqual(route.has, [{ type: 'host', value: GITHUB_VANITY_HOST }]);
  assert.equal(route.status, 308);
  assert.equal(route.headers.Location, GITHUB_REPOSITORY_URL);
});

test('accepts permanent redirects to the repository, with or without a trailing slash', () => {
  for (const [status, location] of [[308, GITHUB_REPOSITORY_URL], [301, GITHUB_REPOSITORY_URL + '/']]) {
    assertGithubVanityRedirect(new Response(null, { status, headers: { Location: location } }));
  }
});

test('rejects missing, temporary, or off-target redirects', () => {
  assert.throws(() => assertGithubVanityRedirect(new Response('ok')), /HTTP 200/);
  assert.throws(() => assertGithubVanityRedirect(new Response(null, { status: 307, headers: { Location: GITHUB_REPOSITORY_URL } })), /permanent redirect/);
  assert.throws(() => assertGithubVanityRedirect(new Response(null, { status: 308 })), /missing Location/);
  assert.throws(() => assertGithubVanityRedirect(new Response(null, { status: 308, headers: { Location: 'https://github.com/' } })), /redirected to/);
});
