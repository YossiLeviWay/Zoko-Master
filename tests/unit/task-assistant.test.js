import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskAssistantInput,
  findHolidayConflict,
  inferTaskTeamSuggestion,
  normalizeTaskAssistantProposal,
  proposalToTaskForm,
  redactTaskAssistantInput,
  resolveRelativeTaskDate,
  resolveTaskAssistantProposal,
} from '../../src/utils/taskAssistant.js';

test('task assistant normalizes a detailed proposal and drops unknown fields', () => {
  const proposal = normalizeTaskAssistantProposal({
    title: ' טיול שנתי ',
    taskType: 'team',
    priority: 'normal',
    dueDate: '2026-10-18',
    subtasks: ['אישורי הורים', 'הזמנת אוטובוס'],
    injectedPermission: 'global_admin',
  });
  assert.equal(proposal.title, 'טיול שנתי');
  assert.equal(proposal.priority, 'medium');
  assert.deepEqual(proposal.subtasks, ['אישורי הורים', 'הזמנת אוטובוס']);
  assert.equal(Object.hasOwn(proposal, 'injectedPermission'), false);
});

test('task assistant redacts contact details and refuses sensitive student content', () => {
  const cleaned = redactTaskAssistantInput('שלחו עדכון ל-050-123-4567 ול-test@example.com');
  assert.equal(cleaned.safe, true);
  assert.equal(cleaned.text.includes('050-123-4567'), false);
  assert.equal(cleaned.text.includes('test@example.com'), false);
  assert.equal(redactTaskAssistantInput('צריך לטפל בציונים של תלמיד').safe, false);
  assert.equal(redactTaskAssistantInput('צריך להקים צוות לטיפול בציונים ובהערכה').safe, true);
});

test('task assistant matches a unique staff first name without exposing other records', () => {
  const resolved = resolveTaskAssistantProposal({
    proposal: { title: 'בדיקה', taskType: 'assigned', assigneeSuggestions: ['לינה'] },
    staff: [{ id: 'staff-lina', fullName: 'לינה כהן' }, { id: 'staff-david', fullName: 'דוד לוי' }],
    canAssign: true,
  });
  assert.equal(resolved.assignee.id, 'staff-lina');
  assert.deepEqual(resolved.unresolvedAssigneeSuggestions, []);
});

test('trip language selects an existing trips team even without an explicit team suggestion', () => {
  const resolved = resolveTaskAssistantProposal({
    proposal: { title: 'הכנת הטיול', taskType: 'personal', assigneeSuggestions: ['לינה'] },
    request: 'צריך לקדם את הטיול השנתי ולקבוע מקומות לינה',
    staff: [{ id: 'staff-lina', fullName: 'לינה כהן' }],
    teams: [{ id: 'trips-team', name: 'טיולים וסיורים', memberIds: [] }],
    canAssign: true,
    canCreateTeam: true,
  });
  assert.equal(inferTaskTeamSuggestion('צריך לקדם טיולים'), 'צוות טיולים');
  assert.equal(resolved.taskType, 'team');
  assert.equal(resolved.team.id, 'trips-team');
  assert.equal(resolved.assignee, null);
  assert.deepEqual(resolved.unresolvedAssigneeSuggestions, []);
  assert.equal(resolved.proposedTeam, null);
});

test('task assistant proposes an approved team creation with matched named staff', () => {
  const resolved = resolveTaskAssistantProposal({
    proposal: {
      title: 'מיפוי ציונים',
      taskType: 'team',
      teamSuggestions: ['צוות ציונים'],
      assigneeSuggestions: ['מאיה', 'אורי'],
    },
    request: 'מאיה ואורי יכינו מיפוי ציונים',
    staff: [{ id: 'maya', fullName: 'מאיה לוי' }, { id: 'uri', fullName: 'אורי כהן' }],
    teams: [],
    canAssign: true,
    canCreateTeam: true,
  });
  assert.equal(resolved.proposedTeam.name, 'צוות ציונים');
  assert.deepEqual(resolved.proposedTeam.memberIds, ['maya', 'uri']);
});

test('task assistant detects named staff missing from an existing relevant team', () => {
  const resolved = resolveTaskAssistantProposal({
    proposal: { title: 'ציונים', taskType: 'team', teamSuggestions: ['ציונים'], assigneeSuggestions: ['מאיה'] },
    staff: [{ id: 'maya', fullName: 'מאיה לוי' }],
    teams: [{ id: 'grades', name: 'צוות ציונים', memberIds: [] }],
    canAssign: true,
    canCreateTeam: true,
  });
  assert.equal(resolved.team.id, 'grades');
  assert.deepEqual(resolved.missingTeamMembers.map(member => member.id), ['maya']);
});

test('task assistant builds a bounded prompt with only minimized institutional context', () => {
  const payload = JSON.parse(buildTaskAssistantInput({
    request: 'צריך להכין ישיבת צוות עד יום ראשון הבא',
    organizationContext: {
      domain: 'טיולים',
      matchingTeamLabels: ['צוות טיולים'],
      staff: [{ id: 'secret', fullName: 'שם פרטי' }],
      identityNumber: '123456789',
    },
  }));
  assert.equal(payload.request.includes('ישיבת צוות'), true);
  assert.deepEqual(Object.keys(payload).sort(), ['answer', 'currentProposal', 'organizationContext', 'request', 'today']);
  assert.deepEqual(payload.organizationContext.matchingTeamLabels, ['צוות טיולים']);
  assert.equal(Object.hasOwn(payload.organizationContext, 'staff'), false);
  assert.equal(JSON.stringify(payload).includes('123456789'), false);
});

test('relative dates are resolved locally before saving', () => {
  assert.equal(resolveRelativeTaskDate('צריך לסיים מחר', new Date(2026, 7, 2)), '2026-08-03');
  assert.equal(resolveRelativeTaskDate('עד יום ראשון הבא', new Date(2026, 7, 2)), '2026-08-09');
});

test('local resolution only links records supplied by the authorized client context', () => {
  const resolved = resolveTaskAssistantProposal({
    proposal: { title: 'טיול', taskType: 'team', teamSuggestions: ['צוות טיולים'], assigneeSuggestions: ['אדם זר'] },
    teams: [{ id: 'team-1', name: 'צוות טיולים' }],
    staff: [{ id: 'staff-1', fullName: 'שרון לוי' }],
    canAssign: true,
  });
  assert.equal(resolved.team.id, 'team-1');
  assert.equal(resolved.assignee, null);
  assert.equal(resolved.taskType, 'team');
});

test('unauthorized task types are downgraded locally before the form is shown', () => {
  const resolved = resolveTaskAssistantProposal({ proposal: { title: 'תכנית', taskType: 'initiative' } });
  const form = proposalToTaskForm(resolved, { scope: 'personal', assigneeIds: [], teamId: '' });
  assert.equal(resolved.taskType, 'personal');
  assert.equal(form.creationKind, 'task');
  assert.equal(form.scope, 'personal');
});

test('holiday conflicts are detected without allowing the model to decide official dates', () => {
  const conflict = findHolidayConflict('2026-10-01', [{ id: 'holiday-1', name: 'חופשה', startDate: '2026-09-30', endDate: '2026-10-02' }]);
  assert.equal(conflict.id, 'holiday-1');
  assert.equal(findHolidayConflict('2026-10-03', [conflict]), null);
});
