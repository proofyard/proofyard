import { playwright } from "@vitest/browser-playwright";
import { vitestPluginRSC } from "vitest-plugin-rsc";
import { vitestPluginNext } from "vitest-plugin-rsc/nextjs/plugin";
import { defineConfig } from "vitest/config";

// vitest-plugin-rsc の README の設定のまま
export default defineConfig({
  plugins: [vitestPluginRSC(), vitestPluginNext()],
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright(),
    },
    include: ["bench/**/*.test.{ts,tsx}"],
    isolate: false,
  },
});
