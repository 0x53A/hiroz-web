//! Test-only native ROS 2 turtlesim interoperability, separate from the Nav2 demo.
use hiroz::{action::GoalStatus, context::ZContextBuilder, Builder};
use hiroz_msgs::geometry_msgs::Twist;
use std::time::Duration;
use wasm_bindgen::prelude::*;
use zenoh_runtime::wasm_yield::{sleep_ms, Instant};
// Generated from the current native turtlesim_msgs definitions in tests/interfaces.
use crate::turtle_interfaces::turtlesim_msgs::{action::RotateAbsolute, Pose, RotateAbsoluteGoal};

#[wasm_bindgen]
pub async fn test_native_turtlesim() -> Result<String, JsValue> {
    let (tx, rx) = flume::bounded(1);
    zenoh_runtime::ZRuntime::Application.spawn(async move {
        zenoh_runtime::spawn_on_current(async move {
            let result = run().await.map_err(|error| error.to_string());
            let _ = tx.send(result);
        });
    });
    zenoh_runtime::recv_async_anywhere(&rx)
        .await
        .map_err(|error| JsValue::from_str(&error.to_string()))?
        .map_err(|error| JsValue::from_str(&error))
}

async fn run() -> hiroz::Result<String> {
    let mut checks = Vec::new();
    let mut config = zenoh::Config::default();
    config.insert_json5("mode", r#""client""#)?;
    config.insert_json5("connect/endpoints", r#"["ws/127.0.0.1:7748"]"#)?;
    config.insert_json5("scouting/multicast/enabled", "false")?;
    let context = ZContextBuilder::default()
        .with_zenoh_config(config)
        .build_async()
        .await?;
    let node = context
        .create_node("browser_turtlesim_validation")
        .build()?;
    let pose = node.create_sub::<Pose>("/turtle1/pose").build()?;
    let velocity = node.create_pub::<Twist>("/turtle1/cmd_vel").build()?;
    let action = node
        .create_action_client::<RotateAbsolute>("/turtle1/rotate_absolute")
        .build()?;
    if !action.wait_for_server(Duration::from_secs(20)).await {
        return Err("native turtlesim RotateAbsolute server was not discovered".into());
    }
    let first = hiroz::compat::timeout(Duration::from_secs(10), pose.async_recv())
        .await
        .map_err(|_| "native turtlesim pose timed out")??;
    checks.push("PASS: native turtlesim action discovery and Pose reception");
    let mut drive = Twist::default();
    drive.linear.x = 0.8;
    for _ in 0..15 {
        velocity.publish(&drive)?;
        sleep_ms(50).await;
    }
    velocity.publish(&Twist::default())?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let sample = hiroz::compat::timeout(Duration::from_secs(1), pose.async_recv())
            .await
            .map_err(|_| "native pose stopped during drive check")??;
        if ((sample.x - first.x).powi(2) + (sample.y - first.y).powi(2)).sqrt() > 0.15
            && sample.linear_velocity.abs() < 0.01
        {
            break;
        }
        if Instant::now() > deadline {
            return Err("Twist drive/stop did not change native turtlesim pose".into());
        }
    }
    checks.push("PASS: browser Twist drives native turtlesim and zero command stops it");
    let mut goal = action.send_goal(RotateAbsoluteGoal { theta: 1.2 }).await?;
    let mut feedback = goal
        .feedback()
        .ok_or("missing RotateAbsolute feedback receiver")?;
    let (status, result) =
        hiroz::compat::timeout(Duration::from_secs(10), goal.result_with_status())
            .await
            .map_err(|_| "native rotation did not finish")??;
    if status != GoalStatus::Succeeded || !result.delta.is_finite() {
        return Err("native RotateAbsolute did not succeed with finite result".into());
    }
    if feedback.try_recv().is_err() {
        return Err("native RotateAbsolute feedback missing".into());
    }
    checks.push("PASS: native RotateAbsolute feedback and successful result");
    let mut goal = action.send_goal(RotateAbsoluteGoal { theta: -1.5 }).await?;
    let mut feedback = goal
        .feedback()
        .ok_or("missing cancellation feedback receiver")?;
    hiroz::compat::timeout(Duration::from_secs(3), feedback.recv())
        .await
        .map_err(|_| "native cancellation goal never started")?
        .ok_or("native cancellation feedback ended")?;
    let cancel = goal.cancel().await?;
    if cancel.return_code != 0 || cancel.goals_canceling.is_empty() {
        return Err("native RotateAbsolute cancellation rejected".into());
    }
    let (status, _) = hiroz::compat::timeout(Duration::from_secs(5), goal.result_with_status())
        .await
        .map_err(|_| "native canceled rotation did not finish")??;
    if status != GoalStatus::Canceled {
        return Err("native rotation did not return Canceled".into());
    }
    checks.push("PASS: native RotateAbsolute cancellation and canceled result");
    drop(action);
    drop(velocity);
    drop(pose);
    drop(node);
    context.shutdown_async().await?;
    checks.push("PASS: native turtlesim validation context shuts down");
    Ok(checks.join("\n"))
}
