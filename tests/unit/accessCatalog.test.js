import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_DEFINITIONS, presetProfile, profileGrants, permissionPatch, profileChanges } from '../../functions/src/accessCatalog.js';
import { DIRECT_PERMISSION_DEFINITIONS } from '../../functions/src/permissionCatalog.js';
import { aclActions, aclHasAction } from '../../functions/src/resourceActions.js';
import { evaluatePermission } from '../../functions/src/services/permissionEngine.js';
import { accessProfileSchema } from '../../functions/src/validation/accessProfile.js';

test('all existing capabilities remain represented exactly once', () => {
  assert.deepEqual(new Set(ACCESS_DEFINITIONS.map(item => item.key)), new Set(DIRECT_PERMISSION_DEFINITIONS.map(item => item.key)));
  assert.equal(new Set(ACCESS_DEFINITIONS.map(item => item.key)).size, ACCESS_DEFINITIONS.length);
});
test('teacher and leadership start without broad student, file or delegation access', () => {
  for (const id of ['teacher', 'leadership']) {
    const profile = presetProfile(id);
    assert.equal(profile.school['files.view'], undefined);
    assert.equal(profile.school['students.view'], undefined);
    assert.equal(profile.school['roles.assign'], undefined);
    assert.equal(profile.school['tasks.create'], true);
    assert.equal(accessProfileSchema.safeParse(profile).success, true);
  }
});
test('homeroom follows verified active assignments and does not expose sensitive data', () => {
  const profile = presetProfile('homeroom');
  const classes = [{ id: 'a', teacherId: 'u' }, { id: 'b', teacherId: 'v', staffIds: ['u'] }, { id: 'c', teacherId: 'u', status: 'archived' }];
  const grants = profileGrants(profile, classes, 'u');
  assert.deepEqual(grants.find(item => item.capability === 'students.view').scope.classIds, ['a']);
  assert.equal(grants.some(item => item.capability === 'personalFile.view'), false);
  assert.equal(grants.some(item => item.capability === 'students.viewSensitiveFields'), false);
  assert.equal(profileGrants(profile, [], 'u').some(item => item.capability === 'students.view'), false);
  classes[0].teacherId = 'v';
  assert.equal(profileGrants(profile, classes, 'u').some(item => item.capability === 'students.view'), false);
});
test('explicit class overrides are personal and aliases remain synchronized', () => {
  const a = presetProfile('teacher'), b = presetProfile('teacher');
  a.classes.x = permissionPatch('students.update', true);
  assert.equal(a.classes.x.students_update, true);
  assert.deepEqual(b.classes, {});
  assert.equal(profileChanges(a, a).added.length, 0);
  assert.ok(profileChanges(b, a).added.length > 0);
});
test('new resource actions keep create, edit and delete independent', () => {
  const add = { accessLevel: 'manage', actions: ['view', 'create'] };
  assert.equal(aclHasAction(add, 'create'), true);
  assert.equal(aclHasAction(add, 'edit'), false);
  assert.equal(aclHasAction(add, 'delete'), false);
  assert.equal(aclHasAction({ actions: ['view', 'edit'] }, 'create'), false);
  assert.deepEqual(aclActions({ accessLevel: 'edit' }), ['view', 'comment', 'create', 'edit']);
});
test('a configured share blocks broader capability grants and explicit denies win', () => {
  const context = { schoolId: 's', subject: { uid: 'u', schoolIds: ['s'], roleIds: [], teamIds: [], classIds: [] }, capabilityGrants: [{ capability: 'files.edit', scope: { type: 'school' } }], resourceAcls: [{ resourceType: 'file', resourceId: 'f', principalType: 'user', principalId: 'u', actions: ['view', 'create'] }] };
  const request = { capability: 'files.edit', resourceType: 'file', resourceId: 'f', accessLevel: 'edit' };
  assert.equal(evaluatePermission(context, request).allowed, false);
  assert.equal(evaluatePermission(context, { ...request, accessLevel: 'create' }).allowed, true);
  context.resourceAcls[0].explicitDeny = true;
  assert.equal(evaluatePermission(context, { ...request, accessLevel: 'view' }).allowed, false);
});
test('school profile validation rejects forum shortcuts and unrecognized capabilities', () => {
  const profile = presetProfile('teacher');
  profile.school['forum.access'] = true;
  assert.equal(accessProfileSchema.safeParse(profile).success, false);
  delete profile.school['forum.access'];
  profile.school['unknown.grant'] = true;
  assert.equal(accessProfileSchema.safeParse(profile).success, false);
});
