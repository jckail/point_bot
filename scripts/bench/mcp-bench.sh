#!/usr/bin/env bash
# MCP (HTTP transport) benchmark: starts the web app and the MCP server, loads
# /mcp tools/call with rotating bearer tokens, optionally profiles the MCP
# process (PROFILE=1), then stops both.
#
#   SERVER_DIR=/path/to/standalone-copy scripts/bench/mcp-bench.sh [label]
#
# Env: USERS (300), DURATION (8), CONNECTIONS (16), OUT_DIR (/tmp/pointup-bench).
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
label="${1:-mcp}"; out="${OUT_DIR:-/tmp/pointup-bench}"; mkdir -p "$out"
db="${BENCH_DATABASE_URL:-postgresql://postgres:password@localhost:5432/app_bench}"
psql "$db" -qc "update access_token set last_used_at = now()" >/dev/null

"$root/scripts/bench/start-web.sh" >"$out/$label.web.log" 2>&1 & web=$!
mcp_node_opts=""
if [ "${PROFILE:-0}" = "1" ]; then rm -rf "$out/prof-$label"; mcp_node_opts="--cpu-prof --cpu-prof-dir=$out/prof-$label"; fi
(cd "$root/apps/mcp" && POINTUP_URL=http://127.0.0.1:${PORT:-3100} PORT=8787 \
  exec node $mcp_node_opts --import tsx src/index.ts --http) >"$out/$label.mcp.log" 2>&1 & mcp=$!
trap 'kill -INT $mcp $web 2>/dev/null || true; wait 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:8787/healthz >/dev/null && curl -sf http://127.0.0.1:${PORT:-3100}/api/health >/dev/null && break; sleep 0.5; done

(cd "$root" && npx tsx scripts/bench/http.ts --target=mcp --base=http://127.0.0.1:8787 \
  --duration="${DURATION:-8}" --connections="${CONNECTIONS:-16}" --users="${USERS:-300}") | tee "$out/$label.txt"

kill -INT $mcp; wait $mcp 2>/dev/null || true; trap 'kill -INT $web 2>/dev/null || true' EXIT
if [ "${PROFILE:-0}" = "1" ]; then
  node "$root/scripts/bench/profile-summary.mjs" "$out/prof-$label"/*.cpuprofile --top=25 | tee "$out/$label.prof.txt"
fi
