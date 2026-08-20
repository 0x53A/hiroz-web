#!/usr/bin/env bash
# Build the threaded hiroz demo (nightly + build-std; flags in .cargo/config.toml).
set -euo pipefail
cd "$(dirname "$0")"

cargo build --locked --target wasm32-unknown-unknown --release

# CLI schema version must match the wasm-bindgen crate in Cargo.lock (0.2.127):
#   cargo install wasm-bindgen-cli --version 0.2.127
WASM_BINDGEN="${WASM_BINDGEN:-}"
if [ -z "$WASM_BINDGEN" ]; then
  WASM_BINDGEN="$(command -v wasm-bindgen || true)"
fi
if [ -z "$WASM_BINDGEN" ] && [ -x "${CARGO_HOME:-$HOME/.cargo}/bin/wasm-bindgen" ]; then
  WASM_BINDGEN="${CARGO_HOME:-$HOME/.cargo}/bin/wasm-bindgen"
fi
if [ -z "$WASM_BINDGEN" ]; then
  echo "wasm-bindgen 0.2.127 not found. Install it with:"
  echo "  cargo install wasm-bindgen-cli --version 0.2.127 --locked"
  exit 1
fi

"$WASM_BINDGEN" \
  --target no-modules \
  --out-dir pkg \
  target/wasm32-unknown-unknown/release/hiroz_wasm_demo.wasm

echo ""
echo "Build complete. Run:"
echo "  docker compose up -d                       # ROS 2 stack + router"
echo "  python3 serve.py 8083                      # COEP server"
echo "  node run_headless.mjs                      # automated test"
echo "  # or open http://localhost:8083 for the interactive page"
