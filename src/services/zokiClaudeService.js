// Browser side of the Claude-backed role agent. The browser only talks to our own
// Worker (which holds the Anthropic key); it never sees or sends an API key.
import { getToken } from 'firebase/app-check';
import { appCheck, auth } from '../firebase.js';
import { readTokenStream } from '../utils/tokenStream.js';

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
  if (!isZokiClaudeConfigured()) throw Object.assign(new Error('agent-not-configured'), { code: 'agent-not-configured' });
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${await user.getIdToken()}` };
  if (appCheck) {
    try { headers['x-firebase-appcheck'] = (await getToken(appCheck)).token; }
    catch { throw Object.assign(new Error('app-check-failed'), { code: 'app-check-failed' }); }
  }
  // A browser-level failure (CORS, CSP, offline) has no status; give it a readable code.
  const response = await fetch(`${zokiClaudeEndpoint()}/v1/zoki/turn`, { method: 'POST', headers, body: JSON.stringify({ schoolId, messages, context, stream: typeof onToken === 'function' }), signal })
    .catch(() => { throw Object.assign(new Error('worker-unreachable'), { code: 'worker-unreachable' }); });
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
