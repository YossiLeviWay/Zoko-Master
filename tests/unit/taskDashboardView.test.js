import test from 'node:test';
import assert from 'node:assert/strict';
import {
  belongsToTaskView,
  overdueDayCount,
  taskDateBucket,
  TASK_GROUP_ORDER,
} from '../../src/utils/taskDashboardView.js';

test('team tasks never appear in the personal work view', () => {
  const task = { scope: 'team', assigneeType: 'team', createdBy: 'user-a', assigneeIds: ['user-a'] };
  assert.equal(belongsToTaskView(task, 'mine', 'user-a'), false);
  assert.equal(belongsToTaskView(task, 'teams', 'user-a'), true);
});

test('institution-visible tasks stay out of the personal view and appear with team work', () => {
  const task = { scope: 'institution', assigneeType: 'all_school', createdBy: 'manager' };
  assert.equal(belongsToTaskView(task, 'mine', 'teacher'), false);
  assert.equal(belongsToTaskView(task, 'teams', 'teacher'), true);
});

test('personal and individually assigned work appears under mine', () => {
  assert.equal(belongsToTaskView({ _source: 'personal', scope: 'personal' }, 'mine', 'user-a'), true);
  assert.equal(belongsToTaskView({ scope: 'assigned', assigneeIds: ['user-a'] }, 'mine', 'user-a'), true);
  assert.equal(belongsToTaskView({ scope: 'assigned', assigneeIds: ['user-b'] }, 'mine', 'user-a'), false);
});

test('date buckets preserve the required work order', () => {
  const today = '2026-08-02';
  assert.deepEqual(TASK_GROUP_ORDER, ['overdue', 'today', 'upcoming', 'no_date', 'completed']);
  assert.equal(taskDateBucket({ dueDate: '2026-08-01' }, today), 'overdue');
  assert.equal(taskDateBucket({ dueDate: today }, today), 'today');
  assert.equal(taskDateBucket({ dueDate: '2026-08-03' }, today), 'upcoming');
  assert.equal(taskDateBucket({}, today), 'no_date');
  assert.equal(taskDateBucket({ dueDate: today }, today, true), 'completed');
  assert.equal(overdueDayCount({ dueDate: '2026-07-29' }, today), 4);
});
