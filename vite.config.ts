import { defineConfig } from "vitest/config";
import { facebookMetadata } from "./scripts/facebook-metadata.mjs";

export default defineConfig({
  plugins: [{
    name: 'facebook-app-metadata',
    transformIndexHtml() {
      return facebookMetadata(process.env.FACEBOOK_APP_ID, process.env.REQUIRE_FACEBOOK_APP_ID === '1');
    },
  }],
  server: {
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
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 180_000,
  },
});
