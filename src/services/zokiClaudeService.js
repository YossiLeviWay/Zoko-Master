// Browser side of the Claude-backed role agent. The browser only talks to our own
// Worker (which holds the Anthropic key); it never sees or sends an API key.
import { getToken } from 'firebase/app-check';
import { appCheck, auth } from '../firebase.js';

export const zokiClaudeEndpoint = () => (import.meta.env.VITE_ZOKI_WORKER_URL || '').replace(/\/$/, '');
export const isZokiClaudeConfigured = () => Boolean(zokiClaudeEndpoint());

// messages: [{ role: 'user' | 'assistant', content }]
// Returns { reply, proposals[], agent }. Proposals are suggestions only: the UI must
// show them and execute nothing until the user approves.
export async function askRoleAgent({ schoolId, messages, context = '', signal }) {
  if (!isZokiClaudeConfigured()) throw Object.assign(new Error('agent-not-configured'), { code: 'agent-not-configured' });
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${await user.getIdToken()}` };
  if (appCheck) {
    try { headers['x-firebase-appcheck'] = (await getToken(appCheck)).token; }
    catch { throw Object.assign(new Error('app-check-failed'), { code: 'app-check-failed' }); }
  }
  // A browser-level failure (CORS, CSP, offline) has no status; give it a readable code.
  const response = await fetch(`${zokiClaudeEndpoint()}/v1/zoki/turn`, { method: 'POST', headers, body: JSON.stringify({ schoolId, messages, context }), signal })
    .catch(() => { throw Object.assign(new Error('worker-unreachable'), { code: 'worker-unreachable' }); });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'agent-unavailable'), { code: body.error || 'agent-unavailable' });
  return body;
}
