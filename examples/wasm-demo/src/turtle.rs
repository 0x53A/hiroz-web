//! Router-connected browser robot and groundstation. All ROS objects stay on the
//! Application worker; JS handles only configuration, commands and event queues.
use crate::turtle_interfaces::{
    nav2_msgs::{NavigateToPoseFeedback, NavigateToPoseGoal, action::NavigateToPose},
    turtlesim_msgs::{Pose, RotateAbsoluteFeedback, RotateAbsoluteGoal, action::RotateAbsolute},
};
use hiroz::{
    Builder,
    action::{GoalStatus, ZAction},
    compat::{Mutex, timeout},
    context::ZContextBuilder,
};
use hiroz_msgs::{
    geometry_msgs::{Twist, TwistStamped},
    nav_msgs::Odometry,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    cell::RefCell,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use wasm_bindgen::prelude::*;
use zenoh_runtime::{
    ZRuntime,
    wasm_yield::{Instant, sleep_ms},
};

#[derive(Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct Config {
    role: String,
    profile: String,
    router: String,
    domain: usize,
    namespace: String,
    cmd_topic: String,
    odom_topic: String,
    action_name: String,
    frame: String,
    base_frame: String,
    twist_stamped: bool,
    max_linear: f64,
    max_angular: f64,
    watchdog_ms: u64,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            role: "groundstation".into(),
            profile: "turtlebot".into(),
            router: "ws/127.0.0.1:7448".into(),
            domain: 0,
            namespace: "/turtlebot".into(),
            cmd_topic: "cmd_vel".into(),
            odom_topic: "odom".into(),
            action_name: "navigate_to_pose".into(),
            frame: "odom".into(),
            base_frame: "base_link".into(),
            twist_stamped: true,
            max_linear: 0.3,
            max_angular: 1.2,
            watchdog_ms: 500,
        }
    }
}
impl Config {
    fn parse(input: &str) -> Result<Self, String> {
        let mut c: Self = serde_json::from_str(input).map_err(|e| e.to_string())?;
        if !["simulator", "groundstation"].contains(&c.role.as_str()) {
            return Err("Choose simulator or groundstation role".into());
        }
        if !["turtlebot", "turtlesim"].contains(&c.profile.as_str()) {
            return Err("Unknown robot profile".into());
        }
        if !(c.router.starts_with("ws/") || c.router.starts_with("wss/"))
            || c.router
                .split_once('/')
                .is_none_or(|(_, address)| address.is_empty())
        {
            return Err("Router must be ws/host:port or wss/host:port".into());
        }
        if c.domain > 232 {
            return Err("ROS domain must be between 0 and 232".into());
        }
        for name in [
            &c.namespace,
            &c.cmd_topic,
            &c.odom_topic,
            &c.action_name,
            &c.frame,
            &c.base_frame,
        ] {
            if name.is_empty()
                || name
                    .chars()
                    .any(|ch| !(ch.is_ascii_alphanumeric() || ch == '_' || ch == '/'))
            {
                return Err(
                    "ROS names must contain letters, digits, underscores or slashes".into(),
                );
            }
        }
        if !c.max_linear.is_finite()
            || !(0.01..=2.0).contains(&c.max_linear)
            || !c.max_angular.is_finite()
            || !(0.01..=4.0).contains(&c.max_angular)
            || !(100..=3000).contains(&c.watchdog_ms)
        {
            return Err("Invalid speed limits or watchdog duration".into());
        }
        if !c.namespace.starts_with('/') {
            c.namespace.insert(0, '/');
        }
        if c.profile == "turtlesim" {
            c.twist_stamped = false;
            if c.odom_topic == "odom" {
                c.odom_topic = "pose".into();
            }
            if c.action_name == "navigate_to_pose" {
                c.action_name = "rotate_absolute".into();
            }
        }
        Ok(c)
    }
}
#[derive(Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Command {
    Velocity { linear: f64, angular: f64 },
    Goal { x: f64, y: f64, yaw: f64 },
    Cancel,
    Disconnect,
}
// Velocity is replaceable state, while stop/cancel/disconnect are priority
// signals. A congested worker must never replay a FIFO of old motion commands.
#[derive(Default)]
struct CommandSignals {
    goals: std::collections::VecDeque<Command>,
    latest: Option<(f64, f64, Instant)>,
    stop: bool,
    cancel: bool,
    disconnect: bool,
}
struct CommandSender {
    signals: Arc<Mutex<CommandSignals>>,
    wake: flume::Sender<()>,
}
struct CommandReceiver {
    signals: Arc<Mutex<CommandSignals>>,
    wake: flume::Receiver<()>,
    max_age: Duration,
}
fn command_channel(max_age: Duration) -> (CommandSender, CommandReceiver) {
    let (wake, notified) = flume::bounded(1);
    let signals = Arc::new(Mutex::new(CommandSignals::default()));
    (
        CommandSender {
            signals: signals.clone(),
            wake,
        },
        CommandReceiver {
            signals,
            wake: notified,
            max_age,
        },
    )
}
impl CommandSender {
    fn try_send(&self, command: Command) -> Result<(), String> {
        {
            if self.wake.is_disconnected() {
                return Err("Session worker has ended".into());
            }
            let mut signals = self.signals.lock();
            if signals.disconnect {
                return Err("Session is disconnecting".into());
            }
            match command {
                goal @ Command::Goal { .. } => {
                    if signals.goals.len() == 64 {
                        return Err("Goal command queue full".into());
                    }
                    signals.goals.push_back(goal);
                }
                Command::Velocity { linear, angular } if linear != 0.0 || angular != 0.0 => {
                    signals.latest = Some((linear, angular, Instant::now()))
                }
                Command::Velocity { .. } => {
                    signals.latest = None;
                    signals.stop = true;
                }
                Command::Cancel => {
                    signals.latest = None;
                    signals.goals.clear();
                    signals.cancel = true;
                }
                Command::Disconnect => {
                    signals.latest = None;
                    signals.disconnect = true;
                }
            }
        }
        match self.wake.try_send(()) {
            Ok(()) | Err(flume::TrySendError::Full(_)) => Ok(()),
            Err(flume::TrySendError::Disconnected(_)) => {
                let mut signals = self.signals.lock();
                signals.latest = None;
                signals.goals.clear();
                signals.disconnect = true;
                Err("Session worker has ended".into())
            }
        }
    }
}
impl CommandReceiver {
    async fn recv_async(&self) -> Result<Command, flume::RecvError> {
        loop {
            {
                let mut signals = self.signals.lock();
                if signals.disconnect {
                    return Ok(Command::Disconnect);
                }
                if std::mem::take(&mut signals.cancel) {
                    return Ok(Command::Cancel);
                }
                // A later nonzero command cannot erase a pending stop.
                if std::mem::take(&mut signals.stop) {
                    return Ok(Command::Velocity {
                        linear: 0.0,
                        angular: 0.0,
                    });
                }
                if let Some((linear, angular, issued_at)) = signals.latest.take() {
                    return Ok(if issued_at.elapsed() <= self.max_age {
                        Command::Velocity { linear, angular }
                    } else {
                        Command::Velocity {
                            linear: 0.0,
                            angular: 0.0,
                        }
                    });
                }
                // Only take a goal when returning it. Cancellation of this
                // receive future cannot consume and lose a pending goal.
                if let Some(goal) = signals.goals.pop_front() {
                    return Ok(goal);
                }
            }
            self.wake.recv_async().await?;
        }
    }
}

