import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalRequest, callLocalModel, localModelConfigured, parseLocalResponse } from '../../worker/src/localModel.js';

const profile = { systemPrompt: 'אתה זוקי' };

test('local requests carry no tools and bound the history', () => {
  const req = buildLocalRequest({ profile, messages: [{ role: 'user', content: 'שלום' }], model: 'dictalm' });
  assert.equal(req.messages[0].role, 'system');
  assert.equal(req.tools, undefined);
  assert.throws(() => buildLocalRequest({ profile, messages: [], model: 'x' }), /invalid-input/u);
});

test('local replies never produce proposals and drop reasoning tags', () => {
  const out = parseLocalResponse({ message: { content: '<think>x</think>תשובה' }, eval_count: 3 });
  assert.equal(out.reply, 'תשובה');
  assert.deepEqual(out.proposals, []);
});

test('only an https address counts as configured; the token is sent as a bearer header', async () => {
  assert.equal(localModelConfigured({ LOCAL_MODEL_URL: 'http://1.2.3.4' }), false);
  let seen;
  const env = { LOCAL_MODEL_URL: 'https://m.example.com/', LOCAL_MODEL_TOKEN: 't' };
  await callLocalModel(env, {}, async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({}) }; });
  assert.equal(seen.url, 'https://m.example.com/api/chat');
  assert.equal(seen.init.headers.authorization, 'Bearer t');
  await assert.rejects(callLocalModel(env, {}, async () => ({ ok: false })), /agent-unavailable/u);
});

test('worker provider shares no school records and never returns an action', async () => {
  const { knowledgeContext } = await import('../../src/services/zokiWorkerProvider.js');
  const text = knowledgeContext({ knowledge: [{ title: 'טיולים', mode: 'cite' }], upcomingMilestones: 'ב-20.05 תכנון טיולים' });
  assert.match(text, /טיולים/u);
  assert.match(text, /20\.05/u);
});
