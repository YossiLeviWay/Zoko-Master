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
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

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

function academicYearRecord({
  schoolId = SCHOOL_A,
  label = 'תשפ״ז',
  startYear = 2026,
  endYear = 2027,
  actor = 'principal_a',
} = {}) {
  return {
    schoolId, label, startYear, endYear, status: 'active',
    createdBy: actor, updatedBy: actor, createdAt: 'created', updatedAt: 'created',
  };
}

function enrollmentRecord({
  studentId = 'student_a',
  schoolId = SCHOOL_A,
  academicYearId = 'year_2026_2027',
  classId = 'class_a',
  status = 'active',
  actor = 'principal_a',
} = {}) {
  return {
    studentId,
    schoolId,
    academicYearId,
    academicYearLabel: academicYearId === 'year_2025_2026' ? 'תשפ״ו' : 'תשפ״ז',
    classId,
    className: classId === 'class_b' ? 'Class B' : 'Class A',
    grade: 'י׳',
    majorIds: [],
    studyProgramIds: [],
    enrollmentStatus: status,
    startDate: '2026-09-01',
    endDate: '',
    exitReason: '',
    displayName: 'Student A',
    createdBy: actor,
    updatedBy: actor,
    createdAt: 'created',
    updatedAt: 'created',
  };
}

function attendanceFile({
  schoolId = SCHOOL_A,
  classId = 'class_a',
  createdBy = 'principal_a',
  setupStatus = 'ready',
} = {}) {
  return {
    name: 'Attendance A',
    fileType: 'attendance',
    type: 'application/x-attendance-sheet',
    folderId: 'folder_a',
    schoolId,
    classId,
    className: classId === 'class_b' ? 'Class B' : 'Class A',
    dateRange: { start: '2026-09-01', end: '2026-09-30' },
    timezone: 'Asia/Jerusalem',
    status: 'active',
    setupStatus,
    createdBy,
    updatedBy: createdBy,
    createdAt: 'created',
    updatedAt: 'created',
  };
}

function attendanceRecord({
  schoolId = SCHOOL_A,
  fileId = 'attendance_a',
  classId = 'class_a',
  studentId = 'student_a',
  updatedBy = 'principal_a',
} = {}) {
  return {
    schoolId,
    fileId,
    classId,
    studentId,
    dateKey: '2026-09-01',
    primaryStatusId: 'present',
    actionIds: [],
    note: '',
    updatedBy,
    updatedAt: 'updated',
  };
}

function gradebookRecord({ schoolId = SCHOOL_A, classId = 'class_a', actor = 'principal_a' } = {}) {
  return {
    schoolId,
    classId,
    className: classId === 'class_b' ? 'Class B' : 'Class A',
    academicYearId: 'year_2026_2027',
    academicYearLabel: 'תשפ״ז',
    academicYearRange: '2026-2027',
    status: 'active',
    subjects: [{
      id: 'math', name: 'מתמטיקה', formula: 'C1*30% + C2*70%',
      components: [
        { id: 'project', name: 'פרויקט', weight: 30 },
        { id: 'exam', name: 'מבחן', weight: 70 },
      ],
    }],
    createdBy: actor,
    updatedBy: actor,
    createdAt: 'created',
    updatedAt: 'created',
  };
}

