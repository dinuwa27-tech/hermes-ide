import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  projects: [{ name: "webkit", use: { browserName: "webkit" } }],
  webServer: {
    command: "npx vite --config e2e/harness/vite.config.ts",
    port: 1422,
    reuseExistingServer: true,
  },
});
