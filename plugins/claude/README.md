# PointUp plugin for Claude

Skills + MCP connector for managing loyalty points, including consented
browser/computer-use balance capture that writes back to PointUp.

## Install

```
/plugin marketplace add jckail/point_bot
/plugin install pointup@pointup
```

Then set (shell profile or Claude Code settings `env`):

```
export POINTUP_MCP_URL="https://mcp.your-domain.example/mcp"   # or http://localhost:8787/mcp
export POINTUP_TOKEN="pu_..."                                   # Dashboard → Agents → New token
```

**Token scopes.** Give agents `portfolio:read`, `portfolio:write`, `observations:write`.
Add `consents:manage` only if you want Claude to be able to *ask* you for consent
interactively (it still needs your explicit yes). Omit it to grant consent solely in the dashboard.

## Local stdio alternative

Replace `.mcp.json` with:

```json
{ "mcpServers": { "pointup": {
  "command": "node", "args": ["apps/mcp/dist/index.mjs"],
  "env": { "POINTUP_URL": "http://localhost:3000", "POINTUP_TOKEN": "pu_..." } } } }
```

(`npm run build --workspace @pointup/mcp` first; use an absolute path in `args` since Claude Code
resolves it from your current directory, not the plugin's.)

## Notes

- Hosted vs. local: the default `.mcp.json` connects to a remote HTTP MCP server
  (`node apps/mcp/dist/index.mjs --http`, see `docs/agents.md`). The token is sent as
  `Authorization: Bearer ...` on every request and forwarded to the PointUp API.
- Balance-capture skills are marked `unverified` until a human has checked the provider's
  start URL; Claude will tell you when a URL is best-effort.
- The plugin has no hooks and needs no setup beyond the two environment variables.

## What's inside

| Piece | Purpose |
| --- | --- |
| `skills/portfolio-review` | Totals, trends, expiring points, goals, top actions |
| `skills/capture-balance` | Consent-gated browser/computer-use capture + write-back |
| `skills/expiry-rescue` | Keep expiring points alive cheaply |
| `skills/plan-redemption` | Trip planning against balances and transfer partners |
| `agents/balance-collector` | Sequential multi-program capture |
| `/pointup:balances`, `/pointup:capture <provider\|all>` | Shortcuts (commands are namespaced by the plugin name) |