struct Connection {
    commands: CommandSender,
    events: flume::Receiver<Value>,
    latest: Arc<Mutex<[Option<Value>; 2]>>,
    done: flume::Receiver<()>,
}
thread_local! { static CONNECTION: RefCell<Option<Connection>> = const {RefCell::new(None)}; }
#[derive(Default)]
struct ReceiptStats {
    count: u64,
    last: Option<Instant>,
    max_gap_ms: u128,
}
#[derive(Clone)]
struct Events {
    control: flume::Sender<Value>,
    receipts: Arc<Mutex<ReceiptStats>>,
    latest: Arc<Mutex<[Option<Value>; 2]>>,
}
fn emit(events: &Events, mut value: Value) {
    match value["type"].as_str() {
        Some("odometry") => {
            value["received_ms"] = json!(js_sys::Date::now());
            // Align page and worker monotonic clocks without depending on
            // wall-clock adjustments. Keep received_ms for human timestamps.
            value["received_monotonic_ms"] = json!(receipt_time_ms());
            {
                let mut stats = events.receipts.lock();
                let now = Instant::now();
                if let Some(last) = stats.last {
                    stats.max_gap_ms = stats.max_gap_ms.max(now.duration_since(last).as_millis());
                }
                stats.last = Some(now);
                stats.count += 1;
                value["callback_count"] = json!(stats.count);
                value["max_callback_gap_ms"] = json!(stats.max_gap_ms);
            }
            events.latest.lock()[0] = Some(value);
        }
        Some("feedback") => events.latest.lock()[1] = Some(value),
        _ => {
            let _ = events.control.send(value);
        }
    }
}
fn receipt_time_ms() -> f64 {
    use wasm_bindgen::JsCast;
    thread_local! {
        static PERFORMANCE: web_sys::Performance = js_sys::Reflect::get(
            &js_sys::global(), &JsValue::from_str("performance")
        ).expect("browser performance clock").unchecked_into();
    }
    PERFORMANCE.with(|p| p.time_origin() + p.now())
}