function gradebookFile({ schoolId = SCHOOL_A, classId = 'class_a', actor = 'principal_a' } = {}) {
  return {
    name: 'מיפוי ציונים - Class A',
    fileType: 'gradebook',
    type: 'application/x-zoko-gradebook',
    folderId: `class_${classId}`,
    schoolId,
    classId,
    className: classId === 'class_b' ? 'Class B' : 'Class A',
    gradebookId: `grades_${classId}_year_2026_2027`,
    academicYearId: 'year_2026_2027',
    academicYear: 'תשפ״ז',
    academicYearRange: '2026-2027',
    status: 'active',
    createdBy: actor,
    updatedBy: actor,
    uploadedBy: 'Principal',
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

test('mandatory tasks are server-created and cannot be deleted by recipients', async () => {
  await seedFirestore({
    'users/assigner_a': user({ schoolId: SCHOOL_A, permissions: { tasks_edit: true, 'tasks.assignMandatory': true } }),
    'users/recipient_a': user({ schoolId: SCHOOL_A, permissions: { tasks_edit: true } }),
    [`schools/${SCHOOL_A}/tasks/mandatory_1`]: {
      scope: 'assigned', schoolId: SCHOOL_A, createdBy: 'assigner_a', title: 'Required',
      status: 'todo', assigneeType: 'individual', assigneeIds: ['recipient_a'], mandatory: true,
      assignedBy: 'assigner_a', assignmentAuthority: 'tasks.assignMandatory',
    },
  });
  const recipientRef = doc(context('recipient_a').firestore(), `schools/${SCHOOL_A}/tasks/mandatory_1`);
  await assertSucceeds(getDoc(recipientRef));
  await assertSucceeds(updateDoc(recipientRef, { status: 'done', completedAt: 'server-value', updatedAt: 'server-value' }));
  await assertFails(deleteDoc(recipientRef));
  await assertFails(updateDoc(recipientRef, { assignedBy: 'recipient_a' }));
  await assertFails(setDoc(doc(context('assigner_a').firestore(), `schools/${SCHOOL_A}/tasks/mandatory_client`), {
    scope: 'assigned', schoolId: SCHOOL_A, createdBy: 'assigner_a', title: 'Spoofed', status: 'todo',
    assigneeType: 'individual', assigneeIds: ['recipient_a'], mandatory: true,
  }));
});

test('task invitations and shared tasks are visible only to their actors', async () => {
  await seedFirestore({
    'users/owner_a': user({ schoolId: SCHOOL_A }),
    'users/recipient_a': user({ schoolId: SCHOOL_A }),
    'users/other_a': user({ schoolId: SCHOOL_A }),
    [`schools/${SCHOOL_A}/taskInvitations/invite_1`]: {
      schoolId: SCHOOL_A, inviterId: 'owner_a', recipientId: 'recipient_a',
      title: 'Preview', description: 'Limited preview', status: 'pending',
    },
    [`schools/${SCHOOL_A}/tasks/shared_1`]: {
      schoolId: SCHOOL_A, createdBy: 'owner_a', title: 'Shared task', status: 'todo',
      scope: 'shared', assigneeType: 'participants', participantIds: ['owner_a', 'recipient_a'], mandatory: false,
    },
  });
  const invitationPath = `schools/${SCHOOL_A}/taskInvitations/invite_1`;
  await assertSucceeds(getDoc(doc(context('owner_a').firestore(), invitationPath)));
  await assertSucceeds(getDoc(doc(context('recipient_a').firestore(), invitationPath)));
  await assertFails(getDoc(doc(context('other_a').firestore(), invitationPath)));
  await assertFails(updateDoc(doc(context('recipient_a').firestore(), invitationPath), { status: 'accepted' }));
  const sharedPath = `schools/${SCHOOL_A}/tasks/shared_1`;
  await assertSucceeds(getDoc(doc(context('owner_a').firestore(), sharedPath)));
  await assertSucceeds(getDoc(doc(context('recipient_a').firestore(), sharedPath)));
  await assertFails(getDoc(doc(context('other_a').firestore(), sharedPath)));
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

test('academic-year managers may configure only their school while ordinary viewers stay read-only', async () => {
  await seedFirestore({
    'users/year_manager': user({
      schoolId: SCHOOL_A,
      permissions: { 'academicYears.manage': true },
    }),
    'users/viewer_a': user({ schoolId: SCHOOL_A }),
    'users/viewer_b': user({ schoolId: SCHOOL_B }),
  });
  const managerDb = context('year_manager').firestore();
  const yearPath = `academic_years_${SCHOOL_A}/year_2026_2027`;
  await assertSucceeds(setDoc(doc(managerDb, yearPath), academicYearRecord({ actor: 'year_manager' })));
  await assertSucceeds(setDoc(doc(managerDb, `settings_${SCHOOL_A}/academic_years`), {
    schoolId: SCHOOL_A,
    activeAcademicYearId: 'year_2026_2027',
    createdBy: 'year_manager',
    updatedBy: 'year_manager',
    createdAt: 'created',
    updatedAt: 'created',
  }));
  await assertSucceeds(getDoc(doc(context('viewer_a').firestore(), yearPath)));
  await assertFails(updateDoc(doc(context('viewer_a').firestore(), yearPath), {
    label: 'שינוי אסור', updatedBy: 'viewer_a', updatedAt: 'later',
  }));
  await assertFails(getDoc(doc(context('viewer_b').firestore(), yearPath)));
  await assertFails(setDoc(doc(managerDb, `academic_years_${SCHOOL_B}/year_2027_2028`), {
    ...academicYearRecord({ schoolId: SCHOOL_B, actor: 'year_manager', startYear: 2027, endYear: 2028 }),
  }));
});

test('student creation writes one deterministic annual enrollment and preserves tenant ownership', async () => {
  await seedFirestore({
    'users/teacher_a': user({ schoolId: SCHOOL_A }),
    [`classes_${SCHOOL_A}/class_a`]: {
      ...classRecord({ teacherId: 'teacher_a' }), academicYearId: 'year_2026_2027',
    },
    [`academic_years_${SCHOOL_A}/year_2026_2027`]: academicYearRecord(),
  });
  const db = context('teacher_a').firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, `students_${SCHOOL_A}/student_a`), {
    ...studentRecord(),
    currentEnrollmentId: 'student_a__year_2026_2027',
    createdBy: 'teacher_a', updatedBy: 'teacher_a',
  });
  batch.set(doc(db, `students_${SCHOOL_A}/student_a/history/created`), {
    type: 'student_created', schoolId: SCHOOL_A, studentId: 'student_a',
    nextClassId: 'class_a', effectiveDate: '2026-09-01',
    createdBy: 'teacher_a', createdAt: 'created',
  });
  batch.set(doc(db, `student_enrollments_${SCHOOL_A}/student_a__year_2026_2027`), {
    ...enrollmentRecord({ actor: 'teacher_a' }),
  });
  batch.set(doc(db, `personal_files_${SCHOOL_A}/student_a`), {
    schoolId: SCHOOL_A, studentId: 'student_a', status: 'active',
    createdBy: 'teacher_a', updatedBy: 'teacher_a', createdAt: 'created', updatedAt: 'created',
  });
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(db, `student_enrollments_${SCHOOL_A}/student_a__year_2026_2027`)));
  await assertFails(getDoc(doc(db, `personal_files_${SCHOOL_A}/student_a`)));
  await assertFails(setDoc(doc(db, `student_enrollments_${SCHOOL_A}/forged_id`), {
    ...enrollmentRecord({ actor: 'teacher_a' }),
  }));
  await assertFails(setDoc(doc(db, `student_enrollments_${SCHOOL_B}/student_a__year_2026_2027`), {
    ...enrollmentRecord({ schoolId: SCHOOL_B, actor: 'teacher_a' }),
  }));
});

