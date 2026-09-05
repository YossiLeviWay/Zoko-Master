import test from 'node:test';
import assert from 'node:assert/strict';
import { proposalWithRoleHolder, resolveTaskRoleTarget } from '../../src/utils/zokiTaskWorkflow.js';

const role = { id: 'pedagogy', name: 'רכז פדגוגי', aliases: ['רכז הוראה'] };

test('task workflow resolves a configured role from broad request wording', () => {
  const result = resolveTaskRoleTarget({
    request: 'אפשר לדאוג שמישהו מהפדגוגיה יכין את הלוח?',
    targetLabel: 'רכז הוראה',
    roles: [role],
    staff: [{ id: 'teacher1', fullName: 'סאמי סלאמה', customRoleIds: ['pedagogy'] }],
    schoolId: 'school1',
  });
  assert.equal(result.status, 'resolved');
  assert.equal(result.holders[0].id, 'teacher1');
});

test('task workflow distinguishes an unassigned role from a missing role', () => {
  assert.equal(resolveTaskRoleTarget({ request: 'משימה לרכז הפדגוגי', roles: [role], staff: [], schoolId: 'school1' }).status, 'unassigned_role');
  assert.equal(resolveTaskRoleTarget({ request: 'משימה לרכז חדשנות', targetLabel: 'רכז חדשנות', roles: [role], staff: [], schoolId: 'school1' }).status, 'role_missing');
});

test('selected role holder becomes the concrete task assignee', () => {
  const proposal = proposalWithRoleHolder({ title: 'לוח מבחנים', taskType: 'personal', assignmentPlan: {} }, { id: 'teacher1', fullName: 'סאמי סלאמה', jobTitle: 'רכז פדגוגי' });
  assert.equal(proposal.taskType, 'assigned');
  assert.deepEqual(proposal.assigneeSuggestions, ['סאמי סלאמה']);
  assert.equal(proposal.assignmentPlan.responsible[0].id, 'teacher1');
});
