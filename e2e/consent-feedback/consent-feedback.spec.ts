import { test as base, expect, type Page } from "@playwright/test";
import type { PluginBuild } from "esbuild";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ConsentCall } from "./actions";

const directory = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(directory, "../..");
const require = createRequire(path.join(checkout, "package.json"));
const productPaths = [
  "components/agents-panel.tsx",
  "components/form-feedback.tsx",
  "components/ui/button.tsx",
  "lib/action-result.ts",
  "lib/format.ts",
].map(file => path.join(checkout, "apps/web/src", file));

async function fingerprints(): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(productPaths.map(async file => [
    path.relative(checkout, file),
    createHash("sha256").update(await fs.readFile(file)).digest("hex"),
  ])));
}

type Harness = { page: Page; origin: string };
const test = base.extend<{}, { consentHarness: Harness }>({
  consentHarness: [async ({ browser }, use) => {
    const sourceHashes = await fingerprints();
    const esbuild = require("esbuild") as typeof import("esbuild");
    let javascript: Uint8Array;
    try {
      const output = await esbuild.build({
        entryPoints: [path.join(directory, "fixture.tsx")],
        write: false,
        bundle: true,
        platform: "browser",
        format: "iife",
        jsx: "automatic",
        nodePaths: [path.join(checkout, "node_modules")],
        define: { "process.env.NODE_ENV": '"development"' },
        plugins: [{
          name: "synthetic-actions",
          setup(build: PluginBuild) {
            build.onResolve({ filter: /^@\// }, args => ({
              path: args.path === "@/app/agent-actions"
                ? path.join(directory, "actions.ts")
                : path.join(checkout, "apps/web/src", args.path.slice(2)
                  + (args.path.includes("components/") ? ".tsx" : ".ts")),
            }));
          },
        }],
      });
      if (!output.outputFiles?.[0]) throw new Error("Missing fixture bundle");
      javascript = output.outputFiles[0].contents;
    } finally {
      esbuild.stop();
    }
    expect(await fingerprints()).toEqual(sourceHashes);

    const html = `<!doctype html><html lang="en"><meta charset="utf-8">
      <title>Synthetic consent feedback</title>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none';
        script-src 'self'; connect-src 'none'; form-action 'none'">
      <div id="root"></div><script src="/fixture.js"></script></html>`;
    const server = createServer((request, response) => {
      if (request.method !== "GET" || !["/", "/fixture.js"].includes(request.url ?? "")) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": request.url === "/" ? "text/html" : "text/javascript",
        "Cache-Control": "no-store",
      });
      response.end(request.url === "/" ? html : javascript);
    });
    let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    let externalAttempts = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing owned port");
      const origin = `http://127.0.0.1:${address.port}`;
      context = await browser.newContext({ serviceWorkers: "block" });
      await context.route("**/*", async route => {
        if (new URL(route.request().url()).origin === origin) await route.continue();
        else {
          externalAttempts++;
          await route.abort("blockedbyclient");
        }
      });
      const page = await context.newPage();
      await use({ page, origin });
    } finally {
      try {
        if (context) {
          for (const page of context.pages()) {
            await page.evaluate(() => window.consentFixture?.unmount()).catch(() => {});
          }
          await context.close();
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close(error => error ? reject(error) : resolve()));
      }
      expect(externalAttempts).toBe(0);
      expect(await fingerprints()).toEqual(sourceHashes);
    }
  }, { scope: "worker", timeout: 30_000 }],
});

const revokeForm = (page: Page, id: string) =>
  page.locator(`form:has(input[name="consentId"][value="${id}"])`);
const revokeStatus = (page: Page) =>
  page.locator('#capture-consent > p[role="status"][tabindex="-1"]');
const grantForm = (page: Page) =>
  page.locator('#capture-consent form:has(select[name="providerId"])');
const grantStatus = (page: Page) =>
  page.locator("#capture-consent").getByRole("status").filter({ hasText: "Consent granted." });

const calls = (page: Page) => page.evaluate(() => window.consentFixture.calls());
const settle = (page: Page, number: number, outcome: "success" | "error") =>
  page.evaluate(({ number, outcome }) => window.consentFixture.settle(number, outcome),
    { number, outcome });
const grantRows = (page: Page, id: string) =>
  page.evaluate(id => window.consentFixture.grant(id), id);
const revokeRow = (page: Page, id: string) =>
  page.evaluate(id => window.consentFixture.revoke(id), id);

async function dispatch(page: Page, kind: ConsentCall["kind"], id = ""): Promise<number> {
  const button = kind === "grant"
    ? grantForm(page).getByRole("button", { name: "Allow agents" })
    : revokeForm(page, id).getByRole("button", { name: /Revoke/ });
  await button.click();
  await expect.poll(async () => (await calls(page)).filter(call => call.kind === kind).length)
    .toBe(1);
  const call = (await calls(page)).find(call => call.kind === kind);
  if (!call) throw new Error("Missing synthetic action");
  return call.number;
}

async function grant(page: Page, id: string): Promise<void> {
  const call = await dispatch(page, "grant");
  await settle(page, call, "success");
  await grantRows(page, id);
  await expect(revokeForm(page, id)).toHaveCount(1);
  await expect(grantStatus(page)).toHaveCount(1);
}

test.beforeEach(async ({ consentHarness: { page, origin } }, testInfo) => {
  testInfo.annotations.push({ type: "coverage", description:
    "Actual React/DOM; synthetic actions and controlled props; no auth/Next/provider proof" });
  await page.goto(origin);
  await expect(grantForm(page)).toBeVisible();
});

test("grant then revoke clears obsolete grant success", async ({ consentHarness: { page } }) => {
  await expect(grantStatus(page)).toHaveCount(0);
  await grant(page, "fixture-consent-b");
  await expect(revokeForm(page, "fixture-consent-a")).toHaveCount(0);

  const denied = await dispatch(page, "revoke", "fixture-consent-b");
  await settle(page, denied, "error");
  await expect(revokeForm(page, "fixture-consent-b").getByRole("alert")).toBeVisible();
  await expect(grantStatus(page)).toHaveCount(1);
  await expect(revokeStatus(page)).toHaveText("");

  const success = await dispatch(page, "revoke", "fixture-consent-b");
  await settle(page, success, "success");
  await revokeRow(page, "fixture-consent-b");
  await expect(revokeForm(page, "fixture-consent-b")).toHaveCount(0);
  await expect(revokeStatus(page)).toContainText("revoked.");
  await expect(grantStatus(page)).toHaveCount(0);
});

test("revoke then grant clears obsolete revoke success", async ({ consentHarness: { page } }) => {
  const call = await dispatch(page, "revoke", "fixture-consent-a");
  await settle(page, call, "success");
  await revokeRow(page, "fixture-consent-a");
  await expect(revokeStatus(page)).toContainText("revoked.");
  await expect(grantStatus(page)).toHaveCount(0);

  const denied = await dispatch(page, "grant");
  await settle(page, denied, "error");
  await expect(grantForm(page).locator("..").getByRole("alert")).toBeVisible();
  await expect(grantStatus(page)).toHaveCount(0);
  await expect(revokeStatus(page)).toContainText("revoked.");

  await grant(page, "fixture-consent-c");
  await expect(revokeForm(page, "fixture-consent-a")).toHaveCount(0);
  await expect(revokeStatus(page)).toHaveText("");
});
