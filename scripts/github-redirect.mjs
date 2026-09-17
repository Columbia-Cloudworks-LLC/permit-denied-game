export const GITHUB_VANITY_HOST = 'github.permitdenied.app';
export const GITHUB_REPOSITORY_URL = 'https://github.com/Columbia-Cloudworks-LLC/permit-denied-game';

export function githubVanityRedirectRoute() {
  return {
    src: '/(.*)',
    has: [{ type: 'host', value: GITHUB_VANITY_HOST }],
    status: 308,
    headers: { Location: GITHUB_REPOSITORY_URL },
  };
}

export function assertGithubVanityRedirect(response) {
  if (![301, 308].includes(response.status)) throw new Error(`${GITHUB_VANITY_HOST} returned HTTP ${response.status} instead of a permanent redirect`);
  const location = response.headers.get('location');
  if (!location) throw new Error(`${GITHUB_VANITY_HOST} redirect is missing Location`);
  const url = new URL(location, `https://${GITHUB_VANITY_HOST}`);
  const normalized = url.origin + url.pathname.replace(/\/$/, '');
  if (normalized !== GITHUB_REPOSITORY_URL) throw new Error(`${GITHUB_VANITY_HOST} redirected to ${location}`);
}
