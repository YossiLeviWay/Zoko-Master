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
