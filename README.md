# hiroz-web

Eclipse [zenoh](https://zenoh.io) and [hiroz (ros-z)](https://github.com/ZettaScaleLabs/ros-z)
compiled to WebAssembly with a SharedArrayBuffer threadpool — a full zenoh
client and a ROS 2 node running in a browser tab, talking to real ROS 2
systems via rmw_zenoh.

**Live demos:** https://0x53a.github.io/hiroz-web/

## Layout

- [`zenoh-wasm/`](https://github.com/0x53A/zenoh) (submodule) — zenoh fork
  with WASM support: WebSocket transport, single-threaded runtime, and the
  `wasm-threads` multi-threaded runtime (pure-Rust executors on
  SharedArrayBuffer workers). Session notes in `zenoh-wasm/_Tasks/`.
- [`ros-z-wasm/`](https://github.com/0x53A/ros-z) (submodule, branch `wasm`)
  — hiroz fork with WASM support; browser ↔ ROS 2 demos under `examples/`.
- `docs/` — the GitHub Pages site (built demo artifacts). Regenerate with
  `./publish-site.sh`.

## Running the demos against your own system

The pages need a zenoh router reachable from the browser:

```sh
zenohd --listen ws/0.0.0.0:7448     # endpoint: ws/<host>:7448
```

From the https Pages site, plain `ws/` endpoints work only for
`127.0.0.1`/`localhost` (mixed-content rules); remote routers need a TLS
listener and a `wss/` endpoint.

For the ROS 2 side of the hiroz demo, use the docker compose stack in
`ros-z-wasm/examples/wasm-demo/` (zenoh router + ROS 2 Jazzy talker/listener
with rmw_zenoh_cpp).

## Note on SharedArrayBuffer

The threaded demos require cross-origin isolation (COOP/COEP headers).
GitHub Pages cannot send custom headers; if the demos report
"SharedArrayBuffer unavailable", the fallback is a `coi-serviceworker`
shim — see `publish-site.sh`.
