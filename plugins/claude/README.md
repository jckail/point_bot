# Claude instruction plugin

This folder has a Claude plugin manifest and a PointUp skill. Configure the default local stdio server or opt-in private bearer HTTP endpoint separately using [the MCP instructions](../../apps/mcp/README.md). No credentials or hard-coded local paths are shipped in the plugin. Installation and browser capability availability depend on the host; plugin installation is not an end-to-end authenticated integration test.

HTTP MCP requires a host that supports a private bearer Authorization header on every request. Each user supplies their own scoped PAT with `portfolio:read`; opt-in proposal tools additionally require `actions:propose`. The endpoint has no OAuth authorization flow and is not hosted or published by this plugin. Never share one user's PAT or publish it in plugin configuration.
