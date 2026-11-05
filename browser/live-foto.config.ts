import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "live-foto.spec.ts",
  workers: 1,
  webServer: process.env.LIVE_TEST_EXTERNAL_SERVER
    ? undefined
    : {
        command: "npm run start -- --hostname 127.0.0.1 --port 3191",
        cwd: process.cwd(),
        url: "http://127.0.0.1:3191",
        env: {
          APP_SECRET: "local-browser-only",
          ANTHROPIC_API_KEY: "not-real",
        },
      },
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 393, height: 852 },
    baseURL: "http://127.0.0.1:3191",
    launchOptions: {
      executablePath: process.env.LIVE_TEST_CHROME,
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
  },
});
