import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "bench/playwright",
  use: { baseURL: "http://localhost:3999" },
  webServer: {
    command: "node ../../../../node_modules/next/dist/bin/next start -p 3999",
    reuseExistingServer: false,
    url: "http://localhost:3999",
  },
  workers: 2,
});
