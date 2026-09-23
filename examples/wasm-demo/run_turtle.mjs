#!/usr/bin/env node
// Only a Zenoh router on 7648 is external. The plain static server deliberately
// sends no isolation headers: the app must bootstrap its COI service worker.
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
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
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
const native = process.argv.includes('--native');
const errors = [];
const pages = [];
let passes = 0;
function pass(label) { passes++; console.log(`PASS: ${label}`); }
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/run/current-system/sw/bin/google-chrome-stable',
    headless: true, args: ['--no-sandbox', '--disable-gpu'],
  });
  async function openRole(role) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', error => errors.push(`${role}: ${error.stack || error}`));
    page.on('console', message => {if(message.type()==='error' && /PANIC:|RuntimeError/.test(message.text())) errors.push(`${role}: ${message.text()}`);});
    await page.setViewport({ width: 1440, height: 1000 });
    const params = new URLSearchParams({role,router:`ws/127.0.0.1:${native ? 7748 : 7648}`,namespace:native ? '/turtle1' : '/turtle_test',profile:native ? 'turtlesim' : 'turtlebot'});
    await page.goto(`${baseUrl}/?${params}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => crossOriginIsolated && typeof wasm_bindgen?.turtle_start === 'function' && !document.querySelector('#connect').disabled, { timeout: 30000 });
    assert.equal(await page.$eval('#role', element => element.value), role);
    assert.equal(await page.$eval('#router', element => element.value), `ws/127.0.0.1:${native ? 7748 : 7648}`);
    assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true);
    return page;
  }
  const device = native ? null : await openRole('simulator');
  const ground = await openRole('groundstation');
  pass(native ? 'native turtlesim groundstation loads through plain-host service worker' : 'independent device/groundstation contexts load through plain-host service worker');
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
  if (!native) {
    await ground.evaluate(()=>wasm_bindgen.turtle_command(JSON.stringify({type:'velocity',linear:0.2,angular:0})));
    await ground.waitForFunction(()=>Number(document.querySelector('#velocity').textContent)>0.1,{timeout:1000});
    await ground.waitForFunction(()=>Math.abs(Number(document.querySelector('#velocity').textContent))<0.02,{timeout:2000});
    pass('device watchdog stops a single command without an explicit zero or refresh');
  }
  const startX = await number('#pose-x'), startY = await number('#pose-y');
  await hold('#drive-forward',900);
  await ground.waitForFunction(([x,y])=>Math.hypot(Number(document.querySelector('#pose-x').textContent)-x,Number(document.querySelector('#pose-y').textContent)-y)>0.06,{timeout:4000},[startX,startY]);
  await ground.waitForFunction(()=>Math.abs(Number(document.querySelector('#velocity').textContent))<0.02,{timeout:3000});
  pass('held forward control moves the remote robot and release stops it');
  const startYaw=await number('#pose-yaw');
  await hold('#drive-left',650);
  await ground.waitForFunction(yaw=>Math.abs(Number(document.querySelector('#pose-yaw').textContent)-yaw)>8,{timeout:3000},startYaw);
  pass('held turn control changes received heading');
  // Losing focus must stop the stream even without pointerup/key release.
  await ground.focus('#map');await ground.keyboard.down('w');await delay(300);
  await ground.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await ground.keyboard.up('w');
  await ground.waitForFunction(()=>Math.abs(Number(document.querySelector('#velocity').textContent))<0.02,{timeout:3000});
  pass('focus loss clears held keyboard motion');
  await fill('#goal-x',native ? 1 : (await number('#pose-x'))+0.20);
  await fill('#goal-y',native ? 1 : (await number('#pose-y'))+0.10);
  await fill('#goal-yaw',native ? ((await number('#pose-yaw'))+70+540)%360-180 : 0);
  await ground.click('#send-goal');
  await ground.waitForFunction(()=>document.querySelector('#goal-detail').textContent.includes('remaining'),{timeout:7000});
  pass('action feedback reaches the groundstation UI');
  await ground.waitForFunction(()=>document.querySelector('#goal-state').textContent==='Succeeded',{timeout:20000});
  pass(native ? 'native turtlesim RotateAbsolute result succeeds through the UI' : 'browser NavigateToPose result succeeds through the UI');
  await fill('#goal-x',(await number('#pose-x'))+3);
  await fill('#goal-y',(await number('#pose-y'))+2);
  await fill('#goal-yaw',native ? ((await number('#pose-yaw'))+150+540)%360-180 : -150);
  await ground.click('#send-goal');
  await ground.waitForFunction(()=>document.querySelector('#goal-detail').textContent.includes('remaining'),{timeout:7000});
  if (!native) {
    const other = await openRole('groundstation');
    await other.click('#connect');
    await other.waitForFunction(() => !document.querySelector('#send-goal').disabled, { timeout: 20000 });
    await other.click('#send-goal');
    await other.waitForFunction(() => document.querySelector('#goal-state').textContent === 'Rejected', { timeout: 2500 });
    assert.equal(await other.$eval('#send-goal', e => e.disabled), false);
    pass('busy device rejects a second client promptly and releases that client’s goal interlock');
    await other.click('#disconnect');
    await other.waitForFunction(() => !document.querySelector('#connect').disabled, { timeout: 7000 });
  }
  await ground.click('#cancel-goal');
  await ground.waitForFunction(()=>document.querySelector('#goal-state').textContent==='Canceled',{timeout:6000});
  pass('cancel returns a terminal action result while telemetry remains responsive');
  // Reconnection creates a fresh session; completed commands must not replay.
  await ground.click('#disconnect');
  await ground.waitForFunction(()=>!document.querySelector('#connect').disabled,{timeout:7000});
  await ground.click('#connect');await live();
  const reconnectX=await number('#pose-x'), reconnectY=await number('#pose-y');
  await delay(700);
  assert(Math.hypot((await number('#pose-x'))-reconnectX,(await number('#pose-y'))-reconnectY)<0.04,'reconnect replayed motion');
  pass('disconnect/reconnect does not replay motion');
  // Exercise the worker-originated exit path rather than the UI's disconnect
  // handler, which removes the connection before asking the worker to stop.
  await ground.evaluate(() => wasm_bindgen.turtle_command(JSON.stringify({ type: 'disconnect' })));
  await ground.waitForFunction(() => !document.querySelector('#connect').disabled, { timeout: 7000 });
  await ground.click('#connect');
  await live();
  pass('a completed worker session can reconnect through the UI');
  // A nonexistent action server must not stall stop, cancellation or disconnect.
  await ground.click('#disconnect');
  await ground.waitForFunction(()=>!document.querySelector('#connect').disabled,{timeout:7000});
  await fill('#action-name','no_action_server_here');
  await ground.click('#connect');await live();await ground.click('#send-goal');
  await ground.waitForFunction(()=>document.querySelector('#goal-state').textContent==='Discovering',{timeout:2000});
  await ground.click('#stop');
  await ground.waitForFunction(()=>['Canceled','Rejected'].includes(document.querySelector('#goal-state').textContent),{timeout:2500});
  pass('stop remains responsive while action server discovery is pending');
  await ground.click('#send-goal');
  const beforeDisconnect=Date.now();await ground.click('#disconnect');
  await ground.waitForFunction(()=>!document.querySelector('#connect').disabled,{timeout:5000});
  assert(Date.now()-beforeDisconnect<4500,'disconnect blocked on missing action server');
  pass('disconnect finishes during a pending action request');
  await fill('#action-name',native?'rotate_absolute':'navigate_to_pose');await ground.click('#connect');await live();
  await ground.screenshot({ path: native ? '/tmp/turtlesim-groundstation-desktop.png' : '/tmp/turtle-groundstation-desktop.png', fullPage: true });
  if(device) await device.screenshot({ path: '/tmp/turtle-device-desktop.png', fullPage: true });
  await ground.setViewport({ width: 390, height: 844 });
  await live();
  await ground.screenshot({ path: native ? '/tmp/turtlesim-groundstation-mobile.png' : '/tmp/turtle-groundstation-mobile.png', fullPage: true });
  assert.equal(await ground.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'mobile layout must not overflow horizontally');
  assert.deepEqual(errors, []);
  console.log(`Turtle browser suite complete: ${passes} checks`);
} catch(error) {
  for (const [index,page] of pages.entries()) {
    console.error(await page.evaluate(()=>({status:document.querySelector('#status').textContent,goal:document.querySelector('#goal-state').textContent,detail:document.querySelector('#goal-detail').textContent,activity:document.querySelector('#activity').textContent})));
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
