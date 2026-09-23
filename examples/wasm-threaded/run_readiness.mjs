#!/usr/bin/env node
// Requires only serve.py on 8082 and a built pkg directory; each case gets fresh WASM memory.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/run/current-system/sw/bin/google-chrome-stable',
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  for (const [shim, timeout, expected] of [
    ['./missing-readiness-shim.js', 5000, /worker \d:.*(?:importScripts|script|fetch)/i],
    ['./test_stalled_shim.js', 250, /startup timed out/],
  ]) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    await page.goto('http://127.0.0.1:8082/test_readiness.html');
    const result = await page.evaluate(async (shim, timeout) => {
      await wasm_bindgen('./pkg/zenoh_wasm_threaded_test_bg.wasm');
      const errors = [];
      for (const url of [shim, './pkg/zenoh_wasm_threaded_test.js']) {
        try {
          await Promise.race([
            wasm_bindgen.__zenoh_init_threaded_runtime_async(url, timeout),
            new Promise((_, reject) => setTimeout(() => reject('HARNESS DEADLINE'), 8000)),
          ]);
          errors.push('unexpected success');
        } catch (error) { errors.push(String(error)); }
      }
      return errors;
    }, shim, timeout);
    assert.match(result[0], expected);
    assert.match(result[0], /reload the page/);
    assert.equal(result[1], result[0], 'failure must remain terminal on retry');
    assert.deepEqual(pageErrors, []);
    console.log(`PASS: ${shim}: bounded failure and terminal retry`);
    await page.close();
  }
} finally { await browser.close(); }
