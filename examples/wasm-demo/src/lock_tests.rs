//! Main-thread contention regressions; no ROS router is required.
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::time::Duration;
use wasm_bindgen::prelude::*;
use zenoh_runtime::wasm_yield::Instant;

#[wasm_bindgen]
pub async fn test_rwlock_contention() -> Result<(), JsValue> {
    for worker_writes in [true, false] {
        let lock = Arc::new(hiroz::compat::RwLock::new(7u32));
        let main_attempting = Arc::new(AtomicBool::new(false));
        let worker_lock = lock.clone();
        let worker_attempting = main_attempting.clone();
        let (tx, rx) = flume::bounded(1);
        zenoh_runtime::ZRuntime::Application.spawn(async move {
            // No await while holding the guard. The worker always releases it,
            // including when the browser main-thread attempt throws an exception.
            let hold = || {
                tx.send(()).unwrap();
                let deadline = Instant::now() + Duration::from_secs(2);
                while !worker_attempting.load(Ordering::Acquire) && Instant::now() < deadline {
                    std::hint::spin_loop();
                }
                let release_at = Instant::now() + Duration::from_millis(100);
                while Instant::now() < release_at { std::hint::spin_loop(); }
            };
            if worker_writes {
                let mut guard = worker_lock.write();
                *guard = 9;
                hold();
            } else {
                let _guard = worker_lock.read();
                hold();
            }
        });
        hiroz::compat::timeout(Duration::from_secs(3), zenoh_runtime::recv_async_anywhere(&rx))
            .await.map_err(|_| JsValue::from_str("worker did not acquire the lock"))?
            .map_err(|_| JsValue::from_str("worker ended before acquiring the lock"))?;
        let started = Instant::now();
        main_attempting.store(true, Ordering::Release);
        if worker_writes {
            assert_eq!(*lock.read(), 9);
        } else {
            *lock.write() = 11;
            assert_eq!(*lock.read(), 11);
        }
        assert!(started.elapsed() >= Duration::from_millis(80), "lock attempt must really contend");
    }
    Ok(())
}