test('promotion completes the prior enrollment and creates a new one without deleting history', async () => {
  await seedFirestore({
    'users/promoter_a': user({
      schoolId: SCHOOL_A,
      permissions: { 'students.promote': true },
    }),
    [`classes_${SCHOOL_A}/class_a`]: {
      ...classRecord(), academicYear: '2025-2026', academicYearId: 'year_2025_2026',
    },
    [`classes_${SCHOOL_A}/class_b`]: {
      ...classRecord({ name: 'Class B' }), academicYearId: 'year_2026_2027',
    },
    [`students_${SCHOOL_A}/student_a`]: {
      ...studentRecord(), academicYear: '2025-2026',
      currentEnrollmentId: 'student_a__year_2025_2026',
    },
    [`student_enrollments_${SCHOOL_A}/student_a__year_2025_2026`]: enrollmentRecord({
      academicYearId: 'year_2025_2026', actor: 'principal_a',
    }),
  });
  const db = context('promoter_a').firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, `student_enrollments_${SCHOOL_A}/student_a__year_2025_2026`), {
    enrollmentStatus: 'completed', endDate: '2026-08-31',
    updatedBy: 'promoter_a', updatedAt: 'later',
  });
  batch.set(doc(db, `student_enrollments_${SCHOOL_A}/student_a__year_2026_2027`), {
    ...enrollmentRecord({ classId: 'class_b', actor: 'promoter_a' }),
  });
  batch.update(doc(db, `students_${SCHOOL_A}/student_a`), {
    classId: 'class_b', className: 'Class B', gradeLevel: 'י׳', academicYear: 'תשפ״ז',
    currentEnrollmentId: 'student_a__year_2026_2027', status: 'active',
    joinedAt: '2026-09-01', endDate: '', updatedBy: 'promoter_a', updatedAt: 'later',
  });
  batch.set(doc(db, `students_${SCHOOL_A}/student_a/history/promoted`), {
    type: 'student_promoted', schoolId: SCHOOL_A, studentId: 'student_a',
    previousClassId: 'class_a', previousAcademicYearId: 'year_2025_2026',
    nextClassId: 'class_b', nextAcademicYearId: 'year_2026_2027',
    effectiveDate: '2026-09-01', createdBy: 'promoter_a', createdAt: 'created',
  });
  await assertSucceeds(batch.commit());
  const prior = await getDoc(doc(db, `student_enrollments_${SCHOOL_A}/student_a__year_2025_2026`));
  const next = await getDoc(doc(db, `student_enrollments_${SCHOOL_A}/student_a__year_2026_2027`));
  assert.equal(prior.data().enrollmentStatus, 'completed');
  assert.equal(next.data().enrollmentStatus, 'active');
  await assertSucceeds(getDoc(doc(db, `students_${SCHOOL_A}/student_a/history/promoted`)));
});

test('graduation, withdrawal and restore require the matching lifecycle permission', async () => {
  await seedFirestore({
    'users/graduator_a': user({ schoolId: SCHOOL_A, permissions: { 'students.markGraduate': true } }),
    'users/viewer_a': user({ schoolId: SCHOOL_A, permissions: { students_view: true } }),
    [`classes_${SCHOOL_A}/class_a`]: { ...classRecord(), academicYearId: 'year_2026_2027' },
    [`students_${SCHOOL_A}/student_a`]: {
      ...studentRecord(), currentEnrollmentId: 'student_a__year_2026_2027',
    },
    [`student_enrollments_${SCHOOL_A}/student_a__year_2026_2027`]: enrollmentRecord(),
  });
  const graduationDb = context('graduator_a').firestore();
  const batch = writeBatch(graduationDb);
  batch.update(doc(graduationDb, `student_enrollments_${SCHOOL_A}/student_a__year_2026_2027`), {
    enrollmentStatus: 'graduated', endDate: '2027-06-30', graduationYear: '2027',
    updatedBy: 'graduator_a', updatedAt: 'later',
  });
  batch.update(doc(graduationDb, `students_${SCHOOL_A}/student_a`), {
    status: 'graduated', endDate: '2027-06-30', updatedBy: 'graduator_a', updatedAt: 'later',
  });
  batch.set(doc(graduationDb, `students_${SCHOOL_A}/student_a/history/graduated`), {
    type: 'student_graduated', schoolId: SCHOOL_A, studentId: 'student_a',
    academicYearId: 'year_2026_2027', classId: 'class_a', effectiveDate: '2027-06-30',
    graduationYear: '2027', createdBy: 'graduator_a', createdAt: 'created',
  });
  await assertSucceeds(batch.commit());
  const viewerDb = context('viewer_a').firestore();
  await assertFails(updateDoc(doc(viewerDb, `student_enrollments_${SCHOOL_A}/student_a__year_2026_2027`), {
    enrollmentStatus: 'active', endDate: '', updatedBy: 'viewer_a', updatedAt: 'later-again',
  }));
});

