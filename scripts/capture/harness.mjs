import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { preview } from "vite";
import { TERMS_KEY, TERMS_VERSION, ANALYTICS_KEY } from "../terms-version.mjs";

export const CHROMIUM_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
export const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

export async function reservePort(host = "127.0.0.1") {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port: 0, host }, () => resolve(undefined));
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export function gameUrl(origin, query = "", { debug = true } = {}) {
  const params = new URLSearchParams(query);
  if (debug) params.set("debug", "1");
  const search = params.toString();
  return search ? `${origin}/?${search}` : `${origin}/`;
}

export async function injectConsent(pageOrContext, { analytics = "declined" } = {}) {
  await pageOrContext.addInitScript(
    ({ termsKey, termsVersion, analyticsKey, analytics }) => {
      try {
        localStorage.setItem(termsKey, termsVersion);
        localStorage.setItem(analyticsKey, analytics);
      } catch {
        /* Initial about:blank has no origin storage. */
      }
    },
    { termsKey: TERMS_KEY, termsVersion: TERMS_VERSION, analyticsKey: ANALYTICS_KEY, analytics },
  );
}

export async function waitForGame(page) {
  await page.locator("#game-root canvas").waitFor();
  await page.waitForFunction(() => window.__pd?.version === 1 && window.__pd.ready());
}

/** The preferred port first, then free ports, eight in all. */
async function previewPorts(preferredPort) {
  const attempts = preferredPort ? [preferredPort] : [];
  while (attempts.length < 8) attempts.push(await reservePort());
  return attempts;
}

async function startPreview(preferredPort) {
  let lastError;
  for (const port of await previewPorts(preferredPort)) {
    try {
      const server = await preview({
        preview: { host: "127.0.0.1", port, strictPort: true, open: false },
      });
      return { server, port, origin: `http://127.0.0.1:${port}` };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("could not start preview");
}

async function closePreview(server) {
  if (typeof server.close === "function") {
    try {
      await server.close();
      return;
    } catch {
      /* Fall through to the HTTP server handle. */
    }
  }
  const httpServer = server.httpServer;
  if (!httpServer) return;
  await new Promise((resolve, reject) => {
    httpServer.close((error) => (error ? reject(error) : resolve(undefined)));
  });
}

/** Page settings a session applies unless a single openPage call overrides them. */
export function pageDefaults(options) {
  const { viewport, deviceScaleFactor, debug, consent, waitForGame: wait, analytics } = options;
  return {
    viewport: DEFAULT_VIEWPORT, deviceScaleFactor: 1, debug: true, consent: true, wait: true, analytics: "declined",
    ...definedOnly({ viewport, deviceScaleFactor, debug, consent, wait, analytics }),
  };
}

function definedOnly(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

/**
 * Shared Playwright capture session: preview, Chromium flags, consent, readiness,
 * and cleanup on success or failure. Scene scripts supply navigation and shots.
 */
export async function withGameCapture(action, options = {}) {
  const { server, port, origin } = await startPreview(options.port);
  let browser;
  try {
    browser = await chromium.launch({ args: CHROMIUM_ARGS, headless: options.headless !== false });
    return await action({
      browser,
      origin,
      port,
      async openPage({ query = "", pageOptions = {}, ...request } = {}) {
        const { viewport, deviceScaleFactor, debug, consent, wait, analytics } = { ...pageDefaults(options), ...definedOnly(request) };
        const page = await browser.newPage({ viewport, deviceScaleFactor, ...pageOptions });
        if (consent) await injectConsent(page, { analytics });
        await page.goto(gameUrl(origin, query, { debug }), { waitUntil: "networkidle" });
        if (wait) await waitForGame(page);
        return page;
      },
    });
  } finally {
    await browser?.close();
    await closePreview(server);
  }
}

/**
 * Visit each shot's query in one page, waiting for the game before `capture`.
 * Shots need a `query`; `outDir` is created first.
 */
export async function captureShots(outDir, shots, capture, options = {}) {
  await mkdir(outDir, { recursive: true });
  await withGameCapture(async ({ openPage, origin }) => {
    const page = await openPage({ query: shots[0]?.query });
    for (const shot of shots) {
      await page.goto(gameUrl(origin, shot.query), { waitUntil: "networkidle" });
      await waitForGame(page);
      await capture(page, shot);
    }
  }, options);
}
