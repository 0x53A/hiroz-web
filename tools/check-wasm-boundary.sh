#!/usr/bin/env bash
# Lint resolved Rust calls, including aliases, after WASM cfg expansion.
# Cargo features alone cannot enforce this: dependencies unify Tokio features.
set -euo pipefail
REVIEW_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CLIPPY_CONF_DIR="$REVIEW_ROOT/tools/wasm-lints"
# A failing canary proves that the installed Clippy actually enforces the rule,
# including a renamed import. An unrelated compiler failure is not a pass.
CANARY_LOG="$(mktemp)"
trap 'rm -f "$CANARY_LOG"' EXIT
if cargo clippy --locked --manifest-path "$REVIEW_ROOT/tools/wasm-lints/canary/Cargo.toml" \
    --target wasm32-unknown-unknown -- -D clippy::disallowed_methods >"$CANARY_LOG" 2>&1; then
  echo "ERROR: forbidden Tokio call passed the boundary lint"
  exit 1
fi
if ! grep -q 'use of a disallowed method.*tokio::time::sleep' "$CANARY_LOG"; then
  cat "$CANARY_LOG"
  exit 1
fi
cd "$REVIEW_ROOT/examples/wasm-demo"
cargo clippy --locked --target wasm32-unknown-unknown --lib \
  -p hiroz-wasm-demo -p hiroz -p zenoh -p zenoh-ext -p zenoh-runtime -p zenoh-task \
  -p zenoh-link-ws -p zenoh-transport -p zenoh-util \
  -- -D clippy::disallowed_methods -D clippy::disallowed_types

cd "$REVIEW_ROOT/zenoh-wasm/tests/wasm"
cargo clippy --target wasm32-unknown-unknown --lib \
  -p zenoh -p zenoh-runtime -p zenoh-task -p zenoh-link-ws -p zenoh-transport -p zenoh-util \
  -- -D clippy::disallowed_methods -D clippy::disallowed_types
