# WASM integration review — 2026-09-09

This pass reviewed the current uncommitted Zenoh/hiroz ports, runtime boundaries,
action lifecycle, browser example command ingress, test verdicts and CI coverage.
It preserves the earlier port and does not deploy the published site. This is a
bounded software review, not a qualification of a physical robot's control loop.

## Confirmed fixes

- Zenoh compute-worker timer migration now rebinds the timer registration to the
  current executor while preserving its absolute deadline. A parked former owner
  can no longer hold the migrated timer until that worker resumes.
- Publishing from JS/TX contexts now uses nonblocking acquisition for the batch
  queue, current batch and sequence locks. A failed sequence acquisition restores
  the pulled batch. Other compute workers retain the bounded refill wait; native
  behavior is unchanged. Browser main-thread synchronous congestion remains a
  failure path, not permission to park its event loop.
- Browser WebSocket links reject nonbinary frames and close with an error rather
  than silently dropping them and leaving a read waiting indefinitely.
- Hiroz action request metadata is checked before use. Missing/malformed metadata
  no longer panics the shared GetResult task. Native queue receive timeouts now
  recheck their predicate against the original deadline after notifications.
  See [the detailed hiroz review](2026-09-09-hiroz-review.md) for upstream provenance
  and before/after reproductions.
- Demo velocity ingress is latest-only, carries monotonic enqueue time, and
  expires before publication. Stop, Cancel and Disconnect cannot be crowded out
  by a velocity flood. Cancel atomically removes earlier unstarted goals; later
  explicitly submitted goals retain their order. Disconnect is sticky and worker
  loss returns an enqueue error. This prevents delayed browser commands from
  being restamped as fresh at the worker, without claiming wire-level expiry.
- The WASM lint boundary also bans `Condvar::wait_timeout_while`: its standard
  library implementation internally calls unsupported `std::time::Instant`.
  Direct supported compute-worker waits remain available.

## Measurement correction

The earlier 157 ms figure was the maximum gap between latest telemetry events
seen by a 100 ms UI poll, after coalescing. It was not the complete ROS callback
cadence or network latency. The simulator nominally publishes every 50 ms
(20 Hz), with delay after work and earlier wakes on incoming commands.
The revised runner reports UI sample gap/drain age separately from monotonic
callback counts and maximum intervals recorded before coalescing. Device-local
publication/model events and groundstation decoded callbacks are distinct.

## Validation

The combined release WASM build passed. Integration checks on the rebuilt
example passed:

- Firefox: 10 pressure/mailbox checks and 10 checks including a 30-cycle
  drive/navigation/cancel soak, worker stalls, stale/recovery and watchdog.
- Chromium two-browser router-only demo: 12 checks.
- Native ROS Lyrical turtlesim: 11 actual groundstation UI checks, including
  RotateAbsolute success/cancellation and pending-server Stop/Disconnect.
- Chromium with native ROS actions: 25 checks, both client/server directions.
- UI fixtures: 8; browser verdict unit tests: 11; WASM boundary checks passed.

The Firefox soak recorded 1,873 decoded GS callbacks with a maximum 102 ms
interval before coalescing. Its 941 UI samples had a maximum 154 ms sample gap
and 54 ms drain age; peak live repoll timers was six. Device-local events had
a maximum 52 ms interval. These are observed maxima, not deadline guarantees.

An initial action fixture failed by requiring every transient Canceling snapshot
through a KeepLast(1) status subscriber. Source inspection confirmed adjacent
Canceling/Canceled publication; the fixture now requires correlated cancellation
acceptance, terminal Canceled result/status and consistent acceptance stamps.
The failing log is preserved at `/tmp/review-sep9-actions-before.log`; corrected
full interop passed. No production semantics were relaxed for this fixture.

Integration logs: `/tmp/review-sep9-demo-build.log`,
`/tmp/review-sep9-telemetry.log`, `/tmp/review-sep9-turtle.log`,
`/tmp/review-sep9-native-turtle.log`,
`/tmp/review-sep9-actions.log`, `/tmp/review-sep9-ui.log`,
`/tmp/review-sep9-verdicts.log`, `/tmp/review-sep9-boundary.log`.

Independent source-owner results also completed:

- Threaded Chromium: 16 core/link checks, 2 timer migration checks, 2 startup checks.
- Single-threaded Firefox: 11 runtime checks.
- Hiroz native: 69 action tests, 2 new timeout regressions, 9 queue tests.

Logs: `/tmp/review-sep9-threaded-browser.log`, `/tmp/review-sep9-timers.log`,
`/tmp/review-sep9-readiness.log`, `/tmp/review-sep9-firefox.log`,
`/tmp/hiroz-review-native-actions.log`, `/tmp/hiroz-queue-after.log`,
`/tmp/hiroz-queue-suite.log`.

The existing CI workflow already invokes these telemetry, action, native turtlesim,
UI and boundary runners, so the new cases are included through those entrypoints.
Workflow wiring was inspected locally; no hosted CI execution is claimed.

## Remaining limits and upstream work

Action feedback exposes a concrete **unbounded per-goal receiver**. A slow or
non-reading consumer can accumulate every matching feedback message indefinitely;
feedback QoS does not bound that queue. Drain/drop it today; a bounded/latest
public API requires an explicit compatibility decision. KeepLast also establishes
no message-age guarantee. Action result waits can intentionally last for an entire
goal and are not motor deadlines.

Browser suspension, GC, OS scheduling, transport recovery and internal library or
allocator locks have no demonstrated worst-case bound here. Async APIs or suitable
compute workers are required for waiting; no 200 ms end-to-end hardware deadline
has been validated. Unexpected connection loss does not guarantee cancellation of
an autonomous robot goal. Native turtlesim validates Twist/Pose/RotateAbsolute;
browser NavigateToPose schema/pair tests do not prove interoperability with native
Nav2 or a physical TurtleBot.

The upstream CDR allocation and code-generation drafts remain outstanding, as do
upstreaming the newly documented inherited metadata/queue fixes. Nothing has been
posted externally. Published `docs/pkg` assets are not regenerated by this review;
local example builds require reloading both browser windows to use the new WASM.
