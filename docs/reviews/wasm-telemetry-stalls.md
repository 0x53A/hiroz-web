# Firefox telemetry stalls and reliable transport closure

The two visible browser windows could keep simulating locally while groundstation
telemetry stopped arriving. The UI's 1.5-second freshness threshold was reporting
real delivery gaps; it has not been increased or hidden.

Two WASM defects combined:

1. `zenoh-runtime/src/wasm_threaded.rs` scheduled a new raw `setTimeout(1)` on
   every pending poll of `recv_async_anywhere` and `JoinHandle`. The socket
   owner's `select` polls multiple receivers with one waker, multiplying timers
   before earlier callbacks run. Firefox 152.0.1 measured 68,183 pending timers
   at the first sample and 364,402 after 12 seconds. Device events stayed regular
   (maximum sampled gap 151 ms), while groundstation UI-sampled receipt gaps reached
   1,163 ms and WebSocket write acknowledgements took 491–563 ms. A separate
   navigation run reproduced a 2.25-second foreground UI-sampled receipt gap.
2. `zenoh-transport/src/common/pipeline.rs` replaced batch-refill waits with
   immediate `false` on WASM. A temporarily full reliable queue consequently
   looked like an expired enqueue deadline and triggered transport closure.
   This matches the reported “Unable to push non droppable network message”
   error; we do not claim that every transient gap implies a closed transport.

Each pending JS receive/join now owns one timer, retained across polls and
canceled when its future is dropped. The same Firefox 12-second observation
stayed at three pending simulator timers (peak four); groundstation UI-sampled receipt
gaps were at most 149 ms. A subsequent 30-cycle Firefox driving/navigation/
cancellation soak sampled 960 groundstation updates: maximum UI-sampled receipt gap
157 ms, maximum UI drain age 75 ms, and peak six live repoll timers (including
the explicit three-timer regression). All freshness/recovery/watchdog checks
and six pipeline pressure scenarios passed. The `__zenoh_repoll_counts()` diagnostic reports current
and peak live polling timers for the runtime instance.

Those historical receipt figures measure the latest event drained by a 100 ms UI
poll; intermediate events are coalesced. They are neither all ROS message
intervals nor network latency. The simulator nominally publishes every 50 ms
(20 Hz), using a delay after work; incoming commands can wake its loop earlier.
The current review adds monotonic callback counts and maximum intervals before
coalescing, reported separately from UI sampling.

Threaded producer workers now wait for TX refill against the original absolute
deadline, without pumping nested publishers under pipeline locks. TX has a
separate worker and returns batches independently. Browser JS threads, the
single-threaded fallback, and the TX worker itself do not park: synchronous
queue congestion there still fails immediately. The change does not make
blocking publishing on a browser main thread generally supported.

The simulator no longer creates an unused action client. Feedback for another
client's goal is ordinary shared-topic traffic and is logged at trace level,
consistent with unmatched status updates. This removes noise; the timer and
refill defects are fixed independently of logging.

## Focused regressions

`examples/wasm-demo/run-telemetry-tests.sh --skip-build` starts its own disposable
router, opens actual Firefox windows and runs:

- 1,000 shared-waker polls of two receives plus a join: exactly three local
  timers, bounded shared counts, cancellation and JS closure cleanup.
- A real one-batch TX pipeline: delayed refill, two producers sharing the
  Application worker, sustained deadline, notifications without returned batches,
  consumer closure, and nonblocking JS/TX caller paths.
- Repeated driving/navigation/cancellation with UI-sampled gap and timer bounds.
- Actual telemetry loss, control interlock, fresh recovery without motion replay,
  and the device's unrefreshed-command watchdog.

The ordinary Chromium UI/ROS tests remain distinct from these Firefox checks.
The native two-client feedback-routing regression verifies that each client
receives only its own goal feedback/results without warning on foreign traffic.

Rebuild the example and reload **both** windows. A page already running the old
WASM instance or a transport already closed by the old code cannot be repaired
by changing files on disk. This is a bounded local qualification, not a guarantee
against deliberate browser suspension or an unavailable router.
