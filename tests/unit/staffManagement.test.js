import test from 'node:test';
import assert from 'node:assert/strict';
import { staffMutation, staffSchoolIds, schoolJobTitle, canManageStaffMember, zokiStaffFields } from '../../src/utils/staffManagement.js';
import { normalizeSemanticResult } from '../../src/utils/zokiSemanticTurn.js';

test('school membership union and scoped titles preserve primary and other institutions', () => {
  const target = { schoolId: 'a', schoolIds: ['b'], jobTitle: 'מורה', jobTitlesBySchool: { b: 'רכז' } };
  assert.deepEqual(staffSchoolIds(target), ['a', 'b']);
  assert.equal(schoolJobTitle(target, 'b'), 'רכז');
  assert.deepEqual(staffMutation(target, 'a', 'jobTitle', 'רכזת פדגוגית'), { jobTitlesBySchool: { a: 'רכזת פדגוגית', b: 'רכז' } });
  assert.equal(staffMutation(target, 'a', 'remove').schoolId, 'b');
  assert.throws(() => staffMutation(target, 'a', 'jobTitle', ' '));
});
test('management is institutional and cannot target self or another manager', () => {
  const actor = { uid: 'a', role: 'principal', schoolId: 's' };
  const target = { uid: 'b', role: 'viewer', schoolId: 's' };
  assert.ok(canManageStaffMember(actor, target, 's'));
  for (const next of [actor, { ...target, role: 'principal' }, { ...target, schoolId: 'other' }, { ...target, rolesBySchool: { s: 'institution_manager' } }]) assert.equal(canManageStaffMember(actor, next, 's'), false);
});
test('Zoki job title proposal requires an exact authorized staff source', () => {
  const proposal = { answer: 'הצעה לאישור', actionIntent: 'update_staff_role', sourceIds: ['users/test'], staffRoleDraft: { sourceId: 'users/test', jobTitle: 'רכזת פדגוגית וחברתית' } };
  const input = { authorizedSources: [{ id: 'users/test' }] };
  assert.equal(normalizeSemanticResult(proposal, input).staffRoleDraft.jobTitle, proposal.staffRoleDraft.jobTitle);
  assert.throws(() => normalizeSemanticResult(proposal, { authorizedSources: [] }));
  assert.throws(() => normalizeSemanticResult({ ...proposal, staffRoleDraft: { sourceId: 'users/other', jobTitle: 'רכז' } }, input));
});

test('Zoki catalog omits private fields and rejects foreign or inactive school profiles', () => {
  const staff = { schoolIds: ['a'], fullName: 'מורה בדיקה', jobTitle: 'רכזת פדגוגית וחברתית', email: 'private@example.test', phone: 'private', jobTitlesBySchool: { b: 'private other title' } };
  assert.deepEqual(zokiStaffFields(staff, 'a'), { fullName: staff.fullName, jobTitle: staff.jobTitle });
  assert.equal(zokiStaffFields(staff, 'b'), null);
  assert.equal(zokiStaffFields({ ...staff, accountStatus: 'disabled' }, 'a'), null);
});
