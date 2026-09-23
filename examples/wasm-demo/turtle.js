/* Two independent ROS nodes communicate only through the router. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const query = new URLSearchParams(location.search);
  const fields = {router:'router', namespace:'namespace', domain:'domain', profile:'profile', cmd_topic:'cmd-topic', odom_topic:'odom-topic', action_name:'action-name', frame:'frame', base_frame:'base-frame', twist_stamped:'twist-stamped'};
  let ready = false, startupFailed = false, connected = false, connecting = false, activeGoal = false, canCancel = true;
  let lastSample = 0, pose = null, target = null, center = {x:0,y:0};
  let trail = [], currentDrive = {linear:0,angular:0}, lastDrive = 0;
  const keys = new Set();
  const canvas = $('map'), context = canvas.getContext('2d');
  let mapSize = {width:1,height:1,scale:1};
  const terminalStates = new Set(['succeeded','canceled','cancelled','aborted','rejected','failed']);
  const isDevice = () => $('role').value === 'simulator';
  const isTurtlesim = () => $('profile').value === 'turtlesim';
  const receiptTime = () => performance.timeOrigin + performance.now();
  const fresh = () => connected && lastSample > 0 && receiptTime() - lastSample >= 0 && receiptTime() - lastSample < 1500;
  const canDrive = () => !connecting && !isDevice() && fresh() && !activeGoal;
  const frameMatches = () => isTurtlesim() || !pose || (pose.frame || pose.frame_id || $('frame').value) === $('frame').value;
  const format = n => Number(n).toFixed(2);
  const label = text => text.charAt(0).toUpperCase() + text.slice(1);
  const configInputs = () => [$('role'), ...Object.values(fields).map($)];

  function status(text, tone = '') {
    $('status').className = tone;
    $('status').replaceChildren();
    const dot = document.createElement('span'); dot.className = 'status-dot';
    $('status').append(dot, document.createTextNode(text));
  }
  function log(text, error = false) {
    $('activity').querySelector('.log-empty')?.remove();
    const item = document.createElement('li'), time = document.createElement('time'), description = document.createElement('span');
    time.textContent = new Date().toLocaleTimeString([], {hour12:false});
    description.textContent = text; item.append(time, description);
    if (error) item.className = 'error';
    $('activity').prepend(item);
    while ($('activity').children.length > 60) $('activity').lastElementChild.remove();
  }
  function command(value) {
    if (!connected) return false;
    try { wasm_bindgen.turtle_command(JSON.stringify(value)); return true; }
    catch (error) { log(String(error), true); status(String(error), 'err'); return false; }
  }
  function updateControls() {
    const movingAllowed = canDrive();
    document.querySelectorAll('[data-linear]').forEach(button => button.disabled = !movingAllowed);
    $('stop').disabled = !connected || connecting || isDevice();
    $('send-goal').disabled = connecting || !fresh() || isDevice() || activeGoal;
    $('cancel-goal').disabled = connecting || !connected || !activeGoal || !canCancel || isDevice();
    $('disconnect').disabled = !connected || connecting;
    $('connect').disabled = !ready || connecting || connected;
    $('connect').hidden = connected;
    $('disconnect').hidden = !connected;
    $('connect').textContent = connecting ? 'Connecting…' : ready ? 'Connect' : startupFailed ? 'Runtime unavailable' : 'Loading runtime…';
    configInputs().forEach(input => input.disabled = connected || connecting);
    $('drive-hint').textContent = activeGoal ? 'Navigation is active. Cancel it to drive manually.' : movingAllowed ? 'Hold a direction · release to stop' : connected ? 'Waiting for fresh robot telemetry…' : 'Connect and wait for fresh odometry to enable driving.';
  }
  function applyRole() {
    const device = isDevice();
    $('drive-panel').hidden = device; $('navigation-panel').hidden = device; $('device-panel').hidden = !device;
    $('open-peer').textContent = device ? 'Open groundstation ↗' : 'Open simulated device ↗';
    $('map-eyebrow').textContent = device ? 'SIMULATED DEVICE / ROBOT STATE' : 'GROUNDSTATION / ROS TELEMETRY';
    $('map-title').textContent = device ? 'Simulated robot' : 'Robot view';
    $('map-caption').textContent = device ? 'Device model · publishing over ROS' : 'Pose comes from received ROS telemetry';
    $('map-empty').querySelector('strong').textContent = device ? 'Your robot starts here' : 'Waiting for a robot';
    $('map-empty').querySelector('p').textContent = device ? 'Connect to start the device, then open a groundstation.' : 'Connect both windows to the same router. Its position will appear here.';
    updateControls();
  }
  function applyProfile(resetFields = false) {
    const turtle = isTurtlesim();
    if (resetFields) {
      $('namespace').value = turtle ? '/turtle1' : '/turtlebot';
      $('cmd-topic').value = 'cmd_vel'; $('odom-topic').value = turtle ? 'pose' : 'odom';
      $('action-name').value = turtle ? 'rotate_absolute' : 'navigate_to_pose';
      $('twist-stamped').value = turtle ? 'false' : 'true'; $('frame').value = 'odom';
    }
    $('navigation-title').textContent = turtle ? 'Rotate to a heading' : 'Go to a pose';
    $('navigation-help').textContent = turtle ? 'Set a heading for the ROS turtlesim RotateAbsolute action.' : 'Pick a point on the grid or enter coordinates.';
    $('goal-x').disabled = turtle; $('goal-y').disabled = turtle;
    $('goal-x').closest('label').hidden = turtle; $('goal-y').closest('label').hidden = turtle;
    $('goal-detail').textContent = (turtle ? 'RotateAbsolute' : 'NavigateToPose') + ' · waiting for connection';
    $('frame-label').textContent = turtle ? 'turtlesim world' : $('frame').value;
    $('grid-label').textContent = turtle ? '1 unit grid' : '1 m grid';
    document.querySelectorAll('.position-unit').forEach(element => element.textContent = turtle ? 'u' : 'm');
    canvas.setAttribute('aria-label', turtle ? 'Robot pose view. Set the navigation heading using the heading input.' : 'Robot odometry view. Click to choose a navigation target; use coordinate inputs for keyboard access.');
    target = null;
  }
  function stopDrive(force = false) {
    const wasDriving = currentDrive.linear !== 0 || currentDrive.angular !== 0;
    currentDrive = {linear:0,angular:0}; keys.clear();
    document.querySelectorAll('[data-linear]').forEach(button => button.classList.remove('active'));
    if ((wasDriving || force) && !isDevice()) command({type:'velocity',linear:0,angular:0});
  }
  function drive(linear, angular, button) {
    if (!canDrive()) return;
    currentDrive = {linear:linear*Number($('speed').value), angular:angular*0.8};
    lastDrive = performance.now();
    document.querySelectorAll('[data-linear]').forEach(item => item.classList.toggle('active', item === button));
    command({type:'velocity',...currentDrive});
  }
  function resetTelemetry() {
    lastSample = 0; pose = null; trail = []; target = null; center = {x:0,y:0}; activeGoal = false;
    for (const id of ['pose-x','pose-y','pose-yaw','velocity','sample-age']) $(id).textContent = '—';
    $('sample-unit').textContent = ''; $('telemetry-state').textContent = 'Awaiting telemetry'; $('telemetry-state').className = 'tag'; $('goal-state').textContent = 'Ready'; $('goal-state').className = 'tag';
    $('goal-detail').textContent = isTurtlesim() ? 'Enter a heading when robot telemetry is available.' : 'Choose a target when robot telemetry is available.';
    $('map-empty').hidden = false; updateControls();
  }
  function processEvent(event) {
    if (event.type === 'odometry') {
      if (![event.x,event.y,event.yaw,event.linear,event.angular].every(Number.isFinite)) return;
      const first = !pose;
      pose = event; lastSample = Number.isFinite(event.received_monotonic_ms) ? event.received_monotonic_ms : 0;
      if (first) center = {x:Math.round(event.x),y:Math.round(event.y)};
      if (!trail.length || Math.hypot(event.x-trail.at(-1).x,event.y-trail.at(-1).y) > 0.02) {
        trail.push({x:event.x,y:event.y}); if (trail.length > 1200) trail.shift();
      }
      $('pose-x').textContent = format(event.x); $('pose-y').textContent = format(event.y);
      $('pose-yaw').textContent = (event.yaw*180/Math.PI).toFixed(1); $('velocity').textContent = format(event.linear);
      $('map-empty').hidden = true;
      if (event.frame || event.frame_id) $('frame-label').textContent = event.frame || event.frame_id;
      if (!isTurtlesim()) $('navigation-help').textContent = frameMatches() ? 'Pick a point on the grid or enter coordinates.' : `Odometry is in ${event.frame || event.frame_id}. Enter goal coordinates in ${$('frame').value}; grid picking is disabled.`;
    } else if (event.type === 'status') {
      if (event.state === 'connected') { connected = true; connecting = false; status(event.detail || 'Connected · waiting for robot telemetry', 'ok'); }
      else if (event.state === 'disconnected') { stopDrive(); connected = false; connecting = false; if (activeGoal) { $('goal-state').textContent = 'Unknown'; $('goal-detail').textContent = 'Connection lost · robot goal status is unknown'; } activeGoal = false; status(event.detail || 'Disconnected'); }
      else if (event.detail) status(event.detail);
      if (event.detail || event.state) log(event.detail || label(event.state));
    } else if (event.type === 'error') {
      const message = event.message || event.detail || 'An operation failed'; log(message, true); status(message, 'err');
      if (activeGoal) $('goal-detail').textContent = message + ' · remote goal remains active or unknown';
    } else if (event.type === 'goal') {
      const state = (event.state || 'unknown').toLowerCase();
      activeGoal = !terminalStates.has(state); canCancel = event.can_cancel !== false;
      $('goal-state').textContent = label(state); $('goal-state').className = 'tag' + (activeGoal ? ' live' : '');
      $('goal-detail').textContent = event.detail || (terminalStates.has(state) ? 'Goal ' + state : 'Waiting for navigation feedback…');
      log('Navigation ' + state + (event.detail ? ' · ' + event.detail : ''), state === 'aborted' || state === 'rejected' || state === 'failed');
      if (terminalStates.has(state)) target = null;
    } else if (event.type === 'feedback') {
      if (Number.isFinite(event.distance_remaining)) $('goal-detail').textContent = isTurtlesim() ? (event.distance_remaining*180/Math.PI).toFixed(1) + '° remaining' : event.distance_remaining.toFixed(2) + ' m remaining';
      else if (Number.isFinite(event.remaining)) $('goal-detail').textContent = (event.remaining*180/Math.PI).toFixed(1) + '° remaining';
      else if (event.detail) $('goal-detail').textContent = event.detail;
    }
  }
  $('role').value = query.get('role') === 'simulator' ? 'simulator' : 'groundstation';
  if (query.get('profile') === 'turtlesim') { $('profile').value = 'turtlesim'; applyProfile(true); }
  for (const [key,id] of Object.entries(fields)) if (query.has(key)) $(id).value = query.get(key);
  $('role').addEventListener('change', applyRole);
  $('profile').addEventListener('change', () => applyProfile(true));
  $('frame').addEventListener('input', () => $('frame-label').textContent = $('frame').value);
  $('open-peer').onclick = () => {
    const url = new URL(location.href); url.search = '';
    url.searchParams.set('role', isDevice() ? 'groundstation' : 'simulator');
    for (const [key,id] of Object.entries(fields)) url.searchParams.set(key, $(id).value);
    window.open(url, '_blank', 'noopener');
  };
  $('speed').oninput = () => { $('speed-label').textContent = Number($('speed').value).toFixed(2) + ' m/s'; stopDrive(); };
  $('clear-log').onclick = () => $('activity').replaceChildren();
  $('center-view').onclick = () => center = pose ? {x:pose.x,y:pose.y} : {x:0,y:0};
  for (const button of document.querySelectorAll('[data-linear]')) {
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !canDrive()) return;
      event.preventDefault(); button.setPointerCapture(event.pointerId);
      drive(Number(button.dataset.linear), Number(button.dataset.angular), button);
    });
    for (const event of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(event, () => stopDrive());
  }
  const movementKeys = new Set(['w','a','s','d','arrowup','arrowleft','arrowdown','arrowright']);
  window.addEventListener('keydown', event => {
    if ((event.target.matches('input,select,textarea') || event.target.isContentEditable) || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === ' ' && connected && !isDevice()) { event.preventDefault(); $('stop').click(); return; }
    if (!movementKeys.has(key) || !canDrive()) return;
    event.preventDefault(); keys.add(key);
    const linear = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'));
    const angular = Number(keys.has('a') || keys.has('arrowleft')) - Number(keys.has('d') || keys.has('arrowright'));
    drive(linear, angular, null);
  });
  window.addEventListener('keyup', event => { if (movementKeys.has(event.key.toLowerCase())) stopDrive(); });
  window.addEventListener('blur', () => stopDrive());
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopDrive(); });
  window.addEventListener('pagehide', () => { stopDrive(!activeGoal); if (activeGoal) command({type:'cancel'}); });
  $('stop').onclick = () => { stopDrive(!activeGoal); if (activeGoal) command({type:'cancel'}); log('Stop requested'); };
  $('cancel-goal').onclick = () => { if (canCancel && command({type:'cancel'})) { $('goal-state').textContent = 'Canceling'; $('goal-detail').textContent = 'Waiting for robot to acknowledge cancellation…'; } };
  $('send-goal').onclick = () => {
    if (connecting || !fresh() || activeGoal) return;
    const x = isTurtlesim() ? 0 : Number($('goal-x').value), y = isTurtlesim() ? 0 : Number($('goal-y').value), degrees = Number($('goal-yaw').value);
    if ((isTurtlesim() ? ['goal-yaw'] : ['goal-x','goal-y','goal-yaw']).some(id => !$(id).value.trim()) || ![x,y,degrees].every(Number.isFinite) || degrees < -180 || degrees > 180) { log('Enter finite coordinates and a heading between −180° and 180°.',true); return; }
    stopDrive(true);
    if (command({type:'goal',x,y,yaw:degrees*Math.PI/180})) {
      activeGoal = true; canCancel = true; target = isTurtlesim() ? null : {x,y}; $('goal-state').textContent = 'Sending';
      $('goal-detail').textContent = 'Waiting for the action server…'; updateControls();
    }
  };
  canvas.onclick = event => {
    if (connecting || !fresh() || isDevice() || isTurtlesim() || activeGoal || !frameMatches()) return;
    const rect = canvas.getBoundingClientRect();
    const x = center.x + (event.clientX-rect.left-mapSize.width/2)/mapSize.scale;
    const y = center.y - (event.clientY-rect.top-mapSize.height/2)/mapSize.scale;
    $('goal-x').value = x.toFixed(1); $('goal-y').value = y.toFixed(1); target = {x:Number($('goal-x').value),y:Number($('goal-y').value)};
    $('goal-detail').textContent = 'Target selected · press Send goal to navigate';
  };
  $('connect').onclick = async () => {
    if (!ready || connected || connecting) return;
    const config = {role:$('role').value,max_linear:0.3,max_angular:1.2,watchdog_ms:500};
    for (const [key,id] of Object.entries(fields)) config[key] = $(id).value.trim();
    config.domain = Number(config.domain); config.twist_stamped = config.twist_stamped === 'true';
    if (!/^wss?\/.+/.test(config.router)) { status('Use a Zenoh endpoint such as ws/127.0.0.1:7448.', 'err'); return; }
    if (!Number.isInteger(config.domain) || config.domain < 0 || config.domain > 232) { status('ROS domain must be an integer between 0 and 232.', 'err'); return; }
    connecting = true; resetTelemetry(); status('Starting workers and connecting to ' + config.router + '…'); updateControls();
    try {
      await wasm_bindgen.turtle_start(JSON.stringify(config)); connected = true; connecting = false;
      status(isDevice() ? 'Connected · simulated device running' : 'Connected · waiting for robot telemetry', 'ok');
      log('Connected as ' + (isDevice() ? 'simulated device' : 'groundstation') + ' · ' + config.namespace);
    } catch (error) {
      connected = false; connecting = false;
      status(String(error) + ' Check the router and browser local-network permission; remote HTTPS connections may need WSS.', 'err'); log(String(error),true);
    }
    updateControls();
  };
  $('disconnect').onclick = async () => {
    if (!connected || connecting) return;
    stopDrive(!activeGoal); if (activeGoal) command({type:'cancel'});
    connecting = true; updateControls(); status('Disconnecting…');
    try { await wasm_bindgen.turtle_disconnect(); status('Disconnected · ready to connect again'); log('Disconnected'); }
    catch (error) { status(String(error), 'err'); log(String(error),true); }
    finally { connected = false; connecting = false; activeGoal = false; updateControls(); }
  };

  function draw() {
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1,2);
    if (canvas.width !== Math.round(rect.width*ratio) || canvas.height !== Math.round(rect.height*ratio)) { canvas.width = Math.round(rect.width*ratio); canvas.height = Math.round(rect.height*ratio); }
    const width = rect.width, height = rect.height, scale = Math.min(width,height)/10;
    if (scale <= 0) { requestAnimationFrame(draw); return; }
    mapSize = {width,height,scale}; context.setTransform(ratio,0,0,ratio,0,0); context.clearRect(0,0,width,height);
    const project = p => ({x:width/2+(p.x-center.x)*scale,y:height/2-(p.y-center.y)*scale});
    context.lineWidth = 1; context.font = '9px ui-monospace, monospace';
    const firstX = Math.floor(center.x-width/scale/2), firstY = Math.floor(center.y-height/scale/2);
    // Bound work by the viewport; advancing world coordinates can lose unit
    // precision far from the origin. Cap grid density for narrow layouts too.
    const stepX = Math.max(1, Math.ceil(width/scale/200)), stepY = Math.max(1, Math.ceil(height/scale/200));
    for (let i = 0; i <= Math.min(200, Math.ceil(width/scale/stepX)); i++) {
      const x = firstX + i*stepX;
      const p = project({x,y:0}); context.strokeStyle = x === 0 ? '#c0d1c5' : '#dce5dc';
      context.beginPath();context.moveTo(p.x,0);context.lineTo(p.x,height);context.stroke();
      if (x % 2 === 0) { context.fillStyle = '#9aaa9d';context.fillText(x,p.x+4,height-38); }
    }
    for (let i = 0; i <= Math.min(200, Math.ceil(height/scale/stepY)); i++) {
      const y = firstY + i*stepY;
      const p = project({x:0,y}); context.strokeStyle = y === 0 ? '#c0d1c5' : '#dce5dc';
      context.beginPath();context.moveTo(0,p.y);context.lineTo(width,p.y);context.stroke();
      if (y % 2 === 0 && p.y > 55 && p.y < height-40) { context.fillStyle = '#9aaa9d';context.fillText(y,8,p.y-5); }
    }
    if (trail.length > 1) {
      context.beginPath();trail.forEach((point,index) => { const p=project(point); index ? context.lineTo(p.x,p.y) : context.moveTo(p.x,p.y); });
      context.strokeStyle='#75b19a';context.lineWidth=2;context.lineJoin='round';context.stroke();
    }
    if (target && frameMatches()) {
      const p=project(target); if (pose) {const r=project(pose);context.beginPath();context.moveTo(r.x,r.y);context.lineTo(p.x,p.y);context.setLineDash([4,5]);context.strokeStyle='#bc945f';context.lineWidth=1;context.stroke();context.setLineDash([]);}
      context.beginPath();context.arc(p.x,p.y,9,0,Math.PI*2);context.strokeStyle='#bd793a';context.lineWidth=1.5;context.stroke();context.beginPath();context.arc(p.x,p.y,3,0,Math.PI*2);context.fillStyle='#bd793a';context.fill();
    }
    if (pose) {
      const p=project(pose);context.save();context.translate(p.x,p.y);context.rotate(-pose.yaw);
      context.beginPath();context.arc(0,0,27,0,Math.PI*2);context.fillStyle=fresh()?'#087c7810':'#88888810';context.fill();
      context.fillStyle='#153b36';context.fillRect(-9,-16,19,4);context.fillRect(-9,12,19,4);
      context.beginPath();context.roundRect(-13,-12,28,24,7);context.fillStyle=fresh()?'#087c78':'#7c9389';context.fill();context.strokeStyle='#ffffff';context.lineWidth=2;context.stroke();
      context.beginPath();context.moveTo(9,0);context.lineTo(-2,-5);context.lineTo(-2,5);context.closePath();context.fillStyle='#c1ecdb';context.fill();context.restore();
      context.font='9px ui-monospace, monospace';context.fillStyle='#3e6f5e';context.textAlign='center';context.fillText(isDevice()?'SIMULATED DEVICE':'ROBOT',p.x,p.y+36);context.textAlign='start';
    }
    requestAnimationFrame(draw);
  }
  setInterval(() => {
    if (ready) {
      try { const events = JSON.parse(wasm_bindgen.turtle_poll() || '[]'); for (const event of events) processEvent(event); }
      catch (error) { status('Could not read worker events: ' + error, 'err'); }
    }
    const now = performance.now(), live = fresh();
    if (!live && (currentDrive.linear || currentDrive.angular)) stopDrive();
    if (canDrive() && (currentDrive.linear || currentDrive.angular) && now-lastDrive >= 90) { command({type:'velocity',...currentDrive}); lastDrive=now; }
    if (lastSample) { const age = Math.max(0, receiptTime()-lastSample); $('sample-age').textContent = age < 1000 ? Math.round(age).toString() : (age/1000).toFixed(1); $('sample-unit').textContent = age < 1000 ? 'ms' : 's'; }
    $('telemetry-state').textContent = live ? 'Live telemetry' : lastSample ? connected ? 'Telemetry stale' : 'Disconnected' : 'Awaiting telemetry';
    $('telemetry-state').className = 'tag' + (live ? ' live' : lastSample ? ' stale' : '');
    updateControls();
  },100);
  applyProfile(); applyRole(); draw();
  (async () => {
    try {
      // The static-host service worker reloads the page once to enable isolation.
      if (!crossOriginIsolated) status('Preparing browser isolation; the page may reload once…');
      await wasm_bindgen('./pkg/hiroz_wasm_demo_bg.wasm');
      if (typeof wasm_bindgen.turtle_start !== 'function') throw new Error('This WASM build does not include the turtle demo. Rebuild or refresh the deployed files.');
      if (!crossOriginIsolated) throw new Error('WASM workers need cross-origin isolation. Reload after allowing the service worker, or serve with COOP/COEP headers.');
      ready = true; status('Ready · connect this window to your router'); updateControls();
    } catch (error) { startupFailed = true; status(String(error), 'err'); log(String(error),true); updateControls(); }
  })();
})();