test('materialized custom-role permissions remain school and class scoped', async () => {
  await seedFirestore({
    'users/scoped_a': user({
      schoolId: SCHOOL_A,
      permissions: {},
      role: 'viewer',
    }),
    [`classes_${SCHOOL_A}/class_a`]: classRecord(),
    [`classes_${SCHOOL_A}/class_b`]: classRecord({ name: 'Class B' }),
    [`students_${SCHOOL_A}/student_a`]: studentRecord(),
    [`students_${SCHOOL_A}/student_b`]: studentRecord({ classId: 'class_b', name: 'Student B' }),
  });
  await environment.withSecurityRulesDisabled(async disabled => {
    await updateDoc(doc(disabled.firestore(), 'users/scoped_a'), {
      customRoleIds: ['scoped_role'],
      rolePermissionsBySchool: { [SCHOOL_A]: {} },
      classRolePermissionsBySchool: {
        [SCHOOL_A]: { 'students.view': ['class_a'], 'students.update': ['class_a'] },
      },
    });
  });
  const db = context('scoped_a').firestore();
  await assertSucceeds(getDoc(doc(db, `classes_${SCHOOL_A}/class_a`)));
  await assertSucceeds(getDoc(doc(db, `students_${SCHOOL_A}/student_a`)));
  await assertFails(getDoc(doc(db, `students_${SCHOOL_A}/student_b`)));
  await assertSucceeds(updateDoc(doc(db, `students_${SCHOOL_A}/student_a`), {
    fullName: 'Scoped update', updatedBy: 'scoped_a', updatedAt: 'later',
  }));
  await assertFails(updateDoc(doc(db, `students_${SCHOOL_A}/student_b`), {
    fullName: 'Forbidden update', updatedBy: 'scoped_a', updatedAt: 'later',
  }));
  await assertFails(updateDoc(doc(db, 'users/scoped_a'), {
    rolePermissionsBySchool: { [SCHOOL_A]: { 'students.view': true } },
  }));
});

test('explicitly false permissions never grant student or class access', async () => {
  await seedFirestore({
    'users/false_permissions_a': user({
      schoolId: SCHOOL_A,
      permissions: {
        students_view: false,
        classes_view: false,
        attendance_view: false,
      },
    }),
    [`classes_${SCHOOL_A}/class_a`]: classRecord(),
    [`students_${SCHOOL_A}/student_a`]: studentRecord(),
  });
  const db = context('false_permissions_a').firestore();
  await assertFails(getDoc(doc(db, `classes_${SCHOOL_A}/class_a`)));
  await assertFails(getDoc(doc(db, `students_${SCHOOL_A}/student_a`)));
});

test('personal files require explicit access and remain server-managed', async () => {
  await seedFirestore({
    'users/file_viewer_a': user({ schoolId: SCHOOL_A, permissions: { 'personalFile.view': true } }),
    'users/student_viewer_a': user({ schoolId: SCHOOL_A, permissions: { students_view: true } }),
    [`students_${SCHOOL_A}/student_a`]: studentRecord(),
    [`personal_files_${SCHOOL_A}/student_a`]: {
      schoolId: SCHOOL_A, studentId: 'student_a', status: 'active',
      createdBy: 'principal_a', updatedBy: 'principal_a', createdAt: 'created', updatedAt: 'created',
    },
    [`personal_files_${SCHOOL_A}/student_a/credentials/credential_a`]: {
      schoolId: SCHOOL_A, studentId: 'student_a', title: 'Safety', status: 'verified',
      createdBy: 'principal_a', updatedBy: 'principal_a', createdAt: 'created', updatedAt: 'created',
    },
  });
  const authorized = context('file_viewer_a').firestore();
  const unauthorized = context('student_viewer_a').firestore();
  await assertSucceeds(getDoc(doc(authorized, `personal_files_${SCHOOL_A}/student_a`)));
  await assertSucceeds(getDoc(doc(authorized, `personal_files_${SCHOOL_A}/student_a/credentials/credential_a`)));
  await assertFails(getDoc(doc(unauthorized, `personal_files_${SCHOOL_A}/student_a`)));
  await assertFails(getDoc(doc(unauthorized, `personal_files_${SCHOOL_A}/student_a/credentials/credential_a`)));
  await assertFails(setDoc(doc(authorized, `personal_files_${SCHOOL_A}/student_a/credentials/client_write`), {
    schoolId: SCHOOL_A, studentId: 'student_a', title: 'Forged', status: 'verified',
    verifiedBy: 'file_viewer_a',
  }));
});

