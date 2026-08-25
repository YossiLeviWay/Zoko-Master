import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_TASK_SORTS,
  dashboardTaskStats,
  sortDashboardTasks,
} from '../../src/utils/dashboardTasks.js';

const tasks = [
  { id: 'late-low', status: 'todo', priority: 'low', dueDate: '2026-08-20' },
  { id: 'urgent-later', status: 'todo', priority: 'high', dueDate: '2026-08-30' },
  { id: 'urgent-sooner', status: 'in_progress', priority: 'high', dueDate: '2026-08-27' },
  { id: 'complete', status: 'done', priority: 'high', dueDate: '2026-08-19' },
];

test('dashboard task order follows the user priority preference with due-date tie breaking', () => {
  assert.deepEqual(
    sortDashboardTasks(tasks, DASHBOARD_TASK_SORTS.PRIORITY).map(task => task.id),
    ['urgent-sooner', 'urgent-later', 'late-low'],
  );
});

test('dashboard task order follows the user due-date preference and hides completed work', () => {
  assert.deepEqual(
    sortDashboardTasks(tasks, DASHBOARD_TASK_SORTS.DUE_DATE).map(task => task.id),
    ['late-low', 'urgent-sooner', 'urgent-later'],
  );
});

test('dashboard task counters are calculated from the current user task set', () => {
  assert.deepEqual(dashboardTaskStats(tasks, '2026-08-25'), {
    total: 4,
    pending: 3,
    completed: 1,
    overdue: 1,
  });
});
