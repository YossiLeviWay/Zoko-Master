import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { presetProfile, cleanAccessProfile } from '../../functions/src/accessCatalog.js';
import { RESOURCE_ACTIONS } from '../../functions/src/resourceActions.js';
let env;
const school = 'school_a';
const baseUser = { schoolId: school, schoolIds: [school], role: 'viewer', accountStatus: 'active', permissions: {}, teamIds: [], classIds: [] };
const classData = { schoolId: school, name: 'י 1', teacherId: 'teacher', staffIds: [], status: 'active', createdBy: 'manager' };
const studentData = { schoolId: school, classId: 'class_a', fullName: 'Test Student', status: 'active' };
async function seed(data) { await env.withSecurityRulesDisabled(async context => { await Promise.all(Object.entries(data).map(([path, value]) => setDoc(doc(context.firestore(), path), value))); }); }
function policy(actions, denied = false) {
  return { configured: true, ...Object.fromEntries(RESOURCE_ACTIONS.map(action => [action, { allowedUsers: actions.includes(action) && !denied ? ['teacher'] : [], allowedTeams: [], allowedRoles: [], allowedClasses: [], deniedUsers: denied ? ['teacher'] : [], deniedTeams: [], deniedRoles: [], deniedClasses: [] }])) };
}
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-zoko-security', firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } }); });
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seed({ 'users/teacher': { ...baseUser, uid: 'teacher', accessProfilesBySchool: { [school]: presetProfile('teacher') } }, 'users/manager': { ...baseUser, uid: 'manager', role: 'principal' }, [`schools/${school}/classes/class_a`]: classData, [`schools/${school}/students/student_a`]: studentData }); });
test('homeroom follows class assignment, never grants another school or sensitive identity', async () => {
  await seed({ 'users/teacher': { ...baseUser, uid: 'teacher', accessProfilesBySchool: { [school]: presetProfile('homeroom') } }, [`schools/${school}/students/student_a/sensitive/identity`]: { value: 'secret', schoolId: school } });
  const db = env.authenticatedContext('teacher').firestore();
  await assertSucceeds(getDoc(doc(db, `schools/${school}/students/student_a`)));
  await assertFails(getDoc(doc(db, `schools/${school}/students/student_a/sensitive/identity`)));
  await seed({ [`schools/${school}/classes/class_a`]: { ...classData, teacherId: 'other' } });
  await assertFails(getDoc(doc(db, `schools/${school}/students/student_a`)));
});
test('professional teacher cannot use class membership to read student files', async () => {
  const db = env.authenticatedContext('teacher').firestore();
  await assertFails(getDoc(doc(db, `schools/${school}/students/student_a`)));
  await assertFails(updateDoc(doc(db, 'users/teacher'), { accessProfilesBySchool: { [school]: presetProfile('homeroom') } }));
});
test('shared mapping reads its own data without opening student records or another mapping', async () => {
  await seed({
    [`schools/${school}/gradebooks/mapping_a`]: { schoolId: school, classId: 'class_a', subjects: [] },
    [`schools/${school}/gradebooks/mapping_b`]: { schoolId: school, classId: 'class_a', subjects: [] },
    [`schools/${school}/files/gradebook_mapping_a`]: { schoolId: school, classId: 'class_a', gradebookId: 'mapping_a', fileType: 'gradebook' },
    [`schools/${school}/gradebooks/mapping_a/grades/student_a`]: { schoolId: school, classId: 'class_a', studentId: 'student_a', scores: {} },
    [`schools/${school}/resourceAclPolicies/file_gradebook_mapping_a`]: policy(['view']),
  });
  const db = env.authenticatedContext('teacher').firestore();
  await assertSucceeds(getDoc(doc(db, `schools/${school}/gradebooks/mapping_a`)));
  await assertSucceeds(getDoc(doc(db, `schools/${school}/gradebooks/mapping_a/grades/student_a`)));
  await assertFails(getDoc(doc(db, `schools/${school}/gradebooks/mapping_b`)));
  await assertFails(getDoc(doc(db, `schools/${school}/students/student_a`)));
});
test('creation grants do not edit existing files; edit-only shares do not create siblings', async () => {
  const profile = presetProfile('teacher'); profile.school['files.create'] = true; profile.school.files_upload = true;
  await seed({ 'users/teacher': { ...baseUser, accessProfilesBySchool: { [school]: cleanAccessProfile(profile) } }, [`schools/${school}/files/existing`]: { schoolId: school, name: 'Existing', fileType: 'document', folderId: '' }, [`schools/${school}/resourceAclPolicies/folder_shared`]: policy(['view', 'edit']) });
  const db = env.authenticatedContext('teacher').firestore();
  await assertSucceeds(setDoc(doc(db, `schools/${school}/files/new`), { schoolId: school, name: 'New', fileType: 'document', folderId: '' }));
  await assertFails(updateDoc(doc(db, `schools/${school}/files/existing`), { name: 'Changed' }));
  await assertFails(setDoc(doc(db, `schools/${school}/files/sibling`), { schoolId: school, name: 'Sibling', fileType: 'document', folderId: 'shared' }));
});
test('explicit deny blocks a broader personal profile while principal retains protected access', async () => {
  const profile = presetProfile('leadership'); profile.school['files.edit'] = true;
  await seed({ 'users/teacher': { ...baseUser, accessProfilesBySchool: { [school]: profile } }, [`schools/${school}/files/private`]: { name: 'Private', schoolId: school, fileType: 'document', folderId: '' }, [`schools/${school}/resourceAclPolicies/file_private`]: policy([], true) });
  await assertFails(updateDoc(doc(env.authenticatedContext('teacher').firestore(), `schools/${school}/files/private`), { name: 'Changed' }));
  await assertSucceeds(getDoc(doc(env.authenticatedContext('manager').firestore(), `schools/${school}/files/private`)));
  assert.equal(profile.school['roles.assign'], undefined);
});

