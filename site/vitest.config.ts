import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    env: {
      DIRECTUS_URL: "http://directus.test",
      DIRECTUS_TOKEN: "test-token",
      ASSETS_BASE_URL: "https://assets.test",
      SITE_TIMEZONE: "America/Los_Angeles",
      TZ: "UTC",
    },
  },
});
