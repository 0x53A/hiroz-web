# hiroz review after polling-timer and transmit-queue fixes

Reviewed the current uncommitted `ros-z-wasm` port: context/node construction and
shutdown, discovery waits, pub/sub queue and QoS paths, service calls, action
request/feedback/status/result/expiry handling, instance guards, platform task and
clock abstractions, and the existing generated-interface/hash changes. This is a
source review plus the focused native validation below; browser integration is
reported separately. No commits or upstream posts were made.

## Fixed: action request correlation metadata could panic tasks

Action reply paths unconditionally unwrapped both the presence and decoding of
request attachments. A GetResult request for a retained result without an
attachment panicked its handler at `action/driver.rs:308`; the requester observed
a disconnected reply channel rather than an explicit error. Goal acceptance
could also insert goal state before hitting the same unwrap.

The new shared `action::request_attachment` validator requires ROS correlation
metadata, matching regular service decoding. Missing/truncated metadata produces
an explicit query error before goal execution, cancellation changes, or result
waiter registration. Valid requests retain their sequence number and source GID.
Manual action receive/reply APIs use the same validation; missing payloads return
errors instead of panicking, and low-level response APIs propagate reply failures.
No public signatures changed. Bare Zenoh requests without ROS metadata are now
explicitly rejected, rather than relying on the previous inconsistent behavior.

This defect is shared by native and WASM targets and inherited from upstream:
the locally available merged upstream commit
`844e1592802220b3cf024e369436db60991c60fc` contains the result unwrap at
`crates/hiroz/src/action/driver.rs:296` and the corresponding server reply unwraps.
No claim is made about a newer, unfetched upstream version. This section is a
local upstream-report draft, not a posted issue.

Validation:

- Before: `cargo test -p hiroz --test action test_action_request_metadata -- --nocapture`
  reproduced the missing-attachment panic and failed the explicit-error assertion
  (`/tmp/hiroz-metadata-before.log`).
- After: the focused request regression passed (`/tmp/hiroz-metadata-after.log`).
- Expanded final regression covers missing and truncated metadata on SendGoal,
  CancelGoal, and GetResult; absence of invalid goal insertion; preserved valid
  correlation metadata and retained result; and a subsequent successful goal.
- Full native action suite: **69 passed**, including the expanded regression
  (`/tmp/hiroz-review-native-actions.log`).
- Source whitespace check passed. Integration agent owns the combined WASM build
  and browser/ROS checks; those results are not duplicated here.

## Fixed: synchronous queue timeout returned on empty notifications

`BoundedQueue::recv_timeout` performed only one condition-variable wait. A
spurious notification, or a competing receiver consuming the item first, returned
`None` immediately even though the requested timeout had not elapsed. The same
implementation exists at upstream merge-base `844e1592802220b3cf024e369436db60991c60fc`
in `crates/hiroz/src/queue.rs:70`.

The method now loops on the actual queue predicate and subtracts elapsed time
from the original timeout. Notifications cannot restart the deadline. The async
receive implementation is unchanged; synchronous browser calls still require a
compute worker that can block.

Two native regressions failed before the fix: a notified receiver lost its chance
to receive a later item, and an 80ms receive returned after about 10ms
(`/tmp/hiroz-queue-before.log`). After the fix, both focused regressions passed
(`/tmp/hiroz-queue-after.log`), and all **9** existing queue integration tests passed
(`/tmp/hiroz-queue-suite.log`).

## Explicit limits

- Subscriber KeepLast queues drop oldest samples; they do not enforce sample age.
  A receive timeout limits waiting for a sample, not how old a queued sample may
  be. Command expiry and the independent hardware watchdog remain separate from
  ROS service/action execution timeouts.
- Action feedback routes into a per-goal `mpsc::UnboundedReceiver`, independently
  of feedback-topic QoS. A valid slow or non-reading consumer can retain every
  sample for an arbitrarily long goal. API documentation now says to drain or drop
  the receiver. A bounded/latest receiver requires an explicit API change because
  callers currently receive the concrete unbounded receiver; this review does not
  silently change stream semantics.
- GetResult intentionally waits for goal completion, potentially indefinitely.
  Dropping a client call does not cancel the remotely executing goal. Use explicit
  goal cancellation and, where appropriate, configured execution deadlines.
- Browser event-loop threads cannot park in synchronous receive APIs. Library
  overview documentation now states this restriction. Async APIs and compute
  workers are the supported browser execution paths. Short spin-lock critical
  sections and runtime-independent Tokio synchronization do not establish a
  worst-case scheduling bound under contention.
- The previously measured 157ms demo figure was a UI-drained/coalesced telemetry
  observation, not publisher-to-device latency, raw receive jitter, or a guarantee
  that a 200ms hardware deadline will always be met. Browser suspension, scheduling,
  transport recovery, and command expiry require separate qualification.
- Previously documented CDR allocation behavior and codegen upstream findings
  remain in their separate drafts; this pass neither posts them nor claims they
  have been fixed.
