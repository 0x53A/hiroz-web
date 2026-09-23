//! Browser/ROS 2 action interop. Every wait is bounded by the browser runner.
use hiroz::{
    action::{GoalId, GoalStatus},
    context::ZContextBuilder,
    Builder,
};
use hiroz_msgs::example_interfaces::{
    action::Fibonacci, FibonacciFeedback, FibonacciGoal, FibonacciResult,
};
use std::{sync::OnceLock, time::Duration};
use wasm_bindgen::prelude::*;
use zenoh_runtime::wasm_yield::sleep_ms;

static EVENTS: OnceLock<flume::Receiver<String>> = OnceLock::new();
static STOP: OnceLock<flume::Sender<()>> = OnceLock::new();

#[wasm_bindgen]
pub fn actions_start() {
    let (tx, rx) = flume::unbounded();
    EVENTS.set(rx).expect("actions started twice");
    let (stop_tx, stop_rx) = flume::bounded(1);
    STOP.set(stop_tx).expect("actions started twice");
    zenoh_runtime::ZRuntime::Application.spawn(async move {
        zenoh_runtime::spawn_on_current(async move {
            if let Err(error) = run(tx.clone(), stop_rx).await {
                let _ = tx.send(format!("FAIL: {error}"));
            }
        });
    });
}
#[wasm_bindgen]
pub fn actions_poll() -> String {
    EVENTS
        .get()
        .map(|rx| rx.try_iter().collect::<Vec<_>>().join("\n"))
        .unwrap_or_default()
}
#[wasm_bindgen]
pub fn actions_stop() {
    if let Some(tx) = STOP.get() {
        let _ = tx.try_send(());
    }
}

