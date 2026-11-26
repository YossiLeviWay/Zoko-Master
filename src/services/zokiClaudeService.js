// Browser side of the Claude-backed role agent. The browser only talks to our own
// Worker (which holds the Anthropic key); it never sees or sends an API key.
import { getToken } from 'firebase/app-check';
import { appCheck, auth } from '../firebase.js';
import { readTokenStream } from '../utils/tokenStream.js';
import { ZOKI_TURN_TIMEOUT_MS, classifyWorkerFetchError, workerCallContext, workerFailure } from '../utils/zokiWorkerError.js';

export const zokiClaudeEndpoint = () => (import.meta.env.VITE_ZOKI_WORKER_URL || '').replace(/\/$/, '');
export const isZokiClaudeConfigured = () => Boolean(zokiClaudeEndpoint());

// messages: [{ role: 'user' | 'assistant', content }]
// Returns { reply, proposals[], agent }. Proposals are suggestions only: the UI must
// show them and execute nothing until the user approves.
// The first send used to wait on a cold App Check / ID token exchange. Warm both while the
// chat is open so pressing send does not pay for them.
export function warmZokiConnection() {
  const user = auth.currentUser;
  if (user) user.getIdToken().catch(() => undefined);
  if (appCheck) getToken(appCheck, false).catch(() => undefined);
}

export async function askRoleAgent({ schoolId, messages, context = '', signal, onToken }) {
  // No /health ping before this POST. A short precheck would fail on a slow network and the
  // real request would never be sent. The POST below is the first request to the Worker.
  const where = workerCallContext(zokiClaudeEndpoint());
  console.info('zoki-turn-stage', 'start', where);
  if (!isZokiClaudeConfigured()) throw workerFailure('agent-not-configured', new Error('missing worker url'), where);
  const user = auth.currentUser;
  if (!user) throw workerFailure('unauthenticated', new Error('no current user'), where);
  let idToken;
  console.info('zoki-turn-stage', 'id-token', where);
  try { idToken = await user.getIdToken(); }
  catch (error) { throw workerFailure('id-token-failed', error, where); }
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${idToken}` };
  if (appCheck) {
    console.info('zoki-turn-stage', 'app-check', where);
    try { headers['x-firebase-appcheck'] = (await getToken(appCheck)).token; }
    catch (error) { throw workerFailure('app-check-failed', error, where); }
  } else console.info('zoki-turn-stage', 'app-check-skipped', where);
  let payload;
  console.info('zoki-turn-stage', 'body', where);
  try { payload = JSON.stringify({ schoolId, messages, context, stream: typeof onToken === 'function' }); }
  catch (error) { throw workerFailure('request-build-failed', error, where); }
  const timeout = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ZOKI_TURN_TIMEOUT_MS) : undefined;
  let response;
  console.info('zoki-turn-stage', 'fetch', where);
  try {
    response = await fetch(`${zokiClaudeEndpoint()}/v1/zoki/turn`, { method: 'POST', headers, body: payload, signal: signal || timeout });
  } catch (error) {
    throw classifyWorkerFetchError(error, where);
  }
  if (response.ok && onToken && /text\/event-stream/u.test(response.headers.get('content-type') || '')) return readTokenStream(response, onToken);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'agent-unavailable'), { code: body.error || 'agent-unavailable' });
  return body;
}

// What Zoki knows about the signed-in user in this school. The Worker only ever returns the caller's own brain.
async function personalBrainRequest(schoolId, path, method) {
  if (!isZokiClaudeConfigured()) throw Object.assign(new Error('agent-not-configured'), { code: 'agent-not-configured' });
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${await user.getIdToken()}` };
  if (appCheck) headers['x-firebase-appcheck'] = (await getToken(appCheck)).token;
  const url = `${zokiClaudeEndpoint()}/v1/zoki/${path}${method === 'GET' ? `?schoolId=${encodeURIComponent(schoolId)}` : ''}`;
  const response = await fetch(url, { method, headers, ...(method === 'POST' ? { body: JSON.stringify({ schoolId }) } : {}) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'agent-unavailable'), { code: body.error || 'agent-unavailable' });
  return body;
}
export const readPersonalBrain = schoolId => personalBrainRequest(schoolId, 'personal-brain', 'GET');
export const clearPersonalBrain = schoolId => personalBrainRequest(schoolId, 'personal-brain/clear', 'POST');
