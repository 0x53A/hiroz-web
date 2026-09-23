#!/usr/bin/env bash
# Real Firefox windows, isolated router, transport pressure and motion soak.
set -euo pipefail
cd "$(dirname "$0")"
TURTLE_ROUTER="hiroz-telemetry-test-$$"
cleanup() { docker rm -f "$TURTLE_ROUTER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if [ "${1:-}" != "--skip-build" ]; then ./build.sh; fi
export FIREFOX=1
export FIREFOX_BIN="${FIREFOX_BIN:-$(command -v firefox)}"
docker run -d --name "$TURTLE_ROUTER" -p 127.0.0.1:7648:7448 eclipse/zenoh:1.10.0 \
  --no-multicast-scouting --listen ws/0.0.0.0:7448 >/dev/null
node run_telemetry.mjs --pressure-only
node run_telemetry.mjs