async fn run(tx: flume::Sender<String>, stop: flume::Receiver<()>) -> Result<(), String> {
    async fn inner(tx: &flume::Sender<String>, stop: flume::Receiver<()>) -> hiroz::Result<()> {
        let mut config = zenoh::Config::default();
        config.insert_json5("mode", r#""client""#).unwrap();
        config
            .insert_json5("connect/endpoints", r#"["ws/127.0.0.1:7548"]"#)
            .unwrap();
        config
            .insert_json5("scouting/multicast/enabled", "false")
            .unwrap();
        let ctx = ZContextBuilder::default()
            .with_zenoh_config(config)
            .build_async()
            .await?;
        let node = ctx.create_node("wasm_action_interop").build()?;
        let server = node
            .create_action_server::<Fibonacci>("wasm_fibonacci")
            .build()?;
        let (server_stop_tx, server_stop_rx) = flume::bounded(1);
        let server_task = zenoh_runtime::ZRuntime::Application.spawn(async move {
            loop {
                let requested = tokio::select! {
                    _ = server_stop_rx.recv_async() => break,
                    goal = server.recv_goal() => match goal { Ok(g) => g, Err(_) => break },
                };
                if requested.goal().order < 0 {
                    requested.reject().unwrap();
                    continue;
                }
                let accepted = match requested.try_accept() {
                    Ok(goal) => goal,
                    Err(_) => continue,
                };
                if accepted.goal().order == 77 {
                    sleep_ms(300).await;
                }
                let executing = accepted.execute();
                zenoh_runtime::spawn_on_current(async move {
                    let order = executing.goal().order;
                    let mut values = vec![0, 1];
                    for i in 2..=if order == 99 { 200 } else { order } {
                        sleep_ms(50).await;
                        if executing.is_cancel_requested() || executing.try_process_cancel() {
                            executing
                                .canceled(FibonacciResult { sequence: values })
                                .unwrap();
                            return;
                        }
                        values.push(if i < 30 {
                            values[values.len() - 1] + values[values.len() - 2]
                        } else {
                            0
                        });
                        executing
                            .publish_feedback(FibonacciFeedback {
                                sequence: values.clone(),
                            })
                            .unwrap();
                        if order == 13 {
                            executing
                                .abort(FibonacciResult { sequence: vec![13] })
                                .unwrap();
                            return;
                        }
                    }
                    executing
                        .succeed(FibonacciResult { sequence: values })
                        .unwrap();
                });
            }
        });
        let _ = tx.send("Browser action server ready".into());
        let client = node
            .create_action_client::<Fibonacci>("python_fibonacci")
            .build()?;
        assert!(
            client.wait_for_server(Duration::from_secs(15)).await,
            "Python server not discovered"
        );
        let _ = tx.send("PASS: browser action discovery".into());
        assert!(client.send_goal(FibonacciGoal { order: -1 }).await.is_err());
        let _ = tx.send("PASS: browser client rejection".into());
        let mut a = client.send_goal(FibonacciGoal { order: 5 }).await?;
        let b = client.send_goal(FibonacciGoal { order: 6 }).await?;
        let mut feedback = a.feedback().expect("feedback receiver");
        let ar = a.result_with_timeout(Duration::from_secs(10)).await?;
        let br = b.result_with_timeout(Duration::from_secs(10)).await?;
        assert_eq!(ar.sequence, vec![0, 1, 1, 2, 3, 5]);
        assert_eq!(br.sequence, vec![0, 1, 1, 2, 3, 5, 8]);
        assert!(feedback.try_recv().is_ok(), "missing Python feedback");
        let _ = tx.send("PASS: browser client concurrent goals, feedback and results".into());
        let aborted = client.send_goal(FibonacciGoal { order: 13 }).await?;
        let (status, result) = aborted.result_with_status().await?;
        assert_eq!(status, GoalStatus::Aborted);
        assert_eq!(result.sequence, vec![13]);
        let _ = tx.send("PASS: browser client aborted goal result".into());
        let canceled = client.send_goal(FibonacciGoal { order: 99 }).await?;
        let response = canceled.cancel().await?;
        assert_eq!(response.return_code, 0);
        assert_eq!(response.goals_canceling.len(), 1);
        assert_eq!(canceled.result_with_status().await?.0, GoalStatus::Canceled);
        let _ = tx.send("PASS: browser client cancellation and result".into());
        let timed = client.send_goal(FibonacciGoal { order: 99 }).await?;
        let id = timed.id();
        assert!(timed
            .result_with_timeout(Duration::from_millis(30))
            .await
            .is_err());
        client.cancel_goal(id).await?;
        let _ = tx.send("PASS: browser client result timeout".into());
        let first = client.send_goal(FibonacciGoal { order: 99 }).await?;
        let second = client.send_goal(FibonacciGoal { order: 99 }).await?;
        let selected = client
            .cancel_goals(
                GoalId::from_bytes([0; 16]),
                hiroz::action::Time {
                    sec: i32::MAX,
                    nanosec: 0,
                },
            )
            .await?;
        assert_eq!(selected.return_code, 0);
        assert_eq!(selected.goals_canceling.len(), 2);
        assert_eq!(first.result_with_status().await?.0, GoalStatus::Canceled);
        assert_eq!(second.result_with_status().await?.0, GoalStatus::Canceled);
        let _ = tx.send("PASS: browser timestamp selector cancels Python goals".into());
        local_driver_tests(&node, tx).await?;
        let _ = tx.send("Browser action client tests complete".into());
        let _ = stop.recv_async().await;
        // Dropping context closes the session and all test endpoints.
        let _ = server_stop_tx.send(());
        server_task.await.expect("manual server task shutdown");
        ctx.shutdown_async().await?;
        let _ = tx.send("Browser action shutdown complete".into());
        Ok(())
    }
    inner(&tx, stop).await.map_err(|e| e.to_string())
}

// Exercise the managed driver in addition to the manual server used by rclpy.
async fn local_driver_tests(
    node: &hiroz::node::ZNode,
    tx: &flume::Sender<String>,
) -> hiroz::Result<()> {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    struct HandlerGuard(Arc<AtomicUsize>);
    impl Drop for HandlerGuard {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }
    let active = Arc::new(AtomicUsize::new(0));
    let handler_active = active.clone();
    let server = node
        .create_action_server::<Fibonacci>("wasm_managed_fibonacci")
        .with_result_timeout(Duration::from_millis(100))
        .build()?
        .with_handler(move |executing| {
            let active = handler_active.clone();
            async move {
                active.fetch_add(1, Ordering::SeqCst);
                let _guard = HandlerGuard(active);
                if executing.goal().order == 88 {
                    return;
                }
                if executing.goal().order == 0 {
                    executing
                        .succeed(FibonacciResult { sequence: vec![42] })
                        .unwrap();
                    return;
                }
                loop {
                    sleep_ms(10).await;
                    if executing.is_cancel_requested() {
                        executing
                            .canceled(FibonacciResult { sequence: vec![-1] })
                            .unwrap();
                        return;
                    }
                }
            }
        });
    let client = node
        .create_action_client::<Fibonacci>("wasm_managed_fibonacci")
        .build()?;
    assert!(client.wait_for_server(Duration::from_secs(5)).await);
    let a = client.send_goal(FibonacciGoal { order: 99 }).await?;
    let id = a.id();
    let pending =
        zenoh_runtime::ZRuntime::Application.spawn(a.result_with_timeout(Duration::from_secs(5)));
    sleep_ms(50).await; // Ensure GetResult is pending when cancellation arrives.
    assert_eq!(client.cancel_goal(id).await?.return_code, 0);
    assert_eq!(pending.await.unwrap()?.sequence, vec![-1]);
    let _ = tx.send("PASS: managed driver cancellation with pending result".into());

    let a = client.send_goal(FibonacciGoal { order: 99 }).await?;
    let b = client.send_goal(FibonacciGoal { order: 99 }).await?;
    let canceled = client.cancel_all_goals().await?;
    assert_eq!(canceled.return_code, 0);
    assert_eq!(canceled.goals_canceling.len(), 2);
    assert_eq!(
        a.result_with_timeout(Duration::from_secs(5))
            .await?
            .sequence,
        vec![-1]
    );
    assert_eq!(
        b.result_with_timeout(Duration::from_secs(5))
            .await?
            .sequence,
        vec![-1]
    );
    let _ = tx.send("PASS: managed driver cancel all goals".into());

    let dropped = client.send_goal(FibonacciGoal { order: 99 }).await?;
    let dropped_id = dropped.id();
    let task = zenoh_runtime::ZRuntime::Application.spawn(dropped.result());
    sleep_ms(30).await;
    task.abort();
    assert!(task.await.is_err());
    assert!(
        client.status_watch(dropped_id).is_none(),
        "aborted result task retained client registration"
    );
    assert_eq!(client.cancel_goal(dropped_id).await?.return_code, 0);
    assert_eq!(client.get_result(dropped_id).await?.sequence, vec![-1]);
    let _ = tx.send("PASS: aborted client result task removes registration".into());

    let finished = client.send_goal(FibonacciGoal { order: 0 }).await?;
    let finished_id = finished.id();
    assert_eq!(
        finished
            .result_with_timeout(Duration::from_secs(5))
            .await?
            .sequence,
        vec![42]
    );
    assert_eq!(client.get_result(finished_id).await?.sequence, vec![42]);
    sleep_ms(1200).await; // Managed driver expires retained results every second.
    assert!(client.get_result(finished_id).await.is_err());
    assert_eq!(
        client.get_result_with_status(finished_id).await?.0,
        GoalStatus::Unknown
    );
    assert_eq!(
        client
            .get_result_with_status(GoalId::from_bytes([0x55; 16]))
            .await?
            .0,
        GoalStatus::Unknown
    );
    let _ = tx.send("PASS: managed driver retained result expires and unknown status".into());

    let unfinished = client.send_goal(FibonacciGoal { order: 88 }).await?;
    assert_eq!(
        unfinished.result_with_status().await?.0,
        GoalStatus::Aborted
    );
    let _ = tx.send("PASS: managed handler return without result aborts goal".into());

    let timeout_server = node
        .create_action_server::<Fibonacci>("wasm_deadline_fibonacci")
        .with_goal_timeout(Duration::from_millis(50))
        .build()?
        .with_handler(|executing| async move {
            sleep_ms(1000).await;
            executing
                .succeed(FibonacciResult {
                    sequence: vec![999],
                })
                .unwrap();
        });
    let timeout_client = node
        .create_action_client::<Fibonacci>("wasm_deadline_fibonacci")
        .build()?;
    assert!(timeout_client.wait_for_server(Duration::from_secs(5)).await);
    let timed = timeout_client.send_goal(FibonacciGoal { order: 5 }).await?;
    let (status, result) = timed.result_with_status().await?;
    assert_eq!(status, GoalStatus::Aborted);
    assert!(result.sequence.is_empty());
    drop(timeout_server);
    let _ = tx.send("PASS: managed goal deadline aborts handler and replies".into());

    let abandoned = client.send_goal(FibonacciGoal { order: 99 }).await?;
    for _ in 0..100 {
        if active.load(Ordering::SeqCst) > 0 {
            break;
        }
        sleep_ms(10).await;
    }
    assert_eq!(active.load(Ordering::SeqCst), 1);
    drop(server);
    for _ in 0..100 {
        if active.load(Ordering::SeqCst) == 0 {
            break;
        }
        sleep_ms(10).await;
    }
    assert_eq!(
        active.load(Ordering::SeqCst),
        0,
        "server drop must cancel active handlers"
    );
    let abandoned_id = abandoned.id();
    drop(abandoned);
    assert!(
        client.status_watch(abandoned_id).is_none(),
        "dropped handle retained client registration"
    );
    let _ = tx.send("PASS: managed server drop cancels handler task".into());
    Ok(())
}
