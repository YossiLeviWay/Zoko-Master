import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeRequest, parseClaudeResponse, callClaude, boundedMessages, heldCapabilities } from '../../worker/src/claude.js';
import { roleAgentProfile } from '../../functions/src/roleAgents.js';
import { presetProfile } from '../../functions/src/accessCatalog.js';

const profile = roleAgentProfile('secretary');
const held = heldCapabilities(presetProfile('secretary'));

test('request caches the role prompt and offers only tools the user may use', () => {
  const body = buildClaudeRequest({ profile, messages: [{ role: 'user', content: 'נסח מייל להורים' }], heldKeys: held });
  assert.equal(body.system[0].cache_control.type, 'ephemeral');
  const names = body.tools.map(tool => tool.name);
  assert.ok(names.includes('draft_email'));
  assert.equal(names.includes('read_class_grades'), false);
  assert.equal(names.includes('create_event'), false);
});
test('history is bounded, starts with a user turn and strips control characters', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}\u0000` }));
  const out = boundedMessages([{ role: 'assistant', content: 'stray' }, ...many]);
  assert.ok(out.length <= 12);
  assert.equal(out[0].role, 'user');
  assert.equal(out.some(item => item.content.includes('\u0000')), false);
  assert.throws(() => buildClaudeRequest({ profile, messages: [], heldKeys: held }), /invalid-input/);
});
test('tool_use blocks become proposals; unknown tools are dropped', () => {
  const parsed = parseClaudeResponse({ stop_reason: 'tool_use', content: [
    { type: 'text', text: 'מצאתי' }, { type: 'tool_use', id: 't1', name: 'draft_email', input: { subject: 'a', body: 'b' } }, { type: 'tool_use', id: 't2', name: 'delete_everything', input: {} },
  ], usage: { input_tokens: 10, output_tokens: 5 } });
  assert.equal(parsed.reply, 'מצאתי');
  assert.deepEqual(parsed.proposals.map(item => item.tool), ['draft_email']);
});
test('API call sends the key only in the header and never leaks provider errors', async () => {
  let seen;
  const ok = await callClaude({ ANTHROPIC_API_KEY: 'k' }, { a: 1 }, async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ content: [] }) }; });
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], 'k');
  assert.equal(seen.init.body.includes('"k"'), false);
  assert.deepEqual(ok, { content: [] });
  await assert.rejects(callClaude({}, {}), /agent-not-configured/);
  await assert.rejects(callClaude({ ANTHROPIC_API_KEY: 'k' }, {}, async () => ({ ok: false, status: 429 })), /resource-exhausted/);
  await assert.rejects(callClaude({ ANTHROPIC_API_KEY: 'k' }, {}, async () => ({ ok: false, status: 500, text: async () => 'secret prompt' })), /agent-unavailable/);
});
