#!/usr/bin/env bash
# Starts the built standalone web server for benchmarking (dev auth, scratch DB),
# optionally with a V8 CPU profile written on exit.
#
#   (cd apps/web && SKIP_ENV_VALIDATION=1 npx next build)
#   PROFILE_DIR=/tmp/prof scripts/bench/start-web.sh &      # stop with: kill -INT $!
#
# Env: PORT (3100), BENCH_DATABASE_URL, PROFILE_DIR (enables --cpu-prof),
#      DB_POOL_MAX / any other server env is passed through.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
export PORT="${PORT:-3100}" HOSTNAME=127.0.0.1 NODE_ENV=production
export AUTH_PROVIDER=dev ALLOW_INSECURE_DEV_AUTH=true DEV_USER_ID="${DEV_USER_ID:-bench_user_10}"
export DATABASE_URL="${BENCH_DATABASE_URL:-postgresql://postgres:password@localhost:5432/app_bench}"
if [ -n "${PROFILE_DIR:-}" ]; then
  mkdir -p "$PROFILE_DIR"
  export NODE_OPTIONS="${NODE_OPTIONS:-} --cpu-prof --cpu-prof-dir=$PROFILE_DIR"
fi
# SERVER_DIR: a copy of apps/web/.next/standalone (lets you keep a build while rebuilding).
exec node "${SERVER_DIR:-$root/apps/web/.next/standalone}/apps/web/server.js"
