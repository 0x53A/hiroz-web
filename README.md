# hiroz-web

Eclipse [zenoh](https://zenoh.io) and [hiroz (ros-z)](https://github.com/ZettaScaleLabs/ros-z)
compiled to WebAssembly with a SharedArrayBuffer threadpool — a full zenoh
client and a ROS 2 node running in a browser tab, talking to real ROS 2
systems via rmw_zenoh.

**Live demo:** https://0x53a.github.io/hiroz-web/hiroz/ — connect to a zenoh
router, watch the live `/chatter` feed from a ROS 2 talker, publish your own
`std_msgs/String` messages. (Landing page with all demos:
https://0x53a.github.io/hiroz-web/)

## Trying the demo against your own ROS 2 system

The browser needs two things: a zenoh router with a WebSocket listener, and
ROS 2 nodes speaking rmw_zenoh through that router.

**Option A — docker compose (router + ROS 2 Jazzy talker/listener):**

```sh
git clone --recursive https://github.com/0x53A/hiroz-web
cd hiroz-web/examples/wasm-demo
docker compose up -d
```

**Option B — manually:**

```sh
# zenoh router with a WebSocket listener
zenohd --listen tcp/0.0.0.0:7447 --listen ws/0.0.0.0:7448

# ROS 2 nodes via rmw_zenoh (in a sourced ROS 2 environment)
export RMW_IMPLEMENTATION=rmw_zenoh_cpp
ros2 run demo_nodes_cpp talker &
ros2 run demo_nodes_cpp listener &
```

Then open the [demo page](https://0x53a.github.io/hiroz-web/hiroz/), set the
endpoint to `ws/127.0.0.1:7448`, and click connect. You should see the
talker's `Hello World: n` messages streaming in; what you publish appears in
the listener's log.

From the https Pages site, plain `ws/` endpoints work only for
`127.0.0.1`/`localhost` (mixed-content rules); remote routers need a TLS
listener and a `wss/` endpoint. Chrome additionally asks for the
**Local Network Access** permission when a public page connects to
localhost — accept the prompt.

Heads-up: stock zenoh has a bug where **any** failed WebSocket handshake
permanently kills the router's ws listener (it keeps serving `tcp/` and the
process stays up, so it looks like a browser/mixed-content problem). If
browsers stop connecting but ROS 2 keeps working, restart the router. See
`zenoh-wasm/BUGREPORT-ws-listener-dies.md`.

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
