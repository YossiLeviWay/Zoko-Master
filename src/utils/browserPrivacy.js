const PRIVATE_PREFIXES = ['zoko-master:zoki-conversation:', 'zoki-question-window:'];

// Inspect keys only: old conversation bodies must never be read or migrated.
export function removeLegacyPrivateStorage(storage) {
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (key && (PRIVATE_PREFIXES.some(prefix => key.startsWith(prefix)) || key === 'redirect')) {
        try { storage.removeItem(key); } catch { /* Continue cleaning other keys. */ }
      }
    }
  } catch { /* Storage can be blocked by the browser. */ }
}

export function cleanLegacyBrowserData(browser = globalThis) {
  for (const name of ['localStorage', 'sessionStorage']) {
    try { removeLegacyPrivateStorage(browser[name]); } catch { /* Access itself may be denied. */ }
  }
}

let revision = 0;
const listeners = new Set();
export const privateSessionRevision = () => revision;
export function subscribePrivateSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function invalidatePrivateSession() {
  revision++;
  for (const listener of listeners) listener();
}

export function privateSessionGuard() {
  const started = revision;
  return () => {
    if (started !== revision) throw Object.assign(new Error('session-changed'), { code: 'session-changed' });
  };
}
