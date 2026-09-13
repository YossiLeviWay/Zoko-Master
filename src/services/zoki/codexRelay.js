import { doc, getDocFromServer, runTransaction, writeBatch, onSnapshot } from 'firebase/firestore';

const CHUNK = 200000, LIMIT = 29 * 1024 * 1024;
const failure = code => Object.assign(new Error(code), { code });
export const bridgeAvailable = (state, now = Date.now()) => state?.online === true && typeof state.bridgeId === 'string' && state.expiresAt > now;
export const isLocalCodex = () => import.meta.env.VITE_ZOKO_CODEX_LOCAL === true && ['127.0.0.1', 'localhost'].includes(window.location.hostname);
export function createCodexRelay({ uid, schoolId, db, enabled = false }) {
  // No Firebase mailbox access until the production privacy gate is enabled.
  if (!enabled) return { status: async () => ({ connected: false }), request: async operation => {
    if (['status', 'cancel', 'disconnect'].includes(operation)) return { connected: false };
    throw failure('codex-public-disabled');
  } };
  const root = `users/${uid}/zokiPilot/${schoolId}`;
  const bridgeRef = doc(db, `${root}/state/bridge`), requestRef = doc(db, `${root}/state/relayRequest`);
  let pending = null;
  const status = async () => { const snapshot = await getDocFromServer(bridgeRef); const state = snapshot.data(); return { ...state, connected: bridgeAvailable(state) }; };
  async function cancel() {
    if (!pending) return;
    const id = pending;
    await runTransaction(db, async tx => {
      const current = await tx.get(requestRef);
      if (current.data()?.id === id) tx.update(requestRef, { cancel: true, ...(current.data().status === 'queued' ? { status: 'expired' } : {}) });
    });
  }
  async function request(operation, body = {}, signal) {
    if (operation === 'status') return status();
    if (operation === 'cancel' || operation === 'disconnect') { await cancel(); return { connected: false }; }
    if (pending) throw failure('codex-busy');
    const state = await status();
    if (!state.connected) throw failure('codex-offline');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const text = JSON.stringify(body);
    if (new TextEncoder().encode(text).length > LIMIT) throw failure('file-too-large');
    const id = crypto.randomUUID(), parts = Math.max(1, Math.ceil(text.length / CHUNK));
    pending = id;
    const paths = [];
    try {
      for (let start = 0; start < parts; start += 10) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const batch = writeBatch(db);
        for (let part = start; part < Math.min(parts, start + 10); part++) {
          const path = `${root}/transportChunks/${id}-in-${part}`; paths.push(path);
          batch.set(doc(db, path), { text: text.slice(part * CHUNK, (part + 1) * CHUNK), expiresAt: Date.now() + 600000 });
        }
        await batch.commit();
      }
      // The manifest is committed online in a transaction, never queued for a
      // later reconnect. Recheck the worker after a potentially long upload.
      await runTransaction(db, async tx => {
        const bridge = (await tx.get(bridgeRef)).data(); const previous = (await tx.get(requestRef)).data();
        if (!bridgeAvailable(bridge) || bridge.bridgeId !== state.bridgeId) throw failure('codex-offline');
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (previous?.bridgeId === state.bridgeId && (previous.status === 'running' || (previous.status === 'queued' && previous.expiresAt > Date.now()))) throw failure('codex-busy');
        tx.set(requestRef, { id, bridgeId: state.bridgeId, operation, parts, status: 'queued', cancel: false, expiresAt: Date.now() + 180000 });
      });
      const result = await new Promise((resolve, reject) => {
        let unsubscribe = () => {}, timer, heartbeat, finished = false;
        const finish = (error, value) => { if (finished) return; finished = true; unsubscribe(); clearTimeout(timer); clearInterval(heartbeat); signal?.removeEventListener('abort', aborted); error ? reject(error) : resolve(value); };
        const aborted = () => { cancel().catch(() => {}); finish(new DOMException('Aborted', 'AbortError')); };
        signal?.addEventListener('abort', aborted, { once: true });
        if (signal?.aborted) { aborted(); return; }
        heartbeat = setInterval(() => { status().then(next => { if (!next.connected || next.bridgeId !== state.bridgeId) { cancel().catch(() => {}); finish(failure('relay-timeout')); } }).catch(() => finish(failure('relay-timeout'))); }, 30000);
        timer = setTimeout(() => { cancel().catch(() => {}); finish(failure('relay-timeout')); }, 10 * 60 * 1000);
        unsubscribe = onSnapshot(requestRef, snapshot => {
          if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
          const value = snapshot.data();
          if (value?.id !== id || ['expired', 'failed'].includes(value.status)) finish(failure('relay-expired'));
          else if (value.status === 'done') finish(null, value);
        }, () => finish(failure('permission-denied')));
      });
      if (!Number.isInteger(result.outputParts) || result.outputParts < 1 || result.outputParts > 160) throw failure('relay-response-invalid');
      let output = '';
      for (let part = 0; part < result.outputParts; part++) {
        const path = `${root}/transportChunks/${id}-out-${part}`; paths.push(path);
        const chunk = (await getDocFromServer(doc(db, path))).data();
        if (typeof chunk?.text !== 'string' || chunk.text.length > CHUNK) throw failure('relay-response-invalid');
        output += chunk.text;
        if (output.length > LIMIT) throw failure('relay-response-invalid');
      }
      const response = JSON.parse(output);
      if (response.status !== 200) throw failure(response.value?.code || 'relay-operation-failed');
      return response.value;
    } finally {
      pending = null;
      // A worker also removes expired chunks if a tab closes before this point.
      for (let start = 0; start < paths.length; start += 10) {
        const batch = writeBatch(db); paths.slice(start, start + 10).forEach(path => batch.delete(doc(db, path))); batch.commit().catch(() => {});
      }
    }
  }
  return { request, status };
}
