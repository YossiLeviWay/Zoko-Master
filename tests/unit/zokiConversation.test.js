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

test('Zoki keeps a safe in-chat role selection while a task workflow is active', () => {
  const state = normalizeZokiConversationState({
    messages: [{
      id: 'zoki_task_123',
      role: 'zoki',
      text: 'בחרו אחראי למשימה.',
      actionStatus: 'pending',
      actionProposal: {
        type: 'task_role_selection',
        workflowId: 'task_123',
        targetLabel: 'רכז פדגוגי',
        selectedStaffId: 'teacher_1',
        canAssignRole: true,
        roleMissing: false,
        options: [{ id: 'teacher_1', name: 'דגנית כהן', jobTitle: 'רכזת פדגוגית' }],
        ignored: 'must not persist',
      },
    }],
  });

  assert.deepEqual(state.messages[0].actionProposal, {
    type: 'task_role_selection',
    workflowId: 'task_123',
    targetLabel: 'רכז פדגוגי',
    selectedStaffId: 'teacher_1',
    canAssignRole: true,
    roleMissing: false,
    options: [{ id: 'teacher_1', name: 'דגנית כהן', jobTitle: 'רכזת פדגוגית' }],
  });
  assert.equal(state.messages[0].actionStatus, 'pending');
});
