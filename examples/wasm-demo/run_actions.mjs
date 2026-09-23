#!/usr/bin/env node
// Requires the dedicated actions compose project and COOP/COEP server on 8084.
import puppeteer from 'puppeteer-core';
import { actionTestResult } from '../../tools/browser-test-result.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('.', import.meta.url));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/run/current-system/sw/bin/google-chrome-stable', headless: true, args: ['--no-sandbox', '--disable-gpu'] });
let errors = 0;
let client;
let page;
try {
  page = await browser.newPage();
  page.on('pageerror', error => { errors++; console.error(error.stack || error); });
  page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()); });
  await page.goto('http://localhost:8084/test_actions.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#output').textContent.includes('Browser action server ready'), { timeout: 30000 });
  client = spawn('docker', ['compose', '-p', 'hiroz-wasm-actions', '-f', 'docker-compose.actions.yml', 'exec', '-T', 'ros2', '/ros_entrypoint.sh', 'python3', '-u', '/action_peer.py', 'client'], { cwd });
  let pythonOutput = '';
  client.stdout.on('data', data => { pythonOutput += data; process.stdout.write(data); });
  client.stderr.on('data', data => process.stderr.write(data));
  const pythonDone = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.kill(); reject(new Error('Python action client exceeded 70 seconds')); }, 70000);
    client.once('error', error => { clearTimeout(timer); reject(error); });
    client.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Python action client exited ${code}`)); });
  });
  const results = await Promise.allSettled([
    pythonDone,
    page.waitForFunction(() => {
      const text = document.querySelector('#output').textContent;
      if (text.includes('FAIL:')) throw new Error(text);
      return text.includes('Browser action client tests complete');
    }, { timeout: 70000 }),
  ]);
  for (const result of results) if (result.status === "rejected") throw result.reason;
  let output = await page.$eval('#output', element => element.textContent);
  console.log(output);
  if (errors || output.includes('FAIL:') || (output.match(/^PASS:/gm) || []).length < 14 || !pythonOutput.includes('Python action tests complete') || (pythonOutput.match(/^PASS:/gm) || []).length < 10) throw new Error('Incomplete or failed action suite');
  await page.evaluate(() => wasm_bindgen.actions_stop());
  await page.waitForFunction(() => document.querySelector('#output').textContent.includes('Browser action shutdown complete'), { timeout: 15000 });
  output = await page.$eval('#output', element => element.textContent);
  if (!actionTestResult(output, pythonOutput, errors).ok) throw new Error('Incomplete or failed action shutdown');
  console.log('PASS: browser action context shutdown');
  console.log('Action interop tests complete: 25 checks, both directions');
} catch (error) {
  if (page) console.error(await page.$eval("#output", element => element.textContent).catch(() => "page unavailable"));
  throw error;
} finally {
  client?.kill();
  await browser.close();
}
