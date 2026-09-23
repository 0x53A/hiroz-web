# hiroz-web

Eclipse [zenoh](https://zenoh.io) and [hiroz (ros-z)](https://github.com/ZettaScaleLabs/ros-z)
compiled to WebAssembly with a SharedArrayBuffer threadpool — a full zenoh
client and a ROS 2 node running in a browser tab, talking to real ROS 2
systems via rmw_zenoh.

## Browser robot demo

The interactive example has two roles: **Groundstation** and **Simulated
Device**. Open one of each and connect them to the same router. The device
runs a small differential-drive simulation; the groundstation receives real
ROS telemetry, sends velocity commands, and submits/cancels navigation goals.
All communication between the windows goes through Zenoh.

The hosted version needs only a local router:

```sh
zenohd --listen ws/127.0.0.1:7448
```

The [Pages URL](https://0x53a.github.io/hiroz-web/hiroz/) serves the last deployed
build; local changes do not update it. For this checkout, build and serve
`examples/wasm-demo` as described in its [README](examples/wasm-demo/README.md).
No ROS installation or Python robot service is needed for the two-browser
demo. A local HTTP server is needed only when serving the checkout yourself.

The default TurtleBot profile uses `TwistStamped`, `Odometry`, and the
Jazzy `NavigateToPose` action definition. The separate ROS turtlesim profile
uses `Twist`, `turtlesim_msgs/Pose`, and `RotateAbsolute` (heading goals).
Settings are shared by the **Open simulated device** / **Open groundstation**
link. Device simulation uses direct motion without obstacle planning.

For a real robot, close the simulated device and configure the groundstation
for the robot's actual namespace, domain, topic types and frames. Navigation
requires a running compatible Nav2 server. The browser transport speaks
`rmw_zenoh`; a DDS-only robot needs a compatible gateway, not simply
`zenoh-bridge-ros2dds` (which uses a different Zenoh protocol).

From an HTTPS-hosted page, loopback WS connections depend on browser
local-network permissions. Use a browser-trusted WSS endpoint for remote
routers. The service-worker isolation shim does not remove WebSocket network
permissions or mixed-content restrictions.

The original ROS talker/listener and Fibonacci integration fixtures remain
available through `run-tests.sh` and `run-action-tests.sh`; their ROS
containers are test dependencies, not dependencies of the browser demo.

## Layout

- `examples/` — source for the root-owned PoC demos that are built into
  `docs/` by `./publish-site.sh`.
- [`zenoh-wasm/`](https://github.com/0x53A/zenoh/tree/wasm) (submodule,
  branch `wasm`) — zenoh fork with WASM support: WebSocket transport and the
  `wasm-threads` multi-threaded runtime (pure-Rust executors on
  SharedArrayBuffer workers). Session notes in `zenoh-wasm/_Tasks/`.
- [`ros-z-wasm/`](https://github.com/0x53A/hiroz/tree/wasm) (submodule,
  branch `wasm`) — hiroz fork with WASM support used by the root-owned
  browser ROS 2 demo.
- `docs/` — the GitHub Pages site (built demo artifacts). Regenerate with
  `./publish-site.sh`.

## Note on SharedArrayBuffer

The threaded demos require cross-origin isolation (COOP/COEP headers).
GitHub Pages cannot send custom headers, so the pages ship the
`coi-serviceworker` shim, which injects the headers from a service worker
(one automatic reload on first visit). When serving locally, use the
example's `serve.py`, which sends real COOP/COEP headers.

## Stability and WASM runtime boundaries

For a guide to the changes that upstream maintainers can reuse, see the
[Zenoh branch notes](zenoh-wasm/WASM.md) and [hiroz branch notes](ros-z-wasm/WASM.md).
The [upstream merge and cleanup review](docs/reviews/2026-09-23-upstream-cleanup.md)
records the merged revisions, remaining compromises and fresh validation.

The [2026-09-22 review](docs/reviews/2026-09-22-system-review.md) records the
current fixes, tested behavior and remaining groundstation-port blockers.
Run `./tools/check-wasm-boundary.sh` to reject runtime-dependent Tokio/native
calls in WASM builds. Tokio synchronization remains allowed. ROS action clients
and servers run on the WASM compute workers; the demo includes a dedicated
[bidirectional action test](examples/wasm-demo/README.md#ros-2-actions). Use
`build_async()` / `shutdown_async()` for contexts.
