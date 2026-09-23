use wasm_bindgen::prelude::*;

/// Test entry point — called from the HTML page.
/// Initializes the threaded runtime and runs basic tests.
/// `endpoint` is the zenoh router endpoint for tests 5/6,
/// e.g. "ws/127.0.0.1:7448" or "wss/host:443".
#[wasm_bindgen]
pub async fn run_threaded_test(endpoint: String) {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("PANIC: {}", info);
        web_sys::console::error_1(&JsValue::from_str(&msg));
        log(&msg);
    }));

    // Route zenoh's tracing output to the browser console (workers included).
    // Raise to DEBUG/TRACE when diagnosing transport issues.
    tracing_wasm::set_as_global_default_with_config(
        tracing_wasm::WASMLayerConfigBuilder::new()
            .set_max_level(tracing::Level::INFO)
            .set_console_config(tracing_wasm::ConsoleConfig::ReportWithoutConsoleColor)
            .build(),
    );

    log("=== Zenoh WASM Threaded Runtime Test ===");

    // Initialize the threaded runtime with the shim URL
    log("Initializing threaded runtime...");
    match zenoh_runtime::__zenoh_init_threaded_runtime_async("./pkg/zenoh_wasm_threaded_test.js", 10_000).await {
        Ok(true) => log("Threaded runtime ready!"),
        other => {
            log(&format!("FAIL: threaded runtime startup: {other:?}"));
            return;
        }
    }

    // Test 1: spawn a future on a specific runtime and get the result
    log("Test 1: cross-worker spawn...");
    let handle = zenoh_runtime::ZRuntime::Net.spawn(async { 42u32 });
    match handle.await {
        Ok(val) if val == 42 => log("  PASS: spawn returned correct value (42)"),
        Ok(val) => log(&format!("  FAIL: expected 42, got {val}")),
        Err(e) => log(&format!("  FAIL: join error: {e}")),
    }

    // Test 2: spawn on multiple runtimes
    log("Test 2: multi-runtime spawn...");
    let h1 = zenoh_runtime::ZRuntime::Application.spawn(async { "app" });
    let h2 = zenoh_runtime::ZRuntime::TX.spawn(async { "tx" });
    let h3 = zenoh_runtime::ZRuntime::RX.spawn(async { "rx" });
    let r1 = h1.await.unwrap_or("err");
    let r2 = h2.await.unwrap_or("err");
    let r3 = h3.await.unwrap_or("err");
    if r1 == "app" && r2 == "tx" && r3 == "rx" {
        log("  PASS: all runtimes returned correct values");
    } else {
        log(&format!("  FAIL: got {r1}, {r2}, {r3}"));
    }

    // Test 3: zenoh config creation (basic sanity check on a worker)
    log("Test 3: zenoh config on worker...");
    let h = zenoh_runtime::ZRuntime::Application.spawn(async {
        let mut config = zenoh::Config::default();
        config.insert_json5("mode", r#""client""#).is_ok()
    });
    match h.await {
        Ok(true) => log("  PASS: config created on worker"),
        Ok(false) => log("  FAIL: config insert failed"),
        Err(e) => log(&format!("  FAIL: {e}")),
    }

    // Test 4: block_in_place with a future that resolves via cross-worker wake.
    // The future uses a flume channel — the sender fires from another worker,
    // which wakes the Condvar in block_in_place via the channel's waker.
    log("Test 4: block_in_place with cross-worker resolution...");
    let h = zenoh_runtime::ZRuntime::Application.spawn(async {
        let (tx, rx) = flume::bounded::<u32>(1);

        // Spawn a task on Net worker that sends a value after async delay
        zenoh_runtime::ZRuntime::Net.spawn(async move {
            zenoh_runtime::wasm_yield::sleep_ms(100).await;
            let _ = tx.send(99);
        });

        // block_in_place: blocks the Application worker's thread via Condvar.
        // The flume channel's waker calls Condvar::notify when the Net worker
        // sends the value, unblocking this thread.
        zenoh_runtime::ZRuntime::Application
            .block_in_place(async { rx.recv_async().await.unwrap_or(0) })
    });
    match h.await {
        Ok(99) => log("  PASS: block_in_place resolved correctly (99)"),
        Ok(val) => log(&format!("  FAIL: expected 99, got {val}")),
        Err(e) => log(&format!("  FAIL: join error: {e}")),
    }

    log("Regression: timer progress under a continuously yielding task...");
    let h = zenoh_runtime::ZRuntime::Application.spawn(async {
        let busy = zenoh_runtime::ZRuntime::Application.spawn(async {
            loop {
                zenoh_runtime::wasm_yield::yield_now().await;
            }
        });
        zenoh_runtime::wasm_yield::sleep_ms(50).await;
        busy.abort();
        busy.await.is_err()
    });
    if matches!(h.await, Ok(true)) {
        log("  PASS: timer fired and busy task aborted");
    } else {
        log("  FAIL: timer/abort regression");
    }

    log("Regression: cancellation after the task starts and child isolation...");
    let h = zenoh_runtime::ZRuntime::Application.spawn(async {
        let parent = zenoh_task::CancellationToken::new();
        let child = parent.child_token();
        child.cancel();
        if parent.is_cancelled() {
            return false;
        }
        let waiter_token = parent.clone();
        let waiter = zenoh_runtime::ZRuntime::Application.spawn(async move {
            waiter_token
                .run_until_cancelled(std::future::pending::<()>())
                .await
        });
        zenoh_runtime::wasm_yield::sleep_ms(20).await;
        parent.cancel();
        matches!(waiter.await, Ok(None))
    });
    if matches!(h.await, Ok(true)) {
        log("  PASS: cancellation stops pending task; child is independent");
    } else {
        log("  FAIL: cancellation semantics");
    }

    log("Regression: timed shutdown on a compute worker...");
    let h = zenoh_runtime::ZRuntime::Application.spawn(async {
        use std::time::Duration;
        let (tx, rx) = flume::bounded::<()>(1);
        let mut task = zenoh_task::TerminatableTask::spawn(
            zenoh_runtime::ZRuntime::Application,
            async move { let _ = rx.recv_async().await; },
            zenoh_task::CancellationToken::new(),
        );
        if task.terminate(Duration::from_millis(5)) {
            return false;
        }
        tx.send(()).unwrap();
        if !task.terminate(Duration::from_secs(1)) {
            return false;
        }
        let controller = zenoh_task::TaskController::default();
        let pending = controller.spawn_abortable(std::future::pending::<()>());
        controller.terminate_all(Duration::from_secs(1)) == 0
            && matches!(pending.await, Ok(None))
    });
    if matches!(h.await, Ok(true)) {
        log("  PASS: compute shutdown honors timeout and joins on retry");
    } else {
        log("  FAIL: compute shutdown lifecycle");
    }

    log("Regression: JS timer cleanup after cross-worker drop...");
    let baseline = zenoh_runtime::wasm_yield::active_js_timers();
    let sleeps: Vec<_> = (0..128)
        .map(|_| zenoh_runtime::wasm_yield::sleep_ms(u32::MAX))
        .collect();
    let h = zenoh_runtime::ZRuntime::Application.spawn(async move {
        drop(sleeps);
    });
    let joined = h.await.is_ok();
    zenoh_runtime::wasm_yield::sleep_ms(80).await;
    if joined && zenoh_runtime::wasm_yield::active_js_timers() <= baseline + 1 {
        log("  PASS: JS timers dropped on another worker release their callbacks");
    } else {
        log("  FAIL: cross-worker JS timer cleanup");
    }

    // Test 5: zenoh session open (requires zenohd on the given endpoint)
    log(&format!(
        "Test 5: zenoh session open on worker ({endpoint})..."
    ));
    let ep = endpoint.clone();
    let h = zenoh_runtime::ZRuntime::Application.spawn(async move {
        web_sys::console::log_1(&JsValue::from_str("[test5] creating config..."));
        let mut config = zenoh::Config::default();
        config.insert_json5("mode", r#""client""#).unwrap();
        config
            .insert_json5("connect/endpoints", &format!(r#"["{ep}"]"#))
            .unwrap();
        config
            .insert_json5("scouting/multicast/enabled", "false")
            .unwrap();
        web_sys::console::log_1(&JsValue::from_str("[test5] calling zenoh::open()..."));
        match zenoh::open(config).await {
            Ok(session) => {
                let zid = session.zid().to_string();
                let _ = session.close().await;
                Some(zid)
            }
            Err(e) => {
                web_sys::console::error_1(&JsValue::from_str(&format!("Open error: {e}")));
                None
            }
        }
    });
    match h.await {
        Ok(Some(zid)) => log(&format!("  PASS: session opened, ZID={zid}")),
        Ok(None) => log(&format!(
            "  FAIL: session open returned error (is zenohd running on {endpoint}?)"
        )),
        Err(e) => log(&format!("  FAIL: join error: {e}")),
    }

    // Test 6: pub/sub roundtrip through the router (requires zenohd)
    log("Test 6: pub/sub roundtrip on workers...");
    let ep = endpoint.clone();
    let h = zenoh_runtime::ZRuntime::Application.spawn(async move {
        let mut config = zenoh::Config::default();
        config.insert_json5("mode", r#""client""#).unwrap();
        config
            .insert_json5("connect/endpoints", &format!(r#"["{ep}"]"#))
            .unwrap();
        config
            .insert_json5("scouting/multicast/enabled", "false")
            .unwrap();
        let publisher_session = zenoh::open(config.clone())
            .await
            .map_err(|e| e.to_string())?;
        let session = match zenoh::open(config).await {
            Ok(s) => s,
            Err(e) => return Err(format!("open: {e}")),
        };
        let sub = match session.declare_subscriber("wasm/threaded/roundtrip").await {
            Ok(s) => s,
            Err(e) => return Err(format!("subscriber: {e}")),
        };
        // Give the router a moment to propagate the subscription
        zenoh_runtime::wasm_yield::sleep_ms(500).await;
        if let Err(e) = publisher_session
            .put("wasm/threaded/roundtrip", "ping-from-worker")
            .await
        {
            return Err(format!("put: {e}"));
        }
        let sample = match sub.recv_async().await {
            Ok(s) => s,
            Err(e) => return Err(format!("recv: {e}")),
        };
        let payload = sample
            .payload()
            .try_to_string()
            .map(|s| s.into_owned())
            .unwrap_or_default();
        let _ = session.close().await;
        publisher_session.close().await.map_err(|e| e.to_string())?;
        Ok(payload)
    });
    match h.await {
        Ok(Ok(p)) if p == "ping-from-worker" => log("  PASS: pub/sub roundtrip delivered payload"),
        Ok(Ok(p)) => log(&format!("  FAIL: wrong payload: {p}")),
        Ok(Err(e)) => log(&format!("  FAIL: {e}")),
        Err(e) => log(&format!("  FAIL: join error: {e}")),
    }

    log("=== Tests complete ===");
}

fn log(msg: &str) {
    web_sys::console::log_1(&JsValue::from_str(msg));
    if let Some(document) = web_sys::window().and_then(|w| w.document()) {
        if let Some(output) = document.get_element_by_id("output") {
            let current = output.inner_html();
            output.set_inner_html(&format!("{current}<p>{msg}</p>"));
        }
    }
}

async fn sleep_ms(ms: u32) {
    wasm_bindgen_futures::JsFuture::from(js_sys::Promise::new(&mut |resolve, _| {
        web_sys::window()
            .unwrap()
            .set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, ms as i32)
            .unwrap();
    }))
    .await
    .unwrap();
}

/// Called by the headless runner against its disposable raw WebSocket peer.
#[wasm_bindgen]
pub async fn test_link_lifecycle(endpoint: String) -> bool {
    zenoh_runtime::ZRuntime::Application
        .spawn(async move {
            use zenoh_link_commons::LinkManagerUnicastTrait;
            let (tx, _rx) = flume::unbounded();
            let manager = zenoh_link_ws::LinkManagerUnicastWs::new(tx);
            let command = if endpoint.ends_with("/oversized") {
                b"oversized".as_slice()
            } else if endpoint.ends_with("/text") {
                b"text".as_slice()
            } else {
                b"close".as_slice()
            };
            let endpoint: zenoh::config::EndPoint = endpoint.parse().unwrap();
            if zenoh_link::LinkKind::try_from(&endpoint).is_err() {
                return false;
            }
            let link = manager.new_link(endpoint).await.unwrap();
            link.write_all(command, None).await.unwrap();
            let mut buf = [0u8; 32];
            let read = link.read(&mut buf, None);
            let timeout = zenoh_runtime::wasm_yield::sleep_ms(500);
            use futures::FutureExt;
            futures::pin_mut!(read, timeout);
            let closed = futures::select! {
                result = read.fuse() => result.is_err(),
                _ = timeout.fuse() => false,
            };
            let write_failed = link.write_all(b"after-close", None).await.is_err();
            closed && write_failed
        })
        .await
        .unwrap_or(false)
}

#[wasm_bindgen]
pub async fn test_dropped_links(endpoint: String, cancel_open: bool) -> bool {
    zenoh_runtime::ZRuntime::Application
        .spawn(async move {
            use futures::FutureExt;
            use zenoh_link_commons::LinkManagerUnicastTrait;
            let (tx, _rx) = flume::unbounded();
            let manager = zenoh_link_ws::LinkManagerUnicastWs::new(tx);
            for _ in 0..10 {
                let open = manager.new_link(endpoint.parse().unwrap());
                if cancel_open {
                    let timer = zenoh_runtime::wasm_yield::sleep_ms(20);
                    futures::pin_mut!(open, timer);
                    futures::select! {
                        _ = open.fuse() => return false,
                        _ = timer.fuse() => {},
                    }
                } else {
                    let Ok(link) = open.await else { return false };
                    drop(link); // no explicit close(): owner must still release socket
                }
            }
            zenoh_runtime::wasm_yield::sleep_ms(100).await;
            true
        })
        .await
        .unwrap_or(false)
}

/// A main-thread sleep must use the compute timer after crossing to a worker.
/// The browser regression delays its creating JS callback to test independence
/// from that event loop without waiting for a multi-day timer chunk.
#[wasm_bindgen]
pub async fn test_migrated_js_sleep() -> bool {
    let start = zenoh_runtime::wasm_yield::Instant::now();
    let sleep = zenoh_runtime::wasm_yield::sleep_ms(43);
    matches!(zenoh_runtime::ZRuntime::Application.spawn(async move {
        sleep.await;
        let elapsed = start.elapsed();
        elapsed >= std::time::Duration::from_millis(43)
            && elapsed < std::time::Duration::from_secs(2)
    }).await, Ok(true))
}

/// A registered timer must migrate away from a worker parked in synchronous work.
#[wasm_bindgen]
pub async fn test_migrated_compute_sleep() -> bool {
    use std::{future::Future, sync::{Arc, Mutex, Condvar}, task::{Context, Poll}, time::Duration};
    let (send, receive)=flume::bounded(1);
    let parked=Arc::new((Mutex::new(false),Condvar::new()));
    let old_parked=parked.clone();
    let old=zenoh_runtime::ZRuntime::Application.spawn(async move {
        let mut timer=Box::pin(zenoh_runtime::wasm_yield::sleep_ms(60));
        let waker=futures::task::noop_waker();
        assert!(matches!(timer.as_mut().poll(&mut Context::from_waker(&waker)),Poll::Pending));
        let guard=old_parked.0.lock().unwrap();
        send.send(timer).unwrap();
        let _=old_parked.1.wait_timeout(guard,Duration::from_millis(500)).unwrap();
    });
    let timer=zenoh_runtime::recv_async_anywhere(&receive).await.unwrap();
    let start=zenoh_runtime::wasm_yield::Instant::now();
    let moved=zenoh_runtime::ZRuntime::Net.spawn(async move {
        timer.await;
        let elapsed=start.elapsed();
        *parked.0.lock().unwrap()=true;
        parked.1.notify_one();
        elapsed<Duration::from_millis(300)
    });
    let ok=matches!(moved.await,Ok(true));
    let _=old.await;
    ok
}
