import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./browser",
  testMatch: "checker.spec.ts",
  workers: 1,
  timeout: 30000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3194",
    channel: "chrome",
    permissions: ["camera"],
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
  },
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3194`,
    url: "http://127.0.0.1:3194",
    reuseExistingServer: false,
    env: {
      APP_SECRET: "checker-local-test",
      SESSION_SECRET: "reseller-browser-test-secret-minimum-32-chars",
      SNAPLIST_ACCOUNTS_ENABLED: "false",
    },
  },
});
