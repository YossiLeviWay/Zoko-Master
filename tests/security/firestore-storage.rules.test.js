import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

const PROJECT_ID = 'demo-zoko-security';
const SCHOOL_A = 'school_a';
const SCHOOL_B = 'school_b';
let environment;

function context(uid, token = {}) {
  return environment.authenticatedContext(uid, token);
}

async function seedFirestore(documents) {
  await environment.withSecurityRulesDisabled(async disabled => {
    const db = disabled.firestore();
    await Promise.all(Object.entries(documents).map(([path, data]) => setDoc(doc(db, path), data)));
  });
}

function user({ schoolId, role = 'viewer', permissions = {}, teamIds = [], status = 'active' }) {
  return {
    uid: `user_${schoolId}_${role}`,
    schoolId,
    schoolIds: [schoolId],
    role,
    permissions,
    teamIds,
    accountStatus: status,
  };
}

before(async () => {
  const [firestoreRules, storageRules] = await Promise.all([
    readFile(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    readFile(new URL('../../storage.rules', import.meta.url), 'utf8'),
  ]);
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: firestoreRules, host: '127.0.0.1', port: 8080 },
    storage: { rules: storageRules, host: '127.0.0.1', port: 9199 },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
});

after(async () => {
  await environment.cleanup();
});

test('unauthenticated users cannot read Firestore data', async () => {
  await seedFirestore({ [`schools/${SCHOOL_A}`]: { name: 'A' } });
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'schools', SCHOOL_A)));
});

test('assigned user reads a task and may change only completion fields', async () => {
  await seedFirestore({
    'users/viewer_a': user({ schoolId: SCHOOL_A, permissions: { students_view: true } }),
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    [`schools/${SCHOOL_A}`]: { name: 'A' },
    [`schools/${SCHOOL_A}/tasks/assigned`]: {
      scope: 'assigned', schoolId: SCHOOL_A, createdBy: 'creator_a',
      assigneeType: 'individual', assigneeIds: ['viewer_a'], status: 'todo',
    },
    [`schools/${SCHOOL_A}/tasks/private`]: { assigneeType: 'individual', assigneeIds: ['someone_else'] },
    [`schools/${SCHOOL_A}/students/student_1`]: { className: '1A' },
  });
  const db = context('viewer_a').firestore();
  await assertSucceeds(getDoc(doc(db, `schools/${SCHOOL_A}/tasks/assigned`)));
  await assertSucceeds(getDoc(doc(context('principal_a').firestore(), `schools/${SCHOOL_A}/tasks/assigned`)));
  await assertFails(getDoc(doc(db, `schools/${SCHOOL_A}/tasks/private`)));
  await assertSucceeds(updateDoc(doc(db, `schools/${SCHOOL_A}/tasks/assigned`), {
    status: 'done', completedAt: 'server-value', updatedAt: 'server-value',
  }));
  await assertFails(updateDoc(doc(db, `schools/${SCHOOL_A}/tasks/assigned`), { title: 'Taken over' }));
  await assertFails(updateDoc(doc(db, `schools/${SCHOOL_A}/tasks/assigned`), { createdBy: 'viewer_a' }));
  await assertFails(updateDoc(doc(db, `schools/${SCHOOL_A}/students/student_1`), { className: '2B' }));
});