test('calendar create and edit are independent in nested and legacy collections; neither deletes', async () => {
  const db = env.authenticatedContext('teacher').firestore();
  for (const prefix of [`schools/${school}/events`, `events_${school}`]) {
    const profile = presetProfile('teacher'); profile.school['calendar.create'] = true;
    await seed({ 'users/teacher': { ...baseUser, accessProfilesBySchool: { [school]: profile } } });
    const ref = doc(db, `${prefix}/event_a`);
    await assertSucceeds(setDoc(ref, { schoolId: school, title: 'Event', fileType: 'event' }));
    await assertFails(updateDoc(ref, { title: 'Changed' }));
    await assertFails(deleteDoc(ref));
    delete profile.school['calendar.create']; profile.school['calendar.edit'] = true;
    await seed({ 'users/teacher': { ...baseUser, accessProfilesBySchool: { [school]: profile } } });
    await assertSucceeds(updateDoc(ref, { title: 'Changed' }));
    await assertFails(setDoc(doc(db, `${prefix}/event_b`), { schoolId: school, title: 'New', fileType: 'event' }));
    await assertFails(deleteDoc(ref));
  }
});
test('mapping create-only and edit-only shares enforce independent score writes', async () => {
  const root = `schools/${school}`;
  await seed({ [`${root}/gradebooks/mapping_a`]: { schoolId: school, classId: 'class_a', subjects: [] }, [`${root}/files/gradebook_mapping_a`]: { schoolId: school, classId: 'class_a', gradebookId: 'mapping_a', fileType: 'gradebook' }, [`${root}/resourceAclPolicies/file_gradebook_mapping_a`]: policy(['view', 'create']) });
  const db = env.authenticatedContext('teacher').firestore();
  const ref = doc(db, `${root}/gradebooks/mapping_a/grades/student_a`);
  const row = { schoolId: school, gradebookId: 'mapping_a', classId: 'class_a', studentId: 'student_a', displayName: 'Test', scores: {}, calculated: {}, updatedBy: 'teacher' };
  await assertSucceeds(setDoc(ref, row));
  await assertFails(updateDoc(ref, { scores: { math: 80 } }));
  await seed({ [`${root}/resourceAclPolicies/file_gradebook_mapping_a`]: policy(['view', 'edit']), [`${root}/students/student_b`]: studentData });
  await assertSucceeds(updateDoc(ref, { scores: { math: 90 } }));
  await assertFails(setDoc(doc(db, `${root}/gradebooks/mapping_a/grades/student_b`), { ...row, studentId: 'student_b' }));
  await assertFails(deleteDoc(ref));
});
