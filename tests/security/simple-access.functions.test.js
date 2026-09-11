import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { adminDb } from '../../functions/src/services/firebaseAdmin.js';
import { getAccessConfigurationHandler, saveAccessConfigurationHandler, getOwnAccessClassesHandler } from '../../functions/src/callables/accessConfiguration.js';
import { getSharedGradebookContextHandler } from '../../functions/src/callables/sharedGradebook.js';
import { rebuildAclPolicy } from '../../functions/src/callables/permissions.js';
import { presetProfile } from '../../functions/src/accessCatalog.js';
const request = (uid, data) => ({ auth: { uid, token: {} }, data });
const common = { schoolId: 'school_a', schoolIds: ['school_a'], role: 'viewer', accountStatus: 'active', permissions: {} };
beforeEach(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Local emulator required');
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-zoko-security/databases/(default)/documents`, { method: 'DELETE' });
  assert.ok(response.ok);
  await Promise.all([
    adminDb.doc('users/manager').set({ ...common, uid: 'manager', role: 'principal' }),
    adminDb.doc('users/teacher').set({ ...common, uid: 'teacher', permissions: { calendar_view: true }, accessProfilesBySchool: { school_b: presetProfile('teacher') } }),
    adminDb.doc('schools/school_a').set({ name: 'School', status: 'active' }),
    adminDb.doc('schools/school_a/classes/class_a').set({ teacherId: 'teacher', staffIds: [], status: 'active', schoolId: 'school_a', name: 'Class A' }),
  ]);
});
test('opening configuration makes no writes; one save preserves unrelated data and school profiles', async () => {
  const before = (await adminDb.doc('users/teacher').get()).data();
  const configuration = await getAccessConfigurationHandler(request('manager', { schoolId: 'school_a', userId: 'teacher' }));
  assert.deepEqual((await adminDb.doc('users/teacher').get()).data(), before);
  assert.equal(configuration.revision, 0);
  await saveAccessConfigurationHandler(request('manager', { schoolId: 'school_a', userId: 'teacher', revision: 0, profile: presetProfile('homeroom') }));
  const after = (await adminDb.doc('users/teacher').get()).data();
  assert.deepEqual(after.permissions, before.permissions);
  assert.deepEqual(after.accessProfilesBySchool.school_b, before.accessProfilesBySchool.school_b);
  assert.equal(after.accessProfilesBySchool.school_a.presetId, 'homeroom');
  await assert.rejects(saveAccessConfigurationHandler(request('manager', { schoolId: 'school_a', userId: 'teacher', revision: 0, profile: presetProfile('teacher') })), error => error.code === 'aborted');
});
test('self-escalation, cross-school updates and protected-manager changes are rejected', async () => {
  const data = { schoolId: 'school_a', userId: 'teacher', revision: 0, profile: presetProfile('homeroom') };
  await assert.rejects(saveAccessConfigurationHandler(request('teacher', data)), error => error.code === 'permission-denied');
  await assert.rejects(saveAccessConfigurationHandler(request('manager', { ...data, schoolId: 'school_b' })), error => error.code === 'permission-denied');
  await assert.rejects(saveAccessConfigurationHandler(request('manager', { ...data, userId: 'manager' })), error => error.code === 'permission-denied');
});
test('sharing a mapping returns only minimal roster and independent actions', async () => {
  await adminDb.doc('users/teacher').update({ accessProfilesBySchool: { school_a: presetProfile('teacher') } });
  await Promise.all([
    adminDb.doc('schools/school_a/gradebooks/map_a').set({ schoolId: 'school_a', classId: 'class_a' }),
    adminDb.doc('schools/school_a/files/gradebook_map_a').set({ schoolId: 'school_a', classId: 'class_a', gradebookId: 'map_a', fileType: 'gradebook' }),
    adminDb.doc('schools/school_a/students/student_a').set({ schoolId: 'school_a', classId: 'class_a', fullName: 'Student A', phone: 'hidden', note: 'hidden', status: 'active' }),
    adminDb.doc('schools/school_a/resourceAcls/share_a').set({ resourceType: 'file', resourceId: 'gradebook_map_a', principalType: 'user', principalId: 'teacher', actions: ['view', 'create'], accessLevel: 'view', active: true }),
  ]);
  const result = await getSharedGradebookContextHandler(request('teacher', { schoolId: 'school_a', gradebookId: 'map_a' }));
  assert.deepEqual(result.students, [{ id: 'student_a', fullName: 'Student A', classId: 'class_a' }]);
  assert.equal(result.canCreate, true); assert.equal(result.canEdit, false); assert.equal(result.canManage, false);
});
test('noninheritable shares stay local and revoking the last modern share remains restricted', async () => {
  const acl = adminDb.doc('schools/school_a/resourceAcls/folder_share');
  await acl.set({ resourceType: 'folder', resourceId: 'folder_a', principalType: 'user', principalId: 'teacher', actions: ['view', 'edit'], inherit: false, active: true });
  await rebuildAclPolicy('school_a', 'folder', 'folder_a');
  let policy = (await adminDb.doc('schools/school_a/resourceAclPolicies/folder_folder_a').get()).data();
  assert.deepEqual(policy.edit.allowedUsers, ['teacher']); assert.deepEqual(policy.inherit_edit.allowedUsers, []);
  await acl.update({ active: false }); await rebuildAclPolicy('school_a', 'folder', 'folder_a');
  policy = (await adminDb.doc('schools/school_a/resourceAclPolicies/folder_folder_a').get()).data();
  assert.equal(policy.configured, true); assert.deepEqual(policy.view.allowedUsers, []);
});

test('legacy class assignments resolve, but a current nested removal takes precedence', async () => {
  await adminDb.doc('classes_school_a/legacy_class').set({ schoolId: 'school_a', teacherId: 'teacher', name: 'Legacy class', status: 'active' });
  let result = await getOwnAccessClassesHandler(request('teacher', { schoolId: 'school_a' }));
  assert.ok(result.classes.some(item => item.id === 'legacy_class'));
  await adminDb.doc('schools/school_a/classes/legacy_class').set({ schoolId: 'school_a', teacherId: 'someone_else', status: 'active' });
  result = await getOwnAccessClassesHandler(request('teacher', { schoolId: 'school_a' }));
  assert.equal(result.classes.some(item => item.id === 'legacy_class'), false);
  await assert.rejects(getOwnAccessClassesHandler(request('teacher', { schoolId: 'school_b' })), error => error.code === 'permission-denied');
});