test('personal task can be created, read, updated and deleted only by its owner', async () => {
  await seedFirestore({
    'users/owner_a': user({ schoolId: SCHOOL_A }),
    'users/peer_a': user({ schoolId: SCHOOL_A }),
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    'users/global_admin': user({ schoolId: SCHOOL_A, role: 'global_admin' }),
    'users/member_b': user({ schoolId: SCHOOL_B }),
  });
  const ownerDb = context('owner_a').firestore();
  const taskRef = doc(ownerDb, 'users/owner_a/personalTasks/personal_1');
  const personalTask = {
    scope: 'personal', schoolId: SCHOOL_A, ownerId: 'owner_a', createdBy: 'owner_a',
    title: 'Private', status: 'todo', assigneeIds: [], teamId: '', assigneeTeamId: '',
  };

  await assertSucceeds(setDoc(taskRef, personalTask));
  await assertSucceeds(getDoc(taskRef));
  await assertSucceeds(updateDoc(taskRef, { title: 'Updated', updatedAt: 'server-value' }));
  await assertFails(getDoc(doc(context('peer_a').firestore(), 'users/owner_a/personalTasks/personal_1')));
  await assertFails(getDoc(doc(context('principal_a').firestore(), 'users/owner_a/personalTasks/personal_1')));
  await assertFails(getDoc(doc(context('global_admin', { global_admin: true }).firestore(), 'users/owner_a/personalTasks/personal_1')));
  await assertFails(getDoc(doc(context('member_b').firestore(), 'users/owner_a/personalTasks/personal_1')));
  await assertFails(updateDoc(taskRef, { ownerId: 'peer_a' }));
  await assertFails(updateDoc(taskRef, { schoolId: SCHOOL_B }));
  await assertSucceeds(deleteDoc(taskRef));
});

test('a user cannot create a personal task for another user or another school', async () => {
  await seedFirestore({
    'users/owner_a': user({ schoolId: SCHOOL_A }),
    'users/peer_a': user({ schoolId: SCHOOL_A }),
  });
  const ownerDb = context('owner_a').firestore();
  const base = {
    scope: 'personal', schoolId: SCHOOL_A, ownerId: 'owner_a', createdBy: 'owner_a',
    title: 'Private', status: 'todo', assigneeIds: [], teamId: '', assigneeTeamId: '',
  };
  await assertFails(setDoc(doc(ownerDb, 'users/peer_a/personalTasks/invalid_owner'), base));
  await assertFails(setDoc(doc(ownerDb, 'users/owner_a/personalTasks/invalid_school'), {
    ...base, schoolId: SCHOOL_B,
  }));
  await assertFails(setDoc(doc(ownerDb, `schools/${SCHOOL_A}/tasks/personal_in_school`), base));
});

test('only an authorized same-school user can assign a task to one person', async () => {
  await seedFirestore({
    'users/assigner_a': user({ schoolId: SCHOOL_A, permissions: { tasks_assign: true } }),
    'users/viewer_a': user({ schoolId: SCHOOL_A }),
    'users/viewer_b': user({ schoolId: SCHOOL_B }),
  });
  const assignedTask = {
    scope: 'assigned', schoolId: SCHOOL_A, createdBy: 'assigner_a', title: 'Assigned',
    status: 'todo', assigneeType: 'individual', assigneeIds: ['viewer_a'],
    teamId: '', assigneeTeamId: '',
  };
  await assertSucceeds(setDoc(
    doc(context('assigner_a').firestore(), `schools/${SCHOOL_A}/tasks/assigned_1`),
    assignedTask,
  ));
  await assertFails(setDoc(
    doc(context('viewer_a').firestore(), `schools/${SCHOOL_A}/tasks/assigned_2`),
    { ...assignedTask, createdBy: 'viewer_a' },
  ));
  await assertFails(setDoc(
    doc(context('assigner_a').firestore(), `schools/${SCHOOL_A}/tasks/cross_school`),
    { ...assignedTask, assigneeIds: ['viewer_b'] },
  ));
});

test('legacy team tasks remain visible to their team and private from other schools', async () => {
  await seedFirestore({
    'users/member_a': user({ schoolId: SCHOOL_A, teamIds: ['team_a'] }),
    'users/other_team_a': user({ schoolId: SCHOOL_A, teamIds: ['team_other'] }),
    'users/member_b': user({ schoolId: SCHOOL_B, teamIds: ['team_a'] }),
    [`schools/${SCHOOL_A}/tasks/legacy_team`]: {
      assigneeType: 'team', assigneeTeamId: 'team_a', title: 'Existing task', status: 'todo',
    },
  });
  const taskPath = `schools/${SCHOOL_A}/tasks/legacy_team`;
  await assertSucceeds(getDoc(doc(context('member_a').firestore(), taskPath)));
  await assertFails(getDoc(doc(context('other_team_a').firestore(), taskPath)));
  await assertFails(getDoc(doc(context('member_b').firestore(), taskPath)));
});

