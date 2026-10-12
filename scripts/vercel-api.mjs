/**
 * Team-scoped Vercel REST call. Non-2xx responses throw, except a 404 when
 * `allowMissing` is set; the result carries `ok` so callers can tell.
 */
export function vercelApi({ token, teamId, request = fetch }) {
  /**
   * @param {string} endpoint
   * @param {{ method?: string, body?: unknown, allowMissing?: boolean }} [options]
   */
  return async function api(endpoint, { method = 'GET', body, allowMissing = false } = {}) {
    const url = new URL(`https://api.vercel.com${endpoint}`);
    url.searchParams.set('teamId', teamId);
    const response = await request(url, {
      method, signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok && !(allowMissing && response.status === 404)) {
      throw new Error(`Vercel HTTP ${response.status}: ${data.error?.code || 'unknown'}: ${data.error?.message || 'Request failed'}`);
    }
    return { ok: response.ok, data };
  };
}
