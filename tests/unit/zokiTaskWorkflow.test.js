import test from 'node:test';
import assert from 'node:assert/strict';
import { proposalWithRoleHolder, resolveTaskRoleTarget, taskCreationSourceForContext } from '../../src/utils/zokiTaskWorkflow.js';

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

test('task workflow recognizes a legacy job title when no custom role exists', () => {
  const result = resolveTaskRoleTarget({
    request: 'צור משימה עבור הרכז הפדגוגי להכנת לוח מבחנים',
    targetLabel: 'הרכז הפדגוגי להכנת לוח מבחנים',
    roles: [],
    staff: [
      { id: 'pedagogy1', fullName: 'דגנית בן חיים', jobTitle: 'רכז פדגוגית וחברתית' },
      { id: 'trips1', fullName: 'אורפז חן', jobTitle: 'רכז ביטחון וטיולים' },
    ],
    schoolId: 'school1',
  });
  assert.equal(result.status, 'resolved');
  assert.equal(result.holders[0].id, 'pedagogy1');
});

test('selected role holder becomes the only concrete task assignee', () => {
  const proposal = proposalWithRoleHolder({
    title: 'לוח מבחנים',
    taskType: 'personal',
    assignmentPlan: {
      partners: [{ id: 'partner1', name: 'שותף כללי', source: 'staff' }],
      informed: [{ id: 'viewer1', name: 'לעדכון כללי', source: 'staff' }],
    },
  }, { id: 'teacher1', fullName: 'סאמי סלאמה', jobTitle: 'רכז פדגוגי' });
  assert.equal(proposal.taskType, 'assigned');
  assert.deepEqual(proposal.assigneeSuggestions, ['סאמי סלאמה']);
  assert.equal(proposal.assignmentPlan.responsible[0].id, 'teacher1');
  assert.deepEqual(proposal.assignmentPlan.partners, []);
  assert.deepEqual(proposal.assignmentPlan.informed, []);
});

test('a Zoki workflow stays agent-created even when the free AI provider has no session id', () => {
  assert.equal(taskCreationSourceForContext({ creationSource: 'agent', sessionId: '' }), 'agent');
  assert.equal(taskCreationSourceForContext({ sessionId: 'session_1' }), 'agent');
  assert.equal(taskCreationSourceForContext({}), 'manual');
});
