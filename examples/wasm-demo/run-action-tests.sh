#!/usr/bin/env bash
# Disposable, isolated ROS2 action integration stack; does not restart other projects.
set -euo pipefail
cd "$(dirname "$0")"
SERVE_PID=""
compose=(docker compose -p hiroz-wasm-actions -f docker-compose.actions.yml)
cleanup() {
  [ -z "$SERVE_PID" ] || kill "$SERVE_PID" 2>/dev/null || true
  "${compose[@]}" down
}
trap cleanup EXIT
if [ "${1:-}" != "--skip-build" ]; then ./build.sh; fi
"${compose[@]}" up -d --build --wait
python3 serve.py 8084 &
SERVE_PID=$!
for _ in $(seq 20); do
  python3 -c 'import socket; socket.create_connection(("127.0.0.1", 8084), 1)' 2>/dev/null && break
  sleep 0.5
done
node run_actions.mjs
