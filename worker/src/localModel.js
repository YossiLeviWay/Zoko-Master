// Local model adapter (Ollama /api/chat) for Zoki, e.g. DictaLM running on the school's own machine.
// The Worker is the only caller: the browser never learns the model address or token.
// A local model is text-only here: it never proposes tool calls, so it can read nothing
// and change nothing beyond what the knowledge layer in the prompt already contains.
import { boundedMessages } from './claude.js';

export const LOCAL_LIMITS = Object.freeze({ timeoutMs: 60000, maxReplyChars: 6000 });

export function localModelConfigured(env) {
  return /^https:\/\/[^\s/]+/u.test(String(env.LOCAL_MODEL_URL || ''));
}

export function buildLocalRequest({ profile, messages, context = '', model }) {
  const history = boundedMessages(messages);
  if (!history.length) throw new Error('invalid-input');
  const system = [
    profile.systemPrompt,
    'אין לך גישה לכלים או למידע אישי. ענה בעברית, בקצרה, ורק על סמך הידע המאומת שבהנחיות. אם אינך יודע - אמור זאת.',
    context ? `הקשר מוסדי (מצומצם, ללא פרטים מזהים):\n${String(context).slice(0, 6000)}` : '',
  ].filter(Boolean).join('\n\n');
  return { model, stream: false, messages: [{ role: 'system', content: system }, ...history], options: { temperature: 0.2 } };
}

export function parseLocalResponse(response) {
  const reply = String(response?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/gu, '').trim().slice(0, LOCAL_LIMITS.maxReplyChars);
  return { reply, proposals: [], stopReason: response?.done_reason || '', usage: { input: response?.prompt_eval_count || 0, output: response?.eval_count || 0, cacheRead: 0 } };
}

export async function callLocalModel(env, payload, fetchImpl = fetch) {
  if (!localModelConfigured(env)) throw new Error('agent-not-configured');
  const headers = { 'content-type': 'application/json' };
  if (env.LOCAL_MODEL_TOKEN) headers.authorization = `Bearer ${env.LOCAL_MODEL_TOKEN}`;
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
