#!/usr/bin/env bash
# One labelled HTTP benchmark run: fresh server (optionally profiled), load, stop.
#
#   scripts/bench/web-bench.sh <label> [VAR=value ...]
#
# Env: SERVER_DIR (copy of .next/standalone), ROUTES (default summary,accounts,
# expiring,activity,providers,health), DURATION (8), CONNECTIONS (32), OUT_DIR
# (default /tmp/pointup-bench), USERS (rotating bearer tokens, default 1500). Writes <OUT_DIR>/<label>.txt and, with
# PROFILE=1, <OUT_DIR>/prof-<label>/ plus a summary in <label>.prof.txt.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
label="${1:?usage: web-bench.sh <label> [VAR=value ...]}"; shift || true
out="${OUT_DIR:-/tmp/pointup-bench}"; mkdir -p "$out"
db="${BENCH_DATABASE_URL:-postgresql://postgres:password@localhost:5432/app_bench}"

# Bearer tokens are "touched" (an UPDATE) at most once a minute; start every
# run from a state where that write is not on the measured path.
psql "$db" -qc "update access_token set last_used_at = now()" >/dev/null

if [ "${PROFILE:-0}" = "1" ]; then export PROFILE_DIR="$out/prof-$label"; rm -rf "$PROFILE_DIR"; fi
env "$@" "$root/scripts/bench/start-web.sh" >"$out/$label.server.log" 2>&1 &
pid=$!
trap 'kill -INT $pid 2>/dev/null || true; wait $pid 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:${PORT:-3100}/api/health" >/dev/null && break; sleep 0.5; done

(cd "$root" && npx tsx scripts/bench/http.ts --target=web \
  --routes="${ROUTES:-summary,accounts,expiring,activity,providers,health}" \
  --duration="${DURATION:-8}" --connections="${CONNECTIONS:-32}" --users="${USERS:-1500}") | tee "$out/$label.txt"

if [ "${PROFILE:-0}" = "1" ]; then
  kill -INT $pid; wait $pid 2>/dev/null || true; trap - EXIT
  node "$root/scripts/bench/profile-summary.mjs" "$PROFILE_DIR"/*.cpuprofile --top=30 | tee "$out/$label.prof.txt"
fi