test('CV documents and immutable versions require explicit CV access', async () => {
  await seedFirestore({
    'users/cv_viewer_a': user({ schoolId: SCHOOL_A, permissions: { 'cv.view': true } }),
    'users/student_viewer_a': user({ schoolId: SCHOOL_A, permissions: { students_view: true } }),
    'users/cv_viewer_b': user({ schoolId: SCHOOL_B, permissions: { 'cv.view': true } }),
    [`students_${SCHOOL_A}/student_a`]: studentRecord(),
    [`personal_files_${SCHOOL_A}/student_a/cvDocuments/cv_a`]: {
      schoolId: SCHOOL_A, studentId: 'student_a', title: 'CV A', status: 'final', snapshot: {},
    },
    [`personal_files_${SCHOOL_A}/student_a/cvDocuments/cv_a/versions/v001`]: {
      schoolId: SCHOOL_A, studentId: 'student_a', documentId: 'cv_a', status: 'final', versionNumber: 1, snapshot: {},
    },
  });
  const authorized = context('cv_viewer_a').firestore();
  await assertSucceeds(getDoc(doc(authorized, `personal_files_${SCHOOL_A}/student_a/cvDocuments/cv_a`)));
  await assertSucceeds(getDoc(doc(authorized, `personal_files_${SCHOOL_A}/student_a/cvDocuments/cv_a/versions/v001`)));
  await assertFails(getDoc(doc(context('student_viewer_a').firestore(), `personal_files_${SCHOOL_A}/student_a/cvDocuments/cv_a`)));
  await assertFails(getDoc(doc(context('cv_viewer_b').firestore(), `personal_files_${SCHOOL_A}/student_a/cvDocuments/cv_a`)));
  await assertFails(updateDoc(doc(authorized, `personal_files_${SCHOOL_A}/student_a/cvDocuments/cv_a`), { title: 'Client change' }));
});

test('school CV templates stay in their school and personal templates stay with their creator', async () => {
  await seedFirestore({
    'users/template_a': user({ schoolId: SCHOOL_A, permissions: { 'cvTemplates.view': true } }),
    'users/template_peer_a': user({ schoolId: SCHOOL_A, permissions: { 'cvTemplates.view': true } }),
    'users/template_b': user({ schoolId: SCHOOL_B, permissions: { 'cvTemplates.view': true } }),
    [`cv_templates_${SCHOOL_A}/school_template`]: { schoolId: SCHOOL_A, type: 'design', scope: 'school', status: 'active', createdBy: 'template_a', name: 'School' },
    [`cv_templates_${SCHOOL_A}/personal_template`]: { schoolId: SCHOOL_A, type: 'content', scope: 'personal', status: 'active', createdBy: 'template_a', name: 'Personal' },
  });
  const owner = context('template_a').firestore();
  await assertSucceeds(getDoc(doc(owner, `cv_templates_${SCHOOL_A}/school_template`)));
  await assertSucceeds(getDoc(doc(owner, `cv_templates_${SCHOOL_A}/personal_template`)));
  await assertFails(getDoc(doc(context('template_peer_a').firestore(), `cv_templates_${SCHOOL_A}/personal_template`)));
  await assertFails(getDoc(doc(context('template_b').firestore(), `cv_templates_${SCHOOL_A}/school_template`)));
  await assertFails(setDoc(doc(owner, `cv_templates_${SCHOOL_A}/client_template`), { schoolId: SCHOOL_A, scope: 'school', status: 'active' }));
});

test('custom roles are server-managed and cannot be changed directly by a principal', async () => {
  await seedFirestore({
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
  });
  const db = context('principal_a').firestore();
  await assertFails(setDoc(doc(db, `roles_${SCHOOL_A}/client_role`), {
    schoolId: SCHOOL_A,
    name: 'Client role',
    permissions: { 'students.view': true },
  }));
});

