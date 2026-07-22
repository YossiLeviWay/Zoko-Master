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
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
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

function classRecord({ teacherId = '', staffIds = [], schoolId = SCHOOL_A, name = 'Class A' } = {}) {
  return {
    name,
    normalizedName: name.toLowerCase(),
    gradeLevel: 'י׳',
    academicYear: '2026-2027',
    schoolId,
    teacherId,
    staffIds,
    trackIds: [],
    programTypes: [],
    studyDays: ['0', '1', '2', '3', '4'],
    status: 'active',
    createdBy: 'principal_a',
    updatedBy: 'principal_a',
    createdAt: 'created',
    updatedAt: 'created',
  };
}

function studentRecord({ classId = 'class_a', schoolId = SCHOOL_A, name = 'Student A' } = {}) {
  return {
    firstName: name.split(' ')[0],
    lastName: name.split(' ').slice(1).join(' '),
    fullName: name,
    schoolId,
    classId,
    className: classId === 'class_b' ? 'Class B' : 'Class A',
    gradeLevel: 'י׳',
    academicYear: '2026-2027',
    trackId: '',
    trackIds: [],
    programType: '',
    programTypes: [],
    status: 'active',
    joinedAt: '2026-09-01',
    endDate: '',
    createdBy: 'principal_a',
    updatedBy: 'principal_a',
    createdAt: 'created',
    updatedAt: 'created',
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

test('principal creates a class while class editor cannot replace its teacher without permission', async () => {
  await seedFirestore({
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    'users/class_editor': user({
      schoolId: SCHOOL_A,
      permissions: { classes_view: true, classes_update: true },
    }),
    'users/teacher_a': user({ schoolId: SCHOOL_A }),
  });
  const principalDb = context('principal_a').firestore();
  const classRef = doc(principalDb, `schools/${SCHOOL_A}/classes/class_a`);
  await assertSucceeds(setDoc(classRef, classRecord({ teacherId: 'teacher_a' })));

  const editorRef = doc(context('class_editor').firestore(), `schools/${SCHOOL_A}/classes/class_a`);
  await assertSucceeds(updateDoc(editorRef, {
    name: 'Updated Class', updatedBy: 'class_editor', updatedAt: 'later',
  }));
  await assertFails(updateDoc(editorRef, {
    teacherId: 'class_editor', updatedBy: 'class_editor', updatedAt: 'later-again',
  }));
});

test('homeroom teacher reads and edits only students in the assigned class', async () => {
  await seedFirestore({
    'users/teacher_a': user({ schoolId: SCHOOL_A }),
    'users/teacher_b': user({ schoolId: SCHOOL_A }),
    [`schools/${SCHOOL_A}/classes/class_a`]: classRecord({ teacherId: 'teacher_a' }),
    [`schools/${SCHOOL_A}/classes/class_b`]: classRecord({ teacherId: 'teacher_b', name: 'Class B' }),
    [`schools/${SCHOOL_A}/students/student_a`]: studentRecord(),
    [`schools/${SCHOOL_A}/students/student_b`]: studentRecord({ classId: 'class_b', name: 'Student B' }),
  });
  const teacherDb = context('teacher_a').firestore();
  await assertSucceeds(getDoc(doc(teacherDb, `schools/${SCHOOL_A}/classes/class_a`)));
  await assertFails(getDoc(doc(teacherDb, `schools/${SCHOOL_A}/classes/class_b`)));
  await assertSucceeds(getDoc(doc(teacherDb, `schools/${SCHOOL_A}/students/student_a`)));
  await assertFails(getDoc(doc(teacherDb, `schools/${SCHOOL_A}/students/student_b`)));
  await assertSucceeds(getDocs(query(
    collection(teacherDb, `schools/${SCHOOL_A}/classes`),
    where('teacherId', '==', 'teacher_a'),
  )));
  await assertSucceeds(getDocs(query(
    collection(teacherDb, `schools/${SCHOOL_A}/students`),
    where('classId', '==', 'class_a'),
  )));
  await assertSucceeds(updateDoc(doc(teacherDb, `schools/${SCHOOL_A}/students/student_a`), {
    fullName: 'Updated Student', updatedBy: 'teacher_a', updatedAt: 'later',
  }));
  await assertFails(updateDoc(doc(teacherDb, `schools/${SCHOOL_A}/students/student_a`), {
    classId: 'class_b', className: 'Class B', updatedBy: 'teacher_a', updatedAt: 'later',
  }));
  await assertFails(updateDoc(doc(teacherDb, `schools/${SCHOOL_A}/students/student_a`), {
    trackIds: ['track_a'], updatedBy: 'teacher_a', updatedAt: 'later',
  }));
  await assertFails(deleteDoc(doc(teacherDb, `schools/${SCHOOL_A}/students/student_a`)));
});

test('teacher creates a student only in the class they teach', async () => {
  await seedFirestore({
    'users/teacher_a': user({ schoolId: SCHOOL_A }),
    'users/teacher_b': user({ schoolId: SCHOOL_A }),
    [`schools/${SCHOOL_A}/classes/class_a`]: classRecord({ teacherId: 'teacher_a' }),
    [`schools/${SCHOOL_A}/classes/class_b`]: classRecord({ teacherId: 'teacher_b', name: 'Class B' }),
  });
  const db = context('teacher_a').firestore();
  const batch = writeBatch(db);
  batch.set(
    doc(db, `schools/${SCHOOL_A}/students/student_a`),
    { ...studentRecord(), createdBy: 'teacher_a', updatedBy: 'teacher_a' },
  );
  batch.set(doc(db, `schools/${SCHOOL_A}/students/student_a/history/created`), {
    type: 'student_created', schoolId: SCHOOL_A, studentId: 'student_a',
    nextClassId: 'class_a', createdBy: 'teacher_a',
  });
  await assertSucceeds(batch.commit());
  await assertFails(setDoc(
    doc(db, `schools/${SCHOOL_A}/students/student_b`),
    { ...studentRecord({ classId: 'class_b' }), createdBy: 'teacher_a', updatedBy: 'teacher_a' },
  ));
});

test('student transfer and archive permissions are granular and tenant fields stay immutable', async () => {
  await seedFirestore({
    'users/transfer_a': user({ schoolId: SCHOOL_A, permissions: { students_transfer_class: true } }),
    'users/archive_a': user({ schoolId: SCHOOL_A, permissions: { students_archive: true } }),
    [`schools/${SCHOOL_A}/classes/class_a`]: classRecord(),
    [`schools/${SCHOOL_A}/classes/class_b`]: classRecord({ name: 'Class B' }),
    [`schools/${SCHOOL_A}/students/student_a`]: studentRecord(),
    [`schools/${SCHOOL_B}/classes/class_b`]: classRecord({ schoolId: SCHOOL_B, name: 'School B Class' }),
    [`schools/${SCHOOL_B}/students/student_b`]: studentRecord({ schoolId: SCHOOL_B, classId: 'class_b' }),
  });
  const transferRef = doc(context('transfer_a').firestore(), `schools/${SCHOOL_A}/students/student_a`);
  await assertSucceeds(updateDoc(transferRef, {
    classId: 'class_b', className: 'Class B', academicYear: '2026-2027', gradeLevel: 'י׳',
    joinedAt: '2026-10-01', updatedBy: 'transfer_a', updatedAt: 'later',
  }));
  await assertFails(updateDoc(transferRef, {
    schoolId: SCHOOL_B, updatedBy: 'transfer_a', updatedAt: 'later',
  }));
  await assertFails(updateDoc(
    doc(context('transfer_a').firestore(), `schools/${SCHOOL_B}/students/student_b`),
    { className: 'Forged', updatedBy: 'transfer_a', updatedAt: 'later' },
  ));
  const archiveRef = doc(context('archive_a').firestore(), `schools/${SCHOOL_A}/students/student_a`);
  await assertSucceeds(updateDoc(archiveRef, {
    status: 'archived', endDate: '2026-11-01', updatedBy: 'archive_a', updatedAt: 'archived',
  }));
});

test('student notes require class access and separate note permissions', async () => {
  await seedFirestore({
    'users/teacher_a': user({
      schoolId: SCHOOL_A,
      permissions: { students_view_notes: true, students_add_notes: true },
    }),
    'users/peer_a': user({ schoolId: SCHOOL_A, permissions: { students_view_notes: true } }),
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    [`schools/${SCHOOL_A}/classes/class_a`]: classRecord({ teacherId: 'teacher_a' }),
    [`schools/${SCHOOL_A}/students/student_a`]: studentRecord(),
    [`schools/${SCHOOL_A}/students/student_a/notes/class_note`]: {
      schoolId: SCHOOL_A, studentId: 'student_a', content: 'Class note',
      visibility: 'class_staff', createdBy: 'principal_a',
    },
    [`schools/${SCHOOL_A}/students/student_a/notes/admin_note`]: {
      schoolId: SCHOOL_A, studentId: 'student_a', content: 'Admin note',
      visibility: 'school_admin', createdBy: 'principal_a',
    },
  });
  const teacherDb = context('teacher_a').firestore();
  await assertSucceeds(getDoc(doc(teacherDb, `schools/${SCHOOL_A}/students/student_a/notes/class_note`)));
  await assertFails(getDoc(doc(teacherDb, `schools/${SCHOOL_A}/students/student_a/notes/admin_note`)));
  await assertFails(getDoc(doc(context('peer_a').firestore(), `schools/${SCHOOL_A}/students/student_a/notes/class_note`)));
  await assertSucceeds(getDoc(doc(context('principal_a').firestore(), `schools/${SCHOOL_A}/students/student_a/notes/admin_note`)));
  await assertSucceeds(setDoc(doc(teacherDb, `schools/${SCHOOL_A}/students/student_a/notes/new_note`), {
    schoolId: SCHOOL_A,
    studentId: 'student_a',
    content: 'New note',
    visibility: 'class_staff',
    createdBy: 'teacher_a',
  }));
});

test('legacy class and student collections retain class-scoped access', async () => {
  await seedFirestore({
    'users/teacher_a': user({ schoolId: SCHOOL_A }),
    'users/teacher_b': user({ schoolId: SCHOOL_A }),
    [`classes_${SCHOOL_A}/class_a`]: classRecord({ teacherId: 'teacher_a' }),
    [`students_${SCHOOL_A}/student_a`]: studentRecord(),
  });
  await assertSucceeds(getDoc(doc(context('teacher_a').firestore(), `students_${SCHOOL_A}/student_a`)));
  await assertFails(getDoc(doc(context('teacher_b').firestore(), `students_${SCHOOL_A}/student_a`)));
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
