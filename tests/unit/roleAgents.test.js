import test from 'node:test';
import assert from 'node:assert/strict';
import { eventAudience } from '../../functions/src/eventAudience.js';
import { ROLE_AGENT_PROFILES, roleAgentProfile, allowedTools } from '../../functions/src/roleAgents.js';
import { presetProfile } from '../../functions/src/accessCatalog.js';

const classes = [{ id: 'c10', grade: 'י' }, { id: 'c11', grade: 'יא' }];
const staff = [
  { id: 'eng', roleIds: [], subjects: ['english'], teachingClassIds: ['c10', 'c11'] },
  { id: 'heb', roleIds: [], subjects: ['hebrew'], teachingClassIds: ['c10'] },
  { id: 'home10', roleIds: ['homeroom'], homeroomClassIds: ['c10'] },
  { id: 'home11', roleIds: ['homeroom'], homeroomClassIds: ['c11'] },
  { id: 'ped', roleIds: ['pedagogical_coordinator'] },
  { id: 'engCoord', roleIds: ['subject_coordinator'], subjects: ['english'] },
  { id: 'gradeJ', roleIds: ['grade_coordinator'], grades: ['י'] },
  { id: 'sec', roleIds: ['secretary'] },
];
const ids = result => result.map(item => item.id).sort();

test('a grade-10 English exam reaches only the people involved', () => {
  const result = eventAudience({ kind: 'exam', subject: 'english', grade: 'י' }, staff, classes);
  assert.deepEqual(ids(result), ['eng', 'engCoord', 'gradeJ', 'home10', 'ped']);
  assert.equal(result.find(item => item.id === 'eng').reasons.includes('subject-teacher'), true);
});
test('unrelated staff and other grades are not notified', () => {
  const result = ids(eventAudience({ kind: 'exam', subject: 'english', grade: 'י' }, staff, classes));
  for (const id of ['heb', 'home11', 'sec']) assert.equal(result.includes(id), false, id);
});
test('school-wide events reach the management team only', () => {
  const result = eventAudience({ kind: 'event', schoolWide: true }, staff, classes, { managementRoleIds: ['pedagogical_coordinator'] });
  assert.deepEqual(ids(result), ['ped']);
});
test('direct and role targeting work without class data', () => {
  assert.deepEqual(ids(eventAudience({ userIds: ['sec'], roleIds: ['homeroom'] }, staff, classes)), ['home10', 'home11', 'sec']);
});

test('every role has an agent profile with duties and reminders', () => {
  assert.ok(ROLE_AGENT_PROFILES.length >= 20);
  for (const profile of ROLE_AGENT_PROFILES) {
    assert.match(profile.systemPrompt, /אחריות/);
    assert.ok(profile.reminders.length > 0, profile.roleId);
  }
  assert.equal(roleAgentProfile('nope'), null);
});
test('an agent never offers a tool its user lacks the capability for', () => {
  const profile = roleAgentProfile('secretary');
  const held = Object.keys(presetProfile('secretary').school);
  const tools = allowedTools(profile, held);
  assert.ok(tools.includes('draft_email'));
  assert.equal(tools.includes('read_class_grades'), false);
  assert.equal(tools.includes('create_event'), false);
});
