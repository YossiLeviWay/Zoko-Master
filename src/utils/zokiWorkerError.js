// Turns a failure on the way to the Worker into a stable code plus the browser's own
// error name and message. The screen shows that line; the console keeps the same text.
export const ZOKI_TURN_TIMEOUT_MS = 120000;

const buildId = () => {
  try { return String(import.meta.env?.APP_COMMIT_SHA || '').slice(0, 12); }
  catch { return ''; }
};

export function workerCallContext(endpoint = '') {
  let host = 'missing-url';
  try { if (endpoint) host = new URL(endpoint).host || 'bad-url'; }
  catch { host = 'bad-url'; }
  const online = typeof navigator === 'undefined' ? 'n/a' : String(navigator.onLine);
  const build = buildId();
  return [`host ${host}`, `online ${online}`, build ? `build ${build}` : ''].filter(Boolean).join(' | ');
}

export function workerFailure(code, error, context = '') {
  const name = String(error?.name || 'Error').slice(0, 40);
  const message = String(error?.message || '').replace(/\s+/gu, ' ').slice(0, 160);
  const detail = [`${code} | ${name}: ${message}`, context].filter(Boolean).join(' | ').slice(0, 300);
  console.error('Zoki worker call failed', detail);
  return Object.assign(new Error(code), { code, detail, name });
}

export function classifyWorkerFetchError(error, context = '') {
  const name = String(error?.name || '');
  if (name === 'AbortError' || name === 'TimeoutError') return workerFailure('worker-timeout', error, context);
  return workerFailure('worker-unreachable', error, context);
}

// Always includes the stage, the browser's name and message, and the build. Used on the
// error bubble itself, not only in a field the old screen left blank.
export function visibleWorkerDiagnostic(error, build = buildId()) {
  const stage = String(error?.code || 'error').replace(/^functions\//, '') || 'error';
  const name = String(error?.name || 'Error');
  const message = String(error?.message || '').replace(/\s+/gu, ' ').slice(0, 160);
  const base = error?.detail || `${stage} | ${name}: ${message}`;
  const withBuild = build && !String(base).includes('build ') ? `${base} | build ${build}` : base;
  return String(withBuild).slice(0, 320);
}
