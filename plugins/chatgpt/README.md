# PointUp for ChatGPT

Two supported paths. Use whichever your ChatGPT plan offers; both hit the same API and the same scope/consent checks.

## A. Custom GPT with Actions (works on most paid plans)

1. Generate the spec (kept in sync with the API contracts):
   ```bash
   POINTUP_URL=https://app.your-domain.example npx tsx plugins/chatgpt/build.ts
   ```
2. ChatGPT → *Explore GPTs* → *Create* → **Configure**:
   - Name / description / instructions / conversation starters: copy from [`gpt-config.md`](./gpt-config.md).
   - **Actions → Create new action → Import** `plugins/chatgpt/dist/openapi.json`.
   - **Authentication → API Key → Bearer**, paste a PointUp token (`pu_…`) with scopes
     `portfolio:read portfolio:write observations:write` (no `consents:manage`).
   - Privacy policy URL: your deployment's policy page (required to publish beyond "only me").
3. Every write action is marked `x-openai-isConsequential`, so ChatGPT asks the user before each one.

> Per-user keys: a GPT Action API key is one shared secret for everyone who uses the GPT.
> Keep the GPT **private** (only you), or host a PointUp OAuth endpoint and switch the action to OAuth
> so each user authorizes their own account.

## B. MCP connector (ChatGPT developer mode / Apps)

Run the remote MCP server (`npm run build --workspace @pointup/mcp && node apps/mcp/dist/index.mjs --http`),
expose `https://mcp.your-domain.example/mcp`, and add it as a connector with header
`Authorization: Bearer pu_…`. This gives ChatGPT the full tool set, including `pointup_request_consent`
(interactive consent) and the `capture-balance` playbook prompt.

## Browser/computer use in ChatGPT

Use ChatGPT agent mode with the PointUp connector: tell it *"refresh my United balance with PointUp"*.
The skill playbook (`pointup_list_skills`) keeps it on the allow-listed hosts, and write-back is rejected
unless you granted consent for that program in the dashboard.