test('gradebooks, grade files and class folders stay limited to authorized class staff', async () => {
  await seedFirestore({
    'users/teacher_a': user({ schoolId: SCHOOL_A }),
    'users/teacher_b': user({ schoolId: SCHOOL_A }),
    'users/grade_viewer': user({ schoolId: SCHOOL_A, permissions: { 'grades.view': true } }),
    'users/member_b': user({ schoolId: SCHOOL_B, permissions: { 'grades.edit': true } }),
    [`schools/${SCHOOL_A}/classes/class_a`]: classRecord({ teacherId: 'teacher_a' }),
    [`schools/${SCHOOL_A}/classes/class_b`]: classRecord({ teacherId: 'teacher_b', name: 'Class B' }),
    [`schools/${SCHOOL_A}/students/student_a`]: studentRecord(),
    [`schools/${SCHOOL_A}/gradebooks/grades_class_a_year_2026_2027`]: gradebookRecord(),
    [`schools/${SCHOOL_A}/files/gradebook_grades_class_a_year_2026_2027`]: gradebookFile(),
    [`schools/${SCHOOL_A}/folders/class_class_a`]: {
      name: 'כיתה Class A', schoolId: SCHOOL_A, classId: 'class_a', className: 'Class A',
      academicYearId: 'year_2026_2027', visibility: 'class_restricted', specialFolder: true,
      createdBy: 'principal_a', updatedBy: 'principal_a', createdAt: 'created', updatedAt: 'created',
    },
  });
  const gradebookPath = `schools/${SCHOOL_A}/gradebooks/grades_class_a_year_2026_2027`;
  const filePath = `schools/${SCHOOL_A}/files/gradebook_grades_class_a_year_2026_2027`;
  const folderPath = `schools/${SCHOOL_A}/folders/class_class_a`;
  const teacherDb = context('teacher_a').firestore();
  await assertSucceeds(getDoc(doc(teacherDb, gradebookPath)));
  await assertSucceeds(getDoc(doc(teacherDb, filePath)));
  await assertSucceeds(getDoc(doc(teacherDb, folderPath)));
  await assertFails(getDoc(doc(context('teacher_b').firestore(), gradebookPath)));
  await assertFails(getDoc(doc(context('teacher_b').firestore(), filePath)));
  await assertFails(getDoc(doc(context('teacher_b').firestore(), folderPath)));
  await assertFails(getDoc(doc(context('member_b').firestore(), gradebookPath)));
  await assertSucceeds(getDoc(doc(context('grade_viewer').firestore(), gradebookPath)));

  const gradePath = `${gradebookPath}/grades/student_a`;
  const grade = {
    schoolId: SCHOOL_A,
    gradebookId: 'grades_class_a_year_2026_2027',
    classId: 'class_a', studentId: 'student_a', displayName: 'Student A',
    scores: { math: { project: '80', exam: '90' } }, calculated: { math: 87 },
    updatedBy: 'teacher_a', updatedAt: 'updated',
  };
  await assertSucceeds(setDoc(doc(teacherDb, gradePath), grade));
  await assertSucceeds(getDoc(doc(context('grade_viewer').firestore(), gradePath)));
  await assertFails(updateDoc(doc(context('grade_viewer').firestore(), gradePath), {
    scores: { math: { project: '100', exam: '100' } }, calculated: { math: 100 },
    updatedBy: 'grade_viewer', updatedAt: 'forged',
  }));
  await assertFails(setDoc(doc(teacherDb, `${gradebookPath}/grades/student_wrong_class`), {
    ...grade, studentId: 'student_wrong_class', updatedBy: 'teacher_a',
  }));
});

test('principal can initialize but clients cannot delete protected class mappings', async () => {
  await seedFirestore({
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    [`schools/${SCHOOL_A}/classes/class_a`]: classRecord(),
  });
  const db = context('principal_a').firestore();
  const folderRef = doc(db, `schools/${SCHOOL_A}/folders/class_class_a`);
  await assertSucceeds(setDoc(folderRef, {
    name: 'כיתה Class A', schoolId: SCHOOL_A, classId: 'class_a', className: 'Class A',
    academicYearId: 'year_2026_2027', visibility: 'class_restricted', specialFolder: true,
    createdBy: 'principal_a', updatedBy: 'principal_a', createdAt: 'created', updatedAt: 'created',
  }));
  const gradebookRef = doc(db, `schools/${SCHOOL_A}/gradebooks/grades_class_a_year_2026_2027`);
  await assertSucceeds(setDoc(gradebookRef, gradebookRecord()));
  const fileRef = doc(db, `schools/${SCHOOL_A}/files/gradebook_grades_class_a_year_2026_2027`);
  await assertSucceeds(setDoc(fileRef, gradebookFile()));
  await assertFails(deleteDoc(gradebookRef));
  await assertFails(deleteDoc(fileRef));
  await assertFails(deleteDoc(folderRef));
});

