// Local model adapter for Zoki: the school-ai service (DictaLM) running on the school's own machine.
// The Worker is the only caller: the browser never learns the model address or token.
// A local model is text-only here: it never proposes tool calls, so it can read nothing
// and change nothing beyond what the knowledge layer in the prompt already contains.
import { boundedMessages } from './claude.js';

export const LOCAL_LIMITS = Object.freeze({ timeoutMs: 120000, maxReplyChars: 6000 });

export function localModelConfigured(env) {
  return /^https:\/\/[^\s/]+/u.test(String(env.LOCAL_MODEL_URL || ''));
}

// Contract of the school-ai service (DictaLM + its own RAG over the school knowledge files):
// POST {URL}/api/chat  header x-api-key  body {message<=800, history<=6, stream:false}  ->  {answer, sources, ms}
// The service chooses the model and builds its own prompt, so our role prompt and context are not sent.
export const SERVICE_LIMITS = Object.freeze({ messageChars: 800, history: 6 });

export function buildLocalRequest({ messages }) {
  const history = boundedMessages(messages);
  if (!history.length || history.at(-1).role !== 'user') throw new Error('invalid-input');
  const last = history.at(-1);
  return {
    message: last.content.slice(0, SERVICE_LIMITS.messageChars),
    history: history.slice(0, -1).slice(-SERVICE_LIMITS.history).map(item => ({ role: item.role, content: item.content.slice(0, SERVICE_LIMITS.messageChars) })),
    stream: false,
  };
}

export function parseLocalResponse(response) {
  const reply = String(response?.answer ?? '').replace(/<think>[\s\S]*?<\/think>/gu, '').trim().slice(0, LOCAL_LIMITS.maxReplyChars);
  return { reply, proposals: [], stopReason: '', sources: Array.isArray(response?.sources) ? response.sources.filter(item => typeof item === 'string').slice(0, 8) : [], usage: { input: 0, output: 0, cacheRead: 0 } };
}

export async function callLocalModel(env, payload, fetchImpl = fetch) {
  if (!localModelConfigured(env)) throw new Error('agent-not-configured');
  const headers = { 'content-type': 'application/json' };
  // Sent server-to-server without an Origin header, so the service requires this key.
  if (env.LOCAL_MODEL_TOKEN) headers['x-api-key'] = env.LOCAL_MODEL_TOKEN;
  // Optional Cloudflare Access service token in front of the tunnel.
  if (env.LOCAL_MODEL_ACCESS_ID && env.LOCAL_MODEL_ACCESS_SECRET) {
    headers['cf-access-client-id'] = env.LOCAL_MODEL_ACCESS_ID;
    headers['cf-access-client-secret'] = env.LOCAL_MODEL_ACCESS_SECRET;
  }
  let response;
  try {
    response = await fetchImpl(`${String(env.LOCAL_MODEL_URL).replace(/\/$/u, '')}/api/chat`, {
      method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(LOCAL_LIMITS.timeoutMs),
    });
  } catch { throw new Error('agent-unavailable'); }
  if (!response.ok) throw new Error('agent-unavailable');
  return response.json();
}
