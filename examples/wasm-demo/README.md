# Browser robot / hiroz WASM

A self-contained two-window ROS demo. One window runs a simulated device;
the other is its groundstation. Both are independent hiroz ROS nodes in
threaded WebAssembly, communicating through a Zenoh WebSocket router.

## Try it

For the hosted build, the only locally running program is:

```sh
zenohd --listen ws/127.0.0.1:7448
```

Open the page as **Groundstation**, use **Open simulated device**, and connect
both windows with the same settings. Hold a direction to drive, choose a
point on the grid and send a goal, or cancel an active goal. The groundstation
only renders received ROS telemetry; it cannot read the other window's
simulation directly. Keep both windows visible to avoid browser throttling.

The [Pages site](https://0x53a.github.io/hiroz-web/hiroz/) reflects the last
published build. This checkout's changes remain local until published.

## Build and serve locally

```sh
cargo install wasm-bindgen-cli --version 0.2.127 --locked
./build.sh
python3 serve.py 8083
# Open http://localhost:8083 in two windows; start zenohd as above.
```

Requires nightly Rust with rust-src (build-std; configuration is in
`.cargo/config.toml`). The HTTP server serves static assets and isolation
headers; it is not a ROS bridge. Hosted users need neither it nor Python.
GitHub Pages uses the bundled `coi-serviceworker.js` shim, which may reload the
page once before SharedArrayBuffer workers are available. A private browser
mode that disallows service workers may need a host with actual isolation
headers instead.

## Profiles and behavior

| Profile | Velocity | Telemetry | Action |
| --- | --- | --- | --- |
| TurtleBot / Nav2 | `geometry_msgs/TwistStamped` (or selected `Twist`) | `nav_msgs/Odometry` | Jazzy `nav2_msgs/NavigateToPose` |
| ROS turtlesim | `geometry_msgs/Twist` | `turtlesim_msgs/Pose` | `turtlesim_msgs/RotateAbsolute` |

The TurtleBot defaults are namespace `/turtlebot`, topics `cmd_vel` and
`odom`, action `navigate_to_pose`, and frame `odom`. Turtlesim defaults to
`/turtle1`, `cmd_vel`, `pose`, and `rotate_absolute`. Its UI accepts heading
goals, not point navigation. The exact generated definitions and their
sources are recorded in [tests/interfaces](tests/interfaces/README.md).

The simulated device integrates 2D motion and publishes its pose. Navigation
moves directly toward a goal without obstacle avoidance, SLAM, or a map
server. The viewport is a coordinate grid and received trajectory, not an
occupancy map. Simulator state is labeled as such.

Manual motion requires a held control and fresh telemetry. Release, focus
loss or hiding the groundstation stops its command stream; the simulated
device also has a 500 ms command watchdog. Reconnecting does not resume an
old command. Navigation goals run autonomously: cancel requests and explicit
disconnection ask the server to cancel, while an unexpected lost connection
means the remote goal state is unknown. A real robot needs its own motion
watchdog and a running navigation server for navigation actions.

Telemetry freshness uses the monotonic worker receipt time, including time
spent waiting for the page to drain events. System-clock adjustments do not
refresh old samples. Rebuild the WASM and reload the page together when updating
the UI; a sample without the monotonic receipt field does not enable motion.

## Real robot connection

Close the simulated device and configure the groundstation for the robot's
actual namespace, domain, velocity type/topics and fixed frame. A real Nav2
server normally uses its configured global frame, often `map`; matching the
simulator's default `odom` setting blindly is insufficient. Grid picking is
disabled when received odometry and goal frames differ; explicit coordinates
are interpreted in the configured goal frame without an implicit transform. Nav2 interface
versions vary; this example pins the Jazzy definition.

The current hiroz protocol is compatible with `rmw_zenoh`. DDS-only robots
require a compatible DDS-to-rmw_zenoh gateway or an appropriate robot-side
configuration. `zenoh-bridge-ros2dds` alone is not interchangeable with this
protocol; see the [official interoperability note](https://github.com/ros2/rmw_zenoh#on-interoperability-with-eclipse-zenohzenoh-plugin-ros2dds-and-zenoh-bridge-ros2dds).

An HTTPS-hosted page can reach a loopback WS router in supporting browsers,
subject to local-network permissions (Chrome may prompt). Use a
browser-trusted WSS endpoint for remote routers; the isolation service worker
does not change mixed-content or local-network restrictions. Native Zenoh WS
listeners inspected here are plaintext; browser WSS support is not a TLS
server configuration.

## Validation

```sh
./run-turtle-tests.sh --skip-build         # two browsers and only a router
./run-native-turtle-tests.sh --skip-build  # disposable ROS 2 Lyrical turtlesim
node run_ui.mjs --fixture-only            # deterministic UI state regressions
./run-telemetry-tests.sh --skip-build      # Firefox timer/refill pressure and motion soak
```

Firefox telemetry delivery and transport pressure are covered separately; see
[the measured stall investigation](../../docs/reviews/wasm-telemetry-stalls.md).
After rebuilding an older version, reload both windows to replace their WASM
runtimes and any transport closed by the previous version.

The browser pair covers real telemetry, driving/release/focus loss, the device
watchdog, NavigateToPose feedback/success/cancellation, reconnect without command
replay, and Stop/Disconnect responsiveness while action discovery is pending.
The native fixture runs the actual groundstation UI against ROS 2 Lyrical
`turtlesim` over `rmw_zenoh`, validating Twist, turtlesim_msgs/Pose and
RotateAbsolute feedback/results/cancellation. It does **not** validate a native
Nav2 server or a physical TurtleBot. The UI state regressions use mocked exports
and are distinct from those ROS integration checks.

Telemetry carries its worker receipt time, so draining delayed events cannot
make an old sample fresh. A result transport failure keeps the goal uncertain
and retains its identity for cancellation/retry. If acceptance itself is lost,
this example cannot recover the server's goal identity: it blocks new motion,
disables targeted cancellation, and asks you to verify the robot before
reconnecting. Disconnect remains available; it cannot guarantee cancellation
of such an unconfirmed goal.

## Existing integration fixtures

`./run-tests.sh` builds the demo and runs the original ROS 2 Lyrical
pub/sub and timeout checks using its disposable talker/listener stack.
The older `ros_start`, `ros_connect`, `ros_poll` and `ros_publish` exports are
retained for these tests. Await `ros_start` before connecting.

These native ROS containers are validation tools, not runtime dependencies
of the two-browser robot demo.

## ROS 2 actions

The library supports browser action clients and manual or `with_handler` action
servers on the Application compute worker. The independent Fibonacci action
fixture is `test_actions.html`.

Run `./run-action-tests.sh` to build and test against a real ROS 2 Lyrical rclpy
Fibonacci server and client. It uses the separate disposable Compose project
`hiroz-wasm-actions`, WebSocket port 7548 and HTTP port 8084, and removes its
containers and HTTP server on exit. `--skip-build` reuses the current local WASM
artifact. CI runs this after building the demo.

Coverage includes acceptance/rejection, concurrent goals, feedback, terminal
status/results, cancellation before execution and during pending result requests,
all-goal and timestamp selectors, retained-result expiry, handler deadlines,
client task cancellation, and server shutdown. The generated action definitions
provide default result values for the ROS `UNKNOWN` reply and automatic handler
failure replies. Hand-written `ZAction` implementations should override
`default_result()` to enable those protocol replies; without a default, hiroz
returns a service error rather than inventing a result value.

Run action operations on compute workers, as in `src/action_tests.rs`; the port
does not make blocking APIs safe on the browser main thread. This suite does not
qualify browser suspension, prolonged load, or every ROS distribution.
