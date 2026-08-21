import test from 'node:test';
import assert from 'node:assert/strict';
import { localTaskAgentProposal, validateTaskAgentProposal } from '../src/services/taskAgentContext.js';
import { normalizedTaskIntent, taskDomain, taskPatternId } from '../src/services/taskLearning.js';

const context = {
  capabilities: { canAssign: true, collaborationMode: 'assign' },
  staff: [
    { id: 'pedagogy', name: 'נועה', jobTitle: 'רכזת פדגוגית' },
    { id: 'home_8a', name: 'דנה', jobTitle: 'מחנכת ח׳1' },
    { id: 'home_8b', name: 'רון', jobTitle: 'מחנך ח׳2' },
    { id: 'unrelated', name: 'אורי', jobTitle: 'מנהל תחזוקה' },
  ],
  teams: [{ id: 'ped_team', name: 'צוות פדגוגי' }],
  classes: [{ id: '8a', name: 'ח׳1', homeroomTeacherIds: ['home_8a'] }, { id: '8b', name: 'ח׳2', homeroomTeacherIds: ['home_8b'] }],
  patterns: [],
  personalProfile: {},
};

test('exam cold start suggests pedagogical lead and relevant homeroom teachers', () => {
  const proposal = localTaskAgentProposal('הכנת מבחנים לשכבת ח׳', context);
  assert.deepEqual(proposal.assignmentPlan.responsible.map(item => item.id), ['pedagogy']);
  assert.deepEqual(proposal.assignmentPlan.partners.map(item => item.id), ['home_8a', 'home_8b']);
  assert.equal(proposal.assignmentPlan.partners.some(item => item.id === 'unrelated'), false);
  assert.ok(proposal.workPlanSteps.length >= 3);
});

test('proposal validation drops people and teams outside server context', () => {
  const proposal = validateTaskAgentProposal({
    assignmentPlan: { responsible: [{ id: 'foreign', name: 'זר', source: 'staff' }, { id: 'pedagogy', name: 'מזויף', source: 'staff' }] },
    workPlanSteps: [{ title: 'שלב', suggestedParties: [{ id: 'foreign-team', name: 'זר', source: 'team' }] }],
  }, context);
  assert.deepEqual(proposal.assignmentPlan.responsible, [{ id: 'pedagogy', name: 'נועה', jobTitle: 'רכזת פדגוגית', source: 'staff' }]);
  assert.deepEqual(proposal.workPlanSteps[0].suggestedParties, []);
});

test('learning signatures are normalized, stable and domain aware', () => {
  const first = { title: 'הכנת מבחנים לשכבת ח׳' };
  const second = { title: 'לשכבת ח׳ — הכנת מבחנים!' };
  assert.equal(taskDomain(first), 'exams');
  assert.equal(normalizedTaskIntent(first), normalizedTaskIntent(second));
  assert.equal(taskPatternId(first), taskPatternId(second));
});
