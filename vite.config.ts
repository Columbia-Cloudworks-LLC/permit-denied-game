import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";
import { facebookMetadata, facebookPageUrl } from "./scripts/facebook-metadata.mjs";
import { version } from './package.json';

export default defineConfig({
  define: { "import.meta.env.VITE_FACEBOOK_PAGE_URL": JSON.stringify(facebookPageUrl(process.env.FACEBOOK_PAGE_URL, process.env.REQUIRE_FACEBOOK_APP_ID === "1")) },
  plugins: [{
    name: 'facebook-app-metadata',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ version, commit: process.env.DEPLOY_SHA || 'local' }) });
    },
    transformIndexHtml(_html, context) {
      if (context.path.startsWith('/catalog/') || context.path.startsWith('/designer/') || context.path.startsWith('/privacy/') || context.path.startsWith('/terms/')) return [];
      return facebookMetadata(process.env.FACEBOOK_APP_ID, process.env.REQUIRE_FACEBOOK_APP_ID === '1');
    },
  }, VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    filename: 'sw.js',
    manifest: false,
    includeManifestIcons: false,
    workbox: {
      globPatterns: ['index.html', 'assets/**/*.{js,css}', 'pwa/*.png', 'brand/favicon.ico', 'manifest.webmanifest', 'build.json'],
      globIgnores: [
        '**/catalog/**',
        '**/designer/**',
        '**/privacy/**',
        '**/terms/**',
        '**/social/**',
        '**/assets/catalog-*',
        '**/assets/designer-*',
        '**/assets/privacy-*',
        '**/assets/legal-*',
        '**/assets/assetCapture-*',
        '**/assets/isolateLot-*',
        '**/assets/chrome-*',
      ],
      navigateFallback: 'index.html',
      navigateFallbackAllowlist: [/^\/($|\?)/],
      navigateFallbackDenylist: [/^\/catalog(?:\/|$)/, /^\/designer(?:\/|$)/, /^\/privacy(?:\/|$)/, /^\/terms(?:\/|$)/],
      cleanupOutdatedCaches: true,
      skipWaiting: false,
      clientsClaim: false,
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
    },
    devOptions: { enabled: false },
  })],
  // Generated capture galleries are not application entry points.
  optimizeDeps: { entries: ["index.html"] },
  server: {
    watch: { ignored: ["**/artifacts/**", "**/docs/visual-verification/**"] },
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: "es2022",
    rollupOptions: { input: { game: 'index.html', catalog: 'catalog/index.html', designer: 'designer/index.html', privacy: 'privacy/index.html', terms: 'terms/index.html' } },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 240_000,
    teardownTimeout: 240_000,
    // Vitest 3.2 birpc ACKs time out at 60s. The accelerated 20-minute sandbox
    // is CPU-bound; extra workers on GitHub-hosted runners starve it and fail
    // with Timeout calling "onTaskUpdate".
    ...(process.env.CI ? { maxWorkers: 1 } : {}),
  },
});
