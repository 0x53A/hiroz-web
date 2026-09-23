# Local changes and system review — 2026-09-22

Reviewed the uncommitted changes across the root project and both submodules,
with emphasis on executor/timer ownership, WebSocket lifecycle, action cleanup,
queue deadlines, generated action hashes, browser command/telemetry handling,
and integration/CI coverage. Existing work was preserved; no commits, pushes or
deployment were performed. Earlier review results were checked against fresh
builds rather than treated as current validation.

## Fixes in this pass

- **Session task ownership:** dropping a Zenoh join handle detaches its task.
  Profile setup/publication errors could therefore leave action tasks holding
  resources after the profile returned. `SessionTasks` aborts owned tasks on all
  exits, including owner cancellation; normal cleanup keeps handles owned while
  awaiting them. Publication errors now enter the same cancel/stop cleanup path
  as an explicit disconnect. A browser regression checks resource release for
  both newly dispatched and already running tasks.
- **Telemetry age:** wall-clock adjustments affected the motion freshness
  interlock. Worker events now include `received_monotonic_ms`, measured with
  `performance.timeOrigin + performance.now()`. The page and telemetry runner
  use that clock for sample age and delivery measurements. The wall-clock
  `received_ms` field remains for display/log consumers. Missing monotonic
  timestamps do not enable motion, so the UI and WASM must be updated together.
- **Map rendering:** a zero-size canvas could produce an invalid grid scale.
  Collapsed maps skip drawing; grid iteration is bounded by viewport dimensions
  and a maximum line count. The UI regression covers hiding/restoring the map.
- **Integration runners:** the turtle and telemetry suites shared HTTP port
  8085 and collided when run concurrently. Each now requests an OS-assigned
  port. Browser launch is inside the cleanup scope, so launch failure closes
  the HTTP listener instead of leaving the runner alive. Both failure paths
  were checked with a missing browser executable and exited promptly.
- **ROS fixture builds:** fresh image builds reproduced a loader failure:
  `has_buffer_fields_service_msgs__msg__ServiceEventInfo` was missing. The base
  image contained August service/action message libraries while newly installed
  example interfaces came from September. Both Dockerfiles now upgrade base
  packages against the same index before installing fixtures. The talker runner
  uses `--build` so Dockerfile fixes also apply when a local image already exists.
- **CI:** added a native job for the action lifecycle suite, queue deadline
  regressions, queue integration tests and nested action hash generation.
  The existing browser lock runner also exercises session task cleanup.

## Fresh validation

| Check | Result |
| --- | --- |
| Both release WASM builds | Passed |
| WASM runtime boundary, including negative canary and both runtime modes | Passed |
| Native action lifecycle | 69 passed |
| Native queue deadlines / queue integration | 2 / 9 passed |
| Nested action dependency/hash generation | 1 passed |
| Browser test-result validator | 11 passed |
| Served UI and fixtures | 11 passed |
| Browser lock contention / session task ownership | 2 passed |
| Chromium threaded runtime and WebSocket lifecycle | 16 passed, no browser errors |
| Worker readiness / timer migration | 2 / 2 passed |
| Firefox single-threaded runtime | 11 passed |
| Two-browser router-only demo | 12 passed |
| Firefox pressure and 30-cycle motion/navigation/cancellation soak | 10 + 10 passed |
| Native ROS turtlesim through the groundstation UI | 11 passed |
| Native ROS action interoperability | 25 passed, both directions |
| Native ROS talker/listener | 4 browser checks plus native receipt confirmation |
| Router restart with the original browser node | Both ROS directions recovered |
| Workflow actionlint and diff whitespace checks | Passed |

The final Firefox soak recorded 1,772 decoded groundstation callbacks, a maximum
callback interval of 353 ms, a maximum UI sample gap of 353.56 ms, and maximum
drain age of 62.16 ms. Peak live repoll timers was six. These are observations
under this machine's concurrent workload, not worst-case latency guarantees.

The default nightly binaries could not start because their embedded Nix loader
path no longer existed. Validation used the working Rust 1.97.1 toolchain;
threaded WASM builds and boundary checks used `RUSTC_BOOTSTRAP=1` for `build-std`.
No global toolchain settings were changed. This does not establish a successful
build on the current CI nightly. Existing compiler warnings remain; boundary
lint errors were absent. Hosted CI itself was not run.

Logs are under `/tmp/sep22-*.log`, notably `native-actions`, `queue`, `codegen`,
`demo-final-build`, `threaded-build`, `boundary`, `served-ui`, `locks`,
`threaded-runtime`, `readiness`, `timer-migration`, `firefox-runtime`,
`telemetry-final`, `native-turtle-final`, `actions-final`, `talker`, and `reconnect`.
Initial failed runs remain separate from the corrected `*-final` logs.

## Remaining scope

The action client's public per-goal feedback receiver remains unbounded, as
documented in the September 9 review. A slow consumer must drain or drop it;
changing that public API needs a separate compatibility design. Browser
scheduling and synchronous critical sections still have no proven hard deadline.
Native Nav2/physical robot interoperability was not tested by these fixtures.
Generated example packages were rebuilt locally; published `docs/` WASM assets
were not regenerated.
