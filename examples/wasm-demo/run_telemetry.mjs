#!/usr/bin/env node
// Only a Zenoh router on 7648 is external. Isolation headers mirror serve.py;
// Firefox uses native new-window contexts so both peers stay visible.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('.', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const path = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) throw Error('invalid path');
    const info = await stat(path);
    if (!info.isFile()) throw Error('not a file');
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy':'same-origin', 'Cross-Origin-Embedder-Policy':'require-corp' });
    createReadStream(path).pipe(response);
  } catch { response.writeHead(404); response.end('Not found'); }
});
// Each runner owns its HTTP listener, so independent suites can run together.
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let browser;
const native = false;
const errors = [];
const pages = [];
let passes = 0;
function pass(label) { passes++; console.log(`PASS: ${label}`); }
try {
  browser = await puppeteer.launch({
    browser: process.env.FIREFOX ? 'firefox' : 'chrome',
    executablePath: process.env.FIREFOX ? process.env.FIREFOX_BIN || '/run/current-system/sw/bin/firefox' : process.env.CHROME_BIN || '/run/current-system/sw/bin/google-chrome-stable',
    headless: true, ignoreDefaultArgs: ['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'], args: process.env.FIREFOX ? [] : ['--no-sandbox', '--disable-gpu'],
  });
  async function openRole(role) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage(process.env.FIREFOX ? {type:'window',background:false} : undefined);
    pages.push(page);
    page.on('pageerror', error => errors.push(`${role}: ${error.stack || error}`));
    page.on('console', message => {if(/ERRORLOCATION|WebSocket|Closing transport|PANIC:|RuntimeError/.test(message.text())) { console.log(role,message.text()); if(message.type()==='error') errors.push(message.text()); }});
    await page.setViewport({ width: 1440, height: 1000 });
    const params = new URLSearchParams({role,router:`ws/127.0.0.1:${native ? 7748 : 7648}`,namespace:native ? '/turtle1' : '/turtle_test',profile:native ? 'turtlesim' : 'turtlebot'});
    await page.goto(`${baseUrl}/?${params}`, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForFunction(() => crossOriginIsolated && typeof wasm_bindgen?.turtle_start === 'function' && !document.querySelector('#connect').disabled, { timeout: 30000, polling:100 });
    assert.equal(await page.$eval('#role', element => element.value), role);
    assert.equal(await page.$eval('#router', element => element.value), `ws/127.0.0.1:${native ? 7748 : 7648}`);
    assert.equal(await page.evaluate(() => crossOriginIsolated), true);
    return page;
  }
  const device = native ? null : await openRole('simulator');
  const ground = await openRole('groundstation');
  pass(native ? 'native turtlesim groundstation loads through plain-host service worker' : 'independent device/groundstation windows load with isolation headers');
  if (device) await device.click('#connect');
  await ground.click('#connect');
  const live = () => ground.waitForFunction(() => document.querySelector('#telemetry-state').textContent.toLowerCase().includes('live') && Number.isFinite(Number(document.querySelector('#pose-x').textContent)) && !document.querySelector('#disconnect').hidden, { timeout: 20000 });
  await live();
  pass(native ? 'native ROS turtlesim pose reaches the real groundstation UI' : 'odometry crosses the router between independently configured roles');
  const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
  const number = id => ground.$eval(id, element => Number(element.textContent));
  const fill = async (id,value) => ground.$eval(id,(element,value)=>{element.value=String(value);element.dispatchEvent(new Event('input',{bubbles:true}));},value);
  async function hold(selector,ms) {
    const box=await ground.$eval(selector,e=>{const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};});
    await ground.mouse.move(box.x,box.y);await ground.mouse.down();await delay(ms);await ground.mouse.up();
  }
  for(const page of pages) await page.evaluate(()=>{
    window.telemetryMeasurements=[];
    const poll=wasm_bindgen.turtle_poll;
    wasm_bindgen.turtle_poll=()=>{const text=poll();for(const e of JSON.parse(text))if(e.type==='odometry')window.telemetryMeasurements.push({received:e.received_monotonic_ms,drained:performance.timeOrigin+performance.now(),hidden:document.hidden,callbackCount:e.callback_count,maxCallbackGapMs:e.max_callback_gap_ms});return text;};
  });
  await ground.bringToFront();
  await Promise.race([ground.evaluate(()=>wasm_bindgen.test_repoll_ownership()),delay(10000).then(()=>{throw Error('repoll regression timeout')})]);
  pass('shared-waker repoll timers remain bounded and cancel cleanly');
  await ground.evaluate(()=>wasm_bindgen.test_command_mailbox());
  pass('velocity mailbox coalesces, expires, prioritizes stop/cancel/disconnect, and preserves goals');
  if(process.argv.includes('--observe-only')) {
    for(let i=0;i<12;i++) {await delay(1000);console.log('Repoll timers',await device.evaluate(()=>Array.from(wasm_bindgen.__zenoh_repoll_counts())));}
  } else if(process.argv.includes('--pressure-only')) {
    await Promise.race([ground.evaluate(()=>wasm_bindgen.test_transport_refill()),delay(20000).then(()=>{throw Error('refill pressure deadline exceeded')})]);
    pass('bounded refill pressure, two producers, real timeout, nonblocking JS');
  } else {
  console.log('Visibility',await device.evaluate(()=>document.visibilityState),await ground.evaluate(()=>document.visibilityState));
  for(let i=0;i<30;i++) {
    await live();
    await hold('#drive-forward',500);
    await hold('#drive-left',250);
    await fill('#goal-x',(await number('#pose-x'))+1.2);
    await fill('#goal-y',(await number('#pose-y'))+0.8);
    await ground.waitForFunction(()=>!document.querySelector('#send-goal').disabled,{polling:100,timeout:20000});
    await ground.click('#send-goal');
    await ground.waitForFunction(()=>document.querySelector('#goal-detail').textContent.includes('remaining'),{polling:100,timeout:7000});
    await delay(250);
    await ground.click('#cancel-goal');
    await ground.waitForFunction(()=>document.querySelector('#goal-state').textContent==='Canceled',{polling:100,timeout:6000});
    await delay(1000);
  }
  pass('30 repeated drive/navigation/cancellation cycles complete');
  }
  for(const page of pages) {
    const maxUiSampleGapMs=await page.evaluate(()=>Math.max(...window.telemetryMeasurements.slice(1).map((s,i)=>s.received-window.telemetryMeasurements[i].received)));
    assert(maxUiSampleGapMs<1500,`UI-sampled telemetry gap exceeded freshness threshold: ${maxUiSampleGapMs}ms`);
    const callbackGap=await page.evaluate(()=>Math.max(...window.telemetryMeasurements.map(s=>s.maxCallbackGapMs)));
    assert(callbackGap<1500,`pre-coalescing callback gap exceeded freshness threshold: ${callbackGap}ms`);
    const peak=await page.evaluate(()=>wasm_bindgen.__zenoh_repoll_counts()[1]);
    assert(peak<16,`repoll timer backlog grew to ${peak}`);
  }
  for(const page of pages) console.log('Measurement',await page.evaluate(()=>{const m=window.telemetryMeasurements;return {count:m.length,maxUiSampleGapMs:Math.max(...m.slice(1).map((s,i)=>s.received-m[i].received)),maxUiDrainAgeMs:Math.max(...m.map(s=>s.drained-s.received)),callbackCount:m.at(-1)?.callbackCount,maxCallbackGapMs:m.at(-1)?.maxCallbackGapMs,tag:document.querySelector('#telemetry-state').textContent,repoll:Array.from(wasm_bindgen.__zenoh_repoll_counts())};}));
  // Pause only the GS application worker; its JS command ingress and the
  // independent device continue running. Old queued motion must never replay.
  for (const stop of [true,false]) {
    const before=await number('#pose-x');
    await ground.evaluate(async stop=>{
      await wasm_bindgen.turtle_pause_application_for_test();
      for(let i=0;i<(stop?1000:1);i++) wasm_bindgen.turtle_command(JSON.stringify({type:'velocity',linear:0.2,angular:0}));
      if(stop) wasm_bindgen.turtle_command(JSON.stringify({type:'velocity',linear:0,angular:0}));
    },stop);
    await delay(1200);
    assert(Math.abs((await number('#pose-x'))-before)<0.015,'paused worker replayed queued/expired motion');
    assert(Math.abs(await number('#velocity'))<0.02);
  }
  pass('paused GS worker never replays flooded or expired manual motion');
  const stationaryX=await number('#pose-x');
  await ground.evaluate(async()=>{
    await wasm_bindgen.turtle_pause_application_for_test();
    wasm_bindgen.turtle_command(JSON.stringify({type:'goal',x:10,y:10,yaw:0}));
    wasm_bindgen.turtle_command(JSON.stringify({type:'cancel'}));
  });
  await delay(1200);
  assert(Math.abs((await number('#pose-x'))-stationaryX)<0.015,'canceled queued goal started after Stop');
  assert.equal(await ground.$eval('#goal-state',e=>e.textContent),'Canceled');
  pass('cancel during worker stall discards unstarted navigation and reports Canceled');

  await device.click('#disconnect');
  await ground.waitForFunction(()=>document.querySelector('#telemetry-state').textContent==='Telemetry stale',{polling:100,timeout:5000});
  assert(await ground.$eval('#drive-forward',e=>e.disabled));
  assert(await ground.$eval('#send-goal',e=>e.disabled));
  pass('actual lost telemetry becomes stale and disables movement/goals');
  await device.waitForFunction(()=>!document.querySelector('#connect').disabled);
  await device.click('#connect');await live();
  await delay(600);
  assert(Math.abs(await number('#velocity'))<0.02,'recovery replayed manual velocity');
  pass('fresh telemetry recovers without replaying old motion');
  await ground.evaluate(()=>wasm_bindgen.turtle_command(JSON.stringify({type:'velocity',linear:0.2,angular:0})));
  await ground.waitForFunction(()=>Number(document.querySelector('#velocity').textContent)>0.1,{polling:100,timeout:1500});
  await ground.waitForFunction(()=>Math.abs(Number(document.querySelector('#velocity').textContent))<0.02,{polling:100,timeout:2000});
  pass('device watchdog stops an unrefreshed command after recovery');
  assert.deepEqual(errors,[]);
  console.log(`Telemetry regression suite complete: ${passes} checks`);

} catch(error) {
  for (const [index,page] of pages.entries()) {
    console.error(await page.evaluate(()=>({measurements:window.telemetryMeasurements?.slice(-30),status:document.querySelector('#status').textContent,goal:document.querySelector('#goal-state').textContent,detail:document.querySelector('#goal-detail').textContent,activity:document.querySelector('#activity').textContent})));
    await page.screenshot({path:`/tmp/turtle-failure-${index}.png`,fullPage:true});
  }
  throw error;
} finally {
  try {
    await browser?.close();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
