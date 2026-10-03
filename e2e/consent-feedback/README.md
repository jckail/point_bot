# Consent feedback client regressions

This opt-in suite imports the actual `AgentsPanel` and shared UI from current
source. React19, StrictMode, `useActionState`, `useFormStatus` and real DOM controls
run normally. Only the server-action module is replaced with synthetic deferred
results; consent props change independently, with new grant IDs matching core
renewal semantics. No copied product source is maintained in this fixture.

From the repository root, the sole verification owner runs:

```sh
agent-heavy-check -- node e2e/node_modules/@playwright/test/cli.js test --config e2e/playwright.consent.config.ts
```

Use installed dependencies only. If the default browser is unavailable, the owner
may select an existing approved browser and its existing libraries for this command:

```sh
POINTUP_BROWSER_EXECUTABLE=/absolute/path/to/existing/chrome \
LD_LIBRARY_PATH=/absolute/path/to/existing/browser-libraries \
agent-heavy-check -- node e2e/node_modules/@playwright/test/cli.js test --config e2e/playwright.consent.config.ts
```

These are placeholders, not download/install instructions. Preserve the shared
foreground gate and current browser/process ownership. Do not retry unchanged
exit75 or overlap another verifier. The existing HTTP/MCP config and package scripts
are unchanged; this separate config selects only this directory. Invoking existing
`npm test` still runs the original HTTP suite and its MCP prebuild.

There are exactly two cases: grant→revoke and revoke→grant. Each proves real success,
new-ID renewal and failed-action retention before checking that obsolete success
feedback disappears. One worker/context/page, retries0, loopback-only in-memory
assets, blocked external context requests/service workers, and explicit server,
context and esbuild cleanup keep the fixture isolated. Product source hashes must
stay unchanged across build and tests. The existing verifier must retain bounded
process-group interruption cleanup around the Playwright CLI.

No real credentials, PATs, sessions, provider calls, API responses or payment data.
Do not replace synthetic labels with account data. Traces/screenshots/videos are
turned off. Context routing does not observe Chromium background traffic.

These tests establish React client behavior with mocked action transport and
controlled props. They do not establish Next/Flight/authenticated routes, actual core consent writes,
provider/model access, OS window focus loss or assistive-technology speech.
