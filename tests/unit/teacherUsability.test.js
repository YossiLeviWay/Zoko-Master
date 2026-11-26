import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardTasks, dashboardTaskStats } from '../../src/utils/dashboardTasks.js';
import { classForLesson, teacherDashboardWidgets } from '../../src/utils/dashboardWidgets.js';
import { permissionLabel, permissionScopeLabel } from '../../src/utils/permissionLabels.js';
import { zokiBlocks, zokiInline } from '../../src/utils/zokiDisplayText.js';

test('a shared open task counts on the teacher home, not only a direct assignment', () => {
  const tasks = dashboardTasks(
    [],
    [{ id: 'trip', title: 'טיול פתיחת שנה', status: 'todo', scope: 'team', assigneeTeamId: 't1' }],
  );
  assert.equal(dashboardTaskStats(tasks, '2026-11-26').pending, 1);
  assert.equal(dashboardTaskStats([{ id: 'done', status: 'done' }], '2026-11-26').pending, 0);
});

test('the teacher home starts with today, urgent work, and the week', () => {
  assert.deepEqual(teacherDashboardWidgets().map(widget => widget.type), ['today_schedule', 'my_tasks', 'week_schedule']);
  const classes = [{ id: 'c1', teacherId: 'me', gradeLevel: 'י', status: 'active' }];
  assert.equal(classForLesson({ audience: { grade: 'י' } }, classes, 'me').id, 'c1');
  assert.equal(classForLesson({ classId: 'c1' }, classes, 'other').id, 'c1');
});

test('permission preview uses Hebrew names', () => {
  assert.equal(permissionLabel('staff.view'), 'צפייה באנשי צוות');
  assert.equal(permissionLabel('not.a.real.key'), 'הרשאה');
  assert.equal(permissionScopeLabel({ type: 'classes' }), 'כיתות שנבחרו');
  assert.equal(permissionScopeLabel('school'), 'כל המוסד');
});

test('Zoki markdown becomes text instead of literal stars', () => {
  const parts = zokiInline('**שלום** כיתה');
  assert.deepEqual(parts, [{ strong: 'שלום' }, { text: ' כיתה' }]);
  assert.equal(parts.some(part => String(part.text || '').includes('**')), false);
  assert.equal(zokiBlocks('- אחד\n- שתיים')[0].type, 'list');
});