test('principal creates and initializes a structured legacy attendance sheet without allowing hard deletion', async () => {
  await seedFirestore({
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    [`classes_${SCHOOL_A}/class_a`]: classRecord(),
    [`students_${SCHOOL_A}/student_a`]: studentRecord(),
  });
  const db = context('principal_a').firestore();
  const fileRef = doc(db, `files_${SCHOOL_A}/attendance_a`);
  await assertSucceeds(setDoc(fileRef, attendanceFile({ setupStatus: 'creating' })));

  const setup = writeBatch(db);
  setup.set(doc(db, `files_${SCHOOL_A}/attendance_a/attendanceLegend/present`), {
    schoolId: SCHOOL_A, fileId: 'attendance_a', label: 'נוכח', shortCode: 'נ',
    color: '#16a34a', type: 'status', attendanceEffect: 'present', active: true,
    createdBy: 'principal_a', createdAt: 'created', updatedAt: 'created',
  });
  setup.set(doc(db, `files_${SCHOOL_A}/attendance_a/attendanceMembers/student_a`), {
    schoolId: SCHOOL_A, fileId: 'attendance_a', classId: 'class_a',
    studentId: 'student_a', displayName: 'Student A', included: true, order: 0,
    createdBy: 'principal_a', createdAt: 'created',
  });
  setup.set(doc(db, `files_${SCHOOL_A}/attendance_a/attendanceDays/2026-09-01`), {
    schoolId: SCHOOL_A, fileId: 'attendance_a', dateKey: '2026-09-01', blocked: false,
    createdBy: 'principal_a', createdAt: 'created', updatedAt: 'created',
  });
  await assertSucceeds(setup.commit());
  await assertSucceeds(updateDoc(fileRef, {
    setupStatus: 'ready', updatedBy: 'principal_a', updatedAt: 'ready',
  }));

  const attendanceWrite = writeBatch(db);
  attendanceWrite.set(
    doc(db, `files_${SCHOOL_A}/attendance_a/attendanceRecords/student_a__2026-09-01`),
    attendanceRecord(),
  );
  attendanceWrite.set(doc(db, `files_${SCHOOL_A}/attendance_a/attendanceHistory/history_a`), {
    schoolId: SCHOOL_A, fileId: 'attendance_a', classId: 'class_a',
    recordId: 'student_a__2026-09-01', studentId: 'student_a', dateKey: '2026-09-01',
    type: 'cell_created', createdBy: 'principal_a', createdAt: 'created',
  });
  await assertSucceeds(attendanceWrite.commit());
  await assertFails(deleteDoc(fileRef));
});

test('homeroom teacher creates and edits attendance only for the assigned class', async () => {
  await seedFirestore({
    'users/teacher_a': user({ schoolId: SCHOOL_A }),
    [`classes_${SCHOOL_A}/class_a`]: classRecord({ teacherId: 'teacher_a' }),
    [`classes_${SCHOOL_A}/class_b`]: classRecord({ teacherId: 'teacher_b', name: 'Class B' }),
    [`files_${SCHOOL_A}/attendance_a`]: attendanceFile({ createdBy: 'teacher_a' }),
    [`files_${SCHOOL_A}/attendance_b`]: attendanceFile({ classId: 'class_b', createdBy: 'teacher_b' }),
    [`files_${SCHOOL_A}/attendance_a/attendanceMembers/student_a`]: { studentId: 'student_a' },
    [`files_${SCHOOL_A}/attendance_a/attendanceDays/2026-09-01`]: { dateKey: '2026-09-01' },
    [`files_${SCHOOL_A}/attendance_b/attendanceMembers/student_b`]: { studentId: 'student_b' },
    [`files_${SCHOOL_A}/attendance_b/attendanceDays/2026-09-01`]: { dateKey: '2026-09-01' },
  });
  const db = context('teacher_a').firestore();
  await assertSucceeds(setDoc(
    doc(db, `files_${SCHOOL_A}/teacher_created`),
    attendanceFile({ createdBy: 'teacher_a', setupStatus: 'creating' }),
  ));
  await assertSucceeds(setDoc(
    doc(db, `files_${SCHOOL_A}/attendance_a/attendanceRecords/student_a__2026-09-01`),
    attendanceRecord({ updatedBy: 'teacher_a' }),
  ));
  await assertFails(setDoc(
    doc(db, `files_${SCHOOL_A}/attendance_b/attendanceRecords/student_b__2026-09-01`),
    attendanceRecord({ fileId: 'attendance_b', classId: 'class_b', studentId: 'student_b', updatedBy: 'teacher_a' }),
  ));
});

test('attendance create permission initializes a sheet but does not grant record editing', async () => {
  await seedFirestore({
    'users/creator_a': user({ schoolId: SCHOOL_A, permissions: { attendance_create: true } }),
    [`classes_${SCHOOL_A}/class_a`]: classRecord(),
  });
  const db = context('creator_a').firestore();
  const fileRef = doc(db, `files_${SCHOOL_A}/attendance_created`);
  await assertSucceeds(setDoc(
    fileRef,
    attendanceFile({ createdBy: 'creator_a', setupStatus: 'creating' }),
  ));
  await assertSucceeds(setDoc(doc(db, `files_${SCHOOL_A}/attendance_created/attendanceDays/2026-09-01`), {
    schoolId: SCHOOL_A, fileId: 'attendance_created', dateKey: '2026-09-01', blocked: false,
    createdBy: 'creator_a', createdAt: 'created', updatedAt: 'created',
  }));
  await assertSucceeds(updateDoc(fileRef, {
    setupStatus: 'ready', updatedBy: 'creator_a', updatedAt: 'ready',
  }));
  await assertFails(setDoc(
    doc(db, `files_${SCHOOL_A}/attendance_created/attendanceRecords/student_a__2026-09-01`),
    attendanceRecord({ fileId: 'attendance_created', updatedBy: 'creator_a' }),
  ));
});

