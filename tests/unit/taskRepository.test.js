import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOrganizationTask,
  normalizePersonalTask,
  taskDueDate,
} from '../../src/services/firestore/taskRepository.js';

test('legacy organization tasks are normalized into render-safe values', () => {
  const task = normalizeOrganizationTask({
    id: 'legacy_1',
    title: { unexpected: 'object' },
    name: 'Legacy title',
    description: { unexpected: 'object' },
    assigneeIds: 'not-an-array',
    participantIds: ['user_a', null, 7],
    pinnedBy: null,
    tags: ['tag', { invalid: true }],
    dueAt: { toDate: () => new Date('2026-07-25T10:00:00.000Z') },
  }, 'legacy');

  assert.equal(task.title, 'Legacy title');
  assert.equal(task.description, '');
  assert.deepEqual(task.assigneeIds, []);
  assert.deepEqual(task.participantIds, ['user_a', '7']);
  assert.deepEqual(task.tags, ['tag']);
  assert.equal(taskDueDate(task), '2026-07-25');
  assert.equal(task._storageMode, 'legacy');
});

test('personal task normalization keeps private scope and safe defaults', () => {
  const task = normalizePersonalTask({ id: 'personal_1', title: 42, status: null });
  assert.equal(task.title, '42');
  assert.equal(task.status, 'todo');
  assert.equal(task.scope, 'personal');
  assert.deepEqual(task.assigneeIds, []);
});

test('email follow-up fields survive personal task normalization', () => {
  const task = normalizePersonalTask({
    id: 'mail_follow_up',
    title: 'מעקב מייל',
    workflowType: 'external_email_followup',
    communicationStatus: 'awaiting_send',
    communicationDraftId: 'draft_1',
    communicationTrackingId: 'MAIL-draft_1',
    nextFollowUpAt: '2026-08-04',
    linkedContextType: 'student',
    linkedContextId: 'student_1',
    linkedContextLabel: 'תלמיד א',
    communicationSubject: 'עדכון',
    externalRecipientLabel: 'parent@example.com',
  });
  assert.equal(task.workflowType, 'external_email_followup');
  assert.equal(task.communicationStatus, 'awaiting_send');
  assert.equal(task.communicationDraftId, 'draft_1');
  assert.equal(task.nextFollowUpAt, '2026-08-04');
  assert.equal(task.linkedContextType, 'student');
  assert.equal(task.linkedContextLabel, 'תלמיד א');
  assert.equal(task.externalRecipientLabel, 'parent@example.com');
});

test('existing task normalization keeps optional initiative links without creating another task', () => {
  const task = normalizeOrganizationTask({
    id: 'linked_1', title: 'Linked', initiativeId: 'initiative_1', milestoneId: 'milestone_1',
  });
  assert.equal(task.id, 'linked_1');
  assert.equal(task.initiativeId, 'initiative_1');
  assert.equal(task.milestoneId, 'milestone_1');
  assert.equal(task._key, 'organization:nested:linked_1');
});

test('unified task steps preserve optional scheduling and responsibility fields', () => {
  const task = normalizeOrganizationTask({
    id: 'task_steps',
    title: 'טיול',
    workPlanSteps: [{
      id: 'permissions',
      title: 'אישורי הורים',
      dueDate: '2027-04-01',
      status: 'in_progress',
      responsibleIds: ['staff_a'],
      teamId: '',
      dependencyStepId: 'route',
      order: 2,
    }],
  });
  assert.equal(task.workPlanSteps[0].dueDate, '2027-04-01');
  assert.equal(task.workPlanSteps[0].status, 'in_progress');
  assert.deepEqual(task.workPlanSteps[0].responsibleIds, ['staff_a']);
  assert.equal(task.workPlanSteps[0].dependencyStepId, 'route');
  assert.equal(task.workPlanSteps[0].order, 2);
});
