import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";
import { facebookMetadata, facebookPageUrl } from "./scripts/facebook-metadata.mjs";
import { version } from './package.json';

/** Heavy generation matrices: Linux CI only. */
export const INTEGRATION_TESTS = [
  "src/world/district.test.ts",
  "src/world/campaignLayout.test.ts",
  "src/world/urbanGeography.test.ts",
  "src/world/terrain.test.ts",
  "src/world/terrainFeatures.test.ts",
  "src/world/nhood.test.ts",
  "src/world/dressing.test.ts",
  "src/world/fields.test.ts",
  "src/world/roads.test.ts",
  "src/world/parcels.test.ts",
  "src/world/buildingDefinitions.test.ts",
  "src/world/migrationBaseline.test.ts",
  "src/world/archetype.test.ts",
  "src/world/campaignPlacement.test.ts",
  "src/world/campaignComposition.test.ts",
  "src/world/biomes.test.ts",
  "src/world/contentScale.test.ts",
  "src/render/WorldRenderer.test.ts",
  "src/render/forestCanopy.test.ts",
];

const SOAK_TESTS = ["src/sim/soak.test.ts"];
const BENCH_TESTS = ["src/sim/bench.test.ts", "src/render/denseCityBench.test.ts"];

const testShared = {
  environment: "node" as const,
  pool: "forks" as const,
  ...(process.env.CI ? { maxWorkers: 1 } : {}),
};

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
    // Pixi (~579 kB) and authored building JSON (~624 kB) are the documented
    // oversized-chunk exceptions; other application splits stay smaller.
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      input: { game: 'index.html', catalog: 'catalog/index.html', designer: 'designer/index.html', privacy: 'privacy/index.html', terms: 'terms/index.html' },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/pixi.js") || id.includes("node_modules/@pixi/")) return "pixi";
          if (id.includes("node_modules/@vercel/analytics")) return "analytics";
          if (id.includes("/src/world/data/")) return "buildings";
        },
      },
    },
  },
  test: {
    ...testShared,
    projects: [
      {
        extends: true,
        test: {
          ...testShared,
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: [...INTEGRATION_TESTS, ...SOAK_TESTS, ...BENCH_TESTS],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          teardownTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          ...testShared,
          name: "integration",
          include: INTEGRATION_TESTS,
          maxWorkers: 1,
          testTimeout: 240_000,
          hookTimeout: 240_000,
          teardownTimeout: 240_000,
        },
      },
      {
        extends: true,
        test: {
          ...testShared,
          name: "soak",
          include: SOAK_TESTS,
          maxWorkers: 1,
          testTimeout: 240_000,
          hookTimeout: 240_000,
          teardownTimeout: 240_000,
        },
      },
      {
        extends: true,
        test: {
          ...testShared,
          name: "bench",
          include: BENCH_TESTS,
          maxWorkers: 1,
          testTimeout: 120_000,
          hookTimeout: 120_000,
          teardownTimeout: 120_000,
        },
      },
    ],
  },
});
