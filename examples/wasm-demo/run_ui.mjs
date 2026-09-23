#!/usr/bin/env node
// Production UI regressions. Mocked transport cases below validate UI state;
// real ROS motion/action interoperability belongs to run_turtle.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/run/current-system/sw/bin/google-chrome-stable',
  headless: true, args: ['--no-sandbox', '--disable-gpu'],
});
const errors = [];
let passes = 0;
const pass = label => { passes++; console.log(`PASS: ${label}`); };
try {
  if (!process.argv.includes('--fixture-only')) {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    const urlIndex = process.argv.indexOf('--url');
    await page.goto(urlIndex >= 0 ? process.argv[urlIndex + 1] : 'http://localhost:8083/');
    await page.waitForFunction(() => typeof document.getElementById('connect').onclick === 'function' && !document.getElementById('connect').disabled);
    await page.evaluate(() => { wasm_bindgen.turtle_start = async () => { throw new Error('startup failed; reload the page'); }; });
    await page.click('#connect');
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('startup failed'));
    assert.equal(await page.$eval('#status', element => element.className), 'err');
    assert.equal(await page.$eval('#send-goal', element => element.disabled), true);
    pass('served interactive page handles asynchronous startup failure');
    await page.close();
  }

  const html = (await readFile(new URL('./index.html', import.meta.url), 'utf8'))
    .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, '');
  const script = await readFile(new URL('./turtle.js', import.meta.url), 'utf8');
  async function fixture(config = {}) {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    await page.setContent(html);
    await page.evaluate(() => {
      // Fixture-only runtime boundary: no robot/session is created here.
      Object.defineProperty(window, 'crossOriginIsolated', { value: true });
      window.uiEvents = []; window.uiCommands = [];
      window.wasm_bindgen = Object.assign(async () => {}, {
        turtle_start: async () => {},
        turtle_command: value => window.uiCommands.push(JSON.parse(value)),
        turtle_poll: () => JSON.stringify(window.uiEvents.splice(0)),
        turtle_disconnect: () => new Promise(resolve => { window.finishDisconnect = resolve; }),
      });
    });
    await page.addScriptTag({ content: script });
    await page.waitForFunction(() => !document.getElementById('connect').disabled);
    await page.evaluate(config => { for (const [id, value] of Object.entries(config)) document.getElementById(id).value = value; }, config);
    return page;
  }
  async function emit(page, ...events) {
    await page.evaluate(events => window.uiEvents.push(...events.map(event =>
      event.type === 'odometry' && event.received_monotonic_ms === undefined
        ? { ...event, received_monotonic_ms: performance.timeOrigin + performance.now() } : event)), events);
    await page.waitForFunction(() => window.uiEvents.length === 0);
  }
  const odometry = (frame = 'odom') => ({ type: 'odometry', x: 0, y: 0, yaw: 0, linear: 0, angular: 0, frame });
  async function connected(page, frame = 'odom') {
    await page.click('#connect');
    await emit(page, odometry(frame));
    await page.waitForFunction(() => !document.getElementById('drive-forward').disabled);
  }

  {
    const page = await fixture(); await connected(page);
    await page.click('#disconnect');
    assert.equal(await page.$eval('#drive-forward', e => e.disabled), true);
    assert.equal(await page.$eval('#send-goal', e => e.disabled), true);
    await page.focus('#map'); await page.keyboard.press('w');
    await page.evaluate(() => document.getElementById('send-goal').onclick());
    const commands = await page.evaluate(() => uiCommands);
    assert(commands.every(c => c.type !== 'goal' && (c.type !== 'velocity' || (!c.linear && !c.angular))), 'teardown admitted motion or a new goal');
    await page.evaluate(() => finishDisconnect());
    await page.waitForFunction(() => !document.getElementById('connect').disabled);
    pass('UI fixture blocks motion and new goals throughout pending disconnect');
    await page.close();
  }
  {
    const page = await fixture(); await connected(page);
    await emit(page, { type: 'goal', state: 'executing' }, { type: 'error', message: 'unrelated operation failed' });
    assert.equal(await page.$eval('#drive-forward', e => e.disabled), true);
    assert.equal(await page.$eval('#send-goal', e => e.disabled), true);
    assert.equal(await page.$eval('#cancel-goal', e => e.disabled), false);
    await page.click('#cancel-goal');
    assert.equal((await page.evaluate(() => uiCommands)).at(-1).type, 'cancel');
    await emit(page, { type: 'goal', state: 'canceled' });
    assert.equal(await page.$eval('#drive-forward', e => e.disabled), false);
    pass('UI fixture preserves remote goal interlock after an unrelated error');
    await page.close();
  }
  {
    const page = await fixture({ frame: 'map' }); await connected(page, 'odom');
    const before = await page.$eval('#goal-x', e => e.value);
    await page.evaluate(() => document.getElementById('map').dispatchEvent(new MouseEvent('click', { clientX: 400, clientY: 200 })));
    assert.equal(await page.$eval('#goal-x', e => e.value), before);
    assert.match(await page.$eval('#navigation-help', e => e.textContent), /grid picking is disabled/i);
    assert.match(await page.$eval('#navigation-help', e => e.textContent), /map/);
    assert.equal(await page.$eval('#send-goal', e => e.disabled), false, 'explicit coordinates remain available in their labeled goal frame');
    pass('UI fixture rejects grid targets across unmatched odometry and goal frames');
    await page.close();
  }
  {
    const page = await fixture(); await connected(page);
    await page.waitForFunction(() => document.getElementById('telemetry-state').textContent === 'Telemetry stale', { timeout: 4000 });
    assert.equal(await page.$eval('#drive-forward', e => e.disabled), true);
    assert.equal(await page.$eval('#send-goal', e => e.disabled), true);
    pass('UI fixture disables motion and new goals when telemetry expires');
    await page.close();
  }
  {
    const page = await fixture(); await connected(page);
    for (const state of ['uncertain', 'unknown']) {
      await emit(page, { type: 'goal', state });
      assert.equal(await page.$eval('#drive-forward', e => e.disabled), true);
      assert.equal(await page.$eval('#send-goal', e => e.disabled), true);
      assert.equal(await page.$eval('#cancel-goal', e => e.disabled), false);
    }
    await page.click('#cancel-goal');
    assert.equal((await page.evaluate(() => uiCommands)).at(-1).type, 'cancel');
    await emit(page, { type: 'goal', state: 'canceled' });
    assert.equal(await page.$eval('#drive-forward', e => e.disabled), false);
    pass('UI fixture keeps uncertain remote goals interlocked and cancelable');
    await page.close();
  }
  {
    const page = await fixture();
    await page.evaluate(() => {
      document.getElementById('goal-x').value = '';
      document.getElementById('goal-y').value = '';
      document.getElementById('profile').value = 'turtlesim';
      document.getElementById('profile').dispatchEvent(new Event('change'));
      document.getElementById('goal-yaw').value = '90';
    });
    await connected(page);
    assert.equal(await page.$eval('#goal-x', e => e.disabled), true);
    await page.click('#send-goal');
    const goal = (await page.evaluate(() => uiCommands)).find(c => c.type === 'goal');
    assert.deepEqual(goal, { type: 'goal', x: 0, y: 0, yaw: Math.PI / 2 });
    pass('UI fixture sends turtlesim heading goals without requiring disabled coordinates');
    await page.close();
  }
  {
    const page = await fixture(); await page.click('#connect');
    await page.evaluate(() => uiEvents.push({
      type: 'odometry', x: 3, y: 4, yaw: 0, linear: 0.2, angular: 0,
      frame: 'odom', received_monotonic_ms: performance.timeOrigin + performance.now() - 5000,
    }));
    await page.waitForFunction(() => uiEvents.length === 0);
    assert.equal(await page.$eval('#drive-forward', e => e.disabled), true,
      'draining an old worker sample must not refresh the motion interlock');
    assert.equal(await page.$eval('#send-goal', e => e.disabled), true);
    assert.notEqual(await page.$eval('#telemetry-state', e => e.textContent), 'Live telemetry');
    pass('UI fixture preserves worker receipt age when draining delayed telemetry');
    await page.close();
  }
  {
    const page = await fixture(); await connected(page);
    const detail = 'Acceptance not confirmed; targeted cancellation is unavailable.';
    await emit(page, { type: 'goal', state: 'uncertain', can_cancel: false, detail });
    assert.equal(await page.$eval('#drive-forward', e => e.disabled), true);
    assert.equal(await page.$eval('#send-goal', e => e.disabled), true);
    assert.equal(await page.$eval('#cancel-goal', e => e.disabled), true);
    await page.evaluate(() => document.getElementById('cancel-goal').onclick());
    assert.equal(await page.$eval('#goal-state', e => e.textContent), 'Uncertain');
    assert.equal(await page.$eval('#goal-detail', e => e.textContent), detail);
    assert.equal((await page.evaluate(() => uiCommands)).length, 0);
    pass('UI fixture does not promise targeted cancellation before goal acceptance is confirmed');
    await page.close();
  }
  {
    const page = await fixture(); await connected(page);
    for (const shift of [-60000, 60000]) {
      await page.evaluate(shift => { Date.now = () => performance.timeOrigin + performance.now() + shift; }, shift);
      await emit(page, odometry());
      assert.equal(await page.$eval('#drive-forward', e => e.disabled), false);
    }
    await page.waitForFunction(() => document.getElementById('telemetry-state').textContent === 'Telemetry stale', { timeout: 4000 });
    assert.equal(await page.$eval('#drive-forward', e => e.disabled), true);
    pass('UI fixture measures freshness independently of wall-clock adjustments');
    await page.close();
  }
  {
    const page = await fixture(); await connected(page);
    await page.$eval('#map', e => { e.style.display = 'none'; });
    await emit(page, odometry());
    await page.$eval('#map', e => { e.style.display = ''; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.$eval('#drive-forward', e => e.disabled), false);
    pass('UI fixture remains responsive while the map is collapsed and restored');
    await page.close();
  }
  assert.deepEqual(errors, [], 'UI fixtures must not hide browser exceptions');
  console.log(`UI regression suite complete: ${passes} checks`);
} finally { await browser.close(); }
