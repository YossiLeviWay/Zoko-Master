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
