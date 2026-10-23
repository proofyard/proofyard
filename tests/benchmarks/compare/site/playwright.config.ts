import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "bench/playwright",
  workers: 2,
  use: { baseURL: "http://localhost:3999" },
  webServer: { command: "node ../../../../node_modules/next/dist/bin/next start -p 3999", url: "http://localhost:3999", reuseExistingServer: false },
});
