import test from 'node:test';
import assert from 'node:assert/strict';
import {
  legacyInitiativeToUnifiedTask,
  normalizeTaskSteps,
} from '../../src/utils/unifiedTaskModel.js';

test('a task without steps remains a valid simple task', () => {
  assert.deepEqual(normalizeTaskSteps({ id: 'task_1', title: 'משימה פשוטה' }), []);
});
test('stored steps keep optional dates, people, dependency and order', () => {
  const steps = normalizeTaskSteps({
    workPlanSteps: [
      { id: 'second', title: 'שלב שני', order: 2, dependencyStepId: 'first' },
      { id: 'first', title: 'שלב ראשון', dueDate: '2026-10-01', responsibleIds: ['staff_1'], order: 1 },
    ],
  });
  assert.deepEqual(steps.map(step => step.id), ['first', 'second']);
  assert.equal(steps[0].dueDate, '2026-10-01');
  assert.deepEqual(steps[0].responsibleIds, ['staff_1']);
  assert.equal(steps[1].dependencyStepId, 'first');
});

test('legacy initiative is adapted read-only without changing or duplicating source data', () => {
  const initiative = Object.freeze({ id: 'initiative_1', title: 'טיול שנתי', ownerId: 'owner_1', memberIds: ['partner_1'], endDate: '2027-05-01' });
  const milestones = Object.freeze([
    Object.freeze({ id: 'milestone_1', title: 'אישורי הורים', ownerId: 'owner_1', startDate: '2027-04-01', status: 'in_progress', order: 1 }),
  ]);
  const adapted = legacyInitiativeToUnifiedTask(initiative, milestones);
  assert.equal(adapted._source, 'legacy_initiative');
  assert.equal(adapted.title, 'טיול שנתי');
  assert.equal(adapted.dueDate, '2027-05-01');
  assert.equal(adapted.workPlanSteps.length, 1);
  assert.equal(adapted.workPlanSteps[0].title, 'אישורי הורים');
  assert.equal(adapted.legacyInitiative, initiative);
  assert.equal(Object.hasOwn(initiative, 'workPlanSteps'), false);
});

test('legacy subtasks are exposed as compatible steps without persistence changes', () => {
  const steps = normalizeTaskSteps({ subtasks: ['בדיקה', 'אישור'] });
  assert.deepEqual(steps.map(step => step.title), ['בדיקה', 'אישור']);
  assert.equal(steps.every(step => step._legacySubtask), true);
});
