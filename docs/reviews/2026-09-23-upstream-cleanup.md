# Upstream merge and browser cleanup — 2026-09-23

These branches implement browser support for Zenoh and hiroz. The entry points are [Zenoh's branch notes](../../zenoh-wasm/WASM.md)
and [hiroz's branch notes](../../ros-z-wasm/WASM.md). Clone this integration
repository recursively to obtain the matching dependencies and runnable demos.

## Upstream baseline

Both upstream mains were fetched and merged before cleanup:

| Fork | Upstream main included | Local merge |
| --- | --- | --- |
| hiroz | `c50384343167e43bc86f0b18681e670708449184` | `1e7ac13e` |
| Zenoh | `9fcd9cb5d364192c3e8a27e66de76f4bc750d1d5` (1.10.1) | `e6c4b8f70` |

The merges retain upstream message-loss tracking and native graph backfill
capacity, alongside asynchronous browser history handling. Native serial
transport remains enabled. The example lockfiles use the matching Zenoh version.

## Corrections and simplification

- Browser transport opening, acceptance and flushing now use the shared timer
  adapter instead of bypassing deadlines. A stalled handshake regression checks
  expiry and successful connection through an alternate endpoint.
- Browser connection startup reuses upstream endpoint selection and retry logic.
  The three duplicated mode-specific implementations were removed. Listener
  startup propagates inner errors instead of discarding them.
- Unsupported browser low-latency transport returns an error before connecting.
  Its panic-prone browser implementation was removed; native code matches
  upstream in those implementation files.
- hiroz async context creation propagates configuration errors. Action client
  cleanup relies on its existing registration guard. An unused result-handler
  cancellation token and misleading lifecycle comments were removed.
- Shared clock/sleep paths replace redundant target branches. Unused lock aliases,
  unrelated formatting, obsolete demo exclusions and dependency-version churn
  were removed. The fixed historical WebSocket report now lives
  [here](historical-ws-listener-bug.md), outside the Zenoh library diff.

Measured against the newly merged upstream mains with `git diff --numstat`
(additions plus deletions), before adding the new browser documentation:

| Fork | After merge | After cleanup | Reduction |
| --- | ---: | ---: | ---: |
| hiroz | 4,355 lines / 36 files | 2,898 lines / 34 files | 33% |
| Zenoh | 5,426 lines / 70 files | 5,016 lines / 68 files | 8% |

The combined Rust-code reduction is 355 changed lines. Much of the remaining
hiroz reduction comes from rebuilding its lockfile from upstream rather than
retaining unrelated dependency upgrades. Zenoh's total includes moving the
historical report; these figures are diff size, not source-code size or runtime
performance claims. The new documentation is intentionally additional.

## Fresh validation

All checks below passed after the merges and production-code cleanup. Firefox
ran the standalone runtime and telemetry checks; the other example harnesses
used Chrome. The threaded runtime used a Zenoh 1.10.1 router; the checked-in ROS
and turtle fixtures use Zenoh 1.10.0. The local nightly was
unusable, so threaded builds used installed Rust 1.97.1 with
`RUSTUP_TOOLCHAIN=1.97.1 RUSTC_BOOTSTRAP=1` for the existing `build-std` flags.
That is a local validation workaround, not a change to the project's toolchain.

| Check | Result |
| --- | --- |
| Native hiroz check | Passed |
| Native actions | 70 tests |
| Queue timeout unit tests / queue integration | 2 / 9 tests |
| Nested action dependency code generation | 1 test |
| Single-thread browser runtime | 13 tests, including timeout cancellation and low-latency rejection |
| Both browser release builds and runtime-boundary checks | Passed, including negative canary |
| Threaded startup / timer migration | 2 / 2 checks |
| Threaded runtime / WebSocket lifecycle / connection deadline | 10 / 6 / 1 checks; no browser errors |
| ROS talker | 4 browser checks plus native listener receipt |
| UI and fixtures / lock contention and resource release | 11 / 2 checks |
| Reconnect | Existing node communicates in both directions after reconnect |
| Two-browser turtle | 14 checks |
| ROS action interop | 25 checks, both directions and completed shutdown |
| Native ROS turtlesim | 12 checks, including reconnect after worker completion |
| Telemetry | Two 10-check pressure runs plus 30 drive/navigation/cancel cycles |
| Browser test verdict parser | 11 tests |
| Whitespace checks | All three repositories passed |

Reproduction entry points are `tools/check-wasm-boundary.sh`,
`tools/tests/browser-test-result.test.mjs`, the `run*.mjs` harnesses in
`examples/wasm-threaded`, and the `run-*-tests.sh` scripts plus `run-tests.sh`
in `examples/wasm-demo`. Library test commands are in the branch notes.
Local raw logs for this run are `/tmp/upstream-*.log`; those temporary logs are
not shipped with the repository. This was local validation, not a hosted CI run
or an exhaustive native workspace test.

## Remaining compromises

Browser networking is WS/WSS only. There is no browser low-latency transport,
UDP scouting, listening router, native plugin loading or shared-memory transport.
The shared-memory worker execution pool is a separate feature and requires
cross-origin isolation. It lives until page unload; failed startup requires a
reload. Cross-worker receive repoll timers and non-parking shared locks still
have CPU and scheduling costs. Background tabs can be throttled or suspended.

Action feedback receivers remain unbounded, so consumers must drain or drop
them. Discovery history is asynchronous. The async context builder does not
apply native config-file/environment overrides. Socket send acknowledgement
means browser acceptance, not remote application receipt; receive overload
closes the connection because browser WebSockets offer no receive backpressure.

The tests establish browser/ROS fixture behavior, including simulated-device
watchdogs. They do not establish hard control deadlines, cancellation of an
autonomous goal after connection loss, native Nav2 compatibility, or physical
TurtleBot operation.