test('attendance viewers are read-only and attendance records remain isolated by school', async () => {
  await seedFirestore({
    'users/viewer_a': user({ schoolId: SCHOOL_A, permissions: { attendance_view: true } }),
    'users/member_a': user({ schoolId: SCHOOL_A }),
    'users/member_b': user({ schoolId: SCHOOL_B, permissions: { attendance_view: true } }),
    [`classes_${SCHOOL_A}/class_a`]: classRecord(),
    [`files_${SCHOOL_A}/attendance_a`]: attendanceFile(),
    [`files_${SCHOOL_A}/attendance_a/attendanceRecords/student_a__2026-09-01`]: attendanceRecord(),
  });
  const recordPath = `files_${SCHOOL_A}/attendance_a/attendanceRecords/student_a__2026-09-01`;
  const viewerDb = context('viewer_a').firestore();
  await assertSucceeds(getDoc(doc(viewerDb, recordPath)));
  await assertFails(updateDoc(doc(viewerDb, recordPath), {
    note: 'forged', updatedBy: 'viewer_a', updatedAt: 'later',
  }));
  await assertFails(getDoc(doc(context('member_a').firestore(), recordPath)));
  await assertFails(getDoc(doc(context('member_b').firestore(), recordPath)));
});

test('nested attendance rules reject tenant and actor spoofing', async () => {
  await seedFirestore({
    'users/editor_a': user({ schoolId: SCHOOL_A, permissions: { attendance_edit: true } }),
    [`schools/${SCHOOL_A}/classes/class_a`]: classRecord(),
    [`schools/${SCHOOL_A}/files/attendance_a`]: attendanceFile(),
    [`schools/${SCHOOL_A}/files/attendance_a/attendanceMembers/student_a`]: { studentId: 'student_a' },
    [`schools/${SCHOOL_A}/files/attendance_a/attendanceDays/2026-09-01`]: { dateKey: '2026-09-01' },
  });
  const db = context('editor_a').firestore();
  const recordRef = doc(db, `schools/${SCHOOL_A}/files/attendance_a/attendanceRecords/student_a__2026-09-01`);
  await assertSucceeds(setDoc(recordRef, attendanceRecord({ updatedBy: 'editor_a' })));
  await assertFails(updateDoc(recordRef, {
    schoolId: SCHOOL_B, updatedBy: 'editor_a', updatedAt: 'later',
  }));
  await assertFails(updateDoc(recordRef, {
    updatedBy: 'principal_a', updatedAt: 'later',
  }));
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

test('personal-file attachments require scoped upload and view permissions', async () => {
  await seedFirestore({
    'users/file_manager_a': user({
      schoolId: SCHOOL_A,
      permissions: { 'personalFile.view': true, 'personalFile.upload': true },
    }),
    'users/student_viewer_a': user({ schoolId: SCHOOL_A, permissions: { students_view: true } }),
    'users/file_viewer_b': user({ schoolId: SCHOOL_B, permissions: { 'personalFile.view': true } }),
    [`students_${SCHOOL_A}/student_a`]: studentRecord(),
  });
  const managerStorage = context('file_manager_a').storage();
  const sameSchoolUnauthorized = context('student_viewer_a').storage();
  const otherSchool = context('file_viewer_b').storage();
  const path = `schools/${SCHOOL_A}/students/student_a/personal-file/credentials/file_a/document.pdf`;
  await assertSucceeds(uploadBytes(
    ref(managerStorage, path),
    new Uint8Array([37, 80, 68, 70]),
    { contentType: 'application/pdf' },
  ));
  await assertSucceeds(getBytes(ref(managerStorage, path)));
  await assertFails(getBytes(ref(sameSchoolUnauthorized, path)));
  await assertFails(getBytes(ref(otherSchool, path)));
  await assertFails(deleteObject(ref(managerStorage, path)));
});

test('CV PDFs are private, immutable and require export permission to upload', async () => {
  await seedFirestore({
    'users/cv_exporter_a': user({ schoolId: SCHOOL_A, permissions: { 'cv.view': true, 'cv.exportPdf': true } }),
    'users/cv_viewer_a': user({ schoolId: SCHOOL_A, permissions: { 'cv.view': true } }),
    'users/cv_viewer_b': user({ schoolId: SCHOOL_B, permissions: { 'cv.view': true, 'cv.exportPdf': true } }),
    [`students_${SCHOOL_A}/student_a`]: studentRecord(),
  });
  const exporter = context('cv_exporter_a').storage();
  const viewer = context('cv_viewer_a').storage();
  const otherSchool = context('cv_viewer_b').storage();
  const path = `schools/${SCHOOL_A}/students/student_a/cv/cv_a/v001/export_a/cv_student.pdf`;
  await assertSucceeds(uploadBytes(ref(exporter, path), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' }));
  await assertSucceeds(getBytes(ref(viewer, path)));
  await assertFails(getBytes(ref(otherSchool, path)));
  await assertFails(uploadBytes(ref(viewer, `schools/${SCHOOL_A}/students/student_a/cv/cv_a/v001/export_b/cv.pdf`), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' }));
  await assertFails(deleteObject(ref(exporter, path)));
});
