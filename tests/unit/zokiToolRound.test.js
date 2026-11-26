import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClaudeRequest } from '../../worker/src/claude.js';
import { PROPOSAL_LINE, offeredCapabilityKeys, runClaudeRounds } from '../../worker/src/zokiToolRound.js';
import { settleWorkerTurn } from '../../src/services/zokiWorkerProvider.js';
import { roleAgentProfile } from '../../functions/src/roleAgents.js';

const profile = roleAgentProfile('secretary');

test('a tool_use-only write becomes a proposal line and the provider does not throw', async () => {
  const seen = [];
  const turned = await runClaudeRounds({
    request: { messages: [{ role: 'user', content: 'צור משימה' }] },
    call: async payload => {
      seen.push(payload);
      return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'create_personal_task', input: { title: 'בדיקה' } }] };
    },
  });
  assert.equal(seen.length, 1);
  assert.equal(turned.reply, PROPOSAL_LINE);
  assert.equal(settleWorkerTurn(turned).reply, PROPOSAL_LINE);
  assert.throws(() => settleWorkerTurn({ reply: '', proposals: [] }), { code: 'agent-unavailable' });
});

test('a read tool gets one tool_result round and the answer is the model text', async () => {
  const seen = [];
  const turned = await runClaudeRounds({
    request: { messages: [{ role: 'user', content: 'מה ביומן?' }] },
    context: { events: [{ date: '2026-12-01', title: 'התנדבות', grade: 'י', category: 'חברתי' }] },
    call: async payload => {
      seen.push(payload);
      if (seen.length === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'read_calendar', input: { from: '2026-12-01', to: '2026-12-02', grade: 'י' } }] };
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'יש התנדבות ב-1.12.' }] };
    },
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].messages.at(-1).content[0].type, 'tool_result');
  assert.match(seen[1].messages.at(-1).content[0].content, /התנדבות/);
  assert.equal(turned.reply, 'יש התנדבות ב-1.12.');
});

test('permission keys cannot add a tool the server did not grant', () => {
  const held = ['tasks.create'];
  const offered = offeredCapabilityKeys(held, ['tasks.create', 'attendance_view', 'calendar.view']);
  assert.deepEqual(offered, ['tasks.create']);
  const body = buildClaudeRequest({ profile, messages: [{ role: 'user', content: 'מה הנוכחות?' }], heldKeys: offered });
  const names = body.tools.map(tool => tool.name);
  assert.equal(names.includes('read_attendance'), false);
  assert.equal(names.includes('read_calendar'), false);
  assert.equal(names.includes('create_personal_task'), true);
});
