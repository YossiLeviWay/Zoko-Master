import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareZokiAction } from '../../src/utils/zokiActions.js';
import { runZokiAction } from '../../src/services/zokiActionRunner.js';

test('Zoki can propose a dashboard widget and undo restores the previous layout', async () => {
  const card = prepareZokiAction(
    { tool: 'set_dashboard_layout', input: { op: 'add', type: 'today_schedule', size: 'half' } },
    { permissions: { 'tasks.viewOwn': true }, actorId: 'teacher' },
  );
  assert.equal(card.allowed, true);
  assert.match(card.lines.join(' '), /דשבורד: add/);
  let saved = null;
  const outcome = await runZokiAction(card, { schoolId: 'school', actor: { uid: 'teacher' } }, {
    getDashboard: async () => [{ type: 'my_tasks', size: 'full', config: {} }],
    saveDashboard: async (_uid, widgets) => { saved = widgets; },
  });
  assert.equal(outcome.saved, true);
  assert.equal(saved.at(-1).type, 'today_schedule');
  let restored = null;
  await runZokiAction(outcome.undo, { schoolId: 'school', actor: { uid: 'teacher' } }, {
    getDashboard: async () => saved,
    saveDashboard: async (_uid, widgets) => { restored = widgets; },
  });
  assert.deepEqual(restored.map(widget => widget.type), ['my_tasks']);
});
