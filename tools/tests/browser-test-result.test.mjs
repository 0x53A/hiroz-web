import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testResult } from '../browser-test-result.mjs';
const completed = 'PASS: first\nPASS: second\n=== Tests complete ===';
test('completed successful suite passes', () => assert.equal(testResult(completed, 2).ok, true));
test('timeout after a passing test fails', () => assert.equal(testResult('PASS: first', 1).ok, false));
test('empty output fails', () => assert.equal(testResult('', 1).ok, false));
test('too few tests fails', () => assert.equal(testResult(completed, 3).ok, false));
test('a browser exception fails', () => assert.equal(testResult(completed, 2, 1).ok, false));
test('an explicit failure fails', () => assert.equal(testResult(`FAIL: broken\n${completed}`, 2).ok, false));
test('a marker inside a payload is not completion', () => {
  assert.equal(testResult('PASS: received "=== Tests complete ==="', 1).ok, false);
});

import { actionTestResult } from '../browser-test-result.mjs';
const actionOutput = `${Array.from({ length: 14 }, (_, i) => `PASS: action ${i}`).join('\n')}\nBrowser action client tests complete`;
const pythonOutput = `${Array.from({ length: 10 }, (_, i) => `PASS: peer ${i}`).join('\n')}\nPython action tests complete`;
const shutdownOutput = `${actionOutput}\nBrowser action shutdown complete`;
test('action suite requires completed shutdown', () => {
  assert.equal(actionTestResult(actionOutput, pythonOutput).ok, false);
  assert.equal(actionTestResult(shutdownOutput, pythonOutput).ok, true);
});
test('action shutdown browser exception fails final verdict', () => {
  assert.equal(actionTestResult(shutdownOutput, pythonOutput, 1).ok, false);
});
test('action shutdown failure fails final verdict despite completion marker', () => {
  assert.equal(actionTestResult(`${actionOutput}\nFAIL: shutdown\nBrowser action shutdown complete`, pythonOutput).ok, false);
});
test('Python action failure cannot hide behind successful exit and completion', () => {
  assert.equal(actionTestResult(shutdownOutput, `FAIL: peer\n${pythonOutput}`).ok, false);
});
