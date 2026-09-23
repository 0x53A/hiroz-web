# Final local review — 2026-09-08

Scope: current uncommitted changes in the parent project and both forks, including
the ROS 2 action port. This pass addresses confirmed local correctness and test
verdict defects. The proposed richer demo is deferred for a separate discussion.
No commits, pushes, publication, or upstream reports were made.

## Zenoh runtime and browser test fixes

- A JS-created `Sleep` moved onto a compute worker retained its JS backend. After
  the first signed-32-bit timer chunk, it could rearm a JS callback on the compute
  worker, whose event loop is permanently occupied by the Rust executor. Polling
  such a sleep on a compute worker now migrates it to the Rust timer queue while
  preserving its absolute deadline; its original callback is cancelled on the
  creating thread. The standalone browser regression deliberately delays the
  original JS callback, then verifies that the moved sleep completes at its
  deadline without that callback. This is a bounded backend-migration regression,
  not a literal multi-day-duration test.
- The action interoperability runner validated errors before shutdown but did not
  revisit them after the shutdown marker. Its final verdict now requires both
  peers' completion, browser shutdown, sufficient checks, and no browser errors
  or explicit failures. Unit regressions cover shutdown exceptions, late failure
  output, incomplete shutdown, and peer failure despite completion output.

An initial concern about cross-JS-thread flume wakeups was withdrawn after
inspecting the actual `js-sys` 0.3.104 atomic waker implementation. That dependency
uses `Atomics.waitAsync`/notification for cross-thread wakes. No fix was made for
that withdrawn concern.

## hiroz synchronization and action lifecycle fixes

- The WASM `RwLock` wrapper still acquired native read/write locks directly. Main
  browser threads cannot execute `Atomics.wait` when such locks contend with a
  worker. Read/write acquisition now uses non-parking try-lock loops, matching
  the existing WASM mutex approach. A browser regression holds each conflicting
  lock on a compute worker, verifies that the main-thread operation really waits,
  and checks the resulting data. This protects short synchronous critical
  sections; it does not make holding locks across an await safe.
- Action expiration previously separated choosing/removing expired state from
  producing its terminal reply. Expiry now changes active goals to their terminal
  state while holding the goal-manager lock, extracts result waiters atomically,
  and notifies them after unlocking. Generated actions retain the default Aborted
  result for the result timeout; handwritten actions without a default-result
  hook keep the previously documented fallback.
- Expiring an executing manual goal now sets its cooperative cancellation flag.
  A late handler completion cannot overwrite the retained Aborted result. Native
  regressions exercise stop notification, result retention/expiry, late success,
  and 128 expired goals with result waiters while preserving a future goal.
  The batch test verifies state/result invariants; it does not deterministically
  recreate the previous deadline-crossing interleaving.
- Accepted goals now carry a private per-instance identity, distinct from their
  protocol UUID. After expiration permits UUID reuse, old accepted/executing
  handles cannot transition, complete, or publish feedback for the replacement;
  automatic-handler cleanup also checks its original instance. Identity metadata
  is removed with the goal. A native regression reuses a UUID through the regular
  SendGoal service and verifies that stale handles do not change the replacement,
  which can complete normally. Public method signatures and public goal-state
  types are unchanged. Stale feedback returns an error; stale completion retains
  the existing no-op behavior.

The final saved source was checked after the hiroz review agent stopped: both the
non-parking lock acquisition and atomic expiry/stop-flag changes were present.
No temporary pre-fix source restoration was left in the workspace. The resumed
hiroz review then added the UUID-instance fix above and rechecked its final source.

## Validation

- Shared browser verdict unit tests: **11 passed**.
- Threaded release build: **passed**.
- Browser timer migration regression: **passed** (`/tmp/final-review-timer-migration.log`).
- Browser startup failure and terminal-retry regressions: **2 passed** (`/tmp/final-review-readiness.log`).
- Threaded runtime and WebSocket lifecycle suite: **15 passed**, no browser errors (`/tmp/final-review-threaded-browser.log`).
- Node script syntax and whitespace checks: **passed**.
- hiroz native expiration tests: **7 passed**, including both new regressions (`/tmp/final-expiry-suite.log`).
- hiroz threaded release build: **passed** (`/tmp/final-hiroz-lock-build.log`).
- Browser main/worker read and write lock contention: **passed** (`/tmp/final-review-lock-contention.log`). The first harness run rejected a favicon 404; an explicit data favicon fixed that fixture error without weakening console-error checks.
- Browser/ROS 2 actions: **25 checks passed**, including the final shutdown verdict (`/tmp/final-review-actions-browser.log`).
- Both WASM runtime boundary checks, including the negative canary: **passed** (`/tmp/final-review-boundary.log`).
- CI workflow `actionlint`: **passed** (`/tmp/final-review-actionlint.log`).

After the UUID-instance fix, the final source was rebuilt and checked again:

- Full native action suite: **67 passed**, including the UUID-reuse regression
  (`/tmp/final-identity-native-actions.log`; focused run `/tmp/final-reused-uuid.log`).
- hiroz threaded release build: **passed** (`/tmp/final-identity-wasm-build.log`).
- Browser/ROS 2 actions: **25 checks passed**, including final shutdown
  (`/tmp/final-identity-browser-actions.log`).
- Both WASM boundary checks and the negative canary: **passed**
  (`/tmp/final-identity-boundary.log`).
- Source whitespace check: **passed**. Disposable action containers and their
  HTTP/router listeners on 8084/7548 were verified absent afterward.

Both new browser regressions are included in the existing CI workflow. All test
HTTP servers and disposable router/ROS containers created during this pass were
stopped; unrelated processes and containers were left alone.

## Limits

This source review does not replace sustained-load, background/suspend, or deployed
browser qualification. Existing upstream reports remain separate, local drafts.
