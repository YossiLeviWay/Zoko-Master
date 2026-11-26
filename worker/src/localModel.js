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

export function buildLocalRequest({ messages, context = '' }) {
  const history = boundedMessages(messages);
  if (!history.length || history.at(-1).role !== 'user') throw new Error('invalid-input');
  const last = history.at(-1);
  return {
    message: last.content.slice(0, SERVICE_LIMITS.messageChars),
    history: history.slice(0, -1).slice(-SERVICE_LIMITS.history).map(item => ({ role: item.role, content: item.content.slice(0, SERVICE_LIMITS.messageChars) })),
    stream: false,
    ...(context ? { context: String(context).slice(0, 3500) } : {}),
  };
}

export function parseLocalResponse(response) {
  const reply = String(response?.answer ?? '').replace(/<think>[\s\S]*?<\/think>/gu, '').trim().slice(0, LOCAL_LIMITS.maxReplyChars);
  return { reply, proposals: [], stopReason: '', sources: Array.isArray(response?.sources) ? response.sources.filter(item => typeof item === 'string').slice(0, 8) : [], usage: { input: 0, output: 0, cacheRead: 0 } };
}

// Asks the service to fill the form of one tool for an instruction. It only proposes: the user approves before anything runs.
export async function routeLocalAction(env, { message, tools, context = '' }, fetchImpl = fetch) {
  try {
    const data = await callLocalModel(env, { mode: 'route', message: String(message).slice(0, 800), tools, context: String(context).slice(0, 1500) }, fetchImpl, { signal: AbortSignal.timeout(25000) });
    return data && typeof data === 'object' ? data : { tool: null };
  } catch { return { tool: null }; }
}

// One call to the service. `model` is "fast" or "strong" (the service picks the concrete model).
// The signal covers the whole request; for streams the caller can abort it earlier.
export async function callLocalModel(env, payload, fetchImpl = fetch, { stream = false, model = '', signal } = {}) {
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
      method: 'POST', headers, body: JSON.stringify({ ...payload, stream, ...(model ? { model } : {}) }), signal: signal || AbortSignal.timeout(LOCAL_LIMITS.timeoutMs),
    });
  } catch { throw new Error('agent-unavailable'); }
  if (!response.ok) throw new Error('agent-unavailable');
  // With stream: true the caller gets the raw event stream (event: token / done) to pass through.
  return stream ? response : response.json();
}

// ---- Fast model first, strong model when the fast one is slow, fails or has no answer ----

export const TIERS = Object.freeze({ firstTokenMs: 20000, peekChars: 20, minAnswerChars: 30 });
const NO_INFO = /^\s*(אין לי מידע|לא מצאתי מידע|אין לי הגדרה)/u;

// A fast answer is weak when it is empty, says it has no information, or is too short to be a sentence.
export const isWeakAnswer = (text, { final = false } = {}) => {
  const value = String(text || '').trim();
  return NO_INFO.test(value) || (final && value.length < TIERS.minAnswerChars);
};

const tiersFor = env => (env.LOCAL_MODEL_TIERING === 'off' ? ['strong'] : ['fast', 'strong']);
const firstTokenMs = env => Number(env.LOCAL_FAST_FIRST_TOKEN_MS) || TIERS.firstTokenMs;

export async function askLocalTiered(env, payload, fetchImpl = fetch) {
  const order = tiersFor(env);
  for (const [index, tier] of order.entries()) {
    const last = index === order.length - 1;
    try {
      const signal = tier === 'fast' && !last ? AbortSignal.timeout(firstTokenMs(env) + 10000) : undefined;
      const data = await callLocalModel(env, payload, fetchImpl, { model: tier, signal });
      if (last || !isWeakAnswer(data?.answer, { final: true })) return data;
    } catch (error) { if (last) throw error; }
  }
  throw new Error('agent-unavailable');
}

const decoder = new TextDecoder();
const tokensIn = buffer => [...buffer.matchAll(/^event:\s*token\s*\r?\ndata:\s*(.*)$/gmu)].map(match => { try { return JSON.parse(match[1]); } catch { return match[1]; } }).join('');

// Opens one stream and reads just enough of it to judge it. Returns { reader, head } or null when the tier is not good enough.
async function openJudgedStream(env, payload, tier, fetchImpl, { judge }) {
  const controller = new AbortController();
  const overall = setTimeout(() => controller.abort(), LOCAL_LIMITS.timeoutMs);
  const give = () => { clearTimeout(overall); controller.abort(); return null; };
  let response;
  try { response = await callLocalModel(env, payload, fetchImpl, { stream: true, model: tier, signal: controller.signal }); } catch { return give(); }
  const reader = response.body.getReader();
  const head = [];
  let text = '';
  let finished = false;
  let firstChunk = true;
  while (!finished && (tokensIn(text).length < TIERS.peekChars)) {
    let chunk;
    let timer;
    try {
      const wait = firstChunk && judge ? new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('slow')), firstTokenMs(env)); }) : null;
      chunk = await (wait ? Promise.race([reader.read(), wait]) : reader.read());
    } catch { return give(); } finally { clearTimeout(timer); }
    firstChunk = false;
    if (chunk.done) { finished = true; break; }
    head.push(chunk.value);
    text += decoder.decode(chunk.value, { stream: true });
    if (/^event:\s*done/mu.test(text)) finished = true;
  }
  const answer = tokensIn(text);
  if (judge && isWeakAnswer(answer, { final: finished })) return give();
  return { reader, head, overall };
}

// Returns a ReadableStream of the service's own SSE frames, from the fast model when it is good, otherwise the strong one.
export async function streamLocalTiered(env, payload, fetchImpl = fetch) {
  const order = tiersFor(env);
  for (const [index, tier] of order.entries()) {
    const opened = await openJudgedStream(env, payload, tier, fetchImpl, { judge: index < order.length - 1 });
    if (!opened) continue;
    const { reader, head, overall } = opened;
    return new ReadableStream({
      start(controller) { head.forEach(chunk => controller.enqueue(chunk)); },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) { clearTimeout(overall); controller.close(); } else controller.enqueue(value);
        } catch { clearTimeout(overall); controller.close(); }
      },
      cancel() { clearTimeout(overall); return reader.cancel(); },
    });
  }
  throw new Error('agent-unavailable');
}
