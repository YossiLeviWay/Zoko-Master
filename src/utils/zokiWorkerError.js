// Turns a failure on the way to the Worker into a stable code plus the browser's own
// error name and message. The screen can show that detail; the console keeps the same text.
export const ZOKI_TURN_TIMEOUT_MS = 120000;

export function workerFailure(code, error) {
  const name = String(error?.name || 'Error').slice(0, 40);
  const message = String(error?.message || '').replace(/\s+/gu, ' ').slice(0, 160);
  const detail = `${code} | ${name}: ${message}`.slice(0, 200);
  console.error('Zoki worker call failed', detail);
  return Object.assign(new Error(code), { code, detail });
}

export function classifyWorkerFetchError(error) {
  const name = String(error?.name || '');
  if (name === 'AbortError' || name === 'TimeoutError') return workerFailure('worker-timeout', error);
  return workerFailure('worker-unreachable', error);
}