// Dropping a JoinHandle detaches it. Session tasks must instead stop on every
// exit path, including setup/publication errors and cancellation of the owner.
#[derive(Default)]
struct SessionTasks(Vec<zenoh_runtime::JoinHandle<()>>);
impl Drop for SessionTasks {
    fn drop(&mut self) {
        for task in &self.0 {
            task.abort();
        }
    }
}
fn js_error(error: impl ToString) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[wasm_bindgen]
pub async fn turtle_start(input: &str) -> Result<(), JsValue> {
    let config = Config::parse(input).map_err(js_error)?;
    if CONNECTION.with(|state| {
        let mut state = state.borrow_mut();
        // A worker can finish independently of turtle_disconnect (for example
        // after a publication error). Retire its completed session before
        // admitting a new one, just as the disconnected UI promises.
        if state.as_ref().is_some_and(|connection| {
            !connection.done.is_empty() || connection.done.is_disconnected()
        }) {
            *state = None;
        }
        state.is_some()
    }) {
        return Err(js_error("Disconnect before connecting again"));
    }
    let global = js_sys::global();
    let location = js_sys::Reflect::get(&global, &"location".into())?;
    let href = js_sys::Reflect::get(&location, &"href".into())?
        .as_string()
        .ok_or_else(|| js_error("Missing page URL"))?;
    let base = href.split('?').next().unwrap_or(&href);
    let shim = if base.ends_with('/') {
        format!("{base}pkg/hiroz_wasm_demo.js")
    } else {
        format!(
            "{}/pkg/hiroz_wasm_demo.js",
            base.rsplit_once('/').map_or(base, |(s, _)| s)
        )
    };
    if !crate::ros_start(&shim).await? {
        return Err(js_error(
            "Shared memory unavailable; use an isolated browser page",
        ));
    }
    let (commands, receiver) = command_channel(Duration::from_millis(config.watchdog_ms));
    let (control, event_rx) = flume::unbounded();
    let latest = Arc::new(Mutex::new([None, None]));
    let events = Events {
        control,
        latest: latest.clone(),
        receipts: Arc::new(Mutex::new(ReceiptStats::default())),
    };
    let (done_tx, done) = flume::bounded(1);
    let (ready_tx, ready) = flume::bounded(1);
    CONNECTION.with(|state| {
        *state.borrow_mut() = Some(Connection {
            commands,
            events: event_rx,
            latest,
            done,
        })
    });
    ZRuntime::Application.spawn(async move {
        zenoh_runtime::spawn_on_current(async move {
            let result = run(config, receiver, events.clone(), ready_tx).await;
            if let Err(error) = result {
                emit(&events, json!({"type":"error","message":error.to_string()}));
            }
            emit(&events, json!({"type":"status","state":"disconnected"}));
            let _ = done_tx.send(());
        });
    });
    match timeout(
        Duration::from_secs(15),
        zenoh_runtime::recv_async_anywhere(&ready),
    )
    .await
    {
        Ok(Ok(Ok(()))) => Ok(()),
        other => {
            let message = format!("Connection failed: {other:?}");
            let _ = turtle_disconnect().await;
            Err(js_error(message))
        }
    }
}
#[wasm_bindgen]
pub fn turtle_command(input: &str) -> Result<(), JsValue> {
    let command: Command = serde_json::from_str(input).map_err(js_error)?;
    match &command {
        Command::Velocity { linear, angular } if !linear.is_finite() || !angular.is_finite() => {
            return Err(js_error("Velocity must be finite"));
        }
        Command::Goal { x, y, yaw }
            if !x.is_finite()
                || !y.is_finite()
                || !yaw.is_finite()
                || x.abs() > 25.0
                || y.abs() > 25.0 =>
        {
            return Err(js_error("Goal must be finite and within 25 metres"));
        }
        _ => {}
    }
    CONNECTION.with(|state| {
        state
            .borrow()
            .as_ref()
            .ok_or_else(|| js_error("Not connected"))?
            .commands
            .try_send(command)
            .map_err(js_error)
    })
}
#[wasm_bindgen]
pub fn turtle_poll() -> String {
    CONNECTION.with(|state| {
        serde_json::to_string(
            &state
                .borrow()
                .as_ref()
                .map(|c| {
                    let mut values: Vec<_> = c
                        .latest
                        .lock()
                        .iter_mut()
                        .filter_map(Option::take)
                        .collect();
                    values.extend(c.events.try_iter());
                    values
                })
                .unwrap_or_default(),
        )
        .unwrap()
    })
}
#[wasm_bindgen]
pub async fn turtle_disconnect() -> Result<(), JsValue> {
    let connection = CONNECTION.with(|state| state.borrow_mut().take());
    if let Some(connection) = connection {
        let _ = connection.commands.try_send(Command::Disconnect);
        timeout(
            Duration::from_secs(5),
            zenoh_runtime::recv_async_anywhere(&connection.done),
        )
        .await
        .map_err(|_| js_error("Disconnect timed out"))?
        .map_err(js_error)?;
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct Target {
    x: f64,
    y: f64,
    yaw: f64,
    rotate_only: bool,
}
struct Model {
    x: f64,
    y: f64,
    yaw: f64,
    linear: f64,
    angular: f64,
    target: Option<Target>,
    last_command: Instant,
}
impl Model {
    fn new(profile: &str) -> Self {
        Self {
            x: if profile == "turtlesim" { 5.5 } else { 0.0 },
            y: if profile == "turtlesim" { 5.5 } else { 0.0 },
            yaw: 0.0,
            linear: 0.0,
            angular: 0.0,
            target: None,
            last_command: Instant::now(),
        }
    }
    fn stop(&mut self) {
        self.target = None;
        self.linear = 0.0;
        self.angular = 0.0;
    }
    fn event(&self, frame: &str) -> Value {
        json!({"type":"odometry","x":self.x,"y":self.y,"yaw":self.yaw,"linear":self.linear,"angular":self.angular,"frame":frame})
    }
}
fn stamp() -> hiroz_msgs::builtin_interfaces::Time {
    let nanos = hiroz::time::ZClock::system().now().as_unix_nanos();
    hiroz_msgs::builtin_interfaces::Time {
        sec: (nanos / 1_000_000_000) as i32,
        nanosec: (nanos % 1_000_000_000) as u32,
    }
}
fn angle(value: f64) -> f64 {
    (value + std::f64::consts::PI).rem_euclid(std::f64::consts::TAU) - std::f64::consts::PI
}
trait DemoAction: ZAction {
    fn goal(target: Target, frame: &str) -> Self::Goal;
    fn target(goal: &Self::Goal, model: &Model) -> Target;
    fn feedback(model: &Model, target: Target, frame: &str) -> Self::Feedback;
    fn feedback_event(feedback: &Self::Feedback) -> Value;
}
impl DemoAction for NavigateToPose {
    fn goal(t: Target, frame: &str) -> Self::Goal {
        let mut g = NavigateToPoseGoal::default();
        g.pose.header.frame_id = frame.into();
        g.pose.header.stamp = stamp();
        g.pose.pose.position.x = t.x;
        g.pose.pose.position.y = t.y;
        g.pose.pose.orientation.z = (t.yaw / 2.0).sin();
        g.pose.pose.orientation.w = (t.yaw / 2.0).cos();
        g
    }
    fn target(g: &Self::Goal, _: &Model) -> Target {
        Target {
            x: g.pose.pose.position.x,
            y: g.pose.pose.position.y,
            yaw: 2.0 * g.pose.pose.orientation.z.atan2(g.pose.pose.orientation.w),
            rotate_only: false,
        }
    }
    fn feedback(m: &Model, t: Target, frame: &str) -> Self::Feedback {
        let mut f = NavigateToPoseFeedback::default();
        f.distance_remaining = ((t.x - m.x).powi(2) + (t.y - m.y).powi(2)).sqrt() as f32;
        f.current_pose.header.frame_id = frame.into();
        f.current_pose.header.stamp = stamp();
        f.current_pose.pose.position.x = m.x;
        f.current_pose.pose.position.y = m.y;
        f.current_pose.pose.orientation.z = (m.yaw / 2.0).sin();
        f.current_pose.pose.orientation.w = (m.yaw / 2.0).cos();
        f
    }
    fn feedback_event(f: &Self::Feedback) -> Value {
        json!({"type":"feedback","distance_remaining":f.distance_remaining})
    }
}
impl DemoAction for RotateAbsolute {
    fn goal(t: Target, _: &str) -> Self::Goal {
        RotateAbsoluteGoal {
            theta: t.yaw as f32,
        }
    }
    fn target(g: &Self::Goal, m: &Model) -> Target {
        Target {
            x: m.x,
            y: m.y,
            yaw: g.theta as f64,
            rotate_only: true,
        }
    }
    fn feedback(m: &Model, t: Target, _: &str) -> Self::Feedback {
        RotateAbsoluteFeedback {
            remaining: angle(t.yaw - m.yaw) as f32,
        }
    }
    fn feedback_event(f: &Self::Feedback) -> Value {
        json!({"type":"feedback","distance_remaining":f.remaining.abs()})
    }
}

enum VelocityPublisher {
    Plain(hiroz::pubsub::ZPub<Twist, <Twist as hiroz::msg::ZMessage>::Serdes>),
    Stamped(hiroz::pubsub::ZPub<TwistStamped, <TwistStamped as hiroz::msg::ZMessage>::Serdes>),
}
impl VelocityPublisher {
    fn send(&self, linear: f64, angular: f64, frame: &str) -> hiroz::Result<()> {
        let mut t = Twist::default();
        t.linear.x = linear;
        t.angular.z = angular;
        match self {
            Self::Plain(p) => p.publish(&t),
            Self::Stamped(p) => {
                let mut msg = TwistStamped::default();
                msg.header.frame_id = frame.into();
                msg.header.stamp = stamp();
                msg.twist = t;
                p.publish(&msg)
            }
        }
    }
}

// Keep the goal handle and its identity alive across transient result failures.
// Retries are paced, while the caller continues servicing feedback and cancel.
async fn retryable_result<A: ZAction>(
    client: &hiroz::action::client::ZActionClient<A>,
    id: hiroz::action::GoalId,
) -> hiroz::Result<(GoalStatus, A::Result)> {
    sleep_ms(250).await;
    client.get_result_with_status(id).await
}

async fn run(
    config: Config,
    commands: CommandReceiver,
    events: Events,
    ready: flume::Sender<Result<(), String>>,
) -> hiroz::Result<()> {
    emit(&events, json!({"type":"status","state":"connecting"}));
    let mut zconfig = zenoh::Config::default();
    zconfig.insert_json5("mode", r#""client""#)?;
    zconfig.insert_json5(
        "connect/endpoints",
        &serde_json::to_string(&vec![&config.router])?,
    )?;
    zconfig.insert_json5("scouting/multicast/enabled", "false")?;
    let context = match timeout(
        Duration::from_secs(10),
        ZContextBuilder::default()
            .with_domain_id(config.domain)
            .with_zenoh_config(zconfig)
            .build_async(),
    )
    .await
    {
        Ok(Ok(ctx)) => ctx,
        other => {
            let _ = ready.send(Err(format!("Router connection failed: {other:?}")));
            return Err("Router connection failed".into());
        }
    };
    let node = Arc::new(
        context
            .create_node(format!("browser_{}", config.role))
            .with_namespace(&config.namespace)
            .build()?,
    );
    let alive = Arc::new(AtomicBool::new(true));
    let result = if config.profile == "turtlesim" {
        run_profile::<RotateAbsolute>(node.clone(), config, commands, events, ready, alive.clone())
            .await
    } else {
        run_profile::<NavigateToPose>(node.clone(), config, commands, events, ready, alive.clone())
            .await
    };
    alive.store(false, Ordering::Release);
    drop(node);
    context.shutdown_async().await?;
    result
}

async fn run_profile<A: DemoAction>(
    node: Arc<hiroz::node::ZNode>,
    c: Config,
    commands: CommandReceiver,
    events: Events,
    ready: flume::Sender<Result<(), String>>,
    alive: Arc<AtomicBool>,
) -> hiroz::Result<()> {
    let mut subscriptions: Vec<Box<dyn std::any::Any>> = Vec::new();
    let mut tasks = SessionTasks::default();
    let model = Arc::new(Mutex::new(Model::new(&c.profile)));
    let velocity = if c.twist_stamped {
        VelocityPublisher::Stamped(node.create_pub::<TwistStamped>(&c.cmd_topic).build()?)
    } else {
        VelocityPublisher::Plain(node.create_pub::<Twist>(&c.cmd_topic).build()?)
    };
    let sim = c.role == "simulator";
    let client = if sim {
        None
    } else {
        Some(Arc::new(
            node.create_action_client::<A>(&c.action_name).build()?,
        ))
    };
    let active = Arc::new(Mutex::new(None));
    let goal_busy = Arc::new(AtomicBool::new(false));
    let mut goal_cancel: Option<Arc<AtomicBool>> = None;
    if sim {
        let state = model.clone();
        let max_linear = c.max_linear;
        let max_angular = c.max_angular;
        let receive = move |msg: Twist| {
            let mut m = state.lock();
            if m.target.is_none() && msg.linear.x.is_finite() && msg.angular.z.is_finite() {
                m.linear = msg.linear.x.clamp(-max_linear, max_linear);
                m.angular = msg.angular.z.clamp(-max_angular, max_angular);
                m.last_command = Instant::now();
            }
        };
        if c.twist_stamped {
            subscriptions.push(Box::new(
                node.create_sub::<TwistStamped>(&c.cmd_topic)
                    .build_with_callback(move |msg| receive(msg.twist))?,
            ));
        } else {
            subscriptions.push(Box::new(
                node.create_sub::<Twist>(&c.cmd_topic)
                    .build_with_callback(receive)?,
            ));
        }
        let server = node.create_action_server::<A>(&c.action_name).build()?;
        let state = model.clone();
        let running = alive.clone();
        let frame = c.frame.clone();
        let event = events.clone();
        tasks.0.push(ZRuntime::Application.spawn(async move {
            while running.load(Ordering::Acquire) {
                let requested = match server.recv_goal().await {
                    Ok(g) => g,
                    Err(_) => break,
                };
                let target = A::target(requested.goal(), &state.lock());
                if state.lock().target.is_some()
                    || !target.x.is_finite()
                    || !target.y.is_finite()
                    || !target.yaw.is_finite()
                    || target.x.abs() > 25.0
                    || target.y.abs() > 25.0
                {
                    let _ = requested.reject();
                    continue;
                }
                let accepted = match requested.try_accept() {
                    Ok(g) => g,
                    Err(_) => continue,
                };
                let executing = accepted.execute();
                state.lock().target = Some(target);
                emit(&event, json!({"type":"goal","state":"executing"}));
                loop {
                    if !running.load(Ordering::Acquire) {
                        state.lock().stop();
                        let _ = executing.abort(A::default_result().unwrap());
                        break;
                    }
                    if executing.is_cancel_requested() || executing.try_process_cancel() {
                        state.lock().stop();
                        let _ = executing.canceled(A::default_result().unwrap());
                        emit(&event, json!({"type":"goal","state":"canceled"}));
                        break;
                    }
                    let (finished, feedback) = {
                        let m = state.lock();
                        let distance = ((target.x - m.x).powi(2) + (target.y - m.y).powi(2)).sqrt();
                        (
                            (target.rotate_only || distance < 0.04)
                                && angle(target.yaw - m.yaw).abs() < 0.04,
                            A::feedback(&m, target, &frame),
                        )
                    };
                    let _ = executing.publish_feedback(feedback);
                    if finished {
                        state.lock().stop();
                        let _ = executing.succeed(A::default_result().unwrap());
                        emit(&event, json!({"type":"goal","state":"succeeded"}));
                        break;
                    }
                    // Keep servicing admission while executing. Otherwise a
                    // second client's request can time out in the queue and
                    // start moving the robot after this goal finishes.
                    tokio::select! {
                        requested = server.recv_goal() => {
                            if let Ok(requested) = requested {
                                let _ = requested.reject();
                            }
                        }
                        _ = sleep_ms(50) => {}
                    }
                }
            }
        }));
    } else {
        let event = events.clone();
        let frame = c.frame.clone();
        if c.profile == "turtlesim" {
            subscriptions.push(Box::new(node.create_sub::<Pose>(&c.odom_topic).build_with_callback(move|p|emit(&event,json!({"type":"odometry","x":p.x,"y":p.y,"yaw":p.theta,"linear":p.linear_velocity,"angular":p.angular_velocity,"frame":frame})))?));
        } else {
            subscriptions.push(Box::new(node.create_sub::<Odometry>(&c.odom_topic).build_with_callback(move|p|emit(&event,json!({"type":"odometry","x":p.pose.pose.position.x,"y":p.pose.pose.position.y,"yaw":2.0*p.pose.pose.orientation.z.atan2(p.pose.pose.orientation.w),"linear":p.twist.twist.linear.x,"angular":p.twist.twist.angular.z,"frame":p.header.frame_id})))?));
        }
    }
    let odom_pub = if sim && c.profile == "turtlebot" {
        Some(node.create_pub::<Odometry>(&c.odom_topic).build()?)
    } else {
        None
    };
    let pose_pub = if sim && c.profile == "turtlesim" {
        Some(node.create_pub::<Pose>(&c.odom_topic).build()?)
    } else {
        None
    };
    emit(
        &events,
        json!({"type":"status","state":"connected","detail":format!("{} · {}",c.role,c.namespace)}),
    );
    let _ = ready.send(Ok(()));
    let mut tick = Instant::now();
    // Publication errors take the same cancellation/stop path as Disconnect.
    // SessionTasks also covers errors during setup and a dropped owner future.
    let result: hiroz::Result<()> = async {
        loop {
            tasks.0.retain(|task| !task.is_finished());
            let command = tokio::select! {command=commands.recv_async()=>match command {Ok(c)=>Some(c),Err(_)=>Some(Command::Disconnect)},_ = sleep_ms(50)=>None};
            match command {
                Some(Command::Disconnect) => break,
                Some(Command::Velocity { linear, angular }) if !sim => {
                    velocity.send(
                        linear.clamp(-c.max_linear, c.max_linear),
                        angular.clamp(-c.max_angular, c.max_angular),
                        &c.base_frame,
                    )?;
                }
                Some(Command::Cancel) if !sim => {
                    if !goal_busy.load(Ordering::Acquire) {
                        emit(
                            &events,
                            json!({"type":"goal","state":"canceled","detail":"Pending goal canceled before execution"}),
                        );
                    }
                    if let Some(flag) = &goal_cancel {
                        flag.store(true, Ordering::Release);
                    }
                }
                Some(Command::Goal { x, y, yaw }) if !sim => {
                    if goal_busy.swap(true, Ordering::AcqRel) {
                        emit(
                            &events,
                            json!({"type":"error","message":"Cancel or finish the active goal first"}),
                        );
                        continue;
                    }
                    let canceled = Arc::new(AtomicBool::new(false));
                    goal_cancel = Some(canceled.clone());
                    let target = Target {
                        x,
                        y,
                        yaw,
                        rotate_only: c.profile == "turtlesim",
                    };
                    let client = client
                        .as_ref()
                        .expect("groundstation action client")
                        .clone();
                    let frame = c.frame.clone();
                    let event = events.clone();
                    let pending = active.clone();
                    let busy = goal_busy.clone();
                    emit(&events, json!({"type":"goal","state":"discovering"}));
                    tasks.0.push(ZRuntime::Application.spawn(async move {
                        let discovered=tokio::select! {
                            found=client.wait_for_server(Duration::from_secs(3))=>found,
                            _=async {while !canceled.load(Ordering::Acquire){sleep_ms(20).await;}}=>false,
                        };
                        if !discovered {emit(&event,json!({"type":"goal","state":if canceled.load(Ordering::Acquire){"canceled"}else{"rejected"},"detail":"Action server unavailable or request canceled"}));busy.store(false,Ordering::Release);return;}
                        let mut goal=match timeout(Duration::from_secs(3),client.send_goal(A::goal(target,&frame))).await {
                            Ok(Ok(goal))=>goal,
                            Ok(Err(error)) if matches!(error.downcast_ref::<hiroz::error::Error>(), Some(hiroz::error::Error::GoalRejected)) => {
                                emit(&event,json!({"type":"goal","state":"rejected","detail":"Action server rejected the goal"}));
                                busy.store(false,Ordering::Release);
                                return;
                            }
                            _=>{emit(&event,json!({"type":"goal","state":"uncertain","can_cancel":false,"detail":"Acceptance was not confirmed. The robot may be executing; this session has no confirmed goal handle. Verify the robot before reconnecting; targeted cancellation is unavailable."}));return;}
                        };
                        let id=goal.id();*pending.lock()=Some(id);emit(&event,json!({"type":"goal","state":"accepted"}));
                        let mut feedback=goal.feedback().unwrap();let mut result=Box::pin(retryable_result(client.as_ref(),id));
                        let mut cancel_sent=false;let mut feedback_open=true;
                        loop {
                            if canceled.load(Ordering::Acquire) && !cancel_sent {cancel_sent=matches!(timeout(Duration::from_secs(2),client.cancel_goal(id)).await,Ok(Ok(_)));}
                            tokio::select! {
                            f=feedback.recv(),if feedback_open=>if let Some(f)=f {emit(&event,A::feedback_event(&f));} else {feedback_open=false;},
                            r=&mut result=>{
                                match r {
                                    Ok((status,_)) if status.is_terminal()=>{
                                        let name=match status{GoalStatus::Succeeded=>"succeeded",GoalStatus::Canceled=>"canceled",_=>"aborted"};
                                        emit(&event,json!({"type":"goal","state":name}));break;
                                    },
                                    Ok(_)=>emit(&event,json!({"type":"goal","state":"uncertain","detail":"Server has no terminal result; keeping goal identity for cancellation"})),
                                    Err(e)=>emit(&event,json!({"type":"goal","state":"uncertain","detail":format!("Result unavailable; retrying: {e}")})),
                                }
                                result=Box::pin(retryable_result(client.as_ref(),id));
                            },
                            _=sleep_ms(20)=>{},
                        }}
                        *pending.lock()=None;busy.store(false,Ordering::Release);
                    }));
                }
                Some(_) => {}
                None => {}
            }
            if sim {
                let now = Instant::now();
                let dt = (now - tick).as_secs_f64().min(0.1);
                tick = now;
                let mut m = model.lock();
                if let Some(t) = m.target {
                    let distance = ((t.x - m.x).powi(2) + (t.y - m.y).powi(2)).sqrt();
                    let heading = if !t.rotate_only && distance >= 0.04 {
                        (t.y - m.y).atan2(t.x - m.x)
                    } else {
                        t.yaw
                    };
                    let difference = angle(heading - m.yaw);
                    m.angular = (difference * 3.0).clamp(-c.max_angular, c.max_angular);
                    m.linear = if !t.rotate_only && distance >= 0.04 && difference.abs() < 0.35 {
                        (distance * 1.5).min(c.max_linear)
                    } else {
                        0.0
                    };
                } else if m.last_command.elapsed() > Duration::from_millis(c.watchdog_ms) {
                    m.linear = 0.0;
                    m.angular = 0.0;
                }
                m.yaw = angle(m.yaw + m.angular * dt);
                m.x += m.linear * m.yaw.cos() * dt;
                m.y += m.linear * m.yaw.sin() * dt;
                if let Some(p) = &odom_pub {
                    let mut msg = Odometry::default();
                    msg.header.frame_id = c.frame.clone();
                    msg.header.stamp = stamp();
                    msg.child_frame_id = c.base_frame.clone();
                    msg.pose.pose.position.x = m.x;
                    msg.pose.pose.position.y = m.y;
                    msg.pose.pose.orientation.z = (m.yaw / 2.0).sin();
                    msg.pose.pose.orientation.w = (m.yaw / 2.0).cos();
                    msg.twist.twist.linear.x = m.linear;
                    msg.twist.twist.angular.z = m.angular;
                    p.publish(&msg)?;
                }
                if let Some(p) = &pose_pub {
                    p.publish(&Pose {
                        x: m.x as f32,
                        y: m.y as f32,
                        theta: m.yaw as f32,
                        linear_velocity: m.linear as f32,
                        angular_velocity: m.angular as f32,
                    })?;
                }
                emit(&events, m.event(&c.frame));
            }
        }
        Ok(())
    }
    .await;
    if !sim {
        if let Some(flag) = goal_cancel {
            flag.store(true, Ordering::Release);
        }
    }
    alive.store(false, Ordering::Release);
    model.lock().stop();
    for task in &mut tasks.0 {
        if !sim && timeout(Duration::from_secs(3), &mut *task).await.is_ok() {
            continue;
        }
        task.abort();
        let _ = task.await;
    }
    if !sim {
        let _ = velocity.send(0.0, 0.0, &c.base_frame);
    }
    drop(subscriptions);
    result
}

/// Regression for profile errors and cancellation while cleanup is pending.
#[wasm_bindgen]
pub async fn test_session_task_cleanup() -> Result<(), JsValue> {
    for poll_before_drop in [false, true] {
        let (started_tx, started_rx) = flume::bounded(1);
        let (released_tx, released_rx) = flume::bounded::<()>(1);
        let mut tasks = SessionTasks::default();
        tasks.0.push(ZRuntime::Application.spawn(async move {
            // The captured sender models resources owned by a session task.
            let _resource = released_tx;
            let _ = started_tx.send(());
            std::future::pending::<()>().await;
        }));
        if poll_before_drop {
            zenoh_runtime::recv_async_anywhere(&started_rx).await.map_err(js_error)?;
        }
        drop(tasks);
        let released = timeout(Duration::from_secs(2),
            zenoh_runtime::recv_async_anywhere(&released_rx)).await;
        if !matches!(released, Ok(Err(_))) {
            return Err(js_error("Session task retained resources after owner drop"));
        }
    }
    Ok(())
}

/// Internal demo regression: priority commands cannot be crowded out by motion.
#[wasm_bindgen]
pub async fn test_command_mailbox() -> Result<(), JsValue> {
    let (tx, rx) = command_channel(Duration::from_millis(500));
    for _ in 0..1000 {
        tx.try_send(Command::Velocity {
            linear: 0.2,
            angular: 0.0,
        })
        .unwrap();
    }
    tx.try_send(Command::Velocity {
        linear: 0.0,
        angular: 0.0,
    })
    .unwrap();
    tx.try_send(Command::Velocity {
        linear: 0.1,
        angular: 0.0,
    })
    .unwrap();
    assert!(matches!(
        rx.recv_async().await.unwrap(),
        Command::Velocity {
            linear: 0.0,
            angular: 0.0
        }
    ));
    assert!(matches!(
        rx.recv_async().await.unwrap(),
        Command::Velocity {
            linear: 0.1,
            angular: 0.0
        }
    ));
    tx.signals.lock().latest = Some((0.3, 0.0, Instant::now()));
    sleep_ms(550).await;
    assert!(matches!(
        rx.recv_async().await.unwrap(),
        Command::Velocity {
            linear: 0.0,
            angular: 0.0
        }
    ));
    for i in 0..64 {
        tx.try_send(Command::Goal {
            x: i as f64,
            y: 0.0,
            yaw: 0.0,
        })
        .unwrap();
    }
    tx.try_send(Command::Cancel).unwrap();
    tx.try_send(Command::Velocity {
        linear: 0.0,
        angular: 0.0,
    })
    .unwrap();
    assert!(matches!(rx.recv_async().await.unwrap(), Command::Cancel));
    assert!(matches!(
        rx.recv_async().await.unwrap(),
        Command::Velocity {
            linear: 0.0,
            angular: 0.0
        }
    ));
    assert!(
        tx.signals.lock().goals.is_empty(),
        "Cancel must discard earlier unstarted goals"
    );
    for i in 0..64 {
        tx.try_send(Command::Goal {
            x: i as f64,
            y: 0.0,
            yaw: 0.0,
        })
        .unwrap();
    }
    for i in 0..64 {
        assert!(matches!(rx.recv_async().await.unwrap(),Command::Goal {x,..} if x==i as f64));
    }
    tx.try_send(Command::Velocity {
        linear: 0.2,
        angular: 0.0,
    })
    .unwrap();
    tx.try_send(Command::Disconnect).unwrap();
    assert!(matches!(
        rx.recv_async().await.unwrap(),
        Command::Disconnect
    ));
    assert!(
        tx.try_send(Command::Velocity {
            linear: 0.2,
            angular: 0.0
        })
        .is_err()
    );
    let (ended, receiver) = command_channel(Duration::from_millis(500));
    drop(receiver);
    assert!(
        ended
            .try_send(Command::Goal {
                x: 1.0,
                y: 0.0,
                yaw: 0.0
            })
            .is_err()
    );
    assert!(ended.signals.lock().goals.is_empty());
    Ok(())
}
/// Bounded worker stall used only by the simulated-device regression runner.
#[wasm_bindgen]
pub async fn turtle_pause_application_for_test() -> Result<(), JsValue> {
    let (ready, rx) = flume::bounded(1);
    ZRuntime::Application.spawn(async move {
        let mutex = std::sync::Mutex::new(());
        let condvar = std::sync::Condvar::new();
        let guard = mutex.lock().unwrap();
        ready.send(()).unwrap();
        let _ = condvar
            .wait_timeout(guard, Duration::from_millis(750))
            .unwrap();
    });
    zenoh_runtime::recv_async_anywhere(&rx)
        .await
        .map_err(js_error)
}
