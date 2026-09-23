#!/usr/bin/env node
// Requires serve.py on 8083; no router or ROS containers.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || '/run/current-system/sw/bin/google-chrome-stable',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://localhost:8083/test_locks.html', { waitUntil: 'domcontentloaded' });
  const passed = await Promise.race([
    page.evaluate(() => window.lockTest),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('lock regression timeout')), 15000); timer.unref(); }),
  ]);
  if (passed !== true || errors.length) throw Error(errors.join('\n') || 'lock regression did not complete');
  console.log('PASS: browser main-thread read/write contention with worker-held RwLock');
  console.log('PASS: session task resources released when their owner exits');
} finally {
  await browser.close();
}
