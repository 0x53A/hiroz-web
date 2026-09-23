#!/usr/bin/env bash
# Test-only native ROS fixture; the interactive browser demo needs only zenohd.
set -euo pipefail
cd "$(dirname "$0")"
TURTLE_PROJECT="hiroz-turtle-native-$$"
cleanup() { docker compose -p "$TURTLE_PROJECT" -f docker-compose.turtlesim.yml down --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT
if [ "${1:-}" != "--skip-build" ]; then ./build.sh; fi
docker compose -p "$TURTLE_PROJECT" -f docker-compose.turtlesim.yml up -d --build
node run_turtle.mjs --native