test('legacy task collection enforces assigned visibility and immutable tenant fields', async () => {
  await seedFirestore({
    'users/assigner_a': user({ schoolId: SCHOOL_A, permissions: { tasks_assign: true } }),
    'users/member_a': user({ schoolId: SCHOOL_A }),
    'users/peer_a': user({ schoolId: SCHOOL_A }),
  });
  const assignerDb = context('assigner_a').firestore();
  const legacyRef = doc(assignerDb, `tasks_${SCHOOL_A}/assigned_legacy`);
  await assertSucceeds(setDoc(legacyRef, {
    scope: 'assigned', schoolId: SCHOOL_A, createdBy: 'assigner_a', title: 'Legacy path',
    status: 'todo', assigneeType: 'individual', assigneeIds: ['member_a'],
    teamId: '', assigneeTeamId: '',
  }));
  await assertSucceeds(getDoc(doc(context('member_a').firestore(), `tasks_${SCHOOL_A}/assigned_legacy`)));
  await assertFails(getDoc(doc(context('peer_a').firestore(), `tasks_${SCHOOL_A}/assigned_legacy`)));
  await assertFails(updateDoc(
    doc(context('member_a').firestore(), `tasks_${SCHOOL_A}/assigned_legacy`),
    { schoolId: SCHOOL_B },
  ));
});

test('editor cannot change user permissions', async () => {
  await seedFirestore({
    'users/editor_a': user({ schoolId: SCHOOL_A, role: 'editor' }),
    'users/viewer_a': user({ schoolId: SCHOOL_A }),
  });
  const db = context('editor_a').firestore();
  await assertFails(updateDoc(doc(db, 'users/viewer_a'), { permissions: { students_edit: true } }));
});

test('principal cannot change another school or grant global admin from the client', async () => {
  await seedFirestore({
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    'users/viewer_b': user({ schoolId: SCHOOL_B }),
    [`schools/${SCHOOL_B}`]: { name: 'B' },
  });
  const db = context('principal_a').firestore();
  await assertFails(updateDoc(doc(db, 'schools', SCHOOL_B), { name: 'Changed' }));
  await assertFails(updateDoc(doc(db, 'users/viewer_b'), { role: 'global_admin' }));
});

test('users cannot change their own role or school memberships', async () => {
  await seedFirestore({ 'users/viewer_a': user({ schoolId: SCHOOL_A }) });
  const profile = doc(context('viewer_a').firestore(), 'users/viewer_a');
  await assertFails(updateDoc(profile, { role: 'editor' }));
  await assertFails(updateDoc(profile, { schoolIds: [SCHOOL_A, SCHOOL_B] }));
  await assertSucceeds(updateDoc(profile, { fullName: 'Safe profile field' }));
});

test('users cannot create or retain password fields in Firestore', async () => {
  await seedFirestore({ 'users/viewer_a': user({ schoolId: SCHOOL_A }) });
  const db = context('viewer_a').firestore();
  await assertFails(updateDoc(doc(db, 'users/viewer_a'), { _authPassword: 'not-a-real-secret' }));
  await assertFails(addDoc(collection(db, 'users'), {
    ...user({ schoolId: SCHOOL_A }),
    _pendingPassword: 'not-a-real-secret',
  }));
});

test('school A user cannot read school B student data', async () => {
  await seedFirestore({
    'users/editor_a': user({
      schoolId: SCHOOL_A,
      role: 'editor',
      permissions: { students_view: true },
    }),
    [`schools/${SCHOOL_B}/students/student_1`]: { className: '1A' },
  });
  const db = context('editor_a').firestore();
  await assertFails(getDoc(doc(db, `schools/${SCHOOL_B}/students/student_1`)));
});

