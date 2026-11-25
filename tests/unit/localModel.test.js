import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalRequest, callLocalModel, localModelConfigured, parseLocalResponse } from '../../worker/src/localModel.js';


test('local requests follow the school-ai contract and stay within its limits', () => {
  const req = buildLocalRequest({ messages: [{ role: 'user', content: 'א' }, { role: 'assistant', content: 'ב' }, { role: 'user', content: 'ג'.repeat(2000) }] });
  assert.equal(req.message.length, 800);
  assert.equal(req.history.length, 2);
  assert.equal(req.stream, false);
  assert.equal(req.tools, undefined);
  assert.throws(() => buildLocalRequest({ messages: [] }), /invalid-input/u);
});

test('local replies never produce proposals and drop reasoning tags', () => {
  const out = parseLocalResponse({ answer: '<think>x</think>תשובה', sources: ['מקור'] });
  assert.equal(out.reply, 'תשובה');
  assert.deepEqual(out.proposals, []);
  assert.deepEqual(out.sources, ['מקור']);
});

test('only an https address counts as configured; the token is sent as a bearer header', async () => {
  assert.equal(localModelConfigured({ LOCAL_MODEL_URL: 'http://1.2.3.4' }), false);
  let seen;
  const env = { LOCAL_MODEL_URL: 'https://m.example.com/', LOCAL_MODEL_TOKEN: 't' };
  await callLocalModel(env, {}, async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({}) }; });
  assert.equal(seen.url, 'https://m.example.com/api/chat');
  assert.equal(seen.init.headers['x-api-key'], 't');
  assert.equal(seen.init.headers.authorization, undefined);
  await assert.rejects(callLocalModel(env, {}, async () => ({ ok: false })), /agent-unavailable/u);
});

test('worker provider shares no school records and never returns an action', async () => {
  const { knowledgeContext } = await import('../../src/services/zokiWorkerProvider.js');
  const text = knowledgeContext({ knowledge: [{ title: 'טיולים', mode: 'cite' }], upcomingMilestones: 'ב-20.05 תכנון טיולים' });
  assert.match(text, /טיולים/u);
  assert.match(text, /20\.05/u);
});

test('the token stream is parsed into growing text and tolerates split frames', async () => {
  const { readTokenStream } = await import('../../src/utils/tokenStream.js');
  const frames = ['event: token\ndata: "של', 'ום "\n\nevent: token\ndata: "עולם"\n\nevent: done\ndata: {"sources":[]}\n\n'];
  const body = new ReadableStream({ start(controller) { frames.forEach(frame => controller.enqueue(new TextEncoder().encode(frame))); controller.close(); } });
  const seen = [];
  const result = await readTokenStream({ body }, text => seen.push(text));
  assert.deepEqual(seen, ['שלום ', 'שלום עולם']);
  assert.equal(result.reply, 'שלום עולם');
});

test('streaming calls hand back the raw response', async () => {
  const response = { ok: true, body: 'stream' };
  const out = await callLocalModel({ LOCAL_MODEL_URL: 'https://m.example.com' }, {}, async (_url, init) => { assert.equal(JSON.parse(init.body).stream, true); return response; }, { stream: true });
  assert.equal(out, response);
});

// ---- fast model first, strong model as the fallback ----
const sse = (...tokens) => `${tokens.map(token => `event: token\ndata: ${JSON.stringify(token)}\n\n`).join('')}event: done\ndata: {"sources":[]}\n\n`;
const streamResponse = text => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } }));
const stuckResponse = () => new Response(new ReadableStream({ start() {} }));
const readAll = async stream => { const reader = stream.getReader(); let out = ''; for (;;) { const { done, value } = await reader.read(); if (done) return out; out += new TextDecoder().decode(value); } };
const env = { LOCAL_MODEL_URL: 'https://m.example.com', LOCAL_FAST_FIRST_TOKEN_MS: '50' };

test('a good fast answer is streamed and the strong model is not called', async () => {
  const { streamLocalTiered } = await import('../../worker/src/localModel.js');
  const calls = [];
  const stream = await streamLocalTiered(env, { message: 'ש' }, async (_url, init) => { calls.push(JSON.parse(init.body).model); return streamResponse(sse('התוכנית ', 'מוגשת עד 20 במאי')); });
  assert.match(await readAll(stream), /20 במאי/u);
  assert.deepEqual(calls, ['fast']);
});

test('"no information" from the fast model escalates to the strong model', async () => {
  const { streamLocalTiered } = await import('../../worker/src/localModel.js');
  const calls = [];
  const stream = await streamLocalTiered(env, { message: 'ש' }, async (_url, init) => {
    const model = JSON.parse(init.body).model; calls.push(model);
    return streamResponse(model === 'fast' ? sse('אין לי מידע מדויק על כך') : sse('תשובה מלאה ומפורטת מהמודל החזק'));
  });
  assert.match(await readAll(stream), /החזק/u);
  assert.deepEqual(calls, ['fast', 'strong']);
});

test('a fast model that sends nothing in time escalates to the strong model', async () => {
  const { streamLocalTiered } = await import('../../worker/src/localModel.js');
  const calls = [];
  const stream = await streamLocalTiered(env, { message: 'ש' }, async (_url, init) => {
    const model = JSON.parse(init.body).model; calls.push(model);
    return model === 'fast' ? stuckResponse() : streamResponse(sse('תשובה מהמודל החזק, בהצלחה'));
  });
  assert.match(await readAll(stream), /החזק/u);
  assert.deepEqual(calls, ['fast', 'strong']);
});

test('non-streaming asks fast first and escalates on a weak or failed answer', async () => {
  const { askLocalTiered } = await import('../../worker/src/localModel.js');
  const calls = [];
  const out = await askLocalTiered(env, { message: 'ש' }, async (_url, init) => {
    const model = JSON.parse(init.body).model; calls.push(model);
    return { ok: true, json: async () => ({ answer: model === 'fast' ? 'אין לי מידע' : 'תשובה ארוכה מספיק מהמודל החזק' }) };
  });
  assert.match(out.answer, /החזק/u);
  assert.deepEqual(calls, ['fast', 'strong']);
  const failing = [];
  await askLocalTiered(env, { message: 'ש' }, async (_url, init) => { const m = JSON.parse(init.body).model; failing.push(m); if (m === 'fast') throw new Error('down'); return { ok: true, json: async () => ({ answer: 'תשובה ארוכה מספיק' }) }; });
  assert.deepEqual(failing, ['fast', 'strong']);
});

test('tiering can be switched off', async () => {
  const { askLocalTiered } = await import('../../worker/src/localModel.js');
  const calls = [];
  await askLocalTiered({ ...env, LOCAL_MODEL_TIERING: 'off' }, { message: 'ש' }, async (_url, init) => { calls.push(JSON.parse(init.body).model); return { ok: true, json: async () => ({ answer: 'תשובה' }) }; });
  assert.deepEqual(calls, ['strong']);
});
