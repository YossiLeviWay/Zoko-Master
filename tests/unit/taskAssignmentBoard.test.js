import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignedTasksForStaff,
  assignmentMutationForTask,
  isAssignmentBankTask,
} from '../../src/utils/taskAssignmentBoard.js';

test('the assignment bank includes personal and organization tasks but not communication follow-ups', () => {
  assert.equal(isAssignmentBankTask({ _source: 'personal' }), true);
  assert.equal(isAssignmentBankTask({ _source: 'organization' }), true);
  assert.equal(isAssignmentBankTask({ _source: 'organization', workflowType: 'external_email_followup' }), false);
  assert.equal(isAssignmentBankTask({ _source: 'initiative' }), false);
});

test('a first assignment converts a personal task into an assigned organization task', () => {
  assert.deepEqual(
    assignmentMutationForTask({ id: 'personal-1', _source: 'personal' }, 'teacher-1', true),
    { kind: 'convert', assignment: { scope: 'assigned', assigneeIds: ['teacher-1'] } },
  );
  assert.equal(assignmentMutationForTask({ id: 'personal-1', _source: 'personal' }, 'teacher-1', false), null);
});

test('organization assignments stay visible in every matching staff lane', () => {
  const tasks = [
    { id: 'shared', _source: 'organization', assigneeIds: ['teacher-1', 'teacher-2'] },
    { id: 'other', _source: 'organization', assigneeIds: ['teacher-3'] },
    { id: 'private', _source: 'personal', assigneeIds: ['teacher-1'] },
  ];
  assert.deepEqual(assignedTasksForStaff(tasks, 'teacher-1').map(task => task.id), ['shared']);
  assert.deepEqual(assignedTasksForStaff(tasks, 'teacher-2').map(task => task.id), ['shared']);
});
