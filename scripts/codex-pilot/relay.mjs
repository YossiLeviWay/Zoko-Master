import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { PilotError } from './client.mjs';
import { UserFirestore } from './firestore.mjs';

export const RELAY_CHUNK = 200000;
export const RELAY_LIMIT = 29 * 1024 * 1024;
export const relayRoot = actor => `users/${actor.uid}/zokiPilot/${actor.schoolId}`;
export function validRelayRequest(data, bridge, now = Date.now()) {
  return data && data.bridgeId === bridge && /^[\w-]{1,80}$/.test(data.id || '')
    && ['connect', 'analyze', 'preview', 'approve'].includes(data.operation)
    && Number.isInteger(data.parts) && data.parts > 0 && data.parts <= 160
    && Number.isFinite(data.expiresAt) && data.expiresAt > now && data.expiresAt <= now + 180000;
}
// Calls the same authenticated, approval-gated handler. Credentials never enter
// a queue document, Codex input, or a browser response.
export async function invokePilot(handler, origin, token, sessionId, operation, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { relayInternal: true, method: 'POST', url: `/__zoki_codex/${operation}`, headers: { host: new URL(origin).host, origin, 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-zoki-session': sessionId } });
  return new Promise((resolve, reject) => {
    const res = { setHeader() {}, end(text) { try { resolve({ status: this.statusCode, value: JSON.parse(text) }); } catch { reject(new Error('relay-response-invalid')); } } };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}
export function createRelay({ projectId, origin, handler, dbFactory = options => new UserFirestore(options) }) {
  let current, ticking = false;
  const dbFor = state => dbFactory({ projectId, token: state.token });
  async function put(db, path, data) { const old = await db.get(path); await db.commit([{ path, data, version: old?.version }]); }
  async function clean(db, root, all = false) {
    const rows = await db.list(`${root}/transportChunks`);
    for (let i = 0; i < rows.length; i += 10) {
      const expired = rows.slice(i, i + 10).filter(row => all || row.data.expiresAt < Date.now());
      if (expired.length) await db.remove(expired);
    }
  }
  async function stop() {
    const state = current; current = null;
    if (!state) return;
    state.active = false;
    await invokePilot(handler, origin, state.token, state.sessionId, 'cancel', { schoolId: state.actor.schoolId }).catch(() => {});
    const db = dbFor(state);
    const presence = await db.get(`${state.root}/state/bridge`).catch(() => null);
    if (presence?.data.bridgeId === state.id) {
      await db.commit([{ path: presence.path, version: presence.version, data: { bridgeId: state.id, online: false, expiresAt: 0 } }]).catch(() => {});
      await clean(db, state.root, true).catch(() => {});
    }
    state.credentials?.clear(); state.token = ''; state.sessionId = '';
  }
  async function session(event) {
    if (event.operation === 'disconnect') { await stop(); return; }
    if (event.operation === 'connect') {
      await stop();
      const db = dbFactory({ projectId, token: event.token });
      const path = `${relayRoot(event.actor)}/state/bridge`;
      const previous = await db.get(path);
      if (previous?.data.online && previous.data.expiresAt > Date.now()) throw new PilotError('codex-busy');
      const id = randomUUID();
      await db.commit([{ path, version: previous?.version, data: { bridgeId: id, online: true, expiresAt: Date.now() + 90000 } }]);
      current = { id, actor: event.actor, root: relayRoot(event.actor), token: event.token, sessionId: event.sessionId, active: true, renewedAt: Date.now(), heartbeat: 0, cleaned: 0, credentials: event.credentials };
    } else if (current?.sessionId === event.sessionId) { current.token = event.token; current.renewedAt = Date.now(); }
    if (event.operation === 'connect') await tick();
  }
  async function execute(state, db, row) {
    const request = row.data;
    if (!validRelayRequest(request, state.id)) return;
    // Claim before invoking: a disconnected browser must not dispatch twice.
    await db.commit([{ path: row.path, version: row.version, patch: { status: 'running' } }]);
    let response;
    try {
      let serialized = '';
      for (let part = 0; part < request.parts; part++) {
        const chunk = await db.get(`${state.root}/transportChunks/${request.id}-in-${part}`);
        if (typeof chunk?.data.text !== 'string' || chunk.data.text.length > RELAY_CHUNK) throw new Error('invalid-chunk');
        serialized += chunk.data.text;
        if (Buffer.byteLength(serialized) > RELAY_LIMIT) throw new Error('invalid-size');
      }
      const body = JSON.parse(serialized);
      if (!state.active || current !== state) return;
      response = await invokePilot(handler, origin, state.token, state.sessionId, request.operation === 'connect' ? 'resume' : request.operation, { ...body, schoolId: state.actor.schoolId });
      // The local handler nonce is private even to the remote mailbox.
      if (response.value.sessionId) response.value.sessionId = state.id;
    } catch { response = { status: 400, value: { code: 'relay-operation-failed' } }; }
    if (!state.active || current !== state) return;
    const text = JSON.stringify(response);
    if (Buffer.byteLength(text) > RELAY_LIMIT) response = { status: 400, value: { code: 'context-too-large' } };
    const output = JSON.stringify(response); const parts = Math.ceil(output.length / RELAY_CHUNK);
    for (let part = 0; part < parts; part++) await put(db, `${state.root}/transportChunks/${request.id}-out-${part}`, { text: output.slice(part * RELAY_CHUNK, (part + 1) * RELAY_CHUNK), expiresAt: Date.now() + 600000 });
    const latest = await db.get(row.path);
    if (latest?.data.id === request.id) await db.commit([{ path: row.path, version: latest.version, patch: { status: 'done', outputParts: parts } }]);
    const inputs = (await db.list(`${state.root}/transportChunks`)).filter(chunk => chunk.id.startsWith(`${request.id}-in-`));
    for (let i = 0; i < inputs.length; i += 10) await db.remove(inputs.slice(i, i + 10));
  }
  async function tick() {
    if (ticking || !current) return;
    ticking = true; const state = current;
    try {
      if (state.credentials) { state.token = await state.credentials.token(); state.renewedAt = Date.now(); }
      if (Date.now() - state.renewedAt > 90000) { await stop(); return; }
      const db = dbFor(state);
      // Revalidate institution role; an old lease cannot grant access.
      await db.actor(state.actor.schoolId);
      if (Date.now() - state.heartbeat > 45000) {
        const status = await invokePilot(handler, origin, state.token, state.sessionId, 'status', { schoolId: state.actor.schoolId });
        if (status.status !== 200) { await stop(); return; }
        const presence = await db.get(`${state.root}/state/bridge`);
        if (presence?.data.bridgeId !== state.id) { await stop(); return; }
        await db.commit([{ path: presence.path, version: presence.version, data: { bridgeId: state.id, online: true, expiresAt: Date.now() + 90000, busy: !!state.running } }]); state.heartbeat = Date.now();
      }
      const row = await db.get(`${state.root}/state/relayRequest`);
      if (row?.data.cancel === true && row.data.status === 'running' && row.data.id === state.running) await invokePilot(handler, origin, state.token, state.sessionId, 'cancel', { schoolId: state.actor.schoolId });
      if (!state.running && row?.data.status === 'queued') {
        if (validRelayRequest(row.data, state.id)) {
          state.running = row.data.id;
          state.work = execute(state, db, row).catch(async () => {
            const latest = await db.get(row.path).catch(() => null);
            if (current === state && latest?.data.id === row.data.id) await db.commit([{ path: row.path, version: latest.version, patch: { status: 'failed' } }]).catch(() => {});
          }).finally(() => { state.running = null; });
        } else await db.commit([{ path: row.path, version: row.version, patch: { status: 'expired' } }]);
      }
      if (!state.running && Date.now() - state.cleaned > 300000) { await clean(db, state.root); state.cleaned = Date.now(); }
    } catch { await stop(); /* Re-pair locally after revocation or a failed credential refresh. */ }
    finally { ticking = false; }
  }
  const timer = setInterval(tick, 10000).unref();
  return { session, close: async () => { clearInterval(timer); await stop(); }, tick };
}
