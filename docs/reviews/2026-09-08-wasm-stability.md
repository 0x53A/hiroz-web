# WASM stability review — 2026-09-08

The Zenoh/hiroz browser stack is materially improved, but this review does not
establish full ROS 2 feature parity or production readiness for the groundstation.
Extended load testing, background-tab behavior, and one upstream CDR
robustness defect remain outstanding.

## Baseline and upstream integration

The parent repository and both submodules were clean at the start. Reviewed:

- Zenoh WASM branch: `2eef4331e` initially; merged current upstream
  `b4107719c9d996237e3b3a942635f2f9b3cbc938`, producing merge `857227ab`.
- hiroz WASM branch: `b20fe52` initially; merged current upstream
  `844e1592802220b3cf024e369436db60991c60fc`, producing merge `c841ceab`.

Both merges were clean. The hiroz merge includes the nested action-message hash
fix (#339). Review fixes are local changes on top of these merges; no push,
publication, or upstream issue posting was performed.

Scope: the root demo projects, fork-specific runtime/transport/task changes,
hiroz browser-facing clock/service/discovery paths, and targeted CDR review.
An independent subagent reviewed the runtime fixes and added regressions.
This was a timed review, not an exhaustive audit of the full upstream projects.

## Fixed in this review

| Area | Failure | Change |
|---|---|---|
| Single-thread task join | A fresh flume receive future was dropped after every Pending poll, removing its wake registration | Keep one receive future in the handle |
| Task cancellation | `abort()` was a no-op; custom cancellation only checked before starting work; child cancellation cancelled its parent | Abortable task wrapper and runtime-independent `tokio-util` cancellation token |
| Task accounting | Aborted tasks could leave the controller's count nonzero | RAII completion guard; async termination waits for task cleanup |
| Executor fairness | Repeated self-wakes/yields could keep `pump()` running forever, starving timers and nested `block_on` | Bounded pump turns with one ready task removed at a time |
| Executor storage | Completed tasks left permanent vector slots | Live task map with monotonically increasing IDs; no stale-waker ID reuse |
| Nested scheduling | Nested polling could consume a suspended caller's wake, or spin on that caller | Preserve active-task wakes; ignore suspended callers when deciding whether to sleep |
| Compute timers | Every repoll appended a timer, and dropping a sleep left registrations behind | Owned registration, waker updates and removal on drop; replace expired registrations during migration |
| Clock behavior | `Date.now()` was used for deadlines; unsigned durations could overflow browser timer arguments | Monotonic performance clock aligned by time origin; long sleeps chunked; checked duration arithmetic |
| Browser channel contention | Standard flume mutexes can invoke forbidden Atomics.wait on the page under cross-worker contention | Enable flume spin locks on the WASM dependency boundary |
| Worker startup | `eval` and string interpolation made startup depend on unsafe-eval permission and fragile quoting | Browser URL API and JSON string encoding |
| Blocking on JS threads | `block_in_place` could block the Acceptor event loop indefinitely | Only compute executors pump/block; JS threads fail explicitly if a future is Pending |
| WebSocket closure | Closing dropped one receive sender but another stayed captured by onmessage | One JS-local owner detaches/drops all callbacks and closes on every exit path |
| Connection cancellation | Abandoned handshakes and dropped links could leave callbacks/socket tasks alive | Owner observes cancellation while connecting and after open |
| WebSocket writes | Write returned success before JS send; errors were only logged | Per-write acknowledgement, open-state check, and browser send-backlog throttling |
| WebSocket receive | Rust receive backlog was unbounded; empty frames could produce zero-byte reads | Bound backlog to 128 MTU-sized frames; close on overflow/oversized frame, ignore empty frames |
| WSS | Socket code recognized TLS, but transport dispatch rejected `wss/` | WASM dispatch recognizes `wss/`; preserve endpoint locator |
| hiroz timers | System-clock sleep immediately returned; service/discovery waits used Tokio execution facilities | Platform timeout/Instant and actual WASM clock sleep |
| hiroz synchronization | Condvar adapter moved guards through raw pointers | Owned optional guard transfer, with safe Rust drop behavior |
| Unsupported APIs | Actions and storage timers compiled into unported execution/stubs | Initially gated native-only; actions subsequently ported and tested below. Storage Timer remains native-only; WASM context uses build_async/shutdown_async |
| Test results | Browser runners could report success after timeout; pub/sub test could use local delivery | Shared completion/failure rules, negative tests, and two distinct Zenoh sessions for router roundtrip |
| CI | wasm-bindgen CLI version differed from the lockfiles | Match 0.2.127; add runtime boundary and threaded lifecycle checks |

The timer migration interleaving was found through source review, not reproduced
with a deterministic race test. Do not count that as a demonstrated race regression.

## Systematic prevention

Run [`tools/check-wasm-boundary.sh`](../../tools/check-wasm-boundary.sh).
The WASM-only Clippy configuration rejects Tokio execution/timer methods and
runtime types, plus native clock/thread entry points. It checks resolved calls
(including renamed imports) after Rust's target configuration has removed native
code. A deliberately forbidden alias is compiled first as a negative canary; the
script requires the expected lint diagnostic, rather than accepting any build error.

The check covers the browser demo and hiroz/Zenoh runtime, task, transport, extension and utility
packages in the threaded demo, and the corresponding single-thread Zenoh build.
CI runs it on pushes, pull requests and manual runs. It is a defined API denylist,
not a proof that all future dependencies are browser-safe; extend it when adding a
new execution backend or runtime-dependent API.

Tokio synchronization and `tokio-util` cancellation remain allowed: they do not
require a Tokio executor. Cargo features alone cannot enforce this distinction,
because dependency feature unification can re-enable runtime features. Native
builds retain their existing Tokio behavior.

Application-side rules:

- Use `ZContextBuilder::build_async()` and `ZContext::shutdown_async()` in WASM.
- Keep hiroz/Zenoh processing on a compute worker; communicate with the page using
  channels and the runtime's cross-worker receive adapter.
- Use hiroz's clock/service/discovery APIs or the platform timer, not direct Tokio
  execution calls. Use async operations on JS event-loop threads.
- ROS action clients and servers now use the platform runtime on compute workers;
  see the action-port validation appended below.

## Validation

Commands and counts from this session are recorded here; final integration
results are appended below. Tests use a disposable local ROS 2 Lyrical/rmw_zenoh
Docker stack and headless browser instances, not a robot connection.

- Single-thread Firefox runtime regressions: **9 passed**, including pending
  joins, abort before/after first poll, detach-on-drop, cancellation hierarchy,
  controller counts, monotonic sleep and long-duration arithmetic.
- Native hiroz clock tests: **22 passed** (`cargo test -p hiroz --lib time::`).
- Browser result validation: **7 passed** (`node --test tools/tests/browser-test-result.test.mjs`).
- Boundary check: both threaded and single-thread builds passed; the alias canary
  failed with the intended `tokio::time::sleep` diagnostic.
- Earlier combined browser run: 8 threaded core tests plus remote-close check;
  hiroz's 4 checks covered clock/service/discovery timers and ROS 2 pub/sub.

Reproduction commands:

```sh
./tools/check-wasm-boundary.sh
node --test tools/tests/browser-test-result.test.mjs
cd examples/wasm-demo
./run-tests.sh --keep-stack
# In another terminal, while that disposable router is running:
cd examples/wasm-threaded
./build.sh
python3 serve.py 8082
# In another terminal from examples/wasm-threaded:
node run_headless.mjs 60
# Single-threaded, from zenoh-wasm/tests/wasm:
nix shell nixpkgs#geckodriver --command wasm-pack test --headless --firefox -- --test runtime
```

The threaded runner requires Node dependencies, Chrome and OpenSSL. It creates
local WS, TLS and unfinished-handshake peers on ports 7449–7451 and removes them
on exit. Its certificate bypass applies only to its disposable test browser.

Final verification after the channel-lock change:

- Threaded Chrome: **13 checks passed** (8 core plus 5 WebSocket/TLS/lifecycle
  checks), no browser errors; includes oversized-frame handling.
- hiroz Chrome/ROS: **4 checks passed**, then **3 additional full runs passed**.
- Router restart: **passed** with the original WASM node and pub/sub handles
  retained; ROS talker reception resumed and the native listener received a new
  unique browser marker. Outbound messages were retried while discovery settled;
  this does not assert delivery of the very first publication after reconnect.
- Firefox runtime suite rerun after the channel configuration change: **9 passed**.
- Complete boundary script including negative canary, library checks and demo
  application check: **exit 0**. Shell syntax and all repository diff checks passed.
- New upstream action dependency/hash regression: **1 passed**.

One earlier late rerun reported `Atomics.wait cannot be called in this context`.
The WASM flume configuration was then changed to spin-based channel locks, since
standard channel mutexes can contend on the browser main thread. The subsequent
runs above passed. This is not a long-running contention proof; retain this case
in future load qualification. The receive-side and timer-migration limits likewise
need sustained testing beyond these bounded regressions.

Run the restart probe with the local demo HTTP server and disposable stack active:
`node examples/wasm-demo/run_reconnect.mjs --disposable-stack`. It deliberately
restarts that stack's router and ROS container; it does not recreate the WASM node.

## Outstanding work before a groundstation migration

1. **Upstream CDR allocation behavior:** see the standalone
   [upstream report and reproduction](2026-09-08-cdr-upstream.md). No production
   CDR implementation was changed in this review.
2. **Action deployment qualification:** the action port and ROS interoperability
   suite are implemented (see below); prolonged load and other ROS distributions
   remain outside this validation.
3. **JS timer background throttling:** cancelled callbacks are now reclaimed by
   their owning thread's shared cleanup timer (normally the next 16 ms tick).
   Browser suspension can delay that tick; no cleanup can run on a suspended
   event loop. Compute timers still clean up directly on drop.
4. **Lifecycle/load qualification:** test hours of repeated connect/disconnect,
   repeated router restarts with retained subscriptions, large camera/point-cloud traffic,
   slow consumers, and bounded-memory behavior under sustained load. The new
   backlog caps are defensive limits, not throughput qualification.
5. **Backgrounding and suspend/resume:** worker timers avoid some page timer
   throttling, but the Acceptor still needs its event loop and browsers can
   suspend pages. Verify keepalives, lease loss and recovery on target browsers.
6. **Worker failure recovery:** the production async initialization API now
   reports readiness, script errors and startup timeout. Failure is terminal for
   that shared-memory instance: reload the page. It does not safely restart a
   worker that may have stopped while holding a Rust lock. The legacy synchronous
   init API still reports dispatch only; both examples await the async API.
7. **Remaining synchronous semantics:** some Zenoh synchronous `.wait()` APIs are
   only usable when immediately ready on JS threads. The fail-fast guard exposes
   this limitation; it does not make blocking browser APIs possible. Task
   synchronous termination remains nonblocking on JS event-loop threads and
   now reports actual completion; compute workers support a timed join. Use
   async termination when completion matters on JS threads.

The earlier `docs/zenoh-wasm-tasks/KNOWN_ISSUES.md` contains historical claims
that were too strong (notably closure cleanup/reconnection and Date-based timing).
Use this review and actual regression results as the current qualification record.

## Follow-up: task shutdown lifecycle

`TerminatableTask::terminate_async` now borrows its join handle until completion.
Dropping the shutdown future or timing it out retains the handle, so a later
shutdown can still wait for the original task. `terminate_async_timeout` offers
an explicit bounded wait. Synchronous termination no longer reports success
for a still-running task: JS event-loop threads return current status, while
compute workers pump their executor until completion or the requested timeout.
TaskController's synchronous shutdown likewise honors the timeout on compute
workers. Cancellation remains cooperative; timeout does not force-abort tasks.

Regression coverage includes cancelling an in-progress shutdown, timing out and
retrying it, repeated shutdown, and compute-worker timed shutdown with a task on
the same executor. The single-threaded Firefox suite passes all 10 tests; the
WASM compiler boundary check passes for both configurations. The threaded Chrome
suite passes all 9 core and 5 link lifecycle checks, with zero browser errors.
JS timer callback cancellation was addressed in the subsequent pass below.

## Final local review: timer ownership and worker startup

Reviewed the runtime executor, join/cancellation paths, timer backend and WebSocket
ownership in Zenoh, and the compatibility layer, context lifecycle, clocks,
discovery waits, pub/sub and services in hiroz. This is a review of the WASM
foundation and changed paths, not a claim that every upstream feature is ported.

- JS sleep futures carry channel receivers only. A thread-local owner retains
  timer callbacks and IDs; one cleanup callback per JS thread clears cancelled
  timers and releases completed callbacks. Cleanup stops and releases the empty
  registry allocation when no timers remain. It never calls clearTimeout from
  a worker that did not create that timer. Long sleeps dropped before polling
  and sleeps moved to another worker are covered by regressions.
- Executor wake-state locking now uses try_lock/spinning on JS event-loop
  threads. Only compute workers use the blocking mutex path. This closes another
  route to main-thread Atomics.wait beyond the earlier flume feature change.
  Critical sections do not poll futures or await; sustained contention and the
  wider dependencies' synchronization still require load qualification.
- Worker initialization now offers a bounded async API, explicit script/init
  errors and a terminal timeout. Readiness is signalled after the executor is
  installed. Worker JS objects/callbacks have thread-local ownership; the unsafe
  SendWrapper for worker handles was removed. Both examples await readiness;
  the arbitrary 500 ms startup delay is gone. New tasks are rejected after a
  recorded failure; existing task handles do not falsely claim completion.
- The interactive Connect handler now awaits startup in an async handler and
  displays rejected startup errors. A real-page smoke test catches HTML script
  parse failures and verifies the error state; the ROS headless page alone did
  not exercise that UI path.
- Browser fixtures exercise a missing shim and a shim whose initialization never
  resolves, including retry after terminal failure. CI runs those fixtures and
  now has a separate single-threaded Firefox runtime regression job.

Sustained load and browser suspend/recovery remain qualification work.
The separate upstream CDR report is still unposted. Changes remain uncommitted in
both forks and the parent repository; no remote CI run or publication was made.

Final validation after these changes:

- Firefox single-threaded runtime: **11 passed**.
- Chrome threaded runtime and WebSocket lifecycle: **10 core + 5 link checks passed**,
  zero browser errors.
- Startup failure fixtures: **2 passed** (missing shim and stalled initialization,
  including terminal retry behavior).
- Interactive-page startup-error smoke test: **passed**.
- hiroz browser timers, service/discovery timeouts and ROS pub/sub: **4 passed**.
- Router restart with original WASM node retained: **both ROS directions recovered**.
- Compiler runtime boundary: **passed** for threaded hiroz/demo and single-threaded
  Zenoh, including the negative lint canary.
- Browser-result verdict unit tests: **7 passed**; actionlint, script syntax and
  diff whitespace checks passed. Remote GitHub execution is still unverified.

The temporary HTTP servers and disposable Docker stack were stopped after testing.


## ROS 2 actions implementation and final verification

Actions are now implemented for the hiroz Application compute worker: clients,
manual servers and automatic handlers, feedback/status, all four cancellation
selectors, results, expiry and structured shutdown. See the
[action implementation review](2026-09-08-ros2-actions.md) for API compatibility
and lifecycle details. The separately verified
[upstream CancelGoal codegen defect](2026-09-08-action-codegen-upstream.md) was
fixed locally; neither that report nor the CDR report has been posted.

Final verification on the frozen production source:

- Native action integration: **64 passed**.
- Codegen library: **88 passed**; canonical CancelGoal/default-result generation
  regression: **1 passed**.
- Full WASM compiler boundary script: **passed**.
- Fresh disposable browser/ROS Lyrical action integration: **25 checks passed**
  in both directions (`/tmp/hiroz-actions-final.log`). This includes duplicate
  UUID refusal, Accepted-goal cancellation and the public timestamp selector API.
- Action CI workflow local `actionlint`, shell/Node syntax and diff whitespace
  checks: **passed**. Remote CI execution remains unverified.

The tested artifact was newer than all production/demo Rust sources. The final
run removed its containers/network; HTTP 8084 and router 7548 are no longer
listening. Source changes remain local and uncommitted. Sustained load and
browser suspend/recovery qualification remain separate follow-up work.
