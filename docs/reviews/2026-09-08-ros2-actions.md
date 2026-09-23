# ROS 2 actions in browser WASM

The hiroz action client/server, node builders and prelude exports are available on WASM. Execution, timeouts and task groups use the platform compatibility boundary; Tokio synchronization primitives remain usable without a Tokio executor. Native public goal-state timestamps remain `std::time::Instant`.

## Protocol and lifecycle changes

- Manual and automatic servers share one concurrent result service for their lifetime. Pending GetResult requests no longer block cancel processing or get lost when installing a handler. Result tasks are aborted and joined on shutdown.
- Goal handlers belong to an abort-on-drop task group. Dropping the last automatic server handle stops its handlers. Configured execution timeouts and handlers that return without finishing a goal produce an aborted default result for generated ROS actions.
- Results expire automatically. Expiry removes waiters and acceptance metadata, and late completions cannot recreate an expired/terminal goal. Explicit `expire_goals()` remains available and is idempotent after background expiry.
- The four ROS cancel selectors are supported, including accepted-but-not-yet-executing goals; exact client cancellation now sends a zero timestamp. `cancel_goals(goal_id, stamp)` exposes arbitrary selectors. Success uses ROS code 0, unknown ID 2, terminal ID 3.
- Goal acceptance timestamps are retained for cancel selection and status. Default status QoS is reliable, transient local, depth 1.
- `try_accept()` atomically rejects duplicate UUIDs; the automatic driver uses it. Existing `accept()` retains its signature and panics on a duplicate; manual servers accepting externally chosen IDs should use `try_accept()`. A second `with_handler()` on the same server is rejected by an atomic guard.
- Client registration follows pending sends, goal handles and result futures through an RAII guard. Dropping/canceling them releases local routing entries. `get_result_with_status` and `result_with_status` preserve succeeded/canceled/aborted/unknown status.
- Action state and routing maps use short platform-compatible mutex sections to avoid browser `Atomics.wait`. WASM mutex contention spins; users must not hold those guards across asynchronous suspension.

## Custom action compatibility

Generated actions implement `ZAction::default_result()`. UNKNOWN/expired results therefore carry a valid default ROS result payload. Legacy custom trait implementations retain source compatibility via the default `None`: they receive a service error for unknown results, and unfinished handlers are removed if no default result is available. Override the hook, or supply `default_result: expression` to `define_action!`, to provide standard default payloads. No blanket `Default` bound was imposed on existing action result types.

## Upstream codegen finding

The browser/ROS tests exposed a pre-existing native hiroz-codegen CancelGoal type hash defect. The local fixes and canonical ROS reference are documented separately in `2026-09-08-action-codegen-upstream.md`; nothing has been posted upstream.

## Validation

The final native action integration run passed all 64 tests (`/tmp/actions-native-release-ready.log`). The codegen library passed 88 tests and its action_nested_deps integration regression passed (`/tmp/actions-codegen-lib.log`, `/tmp/actions-codegen-complete.log`). The final full WASM boundary script exited 0 (`/tmp/actions-boundary-complete2.log`). Expiration expectations were updated to verify automatic removal and idempotent explicit expiration; the cancel regression now expects ROS success code 0. The native codegen regression pins the ROS CancelGoal hash and checks default payload generation. The WASM compiler boundary checks include the now-enabled action modules. Browser tests exercise real rclpy action endpoints in both directions, concurrent goals/results, feedback, rejection, abort, cancellation selectors, result expiry and server shutdown. The final browser run passed **25 checks** (14 browser/client checks, 10 rclpy/client checks, and browser context shutdown), recorded in `/tmp/hiroz-actions-final.log`. This includes the public `cancel_goals(goal_id, stamp)` API, duplicate UUID rejection, cancellation before execution, handler timeout and fallthrough. The tested WASM artifact was built after all production and fixture Rust changes.

The CI workflow now invokes `./run-action-tests.sh --skip-build` after the demo build. Local `actionlint` of `.github/workflows/wasm-ros-e2e.yml`, shell/Node syntax checks, and diff whitespace checks pass. Remote GitHub Actions execution has not been performed. The disposable action Compose project was removed by the test's cleanup trap; no action HTTP server or listeners on 8084/7548 remain.

No changes have been committed or pushed. The upstream CDR report remains separate and unposted.
