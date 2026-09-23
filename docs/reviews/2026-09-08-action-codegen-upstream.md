# ROS 2 CancelGoal type hash interoperability defect

Confirmed in upstream hiroz commit `844e1592802220b3cf024e369436db60991c60fc` by reading the original Git objects, independently of the WASM changes. No issue has been posted.

## Observed behavior

The browser action client could discover a ROS Lyrical Fibonacci server, submit goals, receive feedback and results, but cancellation failed with `Service call ended before any response was received`. The reverse rclpy ActionClient could not finish server discovery because it requires all three action services. The generated CancelGoal type identity did not match ROS.

## Upstream source defects

- `crates/hiroz-codegen/src/hashing.rs:41`: action-service classification uses service-name substrings including `CancelGoal`, producing `/action/` for the standard `action_msgs/srv/CancelGoal` service.
- `crates/hiroz-codegen/src/resolver.rs:737`: the constructed CancelGoal response description includes `return_code` but omits the `goals_canceling` sequence of GoalInfo.
- The same resolver function includes GoalInfo and Time dependencies but omits the UUID dependency nested inside GoalInfo.

All three are present in the upstream commit, not introduced by the WASM fork. This code also runs for native message generation.

## Canonical reference and fix

The installed ROS Lyrical `/opt/ros/lyrical/share/action_msgs/srv/CancelGoal.json` gives the service hash:

`RIHS01_573d8b0a534451d7bc2ac8c5ffde8ac14b8593b7001175d0cd6516dcbeb8689a`

The local fix derives the namespace from the request type description, includes both response fields and requires the full standard dependency set. The native `hiroz-codegen` action_nested_deps regression pins the canonical hash. It also checks generated actions supply their default result payload hook. Browser/rclpy cancellation and reverse action discovery subsequently pass.

Suggested upstream submission: the two codegen source changes and canonical-hash regression, separate from WASM runtime/action lifecycle changes. Reproduce with the existing packaged Jazzy LookupTransform action fixture: CancelGoal is shared across every action, so no new ROS messages are necessary.
