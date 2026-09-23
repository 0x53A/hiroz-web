#!/usr/bin/env node
// Requires a router on ws/127.0.0.1:7448 and serve.py on port 8082.
// Disposable raw peers exercise close/drop/cancel and TLS without a router.
import puppeteer from 'puppeteer-core';
import { WebSocketServer } from 'ws';
import https from 'node:https';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testResult } from '../../tools/browser-test-result.mjs';

const timeoutMs = Number(process.argv[2] || 60) * 1000;
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('invalid timeout');
const certDir = mkdtempSync(join(tmpdir(), 'zenoh-wasm-test-'));
const sockets = new Set();
let browser, peer, tlsPeer, tlsServer, hangingServer;
let failed = true;
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1',
    '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem')], { stdio: 'ignore' });
  peer = new WebSocketServer({ port: 7449, host: '127.0.0.1' });
  tlsServer = https.createServer({ key: readFileSync(join(certDir, 'key.pem')),
    cert: readFileSync(join(certDir, 'cert.pem')) });
  tlsPeer = new WebSocketServer({ server: tlsServer });
  await new Promise(resolve => tlsServer.listen(7450, '127.0.0.1', resolve));
  for (const server of [peer, tlsPeer]) {
    server.on('connection', socket => socket.on('message', data => {
      if (data.toString() === 'close') socket.close();
      if (data.toString() === 'oversized') socket.send(Buffer.alloc(65536));
      if (data.toString() === 'text') socket.send('invalid binary-link frame');
    }));
  }
  hangingServer = http.createServer();
  hangingServer.on('upgrade', (_req, socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.on('end', () => socket.end());
    socket.resume();
    // Intentionally never finish this handshake, to test dropped open futures.
  });
  await new Promise(resolve => hangingServer.listen(7451, '127.0.0.1', resolve));
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/run/current-system/sw/bin/google-chrome-stable',
    headless: true,
    // Certificate bypass is confined to this test browser and disposable TLS peer.
    args: ['--no-sandbox', '--disable-gpu', '--ignore-certificate-errors'],
  });
  const page = await browser.newPage();
  let pageErrors = 0;
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => { pageErrors++; console.log(`[ERR] ${err.message}`); });
  await page.goto('http://localhost:8082/test_headless.html?router=' + encodeURIComponent(process.env.ZENOH_TEST_ENDPOINT || 'ws/127.0.0.1:7448'), { waitUntil: 'domcontentloaded', timeout: 10000 });
  try {
    await page.waitForFunction(() => document.getElementById('output')?.innerText
      .split(/\r?\n/).some(line => line.trim() === '=== Tests complete ==='), { timeout: timeoutMs });
  } catch { console.error('TIMEOUT waiting for test completion'); }
  const output = await page.$eval('#output', element => element.innerText);
  console.log(output);
  const result = testResult(output, 10, pageErrors);
  let extraFailures = 0;
  if (result.ok) {
    async function check(label, fn) {
      let timer;
      const ok = await Promise.race([fn(), new Promise(resolve => {
        timer = setTimeout(() => resolve(false), 5000);
      })]);
      clearTimeout(timer);
      console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
      if (!ok) extraFailures++;
    }
    await check('WS remote close wakes read and rejects writes', () => page.evaluate(() =>
      wasm_bindgen.test_link_lifecycle('ws/127.0.0.1:7449')));
    await check('WSS dispatch, TLS, remote close and failed writes', () => page.evaluate(() =>
      wasm_bindgen.test_link_lifecycle('wss/127.0.0.1:7450')));
    await check('frame exceeding MTU closes the link', () => page.evaluate(() =>
      wasm_bindgen.test_link_lifecycle('ws/127.0.0.1:7449/oversized')));
    await check('text frame fails binary link and wakes readers', () => page.evaluate(() =>
      wasm_bindgen.test_link_lifecycle('ws/127.0.0.1:7449/text')));
    await check('dropping established links releases sockets', async () => {
      const ok = await page.evaluate(() => wasm_bindgen.test_dropped_links('ws/127.0.0.1:7449', false));
      await new Promise(resolve => setTimeout(resolve, 200));
      return ok && peer.clients.size === 0;
    });
    await check('cancelling connection attempts releases sockets', async () => {
      const ok = await page.evaluate(() => wasm_bindgen.test_dropped_links('ws/127.0.0.1:7451', true));
      await new Promise(resolve => setTimeout(resolve, 200));
      if (!ok || sockets.size) console.log(`cancelled opens: returned=${ok}, open sockets=${sockets.size}`);
      return ok && sockets.size === 0;
    });
    await check('connection deadlines expire and alternate endpoints remain usable', () => page.evaluate(router =>
      wasm_bindgen.test_connection_deadlines('ws/127.0.0.1:7451', router),
      process.env.ZENOH_TEST_ENDPOINT || 'ws/127.0.0.1:7448'));
  }
  failed = !result.ok || extraFailures > 0 || pageErrors > 0;
  console.log(`${result.passes} core passes; ${result.fails + extraFailures} failures; ${pageErrors} browser errors`);
} finally {
  await browser?.close();
  for (const server of [peer, tlsPeer]) {
    if (server) { for (const socket of server.clients) socket.terminate(); server.close(); }
  }
  for (const socket of sockets) socket.destroy();
  hangingServer?.close();
  tlsServer?.close();
  rmSync(certDir, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
