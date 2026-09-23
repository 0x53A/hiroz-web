# Iterative fork and integration review — 2026-09-23

The review started from integration commit `c800a8d`, hiroz `5ac8e027`, and
Zenoh `6e3c7b2d8`, after merging the upstream revisions recorded in the
[upstream cleanup review](2026-09-23-upstream-cleanup.md).

## Scope and stopping condition

Each pass covered the fork deltas and their nearby callers: runtime/task
ownership, browser timers and worker scheduling, WebSocket/transport lifecycle,
query and discovery cleanup, hiroz configuration and graph waits, action
admission/cancellation/results, code generation, and root example state,
reconnect and test wiring. Native upstream code was included where those paths
interact with it. This was not an exhaustive audit of every upstream crate or
optional native transport.

1. The first pass found configuration, timer and lifecycle issues. Fixes received
   focused regressions, followed by native and browser integration checks.
2. Rechecking the resulting code and broader validation exposed native task
   shutdown problems, a remaining skipped browser connection backoff, omitted
   runtime tests in the standalone script's `all` selection, and an inaccurate
   browser/router description in the previous review. These were corrected.
3. The final complete pass revisited the same boundaries and resulting changes.
   It found no new actionable issue. The applicable builds and tests passed.

That satisfies the requested stopping condition; it is not a claim that the
branches contain no undiscovered bugs.

## Fixes

| Area | Problem and resulting behavior |
| --- | --- |
| Zenoh workspace lockfile | Upstream's `js-sys`/`wasm-bindgen` versions conflicted with the fork's old `wasm-bindgen-futures`. A targeted update restores `--locked` workspace builds without broad dependency upgrades. |
| Browser deadlines | Session close and routed query/discovery cleanup skipped their deadlines. They now use the common runtime timer. Router tree recomputation and discovered-peer connection backoff also retain their delays. |
| Duration conversion | Session query and advanced-subscriber timers truncated fractional milliseconds and capped long durations. They now reuse the common duration-aware sleep. |
| Transport lease/keepalive | Browser resets could postpone expiry by an extra interval. Both platforms now measure the remaining idle interval. Dropping a clone no longer cancels the shared timer; dropping its final owner cancels the pending task on both platforms. |
| Native ring channel | Notifications whose data another consumer had already taken restarted the whole receive timeout. The wait now consumes a single timeout budget. |
| Native task termination | Canceling a join wait discarded its handle, preventing a later wait from observing actual completion. The handle is retained until completion. A task dropping its own owner cancels without waiting for itself. |
| hiroz managed actions | An unwinding native handler could leave its goal Executing indefinitely. A goal-instance guard retires unfinished goals on return, cancellation or unwinding, without affecting a subsequently reused UUID. |
| hiroz async builder | A configured native shared-memory provider did not enable the transport, unlike the synchronous builder. Async construction now applies the same setting before explicit overrides. |
| Test wiring | The standalone WASM script's `all` selection now includes runtime regressions. Root CI also checks the Zenoh workspace lockfile and new native regressions. |

The handler-panic test and both native task-termination tests failed before their
fixes and passed afterwards. The broad native Zenoh suite originally passed but
logged task-termination errors during topology teardown; the final rerun passed
without those errors. The native self-join test isolates that ownership problem.

Reusable commits are split by subject: Zenoh `e4b7e2274` (ring deadline),
`25026cd64` (task/timer ownership), and `e5b113d56` (browser deadlines and test
wiring); hiroz `39d7aed4` (managed goal cleanup) and `b052eadf` (async SHM setup).

## Validation

| Suite | Passing result |
| --- | --- |
| Native Zenoh library | 42 tests, including routing/topology, query reply, close deadline and ring receive timeout |
| Native transport timer ownership/reset | 3 tests |
| Native task termination | 2 tests |
| Native hiroz actions / graph / SHM | 71 / 24 / 8 tests |
| Native hiroz domain / QoS / queue / services | 4 / 16 / 9 / 6 tests |
| Firefox standalone WASM runtime / basic / session | 14 / 5 / 2 tests |
| Threaded browser runtime / socket and connection checks | 10 / 7 checks; no browser errors |
| Threaded startup / migrated timers | 2 / 2 checks |
| Both release WASM builds and runtime-boundary lint | Passed, including the negative canary |
| Browser-to-ROS talker | 4 browser checks and native listener receipt |
| UI / lock contention and resource release | 11 / 2 checks |
| Reconnect | Original node recovered both ROS directions after router restart |
| ROS action interop | 25 checks, both directions and completed shutdown |
| Two-browser turtle / native ROS turtlesim | 14 / 12 checks |
| Firefox telemetry | Two 10-check pressure runs and 30 drive/navigation/cancellation cycles |
| Browser verdict parser | 11 tests |
| Diff and shell syntax checks | Passed |

The final native task changes were rechecked with the full Zenoh library suite
and hiroz action, graph and SHM suites. The final browser backoff change was
rebuilt in both examples and checked with the standalone Firefox suites,
threaded runtime/socket suite and runtime-boundary lint. The ROS/telemetry runs
exercise client mode, which does not use discovered-peer backoff.

Firefox ran standalone WASM and telemetry checks; Chrome ran the other browser
harnesses. Standalone and threaded Zenoh checks used a disposable 1.10.1 router;
the checked-in ROS/turtle fixtures use 1.10.0, exercising cross-version interop.
Native checks used Rust 1.97.1. Threaded builds used that installed toolchain
with `RUSTC_BOOTSTRAP=1` for the existing `build-std` flags because the local
nightly installation was unusable. No toolchain policy was changed.

Reproduction commands are in `.github/workflows/wasm-ros-e2e.yml`, the example
test scripts, and `zenoh-wasm/tests/wasm/run-tests.sh`. Additional native checks:

```sh
# From zenoh-wasm
cargo test --locked -p zenoh --lib -- --test-threads=1

# From ros-z-wasm
cargo test --locked -p hiroz --test action --test graph --test shm -- --test-threads=1
cargo test --locked -p hiroz --test domain_id --test pubsub_qos --test queue --test service -- --test-threads=1
```

Raw local logs are `/tmp/iterate-*.log`; they are temporary validation artifacts,
not checked-in files or hosted CI results. Multi-day timer durations were not
waited out in real time: those paths reuse the tested shared sleep implementation.

## Remaining limits

The branch notes still apply: [Zenoh](../../zenoh-wasm/WASM.md) and
[hiroz](../../ros-z-wasm/WASM.md). Action feedback remains an unbounded public
receiver. Worker pools last until page unload; repoll timers and non-parking
locks have scheduling/CPU costs. Browsers support WS/WSS, not listening or
multicast transports. Blocking channel APIs that depend on native clocks are
not browser APIs; use async receives and platform timeouts.

The action guard handles unwinding and ordinary task cancellation. It cannot
recover from an aborting panic, including the current WASM panic strategy or a
native `panic=abort` build. Browser worker failure still requires reloading.
These tests do not establish hard timing guarantees, physical robot/Nav2
compatibility, or autonomous-goal cancellation after connection loss.
