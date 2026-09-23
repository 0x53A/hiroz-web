#!/usr/bin/env bash
# Two independent browser contexts and one disposable Zenoh router; no ROS peers.
set -euo pipefail
cd "$(dirname "$0")"
TURTLE_ROUTER="hiroz-turtle-test-$$"
cleanup() { docker rm -f "$TURTLE_ROUTER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if [ "${1:-}" != "--skip-build" ]; then ./build.sh; fi
docker run -d --name "$TURTLE_ROUTER" -p 127.0.0.1:7648:7448 \
  eclipse/zenoh:1.10.0 --no-multicast-scouting --listen ws/0.0.0.0:7448 >/dev/null
node run_turtle.mjs
