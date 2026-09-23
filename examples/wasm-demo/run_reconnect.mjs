#!/usr/bin/env node
// Restarts ONLY the disposable compose stack in this directory. Never point this
// runner at a robot router. The flag makes the required test setup explicit.
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testResult } from '../../tools/browser-test-result.mjs';
if (!process.argv.includes('--disposable-stack')) throw new Error('requires --disposable-stack');
const cwd = fileURLToPath(new URL('.', import.meta.url));
const compose = (...args) => execFileSync('docker', ['compose', ...args], { cwd, encoding: 'utf8', timeout: 30000 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/run/current-system/sw/bin/google-chrome-stable',
  headless: true, args: ['--no-sandbox', '--disable-gpu'],
});
let routerStopped = false;
try {
  const page = await browser.newPage();
  let errors = 0;
  page.on('pageerror', error => { errors++; console.error(error); });
  await page.goto('http://localhost:8083/test_headless.html');
  await page.waitForFunction(() => document.getElementById('output').innerText.includes('=== Tests complete ==='), { timeout: 45000 });
  const output = await page.$eval('#output', element => element.innerText);
  if (!testResult(output, 4, errors).ok) throw new Error(`initial connection failed:\n${output}`);
  compose('stop', 'zenoh-router');
  routerStopped = true;
  await sleep(500);
  // Discard samples received before the outage. Keep the WASM node and its
  // original publisher/subscriber alive throughout the router restart.
  await page.evaluate(() => { while (wasm_bindgen.ros_poll() !== null) {} });
  compose('start', '--wait', 'zenoh-router');
  routerStopped = false;
  // The ROS container's native sessions also need restarting with this stack.
  compose('restart', 'ros2');
  await page.waitForFunction(() => {
    let sample;
    while ((sample = wasm_bindgen.ros_poll()) !== null) {
      if (sample.startsWith('Hello World:')) return true;
    }
    return false;
  }, { timeout: 20000, polling: 100 });
  const marker = `wasm-reconnect-review-${Date.now()}`;
  await page.evaluate(marker => wasm_bindgen.ros_publish(marker), marker);
  let received = false;
  for (let i = 0; i < 30; i++) {
    if (compose('logs', '--since', '1m', 'ros2').includes(marker)) { received = true; break; }
    await page.evaluate(marker => wasm_bindgen.ros_publish(marker), marker);
    await sleep(100);
  }
  if (!received || errors) throw new Error('browser-to-ROS delivery failed after reconnect');
  console.log('PASS: existing WASM node recovered both ROS directions after router restart');
} finally {
  if (routerStopped) compose('start', '--wait', 'zenoh-router');
  await browser.close();
}
