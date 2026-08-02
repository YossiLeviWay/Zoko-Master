import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReminderDraft,
  normalizeCommunicationDraft,
} from '../../src/services/firestore/communicationRepository.js';

test('communication draft becomes a task-compatible shared follow-up', () => {
  const draft = normalizeCommunicationDraft({
    id: 'draft_1',
    taskId: 'task_1',
    trackingId: 'MAIL-draft_1',
    subject: 'עדכון ספק',
    summary: 'ממתינים לאישור',
    to: ['vendor@example.com'],
    communicationStatus: 'awaiting_reply',
    followUpAssigneeId: 'staff_2',
    linkedContextType: 'team',
    linkedContextId: 'team_1',
    linkedContextLabel: 'צוות תפעול',
  });

  assert.equal(draft.id, 'task_1');
  assert.equal(draft.communicationDraftId, 'draft_1');
  assert.equal(draft._source, 'communication');
  assert.equal(draft.followUpAssigneeId, 'staff_2');
  assert.equal(draft.status, 'todo');
});

test('manual reminder draft keeps recipients and uses a bounded deterministic template', () => {
  const gentle = buildReminderDraft({
    subject: 'תיאום הובלה',
    to: ['vendor@example.com'],
    cc: ['office@example.com'],
  }, 'gentle');
  const direct = buildReminderDraft({
    subject: 'תיאום הובלה',
    to: ['vendor@example.com'],
  }, 'direct');

  assert.equal(gentle.subject, 'תזכורת: תיאום הובלה');
  assert.deepEqual(gentle.to, ['vendor@example.com']);
  assert.match(gentle.body, /להזכיר בעדינות/);
  assert.match(direct.body, /טרם התקבל מענה/);
});
