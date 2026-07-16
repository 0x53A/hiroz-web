#!/usr/bin/env bash
# Rebuild both threaded WASM demos and refresh the GitHub Pages tree (docs/).
#
# Usage: ./publish-site.sh [--skip-build]
#
set -euo pipefail
cd "$(dirname "$0")"

ZENOH_EX=examples/wasm-threaded
HIROZ_EX=examples/wasm-demo

if [ "${1:-}" != "--skip-build" ]; then
  (cd "$ZENOH_EX" && ./build.sh)
  (cd "$HIROZ_EX" && ./build.sh)
fi

deploy() { # deploy <src-example-dir> <docs-subdir>
  local src="$1" dst="docs/$2"
  rm -rf "$dst"
  mkdir -p "$dst/pkg"
  cp "$src/index.html" "$dst/"
  # COOP/COEP shim, if the example ships one (needed when the host can't
  # send the headers itself; SharedArrayBuffer requires cross-origin isolation)
  [ -f "$src/coi-serviceworker.js" ] && cp "$src/coi-serviceworker.js" "$dst/"
  cp "$src"/pkg/*.js "$src"/pkg/*.wasm "$dst/pkg/"
}

deploy "$ZENOH_EX" zenoh-threads
deploy "$HIROZ_EX" hiroz

echo "docs/ refreshed:"
du -sh docs/*
echo "Commit and push to update the site."
