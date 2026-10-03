import { defineConfig } from "@playwright/test";

/** Opt-in client suite; existing HTTP/MCP config and package scripts stay intact. */
export default defineConfig({
  testDir: "./consent-feedback",
  testMatch: "consent-feedback.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  globalTimeout: 120_000,
  reporter: [["list"]],
  use: {
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: process.env.POINTUP_BROWSER_EXECUTABLE
      ? { executablePath: process.env.POINTUP_BROWSER_EXECUTABLE }
      : {},
  },
});
