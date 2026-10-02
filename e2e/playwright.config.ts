import { defineConfig } from "@playwright/test";

const API_PORT = 4010;
const MCP_PORT = 4011;

/**
 * Smoke test topology (no browser needed - only Playwright's APIRequestContext):
 *   test --HTTP--> MCP server (apps/mcp bundle, --http) --HTTP--> fake API
 * Run `npm run build:mcp` first (the `pretest` script does it).
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15_000,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${MCP_PORT}` },
  webServer: [
    {
      command: "node fake-api.mjs",
      env: { FAKE_API_PORT: String(API_PORT) },
      url: `http://127.0.0.1:${API_PORT}/__health`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      command: "node ../apps/mcp/dist/index.mjs --http",
      env: {
        PORT: String(MCP_PORT),
        MCP_ALLOWED_ORIGINS: "https://claude.ai",
        POINTUP_URL: `http://127.0.0.1:${API_PORT}`,
        POINTUP_AGENT_NAME: "e2e-agent",
      },
      url: `http://127.0.0.1:${MCP_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
  ],
});
