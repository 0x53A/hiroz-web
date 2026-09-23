#!/usr/bin/env node
// Requires built pkg and serve.py on 8082; no router or ROS stack needed.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/run/current-system/sw/bin/google-chrome-stable',
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:8082/test_readiness.html');
  const result = await page.evaluate(async () => {
    await wasm_bindgen('./pkg/zenoh_wasm_threaded_test_bg.wasm');
    if (!await wasm_bindgen.__zenoh_init_threaded_runtime_async('./pkg/zenoh_wasm_threaded_test.js', 10000)) {
      throw new Error('Threaded runtime unavailable');
    }
    const original = globalThis.setTimeout;
    const held = [];
    let deadline;
    globalThis.setTimeout = (callback, ms, ...args) => {
      // Hold only the sleep created by the Rust export. This models a stalled
      // creating event loop, while keeping the test harness and joins runnable.
      const id = original(callback, ms === 43 ? 60000 : ms, ...args);
      if (ms === 43) held.push(id);
      return id;
    };
    try {
      const completed = await Promise.race([
        wasm_bindgen.test_migrated_js_sleep(),
        new Promise(resolve => { deadline = original(() => resolve(false), 2500); }),
      ]);
      return { completed, held: held.length };
    } finally {
      globalThis.setTimeout = original;
      clearTimeout(deadline);
      held.forEach(clearTimeout);
    }
  });
  assert.equal(result.held, 1, 'the creating JS sleep callback was intercepted');
  assert.equal(result.completed, true, 'moved sleep must finish using the compute timer');
  assert.equal(await Promise.race([page.evaluate(() => wasm_bindgen.test_migrated_compute_sleep()), new Promise((_, reject) => { const t=setTimeout(() => reject(new Error('compute migration timeout')), 5000); t.unref(); })]), true, 'moved compute timer must not wait for its old executor');
  console.log('PASS: compute sleep migrates away from a parked executor');
  assert.deepEqual(errors, []);
  console.log('PASS: moved JS sleep preserves deadline without its creating event loop');
} finally { await browser.close(); }
