// Shared success criteria: partial output and browser exceptions never pass.
export function testResult(output, minimumPasses, pageErrors = 0) {
  const lines = output.split(/\r?\n/).map(line => line.trim());
  const passes = lines.filter(line => line.startsWith('PASS:')).length;
  const fails = lines.filter(line => line.startsWith('FAIL:')).length;
  const complete = lines.includes('=== Tests complete ===');
  return { passes, fails, complete,
    ok: complete && passes >= minimumPasses && fails === 0 && pageErrors === 0 };
}

// Called after action shutdown, so errors appearing during teardown also fail.
export function actionTestResult(output, pythonOutput, pageErrors = 0) {
  const lines = output.split(/\r?\n/).map(line => line.trim());
  const peerLines = pythonOutput.split(/\r?\n/).map(line => line.trim());
  const passes = lines.filter(line => line.startsWith('PASS:')).length;
  const peerPasses = peerLines.filter(line => line.startsWith('PASS:')).length;
  const complete = lines.includes('Browser action client tests complete')
    && lines.includes('Browser action shutdown complete')
    && peerLines.includes('Python action tests complete');
  const fails = [...lines, ...peerLines].filter(line => line.startsWith('FAIL:')).length;
  return { passes, peerPasses, complete, fails,
    ok: complete && passes >= 14 && peerPasses >= 10 && fails === 0 && pageErrors === 0 };
}
