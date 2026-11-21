import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, normalizeWidget, filterTasks, filterEvents, hasFilters, widgetTitle, DEFAULT_LIMIT } from '../../src/utils/dashboardWidgets.js';

const tasks = [
  { id: 'a', title: 'א', teamId: 't1', priority: 'high', dueDate: '2026-11-20', assigneeIds: ['u1'] },
  { id: 'b', title: 'ב', assigneeTeamId: 't2', priority: 'low', dueDate: '2026-11-25', assigneeIds: ['u2'], participantIds: ['u1'] },
  { id: 'c', title: 'ג', teamId: 't1', dueDate: '2026-12-30', createdBy: 'u3' },
  { id: 'd', title: 'ד' },
];
const ids = list => list.map(task => task.id);
const today = '2026-11-21';

test('bad or hostile config is normalised to safe defaults', () => {
  const c = normalizeConfig({ limit: 999, priority: 'urgent', due: 'x', title: '  '.padEnd(200, 'א'), categories: ['x', 'x', 5, ''] });
  assert.equal(c.limit, DEFAULT_LIMIT);
  assert.equal(c.priority, '');
  assert.equal(c.due, 'all');
  assert.ok(c.title.length <= 60);
  assert.deepEqual(c.categories, ['x']);
  assert.equal(normalizeWidget({ type: 'my_tasks', size: 'weird' }).size, 'full');
  assert.equal(normalizeWidget(null), null);
});
test('tasks can be filtered by team, by staff member, by priority and by due window', () => {
  assert.deepEqual(ids(filterTasks(tasks, { teamId: 't1' }, today)), ['a', 'c']);
  assert.deepEqual(ids(filterTasks(tasks, { teamId: 't2' }, today)), ['b']);
  assert.deepEqual(ids(filterTasks(tasks, { staffId: 'u1' }, today)), ['a', 'b']);
  assert.deepEqual(ids(filterTasks(tasks, { staffId: 'u3' }, today)), ['c']);
  assert.deepEqual(ids(filterTasks(tasks, { priority: 'high' }, today)), ['a']);
  assert.deepEqual(ids(filterTasks(tasks, { priority: 'medium' }, today)), ['c', 'd']);
  assert.deepEqual(ids(filterTasks(tasks, { due: 'overdue' }, today)), ['a']);
  assert.deepEqual(ids(filterTasks(tasks, { due: 'week' }, today)), ['b']);
  assert.deepEqual(ids(filterTasks(tasks, { due: 'today' }, '2026-11-20')), ['a']);
  assert.deepEqual(ids(filterTasks(tasks, { teamId: 't1', staffId: 'u1' }, today)), ['a']);
  assert.deepEqual(ids(filterTasks(tasks, {}, today)), ['a', 'b', 'c', 'd']);
});
test('events filter by category and titles can be customised', () => {
  const events = [{ id: 1, category: 'מבחנים' }, { id: 2, category: 'טיולים' }, { id: 3 }];
  assert.deepEqual(filterEvents(events, { categories: ['מבחנים'] }).map(e => e.id), [1]);
  assert.equal(filterEvents(events, {}).length, 3);
  assert.equal(hasFilters({}), false);
  assert.equal(hasFilters({ teamId: 't1' }), true);
  assert.equal(widgetTitle({ config: { title: 'המבחנים שלי' } }, 'ברירת מחדל'), 'המבחנים שלי');
  assert.equal(widgetTitle({}, 'ברירת מחדל'), 'ברירת מחדל');
});
