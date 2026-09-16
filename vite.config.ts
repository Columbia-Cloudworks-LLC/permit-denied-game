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
  }],
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
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 180_000,
    // Vitest 3.2 birpc ACKs time out at 60s. Windows CI plus the 20-minute
    // sandbox bench starves the host and fails a green run with
    // Timeout calling "onTaskUpdate".
    ...(process.env.CI && process.platform === "win32" ? { maxWorkers: 1 } : {}),
  },
});
