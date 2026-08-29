import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeZokiConversationState } from '../../src/utils/zokiConversation.js';

test('Zoki restores conversation text without replaying stale interactive actions', () => {
  const state = normalizeZokiConversationState({
    messages: [{
      id: 'old-action', role: 'zoki', text: 'מצאתי את המשימה.',
      actionProposal: { type: 'task_details_update', changedFields: 'invalid-old-shape' },
      sources: 'invalid-old-shape',
    }],
    pendingTask: { proposal: { title: 'משימה' } },
  });
  assert.deepEqual(state.messages, [{ id: 'old-action', role: 'zoki', text: 'מצאתי את המשימה.' }]);
  assert.equal(state.pendingTask.proposal.title, 'משימה');
});

test('Zoki rejects malformed persisted conversation containers', () => {
  assert.equal(normalizeZokiConversationState(null), null);
  assert.equal(normalizeZokiConversationState({ messages: 'not-an-array' }), null);
});