test('global admin needs the dedicated claim to read student data', async () => {
  await seedFirestore({
    'users/global_admin': user({ schoolId: SCHOOL_A, role: 'global_admin' }),
    [`schools/${SCHOOL_B}/students/student_1`]: { className: '1A' },
  });
  const withoutStudentClaim = context('global_admin', { global_admin: true }).firestore();
  const withStudentClaim = context('global_admin', {
    global_admin: true,
    student_data_access: true,
  }).firestore();
  await assertFails(getDoc(doc(withoutStudentClaim, `schools/${SCHOOL_B}/students/student_1`)));
  await assertSucceeds(getDoc(doc(withStudentClaim, `schools/${SCHOOL_B}/students/student_1`)));
});

test('only conversation participants read messages', async () => {
  await seedFirestore({
    'users/member_a': user({ schoolId: SCHOOL_A }),
    'users/member_b': user({ schoolId: SCHOOL_A }),
    'users/outsider_a': user({ schoolId: SCHOOL_A }),
    'conversations/conversation_1': {
      schoolId: SCHOOL_A,
      participants: ['member_a', 'member_b'],
    },
    'conversations/conversation_1/messages/message_1': { senderId: 'member_a', text: 'private' },
  });
  await assertSucceeds(getDoc(doc(
    context('member_a').firestore(),
    'conversations/conversation_1/messages/message_1',
  )));
  await assertFails(getDoc(doc(
    context('outsider_a').firestore(),
    'conversations/conversation_1/messages/message_1',
  )));
});

test('conversation cannot be created with a user from another school', async () => {
  await seedFirestore({
    'users/member_a': user({ schoolId: SCHOOL_A }),
    'users/member_b': user({ schoolId: SCHOOL_B }),
  });
  await assertFails(setDoc(doc(context('member_a').firestore(), 'conversations/new_conversation'), {
    schoolId: SCHOOL_A,
    participants: ['member_a', 'member_b'],
  }));
});

test('only a notification recipient can read or update it and clients cannot create one', async () => {
  await seedFirestore({
    'users/member_a': user({ schoolId: SCHOOL_A }),
    'users/member_b': user({ schoolId: SCHOOL_A }),
    'notifications/notification_1': { userId: 'member_a', schoolId: SCHOOL_A, read: false },
  });
  const recipientDb = context('member_a').firestore();
  const otherDb = context('member_b').firestore();
  await assertSucceeds(getDoc(doc(recipientDb, 'notifications/notification_1')));
  await assertSucceeds(updateDoc(doc(recipientDb, 'notifications/notification_1'), { read: true }));
  await assertFails(getDoc(doc(otherDb, 'notifications/notification_1')));
  await assertFails(addDoc(collection(recipientDb, 'notifications'), {
    userId: 'member_a',
    read: false,
  }));
});

test('audit logs are immutable to clients', async () => {
  await seedFirestore({
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    'auditLogs/log_1': { schoolId: SCHOOL_A, actorUid: 'server' },
  });
  const db = context('principal_a').firestore();
  await assertSucceeds(getDoc(doc(db, 'auditLogs/log_1')));
  await assertFails(deleteDoc(doc(db, 'auditLogs/log_1')));
  await assertFails(setDoc(doc(db, 'auditLogs/log_2'), { schoolId: SCHOOL_A }));
});

test('storage files are isolated by school and validate type', async () => {
  await seedFirestore({
    'users/uploader_a': user({ schoolId: SCHOOL_A, permissions: { files_upload: true } }),
    'users/member_b': user({ schoolId: SCHOOL_B }),
  });
  const storageA = context('uploader_a').storage();
  const storageB = context('member_b').storage();
  const safePath = `schools/${SCHOOL_A}/files/file_1/document.pdf`;
  await assertSucceeds(uploadBytes(
    ref(storageA, safePath),
    new Uint8Array([37, 80, 68, 70]),
    { contentType: 'application/pdf' },
  ));
  await assertFails(getBytes(ref(storageB, safePath)));
  await assertFails(uploadBytes(
    ref(storageA, `schools/${SCHOOL_A}/files/file_2/payload.html`),
    new TextEncoder().encode('<script>unsafe</script>'),
    { contentType: 'text/html' },
  ));
  assert.ok(true);
});
