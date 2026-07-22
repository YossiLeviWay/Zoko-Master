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

test('viewer reads only assigned tasks and cannot edit tasks or students', async () => {
  await seedFirestore({
    'users/viewer_a': user({ schoolId: SCHOOL_A, permissions: { students_view: true } }),
    [`schools/${SCHOOL_A}`]: { name: 'A' },
    [`schools/${SCHOOL_A}/tasks/assigned`]: { assigneeType: 'individual', assigneeIds: ['viewer_a'] },
    [`schools/${SCHOOL_A}/tasks/private`]: { assigneeType: 'individual', assigneeIds: ['someone_else'] },
    [`schools/${SCHOOL_A}/students/student_1`]: { className: '1A' },
  });
  const db = context('viewer_a').firestore();
  await assertSucceeds(getDoc(doc(db, `schools/${SCHOOL_A}/tasks/assigned`)));
  await assertFails(getDoc(doc(db, `schools/${SCHOOL_A}/tasks/private`)));
  await assertFails(updateDoc(doc(db, `schools/${SCHOOL_A}/tasks/assigned`), { status: 'done' }));
  await assertFails(updateDoc(doc(db, `schools/${SCHOOL_A}/students/student_1`), { className: '2B' }));
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
