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
  limit,
  orderBy,
  query,
  serverTimestamp,
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

function initiativeRecord({
  schoolId = SCHOOL_A,
  ownerId = 'principal_a',
  memberIds = [],
  teamIds = [],
} = {}) {
  return {
    schoolId,
    title: 'Long-term initiative',
    description: 'Safe test initiative',
    academicYearId: 'year_2026_2027',
    academicYearLabel: 'תשפ״ז',
    category: 'education',
    startDate: '2026-09-01',
    endDate: '2027-06-30',
    ownerId,
    ownerName: 'Principal A',
    memberIds,
    teamIds,
    classIds: [],
    fileIds: [],
    goals: [],
    nextAction: '',
    status: 'active',
    health: 'on_track',
    healthOverride: '',
    healthOverrideReason: '',
    archivedAt: null,
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: 'created',
    updatedAt: 'created',
  };
}

function milestoneRecord({
  schoolId = SCHOOL_A,
  initiativeId = 'initiative_a',
  actor = 'principal_a',
  approverId = '',
  requiresEvidence = false,
} = {}) {
  return {
    schoolId,
    initiativeId,
    title: 'Milestone A',
    description: '',
    ownerId: actor,
    participantIds: [],
    status: 'not_started',
    priority: 'medium',
    weight: 25,
    dateType: 'exact',
    startDate: '2026-11-01',
    endDate: '',
    proposedDate: '',
    requiredOutput: '',
    approverId,
    dependencyId: '',
    reminderAt: '',
    fileIds: [],
    evidenceIds: [],
    requiresEvidence,
    completionSummary: '',
    cancelReason: '',
    order: 0,
    createdBy: actor,
    updatedBy: actor,
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

test('task participants can publish chat activity and keep only their own read receipt', async () => {
  await seedFirestore({
    'users/viewer_a': user({ schoolId: SCHOOL_A }),
    'users/outsider_a': user({ schoolId: SCHOOL_A }),
    [`schools/${SCHOOL_A}/tasks/assigned_chat`]: {
      scope: 'assigned', schoolId: SCHOOL_A, createdBy: 'creator_a', title: 'Shared task',
      assigneeType: 'individual', assigneeIds: ['viewer_a'], status: 'todo',
    },
  });
  const viewerDb = context('viewer_a').firestore();
  const taskRef = doc(viewerDb, `schools/${SCHOOL_A}/tasks/assigned_chat`);
  await assertSucceeds(updateDoc(taskRef, {
    lastChatMessageAt: serverTimestamp(),
    lastChatMessageBy: 'viewer_a',
    lastChatPreview: 'עדכון חדש',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(taskRef, {
    lastChatMessageAt: serverTimestamp(),
    lastChatMessageBy: 'outsider_a',
    lastChatPreview: 'spoofed',
    updatedAt: serverTimestamp(),
  }));
  const receiptRef = doc(viewerDb, `users/viewer_a/taskChatReceipts/${SCHOOL_A}__nested__assigned_chat`);
  await assertSucceeds(setDoc(receiptRef, {
    userId: 'viewer_a', schoolId: SCHOOL_A, taskId: 'assigned_chat', storageMode: 'nested', readAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(context('outsider_a').firestore(), `users/viewer_a/taskChatReceipts/forged`), {
    userId: 'viewer_a', schoolId: SCHOOL_A, taskId: 'assigned_chat', storageMode: 'nested', readAt: serverTimestamp(),
  }));
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

test('email follow-up creation is atomic, tenant-scoped and requires explicit send confirmation', async () => {
  await seedFirestore({
    'users/sender_a': user({
      schoolId: SCHOOL_A,
      permissions: { 'communications.create': true, 'communications.viewOwn': true },
    }),
    'users/view_all_a': user({
      schoolId: SCHOOL_A,
      permissions: { 'communications.viewAll': true },
    }),
    'users/unauthorized_a': user({ schoolId: SCHOOL_A }),
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    'users/viewer_b': user({ schoolId: SCHOOL_B }),
    'users/platform_admin': user({ schoolId: SCHOOL_A }),
  });

  const senderDb = context('sender_a').firestore();
  const taskPath = 'users/sender_a/personalTasks/mail_task_1';
  const draftPath = `schools/${SCHOOL_A}/communicationDrafts/mail_draft_1`;
  const eventPath = `schools/${SCHOOL_A}/communicationEvents/mail_event_1`;
  const batch = writeBatch(senderDb);
  batch.set(doc(senderDb, taskPath), {
    title: 'מעקב מייל: עדכון', description: 'מעקב', priority: 'medium', status: 'todo',
    taskStatus: 'todo', dueDate: '2026-08-04', reminderAt: '', tags: ['מייל'],
    attachedFileId: '', attachedFileName: '', initiativeId: '', milestoneId: '',
    scope: 'personal', schoolId: SCHOOL_A, ownerId: 'sender_a', createdBy: 'sender_a',
    createdByName: 'Sender', assigneeIds: [], participantIds: ['sender_a'], teamId: '',
    assigneeTeamId: '', completedAt: null, workflowType: 'external_email_followup',
    communicationStatus: 'awaiting_send', communicationDraftId: 'mail_draft_1',
    communicationTrackingId: 'MAIL-mail_draft_1', nextFollowUpAt: '2026-08-04',
    completionCriteria: 'התקבלה תשובה', sourceTaskId: 'source_task',
    sourceTaskStorageMode: 'nested', linkedContextType: 'task', linkedContextId: 'source_task',
    linkedContextLabel: 'משימת מקור', communicationSubject: 'עדכון',
    externalRecipientLabel: 'recipient@example.com', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.set(doc(senderDb, draftPath), {
    schoolId: SCHOOL_A, trackingId: 'MAIL-mail_draft_1', taskId: 'mail_task_1',
    workflowType: 'external_email_followup', communicationStatus: 'awaiting_send',
    subject: 'עדכון', draftBody: 'שלום, זהו נוסח הטיוטה.', summary: 'מעקב',
    to: ['recipient@example.com'], cc: [], bcc: [], linkedContactId: '',
    createdBy: 'sender_a', confirmedSentBy: '', confirmedSentAt: null,
    followUpAssigneeId: 'sender_a', nextFollowUpAt: '2026-08-04', priority: 'medium',
    completionCriteria: 'התקבלה תשובה', sourceTaskId: 'source_task',
    sourceTaskStorageMode: 'nested', sourceTaskOwnerId: '', linkedStudentId: '',
    linkedClassId: '', linkedTeamId: '', linkedInitiativeId: '', linkedMilestoneId: '',
    linkedEventId: '', linkedContextType: 'task', linkedContextId: 'source_task',
    linkedContextLabel: 'משימת מקור', linkedFileIds: [], links: [], actionHistory: [], reminderHistory: [],
    visibility: 'private', participantIds: ['sender_a'], lastEventId: 'mail_event_1', reminderNotifiedFor: '', schemaVersion: 1,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.set(doc(senderDb, eventPath), {
    schoolId: SCHOOL_A, draftId: 'mail_draft_1', taskId: 'mail_task_1',
    actorId: 'sender_a', type: 'draft_created', previousStatus: '', newStatus: 'awaiting_send',
    metadata: { note: '', previousDate: '', nextDate: '', previousAssigneeId: '', nextAssigneeId: '', reminderTone: '' },
    schemaVersion: 1, createdAt: serverTimestamp(),
  });
  await assertSucceeds(batch.commit());

  await assertSucceeds(getDoc(doc(senderDb, draftPath)));
  await assertSucceeds(getDoc(doc(context('view_all_a').firestore(), draftPath)));
  await assertFails(getDoc(doc(context('principal_a').firestore(), draftPath)));
  await assertFails(getDoc(doc(context('viewer_b').firestore(), draftPath)));
  await assertFails(getDoc(doc(context('platform_admin', { platform_admin: true }).firestore(), draftPath)));

  await assertFails(setDoc(
    doc(context('unauthorized_a').firestore(), `schools/${SCHOOL_A}/communicationDrafts/forged`),
    { schoolId: SCHOOL_A, createdBy: 'unauthorized_a' },
  ));
  await assertFails(updateDoc(doc(senderDb, draftPath), {
    communicationStatus: 'awaiting_reply',
    confirmedSentBy: 'sender_a',
    confirmedSentAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  const confirmation = writeBatch(senderDb);
  confirmation.update(doc(senderDb, draftPath), {
    communicationStatus: 'awaiting_reply',
    confirmedSentBy: 'sender_a',
    confirmedSentAt: serverTimestamp(),
    lastEventId: 'mail_event_2',
    updatedAt: serverTimestamp(),
  });
  confirmation.update(doc(senderDb, taskPath), {
    communicationStatus: 'awaiting_reply',
    updatedAt: serverTimestamp(),
  });
  confirmation.set(doc(senderDb, `schools/${SCHOOL_A}/communicationEvents/mail_event_2`), {
    schoolId: SCHOOL_A, draftId: 'mail_draft_1', taskId: 'mail_task_1',
    actorId: 'sender_a', type: 'send_confirmed', previousStatus: 'awaiting_send', newStatus: 'awaiting_reply',
    metadata: { note: '', previousDate: '', nextDate: '', previousAssigneeId: '', nextAssigneeId: '', reminderTone: '' },
    schemaVersion: 1, createdAt: serverTimestamp(),
  });
  await assertSucceeds(confirmation.commit());
  const savedDraft = await getDoc(doc(senderDb, draftPath));
  assert.equal(savedDraft.data().communicationStatus, 'awaiting_reply');
});

test('follow-up lifecycle is append-only, assignable inside the school and closable by permission', async () => {
  const taskPath = 'users/followup_owner/personalTasks/followup_task';
  const draftPath = `schools/${SCHOOL_A}/communicationDrafts/followup_draft`;
  await seedFirestore({
    'users/followup_owner': user({
      schoolId: SCHOOL_A,
      permissions: { 'communications.create': true, 'communications.reassign': true },
    }),
    'users/followup_assignee': user({ schoolId: SCHOOL_A }),
    'users/followup_manager': user({ schoolId: SCHOOL_A, permissions: { 'communications.viewAll': true, 'communications.reassign': true, 'communications.close': true } }),
    'users/followup_outsider': user({ schoolId: SCHOOL_A }),
    'users/followup_cross_school': user({ schoolId: SCHOOL_B }),
    [taskPath]: {
      title: 'מעקב מייל', description: 'מעקב', priority: 'medium', status: 'todo', taskStatus: 'todo',
      dueDate: '2026-08-04', reminderAt: '', tags: ['מייל'], attachedFileId: '', attachedFileName: '',
      initiativeId: '', milestoneId: '', scope: 'personal', schoolId: SCHOOL_A, ownerId: 'followup_owner',
      createdBy: 'followup_owner', assigneeIds: [], participantIds: ['followup_owner'], teamId: '',
      assigneeTeamId: '', completedAt: null, workflowType: 'external_email_followup',
      communicationStatus: 'awaiting_reply', communicationDraftId: 'followup_draft',
      communicationTrackingId: 'MAIL-followup_draft', nextFollowUpAt: '2026-08-04',
      completionCriteria: 'התקבלה תשובה', sourceTaskId: 'source_task', sourceTaskStorageMode: 'nested',
    },
    [draftPath]: {
      schoolId: SCHOOL_A, trackingId: 'MAIL-followup_draft', taskId: 'followup_task',
      workflowType: 'external_email_followup', communicationStatus: 'awaiting_reply', subject: 'תיאום',
      draftBody: 'טיוטה', summary: 'מעקב', to: ['vendor@example.com'], cc: [], bcc: [],
      linkedContactId: '', createdBy: 'followup_owner', confirmedSentBy: 'followup_owner',
      confirmedSentAt: 'sent', followUpAssigneeId: 'followup_owner', nextFollowUpAt: '2026-08-04',
      priority: 'medium', completionCriteria: 'התקבלה תשובה', sourceTaskId: 'source_task',
      sourceTaskStorageMode: 'nested', sourceTaskOwnerId: '', linkedStudentId: '', linkedClassId: '',
      linkedTeamId: '', linkedInitiativeId: '', linkedMilestoneId: '', linkedEventId: '',
      linkedContextType: 'task', linkedContextId: 'source_task', linkedContextLabel: 'משימת מקור',
      linkedFileIds: [], links: [], actionHistory: [], reminderHistory: [], visibility: 'private',
      participantIds: ['followup_owner'], lastEventId: 'initial_event', reminderNotifiedFor: '', schemaVersion: 1,
      createdAt: 'created', updatedAt: 'created',
    },
  });

  const metadata = (overrides = {}) => ({
    note: '', previousDate: '', nextDate: '', previousAssigneeId: '',
    nextAssigneeId: '', reminderTone: '', ...overrides,
  });
  const event = (actorId, type, previousStatus, newStatus, overrides = {}) => ({
    schoolId: SCHOOL_A, draftId: 'followup_draft', taskId: 'followup_task', actorId, type,
    previousStatus, newStatus, metadata: metadata(overrides), schemaVersion: 1, createdAt: serverTimestamp(),
  });

  const ownerDb = context('followup_owner').firestore();
  const reassign = writeBatch(ownerDb);
  reassign.update(doc(ownerDb, draftPath), {
    followUpAssigneeId: 'followup_assignee', participantIds: ['followup_owner', 'followup_assignee'],
    lastEventId: 'reassign_event', updatedAt: serverTimestamp(),
  });
  reassign.set(doc(ownerDb, `schools/${SCHOOL_A}/communicationEvents/reassign_event`),
    event('followup_owner', 'responsibility_reassigned', 'awaiting_reply', 'awaiting_reply', {
      previousAssigneeId: 'followup_owner', nextAssigneeId: 'followup_assignee',
    }));
  await assertSucceeds(reassign.commit());
  await assertSucceeds(getDoc(doc(context('followup_assignee').firestore(), draftPath)));

  const outsiderDb = context('followup_outsider').firestore();
  await assertFails(updateDoc(doc(outsiderDb, draftPath), { nextFollowUpAt: '2026-08-10' }));

  const assigneeDb = context('followup_assignee').firestore();
  const postpone = writeBatch(assigneeDb);
  postpone.update(doc(assigneeDb, draftPath), {
    communicationStatus: 'postponed', nextFollowUpAt: '2026-08-10', reminderNotifiedFor: '',
    lastEventId: 'postpone_event', updatedAt: serverTimestamp(),
  });
  postpone.set(doc(assigneeDb, `schools/${SCHOOL_A}/communicationEvents/postpone_event`),
    event('followup_assignee', 'no_reply_reported', 'awaiting_reply', 'postponed', {
      previousDate: '2026-08-04', nextDate: '2026-08-10',
    }));
  await assertSucceeds(postpone.commit());

  const managerDb = context('followup_manager').firestore();
  const crossSchoolReassign = writeBatch(managerDb);
  crossSchoolReassign.update(doc(managerDb, draftPath), {
    followUpAssigneeId: 'followup_cross_school',
    participantIds: ['followup_owner', 'followup_assignee', 'followup_cross_school'],
    lastEventId: 'cross_school_event', updatedAt: serverTimestamp(),
  });
  crossSchoolReassign.set(doc(managerDb, `schools/${SCHOOL_A}/communicationEvents/cross_school_event`),
    event('followup_manager', 'responsibility_reassigned', 'postponed', 'postponed', {
      previousAssigneeId: 'followup_assignee', nextAssigneeId: 'followup_cross_school',
    }));
  await assertFails(crossSchoolReassign.commit());

  const close = writeBatch(managerDb);
  close.update(doc(managerDb, draftPath), {
    communicationStatus: 'closed_without_reply', lastEventId: 'close_event', updatedAt: serverTimestamp(),
  });
  close.set(doc(managerDb, `schools/${SCHOOL_A}/communicationEvents/close_event`),
    event('followup_manager', 'closed_without_reply', 'postponed', 'closed_without_reply'));
  await assertSucceeds(close.commit());
  await assertFails(updateDoc(doc(assigneeDb, draftPath), { nextFollowUpAt: '2026-08-12' }));
});

test('student-linked communication requires student access and always remains private', async () => {
  await seedFirestore({
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    'users/sender_a': user({ schoolId: SCHOOL_A, permissions: { 'communications.create': true } }),
    [`schools/${SCHOOL_A}/students/student_1`]: { schoolId: SCHOOL_A, classId: 'class_1', fullName: 'Student' },
  });

  function studentCommunicationBatch(uid, suffix, visibility = 'private', participantIds = [uid]) {
    const client = context(uid).firestore();
    const taskId = `student_mail_task_${suffix}`;
    const draftId = `student_mail_draft_${suffix}`;
    const trackingId = `MAIL-${draftId}`;
    const batch = writeBatch(client);
    batch.set(doc(client, `users/${uid}/personalTasks/${taskId}`), {
      title: 'מעקב מייל: תלמיד', description: 'מעקב', priority: 'medium', status: 'todo', taskStatus: 'todo',
      dueDate: '2026-08-04', reminderAt: '', tags: ['מייל'], attachedFileId: '', attachedFileName: '',
      initiativeId: '', milestoneId: '', scope: 'personal', schoolId: SCHOOL_A, ownerId: uid, createdBy: uid,
      createdByName: 'Sender', assigneeIds: [], participantIds: [uid], teamId: '', assigneeTeamId: '',
      completedAt: null, workflowType: 'external_email_followup', communicationStatus: 'awaiting_send',
      communicationDraftId: draftId, communicationTrackingId: trackingId, nextFollowUpAt: '2026-08-04',
      completionCriteria: 'התקבלה תשובה', sourceTaskId: 'student_1', sourceTaskStorageMode: 'context',
      linkedContextType: 'student', linkedContextId: 'student_1', linkedContextLabel: 'Student',
      communicationSubject: 'עדכון', externalRecipientLabel: 'parent@example.com',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    batch.set(doc(client, `schools/${SCHOOL_A}/communicationDrafts/${draftId}`), {
      schoolId: SCHOOL_A, trackingId, taskId, workflowType: 'external_email_followup',
      communicationStatus: 'awaiting_send', subject: 'עדכון', draftBody: 'נוסח שאינו מכיל מידע רגיש.',
      summary: 'מעקב', to: ['parent@example.com'], cc: [], bcc: [], linkedContactId: '', createdBy: uid,
      confirmedSentBy: '', confirmedSentAt: null, followUpAssigneeId: uid, nextFollowUpAt: '2026-08-04',
      priority: 'medium', completionCriteria: 'התקבלה תשובה', sourceTaskId: 'student_1',
      sourceTaskStorageMode: 'context', sourceTaskOwnerId: '', linkedStudentId: 'student_1',
      linkedClassId: 'class_1', linkedTeamId: '', linkedInitiativeId: '', linkedMilestoneId: '', linkedEventId: '',
      linkedContextType: 'student', linkedContextId: 'student_1', linkedContextLabel: 'Student',
      linkedFileIds: [], links: [], actionHistory: [], reminderHistory: [], visibility, participantIds,
      lastEventId: `student_mail_event_${suffix}`, reminderNotifiedFor: '',
      schemaVersion: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    batch.set(doc(client, `schools/${SCHOOL_A}/communicationEvents/student_mail_event_${suffix}`), {
      schoolId: SCHOOL_A, draftId, taskId, actorId: uid, type: 'draft_created', schemaVersion: 1,
      previousStatus: '', newStatus: 'awaiting_send',
      metadata: { note: '', previousDate: '', nextDate: '', previousAssigneeId: '', nextAssigneeId: '', reminderTone: '' },
      createdAt: serverTimestamp(),
    });
    return batch;
  }

  await assertSucceeds(studentCommunicationBatch('principal_a', 'private').commit());
  await assertFails(studentCommunicationBatch('principal_a', 'shared', 'participants', ['principal_a', 'sender_a']).commit());
  await assertFails(studentCommunicationBatch('sender_a', 'no_student_access').commit());
});

test('institutional and private contacts enforce permissions, visibility and tenant isolation', async () => {
  const institutionalContact = ({
    schoolId = SCHOOL_A,
    createdBy = 'contact_creator_a',
    visibility = 'institution',
    ownerStaffIds = [],
    archived = false,
  } = {}) => ({
    scope: 'institutional', schoolId, fullName: 'External Contact', organization: 'Vendor Ltd',
    jobTitle: 'Coordinator', primaryEmail: 'contact@example.com', additionalEmails: [],
    normalizedEmails: ['contact@example.com'], phone: '', category: 'vendor', tags: [], notes: '',
    ownerStaffIds, visibility, linkedStaffId: '', archived, schemaVersion: 1,
    createdBy, updatedBy: createdBy, archivedBy: '', archivedAt: null,
    mergedIntoId: '', mergedFromIds: [], createdAt: 'created', updatedAt: 'created',
  });
  const privateContact = {
    scope: 'private', ownerId: 'private_owner_a', schoolId: SCHOOL_A,
    fullName: 'Private Contact', organization: '', jobTitle: '',
    primaryEmail: 'private@example.com', additionalEmails: [],
    normalizedEmails: ['private@example.com'], phone: '', category: '', tags: [], notes: '',
    archived: false, schemaVersion: 1, createdBy: 'private_owner_a', updatedBy: 'private_owner_a',
    archivedBy: '', archivedAt: null, mergedIntoId: '', mergedFromIds: [],
    createdAt: 'created', updatedAt: 'created',
  };
  await seedFirestore({
    'users/contact_viewer_a': user({ schoolId: SCHOOL_A, permissions: { 'contacts.view': true } }),
    'users/contact_creator_a': user({ schoolId: SCHOOL_A, permissions: { 'contacts.view': true, 'contacts.create': true } }),
    'users/contact_editor_a': user({ schoolId: SCHOOL_A, permissions: { 'contacts.view': true, 'contacts.edit': true } }),
    'users/contact_archiver_a': user({ schoolId: SCHOOL_A, permissions: { 'contacts.view': true, 'contacts.archive': true } }),
    'users/contact_merger_a': user({ schoolId: SCHOOL_A, permissions: { 'contacts.view': true, 'contacts.merge': true } }),
    'users/responsible_a': user({ schoolId: SCHOOL_A }),
    'users/peer_a': user({ schoolId: SCHOOL_A }),
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    'users/private_owner_a': user({ schoolId: SCHOOL_A }),
    'users/viewer_b': user({ schoolId: SCHOOL_B, permissions: { 'contacts.view': true } }),
    'users/platform_admin': user({ schoolId: SCHOOL_A }),
    [`schools/${SCHOOL_A}/contactDirectory/institutional/items/public_contact`]: institutionalContact(),
    [`schools/${SCHOOL_A}/contactDirectory/institutional/items/restricted_contact`]: institutionalContact({
      visibility: 'responsible_staff', ownerStaffIds: ['responsible_a'],
    }),
    [`schools/${SCHOOL_A}/contactDirectory/institutional/items/merge_source`]: {
      ...institutionalContact({ createdBy: 'contact_merger_a' }),
      primaryEmail: 'source@example.com', normalizedEmails: ['source@example.com'],
    },
    [`schools/${SCHOOL_A}/contactDirectory/institutional/items/merge_target`]: {
      ...institutionalContact({ createdBy: 'contact_merger_a' }),
      primaryEmail: 'target@example.com', normalizedEmails: ['target@example.com'],
    },
    'users/private_owner_a/contactDirectory/private/items/private_contact': privateContact,
  });

  const publicPath = `schools/${SCHOOL_A}/contactDirectory/institutional/items/public_contact`;
  const restrictedPath = `schools/${SCHOOL_A}/contactDirectory/institutional/items/restricted_contact`;
  await assertSucceeds(getDoc(doc(context('contact_viewer_a').firestore(), publicPath)));
  await assertFails(getDoc(doc(context('contact_viewer_a').firestore(), restrictedPath)));
  await assertSucceeds(getDoc(doc(context('responsible_a').firestore(), restrictedPath)));
  await assertSucceeds(getDoc(doc(context('principal_a').firestore(), restrictedPath)));
  await assertFails(getDoc(doc(context('peer_a').firestore(), publicPath)));
  await assertFails(getDoc(doc(context('viewer_b').firestore(), publicPath)));
  await assertFails(getDoc(doc(context('platform_admin', { platform_admin: true }).firestore(), publicPath)));
  await assertSucceeds(getDocs(query(
    collection(context('contact_viewer_a').firestore(), `schools/${SCHOOL_A}/contactDirectory/institutional/items`),
    where('visibility', '==', 'institution'),
  )));

  const createPayload = {
    ...institutionalContact(),
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(
    doc(context('contact_creator_a').firestore(), `schools/${SCHOOL_A}/contactDirectory/institutional/items/new_contact`),
    createPayload,
  ));
  await assertFails(setDoc(
    doc(context('peer_a').firestore(), `schools/${SCHOOL_A}/contactDirectory/institutional/items/forged_contact`),
    { ...createPayload, createdBy: 'peer_a', updatedBy: 'peer_a' },
  ));
  await assertFails(setDoc(
    doc(context('contact_creator_a').firestore(), `schools/${SCHOOL_A}/contactDirectory/institutional/items/extra_field`),
    { ...createPayload, unsafeField: true },
  ));
  await assertSucceeds(updateDoc(doc(context('contact_editor_a').firestore(), publicPath), {
    fullName: 'Updated External Contact',
    updatedBy: 'contact_editor_a',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(context('contact_editor_a').firestore(), publicPath), {
    schoolId: SCHOOL_B,
    updatedBy: 'contact_editor_a',
    updatedAt: serverTimestamp(),
  }));
  const mergerDb = context('contact_merger_a').firestore();
  const mergeBatch = writeBatch(mergerDb);
  mergeBatch.update(
    doc(mergerDb, `schools/${SCHOOL_A}/contactDirectory/institutional/items/merge_target`),
    {
      primaryEmail: 'target@example.com',
      additionalEmails: ['source@example.com'],
      normalizedEmails: ['target@example.com', 'source@example.com'],
      mergedFromIds: ['merge_source'],
      updatedBy: 'contact_merger_a',
      updatedAt: serverTimestamp(),
    },
  );
  mergeBatch.update(
    doc(mergerDb, `schools/${SCHOOL_A}/contactDirectory/institutional/items/merge_source`),
    {
      archived: true,
      archivedBy: 'contact_merger_a',
      archivedAt: serverTimestamp(),
      mergedIntoId: 'merge_target',
      updatedBy: 'contact_merger_a',
      updatedAt: serverTimestamp(),
    },
  );
  await assertSucceeds(mergeBatch.commit());
  await assertFails(deleteDoc(doc(context('principal_a').firestore(), publicPath)));
  await assertSucceeds(updateDoc(doc(context('contact_archiver_a').firestore(), publicPath), {
    archived: true,
    archivedBy: 'contact_archiver_a',
    archivedAt: serverTimestamp(),
    updatedBy: 'contact_archiver_a',
    updatedAt: serverTimestamp(),
  }));

  const privatePath = 'users/private_owner_a/contactDirectory/private/items/private_contact';
  await assertSucceeds(getDoc(doc(context('private_owner_a').firestore(), privatePath)));
  await assertFails(getDoc(doc(context('peer_a').firestore(), privatePath)));
  await assertFails(getDoc(doc(context('principal_a').firestore(), privatePath)));
  await assertFails(getDoc(doc(context('platform_admin', { platform_admin: true }).firestore(), privatePath)));
  await assertSucceeds(setDoc(
    doc(context('private_owner_a').firestore(), 'users/private_owner_a/contactDirectory/private/items/new_private'),
    { ...privateContact, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
  ));
  await assertSucceeds(updateDoc(doc(context('private_owner_a').firestore(), privatePath), {
    fullName: 'Updated Private Contact',
    updatedBy: 'private_owner_a',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(
    doc(context('peer_a').firestore(), 'users/private_owner_a/contactDirectory/private/items/forged_private'),
    { ...privateContact, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
  ));
  await assertFails(deleteDoc(doc(context('private_owner_a').firestore(), privatePath)));
});

test('communication templates remain owner-scoped, tenant-scoped and archive-only', async () => {
  await seedFirestore({
    'users/template_owner_a': user({ schoolId: SCHOOL_A, permissions: { 'communications.create': true } }),
    'users/template_peer_a': user({ schoolId: SCHOOL_A, permissions: { 'communications.create': true } }),
    'users/template_reader_a': user({ schoolId: SCHOOL_A, permissions: { 'communications.useAgent': true } }),
    'users/template_manager_a': user({ schoolId: SCHOOL_A, permissions: { 'communications.manageTemplates': true } }),
    'users/template_viewer_a': user({ schoolId: SCHOOL_A }),
    'users/template_manager_b': user({ schoolId: SCHOOL_B, permissions: { 'communications.manageTemplates': true } }),
  });
  const payload = ({ scope, schoolId, ownerId, actor }) => ({
    scope,
    schoolId,
    ownerId,
    name: 'תזכורת מוסדית',
    category: 'מעקב',
    subjectTemplate: 'תזכורת: {{subject}}',
    bodyTemplate: 'שלום, נשמח לקבל עדכון.',
    tone: 'respectful',
    archived: false,
    archivedBy: '',
    archivedAt: null,
    createdBy: actor,
    updatedBy: actor,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    schemaVersion: 1,
  });

  const privatePath = 'users/template_owner_a/communicationTemplates/private_a';
  const institutionalPath = `schools/${SCHOOL_A}/communicationTemplates/institutional_a`;
  await assertSucceeds(setDoc(
    doc(context('template_owner_a').firestore(), privatePath),
    payload({ scope: 'private', schoolId: SCHOOL_A, ownerId: 'template_owner_a', actor: 'template_owner_a' }),
  ));
  await assertSucceeds(getDoc(doc(context('template_owner_a').firestore(), privatePath)));
  await assertFails(getDoc(doc(context('template_peer_a').firestore(), privatePath)));
  await assertFails(updateDoc(doc(context('template_owner_a').firestore(), privatePath), {
    ownerId: 'template_peer_a',
    updatedBy: 'template_owner_a',
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(context('template_owner_a').firestore(), privatePath), {
    archived: true,
    archivedBy: 'template_owner_a',
    archivedAt: serverTimestamp(),
    updatedBy: 'template_owner_a',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(deleteDoc(doc(context('template_owner_a').firestore(), privatePath)));

  await assertSucceeds(setDoc(
    doc(context('template_manager_a').firestore(), institutionalPath),
    payload({ scope: 'institutional', schoolId: SCHOOL_A, ownerId: '', actor: 'template_manager_a' }),
  ));
  await assertSucceeds(getDoc(doc(context('template_reader_a').firestore(), institutionalPath)));
  await assertFails(getDoc(doc(context('template_viewer_a').firestore(), institutionalPath)));
  await assertFails(getDoc(doc(context('template_manager_b').firestore(), institutionalPath)));
  await assertFails(setDoc(
    doc(context('template_owner_a').firestore(), `schools/${SCHOOL_A}/communicationTemplates/forged`),
    payload({ scope: 'institutional', schoolId: SCHOOL_A, ownerId: '', actor: 'template_owner_a' }),
  ));
  await assertFails(deleteDoc(doc(context('template_manager_a').firestore(), institutionalPath)));
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

test('legacy tasks without schoolId support chat activity only for task participants', async () => {
  await seedFirestore({
    'users/member_a': user({ schoolId: SCHOOL_A }),
    'users/peer_a': user({ schoolId: SCHOOL_A }),
    [`tasks_${SCHOOL_A}/legacy_without_school_id`]: {
      scope: 'assigned', createdBy: 'owner_a', title: 'Older legacy task',
      status: 'todo', assigneeType: 'individual', assigneeIds: ['member_a'],
      participantIds: ['member_a'], teamId: '', assigneeTeamId: '',
    },
  });
  const taskPath = `tasks_${SCHOOL_A}/legacy_without_school_id`;
  await assertSucceeds(updateDoc(doc(context('member_a').firestore(), taskPath), {
    lastChatMessageAt: serverTimestamp(),
    lastChatMessageBy: 'member_a',
    lastChatPreview: 'New message',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(context('peer_a').firestore(), taskPath), {
    lastChatMessageAt: serverTimestamp(),
    lastChatMessageBy: 'peer_a',
    lastChatPreview: 'Unauthorized message',
    updatedAt: serverTimestamp(),
  }));
});

test('principal creates an initiative while unauthorized and cross-school users remain blocked', async () => {
  await seedFirestore({
    'users/principal_a': { ...user({ schoolId: SCHOOL_A, role: 'principal' }), uid: 'principal_a' },
    'users/member_a': { ...user({ schoolId: SCHOOL_A }), uid: 'member_a' },
    'users/outsider_a': { ...user({ schoolId: SCHOOL_A }), uid: 'outsider_a' },
    'users/member_b': { ...user({ schoolId: SCHOOL_B }), uid: 'member_b' },
  });
  const principalDb = context('principal_a').firestore();
  const initiativeRef = doc(principalDb, `schools/${SCHOOL_A}/initiatives/initiative_created`);
  const payload = {
    ...initiativeRecord({ ownerId: 'principal_a', memberIds: ['member_a'] }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(initiativeRef, payload));
  await assertSucceeds(getDoc(doc(context('member_a').firestore(), initiativeRef.path)));
  await assertFails(getDoc(doc(context('outsider_a').firestore(), initiativeRef.path)));
  await assertFails(getDoc(doc(context('member_b').firestore(), initiativeRef.path)));
  await assertFails(setDoc(
    doc(context('outsider_a').firestore(), `schools/${SCHOOL_A}/initiatives/initiative_denied`),
    { ...payload, createdBy: 'outsider_a', updatedBy: 'outsider_a' },
  ));
  await assertFails(deleteDoc(initiativeRef));
});

test('initiative milestone completion enforces evidence and permits only its authorized approver', async () => {
  await seedFirestore({
    'users/principal_a': { ...user({ schoolId: SCHOOL_A, role: 'principal' }), uid: 'principal_a' },
    'users/approver_a': {
      ...user({ schoolId: SCHOOL_A, permissions: { 'initiatives.approveMilestones': true } }),
      uid: 'approver_a',
    },
    'users/member_a': { ...user({ schoolId: SCHOOL_A }), uid: 'member_a' },
    [`schools/${SCHOOL_A}/initiatives/initiative_a`]: initiativeRecord({
      memberIds: ['approver_a', 'member_a'],
    }),
    [`schools/${SCHOOL_A}/initiatives/initiative_a/milestones/milestone_a`]: milestoneRecord({
      approverId: 'approver_a',
      requiresEvidence: true,
    }),
  });
  const milestonePath = `schools/${SCHOOL_A}/initiatives/initiative_a/milestones/milestone_a`;
  const approverRef = doc(context('approver_a').firestore(), milestonePath);
  await assertSucceeds(getDoc(approverRef));
  await assertFails(updateDoc(approverRef, {
    status: 'completed',
    updatedBy: 'approver_a',
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(approverRef, {
    status: 'completed',
    completionSummary: 'Output reviewed and accepted.',
    updatedBy: 'approver_a',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(context('member_a').firestore(), milestonePath), {
    status: 'cancelled',
    cancelReason: 'Unauthorized',
    updatedBy: 'member_a',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(context('member_a').firestore(), milestonePath), {
    archived: true,
    archivedBy: 'member_a',
    archivedAt: serverTimestamp(),
    archiveReason: '',
    updatedBy: 'member_a',
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(context('principal_a').firestore(), milestonePath), {
    archived: true,
    archivedBy: 'principal_a',
    archivedAt: serverTimestamp(),
    archiveReason: 'Removed from the active plan without deleting history.',
    updatedBy: 'principal_a',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(deleteDoc(approverRef));
});

test('initiative update comments are append-only and limited to visible initiative members', async () => {
  await seedFirestore({
    'users/owner_a': { ...user({ schoolId: SCHOOL_A }), uid: 'owner_a' },
    'users/member_a': { ...user({ schoolId: SCHOOL_A }), uid: 'member_a' },
    'users/outsider_a': { ...user({ schoolId: SCHOOL_A }), uid: 'outsider_a' },
    [`schools/${SCHOOL_A}/initiatives/initiative_a`]: initiativeRecord({
      ownerId: 'owner_a',
      memberIds: ['member_a'],
    }),
    [`schools/${SCHOOL_A}/initiatives/initiative_a/updates/update_a`]: {
      schoolId: SCHOOL_A,
      initiativeId: 'initiative_a',
      authorId: 'owner_a',
      type: 'progress',
      text: 'Progress update',
      createdAt: 'created',
      updatedAt: 'created',
    },
  });
  const commentPath = `schools/${SCHOOL_A}/initiatives/initiative_a/comments/comment_a`;
  const comment = {
    schoolId: SCHOOL_A,
    initiativeId: 'initiative_a',
    updateId: 'update_a',
    authorId: 'member_a',
    authorName: 'Member',
    text: 'Reviewed',
    createdAt: serverTimestamp(),
  };
  const memberRef = doc(context('member_a').firestore(), commentPath);
  await assertSucceeds(setDoc(memberRef, comment));
  await assertSucceeds(getDoc(memberRef));
  await assertFails(setDoc(doc(context('outsider_a').firestore(), `${commentPath}_denied`), {
    ...comment,
    authorId: 'outsider_a',
  }));
  await assertFails(updateDoc(memberRef, { text: 'Changed' }));
  await assertFails(deleteDoc(memberRef));
});

test('tasks link to an existing visible initiative and milestone without creating a duplicate task', async () => {
  await seedFirestore({
    'users/assigner_a': {
      ...user({ schoolId: SCHOOL_A, permissions: { tasks_assign: true } }),
      uid: 'assigner_a',
    },
    'users/member_a': { ...user({ schoolId: SCHOOL_A }), uid: 'member_a' },
    [`schools/${SCHOOL_A}/initiatives/initiative_a`]: initiativeRecord({
      ownerId: 'assigner_a',
      memberIds: ['member_a'],
    }),
    [`schools/${SCHOOL_A}/initiatives/initiative_a/milestones/milestone_a`]: milestoneRecord({
      actor: 'assigner_a',
    }),
  });
  const assignerDb = context('assigner_a').firestore();
  const baseTask = {
    scope: 'assigned',
    schoolId: SCHOOL_A,
    createdBy: 'assigner_a',
    title: 'Linked task',
    status: 'todo',
    assigneeType: 'individual',
    assigneeIds: ['member_a'],
    teamId: '',
    assigneeTeamId: '',
    initiativeId: 'initiative_a',
    milestoneId: 'milestone_a',
  };
  await assertSucceeds(setDoc(doc(assignerDb, `schools/${SCHOOL_A}/tasks/linked_task`), baseTask));
  await assertFails(setDoc(doc(assignerDb, `schools/${SCHOOL_A}/tasks/missing_initiative`), {
    ...baseTask,
    initiativeId: 'missing',
    milestoneId: '',
  }));
  await assertFails(setDoc(doc(assignerDb, `schools/${SCHOOL_A}/tasks/missing_milestone`), {
    ...baseTask,
    milestoneId: 'missing',
  }));
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

test('login activity is append-only, tenant-scoped and visible only to the school manager', async () => {
  await seedFirestore({
    'users/principal_a': { ...user({ schoolId: SCHOOL_A, role: 'principal' }), uid: 'principal_a' },
    'users/principal_b': { ...user({ schoolId: SCHOOL_B, role: 'principal' }), uid: 'principal_b' },
    'users/viewer_a': { ...user({ schoolId: SCHOOL_A }), uid: 'viewer_a' },
  });

  const viewerDb = context('viewer_a').firestore();
  const viewerLoginRef = doc(viewerDb, `schools/${SCHOOL_A}/loginActivity/viewer_a/entries/login_a`);
  await assertSucceeds(setDoc(viewerLoginRef, {
    userId: 'viewer_a',
    schoolId: SCHOOL_A,
    eventType: 'school_login',
    loggedInAt: serverTimestamp(),
    schemaVersion: 1,
  }));

  await assertFails(getDoc(viewerLoginRef));
  await assertFails(updateDoc(viewerLoginRef, { eventType: 'edited' }));
  await assertFails(deleteDoc(viewerLoginRef));
  await assertFails(setDoc(doc(viewerDb, `schools/${SCHOOL_A}/loginActivity/principal_a/entries/spoofed_user`), {
    userId: 'principal_a', schoolId: SCHOOL_A, eventType: 'school_login',
    loggedInAt: serverTimestamp(), schemaVersion: 1,
  }));
  await assertFails(setDoc(doc(viewerDb, `schools/${SCHOOL_B}/loginActivity/viewer_a/entries/spoofed_school`), {
    userId: 'viewer_a', schoolId: SCHOOL_B, eventType: 'school_login',
    loggedInAt: serverTimestamp(), schemaVersion: 1,
  }));

  const principalADb = context('principal_a').firestore();
  await assertSucceeds(getDoc(doc(principalADb, `schools/${SCHOOL_A}/loginActivity/viewer_a/entries/login_a`)));
  await assertSucceeds(getDocs(query(
    collection(principalADb, `schools/${SCHOOL_A}/loginActivity/viewer_a/entries`),
    orderBy('loggedInAt', 'desc'),
    limit(10),
  )));
  const principalLoginRef = doc(principalADb, `schools/${SCHOOL_A}/loginActivity/principal_a/entries/login_manager`);
  await assertSucceeds(setDoc(principalLoginRef, {
    userId: 'principal_a',
    schoolId: SCHOOL_A,
    eventType: 'school_login',
    loggedInAt: serverTimestamp(),
    schemaVersion: 1,
  }));
  await assertSucceeds(getDoc(principalLoginRef));
  await assertFails(getDoc(doc(context('principal_b').firestore(), `schools/${SCHOOL_A}/loginActivity/viewer_a/entries/login_a`)));
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

test('student identity is readable only with the sensitive-fields capability and is server-managed', async () => {
  await seedFirestore({
    'users/viewer_a': user({ schoolId: SCHOOL_A, permissions: { students_view: true } }),
    'users/sensitive_a': user({
      schoolId: SCHOOL_A,
      permissions: { students_view: true, 'students.viewSensitiveFields': true },
    }),
    'users/sensitive_b': user({
      schoolId: SCHOOL_B,
      permissions: { students_view: true, 'students.viewSensitiveFields': true },
    }),
    [`schools/${SCHOOL_A}/students/student_a`]: studentRecord(),
    [`schools/${SCHOOL_A}/students/student_a/sensitive/identity`]: {
      schoolId: SCHOOL_A,
      studentId: 'student_a',
      idNumber: 'protected-value',
      normalizedIdNumber: 'PROTECTEDVALUE',
      createdBy: 'server',
      updatedBy: 'server',
    },
  });
  const identityPath = `schools/${SCHOOL_A}/students/student_a/sensitive/identity`;
  await assertFails(getDoc(doc(context('viewer_a').firestore(), identityPath)));
  await assertSucceeds(getDoc(doc(context('sensitive_a').firestore(), identityPath)));
  await assertFails(getDoc(doc(context('sensitive_b').firestore(), identityPath)));
  await assertFails(updateDoc(doc(context('sensitive_a').firestore(), identityPath), {
    idNumber: 'client-change',
  }));
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

test('school principal stores an attributed holiday only in their own school', async () => {
  await seedFirestore({
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    'users/viewer_a': user({ schoolId: SCHOOL_A }),
  });
  const principalDb = context('principal_a').firestore();
  const holiday = {
    schoolId: SCHOOL_A,
    academicYearId: 'year_2026_2027',
    officialHolidayId: 'tashpaz_rosh_hashanah',
    name: 'ראש השנה',
    startDate: '2026-09-11',
    endDate: '2026-09-13',
    returnDate: '2026-09-14',
    sourceUrl: 'https://meyda.education.gov.il/official.pdf',
    type: 'jewish',
    isVacation: true,
    isSchoolDay: false,
  };

  await assertSucceeds(setDoc(doc(principalDb, `holidays_${SCHOOL_A}/official_rosh_hashanah`), holiday));
  await assertSucceeds(getDoc(doc(context('viewer_a').firestore(), `holidays_${SCHOOL_A}/official_rosh_hashanah`)));
  await assertFails(setDoc(doc(principalDb, `holidays_${SCHOOL_B}/forbidden_holiday`), {
    ...holiday,
    schoolId: SCHOOL_B,
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

test('calendar edit granted by a custom role permits event changes without broadening viewer access', async () => {
  await seedFirestore({
    'users/calendar_editor_a': {
      ...user({ schoolId: SCHOOL_A }),
      customRoleIds: ['calendar_editor'],
      rolePermissionsBySchool: { [SCHOOL_A]: { 'calendar.edit': true } },
    },
    'users/calendar_viewer_a': user({ schoolId: SCHOOL_A }),
  });

  const editorDb = context('calendar_editor_a').firestore();
  const viewerDb = context('calendar_viewer_a').firestore();
  const eventPath = `schools/${SCHOOL_A}/events/calendar_event_a`;

  await assertSucceeds(setDoc(doc(editorDb, eventPath), {
    schoolId: SCHOOL_A,
    title: 'Calendar event',
    createdBy: 'calendar_editor_a',
    updatedBy: 'calendar_editor_a',
    createdAt: 'created',
    updatedAt: 'created',
  }));
  await assertSucceeds(updateDoc(doc(editorDb, eventPath), {
    title: 'Updated calendar event',
    updatedAt: 'updated',
  }));
  await assertFails(setDoc(doc(viewerDb, `schools/${SCHOOL_A}/events/forbidden_event`), {
    schoolId: SCHOOL_A,
    title: 'Forbidden event',
    createdBy: 'calendar_viewer_a',
    updatedBy: 'calendar_viewer_a',
    createdAt: 'created',
    updatedAt: 'created',
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

test('attendance legend managers permanently delete items while viewers cannot', async () => {
  const legendItem = {
    schoolId: SCHOOL_A,
    label: 'מעקב',
    shortCode: 'מ',
    color: '#8b5cf6',
    type: 'action',
    attendanceEffect: 'neutral',
    active: true,
    createdBy: 'principal_a',
    createdAt: 'created',
    updatedAt: 'created',
  };
  await seedFirestore({
    'users/legend_manager_a': user({ schoolId: SCHOOL_A, permissions: { attendance_manage_legend: true } }),
    'users/legend_viewer_a': user({ schoolId: SCHOOL_A, permissions: { attendance_view: true } }),
    [`schools/${SCHOOL_A}/classes/class_a`]: classRecord(),
    [`schools/${SCHOOL_A}/files/attendance_nested`]: attendanceFile(),
    [`schools/${SCHOOL_A}/files/attendance_nested/attendanceLegend/tracking`]: { ...legendItem, fileId: 'attendance_nested' },
    [`files_${SCHOOL_A}/attendance_legacy`]: attendanceFile(),
    [`files_${SCHOOL_A}/attendance_legacy/attendanceLegend/tracking`]: { ...legendItem, fileId: 'attendance_legacy' },
  });
  const viewerDb = context('legend_viewer_a').firestore();
  const managerDb = context('legend_manager_a').firestore();
  const nestedPath = `schools/${SCHOOL_A}/files/attendance_nested/attendanceLegend/tracking`;
  const legacyPath = `files_${SCHOOL_A}/attendance_legacy/attendanceLegend/tracking`;

  await assertFails(deleteDoc(doc(viewerDb, nestedPath)));
  await assertFails(deleteDoc(doc(viewerDb, legacyPath)));
  await assertSucceeds(deleteDoc(doc(managerDb, nestedPath)));
  await assertSucceeds(deleteDoc(doc(managerDb, legacyPath)));
  assert.equal((await getDoc(doc(managerDb, nestedPath))).exists(), false);
  assert.equal((await getDoc(doc(managerDb, legacyPath))).exists(), false);
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

test('resource ACL inherits folder grants, applies explicit deny and stays server-managed', async () => {
  const level = (overrides = {}) => ({
    allowedUsers: [], allowedTeams: [], allowedRoles: [], allowedClasses: [],
    deniedUsers: [], deniedTeams: [], deniedRoles: [], deniedClasses: [],
    ...overrides,
  });
  await seedFirestore({
    'users/allowed_a': user({ schoolId: SCHOOL_A, teamIds: ['team_a'] }),
    'users/denied_a': user({ schoolId: SCHOOL_A, teamIds: ['team_a'] }),
    [`schools/${SCHOOL_A}/folders/folder_acl`]: { schoolId: SCHOOL_A, name: 'Shared', visibility: 'all' },
    [`schools/${SCHOOL_A}/files/file_acl`]: { schoolId: SCHOOL_A, name: 'Child', fileType: 'document', folderId: 'folder_acl' },
    [`schools/${SCHOOL_A}/resourceAclPolicies/folder_folder_acl`]: {
      schoolId: SCHOOL_A, resourceType: 'folder', resourceId: 'folder_acl', configured: true,
      view: level({ allowedTeams: ['team_a'], deniedUsers: ['denied_a'] }),
      comment: level(), edit: level(), manage: level(),
    },
  });
  await assertSucceeds(getDoc(doc(context('allowed_a').firestore(), `schools/${SCHOOL_A}/files/file_acl`)));
  await assertFails(getDoc(doc(context('denied_a').firestore(), `schools/${SCHOOL_A}/files/file_acl`)));
  await assertFails(setDoc(doc(context('allowed_a').firestore(), `schools/${SCHOOL_A}/resourceAcls/client_acl`), {
    schoolId: SCHOOL_A, resourceType: 'file', resourceId: 'file_acl', principalType: 'user', principalId: 'allowed_a',
  }));
});

test('resource ACL role identifiers never leak across a multi-school membership', async () => {
  const level = (overrides = {}) => ({
    allowedUsers: [], allowedTeams: [], allowedRoles: [], allowedClasses: [],
    deniedUsers: [], deniedTeams: [], deniedRoles: [], deniedClasses: [], ...overrides,
  });
  await seedFirestore({
    'users/multi_school_user': {
      ...user({ schoolId: SCHOOL_A }),
      schoolIds: [SCHOOL_A, SCHOOL_B],
      customRoleIds: ['same_role_id'],
      customRoleAssignments: { [SCHOOL_A]: ['same_role_id'] },
    },
    [`schools/${SCHOOL_B}/tasks/task_acl_collision`]: {
      schoolId: SCHOOL_B, title: 'Private B task', scope: 'team', assigneeType: 'team', assigneeTeamId: 'other_team',
    },
    [`schools/${SCHOOL_B}/resourceAclPolicies/task_task_acl_collision`]: {
      schoolId: SCHOOL_B, resourceType: 'task', resourceId: 'task_acl_collision', configured: true,
      view: level({ allowedRoles: ['same_role_id'] }), comment: level(), edit: level(), manage: level(),
    },
  });
  await assertFails(getDoc(doc(
    context('multi_school_user').firestore(),
    `schools/${SCHOOL_B}/tasks/task_acl_collision`,
  )));
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

test('storage file access follows the same resource ACL and explicit deny', async () => {
  const level = (overrides = {}) => ({
    allowedUsers: [], allowedTeams: [], allowedRoles: [], allowedClasses: [],
    deniedUsers: [], deniedTeams: [], deniedRoles: [], deniedClasses: [], ...overrides,
  });
  await seedFirestore({
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    'users/storage_allowed': user({ schoolId: SCHOOL_A, teamIds: ['team_a'] }),
    'users/storage_denied': user({ schoolId: SCHOOL_A, teamIds: ['team_a'] }),
    [`schools/${SCHOOL_A}/files/file_acl_storage`]: { schoolId: SCHOOL_A, folderId: '', name: 'ACL PDF' },
    [`schools/${SCHOOL_A}/resourceAclPolicies/file_file_acl_storage`]: {
      schoolId: SCHOOL_A, resourceType: 'file', resourceId: 'file_acl_storage', configured: true,
      view: level({ allowedTeams: ['team_a'], deniedUsers: ['storage_denied'] }),
      comment: level(), edit: level({ allowedUsers: ['principal_a'] }), manage: level({ allowedUsers: ['principal_a'] }),
    },
  });
  const path = `schools/${SCHOOL_A}/files/file_acl_storage/document.pdf`;
  await assertSucceeds(uploadBytes(ref(context('principal_a').storage(), path), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' }));
  await assertSucceeds(getBytes(ref(context('storage_allowed').storage(), path)));
  await assertFails(getBytes(ref(context('storage_denied').storage(), path)));
});

test('storage ACL role identifiers are scoped to the selected school', async () => {
  const level = (overrides = {}) => ({
    allowedUsers: [], allowedTeams: [], allowedRoles: [], allowedClasses: [],
    deniedUsers: [], deniedTeams: [], deniedRoles: [], deniedClasses: [], ...overrides,
  });
  await seedFirestore({
    'users/principal_b': user({ schoolId: SCHOOL_B, role: 'principal' }),
    'users/multi_school_user': {
      ...user({ schoolId: SCHOOL_A }),
      schoolIds: [SCHOOL_A, SCHOOL_B],
      customRoleIds: ['same_role_id'],
      customRoleAssignments: { [SCHOOL_A]: ['same_role_id'] },
    },
    [`schools/${SCHOOL_B}/files/file_acl_collision`]: { schoolId: SCHOOL_B, folderId: '', name: 'Private B file' },
    [`schools/${SCHOOL_B}/resourceAclPolicies/file_file_acl_collision`]: {
      schoolId: SCHOOL_B, resourceType: 'file', resourceId: 'file_acl_collision', configured: true,
      view: level({ allowedRoles: ['same_role_id'] }), comment: level(),
      edit: level({ allowedUsers: ['principal_b'] }), manage: level({ allowedUsers: ['principal_b'] }),
    },
  });
  const path = `schools/${SCHOOL_B}/files/file_acl_collision/document.pdf`;
  await assertSucceeds(uploadBytes(ref(context('principal_b').storage(), path), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' }));
  await assertFails(getBytes(ref(context('multi_school_user').storage(), path)));
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
  const runId = `${process.pid}_${Date.now()}`;
  const path = `schools/${SCHOOL_A}/students/student_a/cv/cv_a/v001/export_${runId}/cv_student.pdf`;
  await assertSucceeds(uploadBytes(ref(exporter, path), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' }));
  await assertSucceeds(getBytes(ref(viewer, path)));
  await assertFails(getBytes(ref(otherSchool, path)));
  await assertFails(uploadBytes(ref(viewer, `schools/${SCHOOL_A}/students/student_a/cv/cv_a/v001/denied_${runId}/cv.pdf`), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' }));
  await assertFails(deleteObject(ref(exporter, path)));
});

test('platform admin directory access never grants internal school data access', async () => {
  await seedFirestore({
    'users/platform_admin': { ...user({ schoolId: SCHOOL_A, role: 'viewer' }), uid: 'platform_admin' },
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    [`schools/${SCHOOL_A}`]: { name: 'School A', status: 'active' },
    [`schools/${SCHOOL_A}/students/student_a`]: studentRecord(),
    [`schools/${SCHOOL_A}/gradebooks/grade_a`]: gradebookRecord(),
    [`schools/${SCHOOL_A}/tasks/task_a`]: { schoolId: SCHOOL_A, scope: 'organization', assigneeType: 'all_school', title: 'Private task' },
    [`schools/${SCHOOL_A}/files/file_a`]: { schoolId: SCHOOL_A, name: 'private.pdf', folderId: '' },
    [`schools/${SCHOOL_A}/events/event_a`]: { schoolId: SCHOOL_A, title: 'Private event' },
  });
  const platformDb = context('platform_admin', { platform_admin: true }).firestore();
  await assertSucceeds(getDoc(doc(platformDb, `schools/${SCHOOL_A}`)));
  await assertFails(getDoc(doc(platformDb, `users/principal_a`)));
  await assertFails(getDoc(doc(platformDb, `schools/${SCHOOL_A}/students/student_a`)));
  await assertFails(getDoc(doc(platformDb, `schools/${SCHOOL_A}/gradebooks/grade_a`)));
  await assertFails(getDoc(doc(platformDb, `schools/${SCHOOL_A}/tasks/task_a`)));
  await assertFails(getDoc(doc(platformDb, `schools/${SCHOOL_A}/files/file_a`)));
  await assertFails(getDoc(doc(platformDb, `schools/${SCHOOL_A}/events/event_a`)));
});

test('Spark forum permits only short schema-validated messages for authorized members', async () => {
  await seedFirestore({
    'users/principal_a': { ...user({ schoolId: SCHOOL_A, role: 'principal' }), uid: 'principal_a', fullName: 'Principal A' },
    'users/scoped_manager_a': {
      ...user({ schoolId: SCHOOL_A }),
      uid: 'scoped_manager_a',
      fullName: 'Scoped Manager',
      activeSchoolId: SCHOOL_A,
      rolesBySchool: { [SCHOOL_A]: 'institution_manager' },
    },
    'users/pending_delegate': { ...user({ schoolId: SCHOOL_A }), uid: 'pending_delegate', fullName: 'Pending' },
    'users/approved_delegate': { ...user({ schoolId: SCHOOL_A }), uid: 'approved_delegate', fullName: 'Approved Delegate' },
    'platformForumMemberships/pending_delegate': { userId: 'pending_delegate', schoolId: SCHOOL_A, status: 'pending_admin_approval', permissions: [] },
    'platformForumMemberships/approved_delegate': { userId: 'approved_delegate', schoolId: SCHOOL_A, status: 'active', permissions: ['forum.access', 'forum.read', 'forum.createThread', 'forum.reply', 'forum.deleteOwnPost'] },
    [`schoolPublicDirectory/${SCHOOL_A}`]: { schoolId: SCHOOL_A, name: 'School A', code: 'A', status: 'active', updatedAt: 'now' },
    'platformForum/root/folders/general': { name: 'General', status: 'active' },
    'platformForum/root/threads/thread_a': { folderId: 'general', title: 'Shared', body: 'Forum only', status: 'active', authorId: 'principal_a', replyCount: 0, followers: [], locked: false },
    [`schools/${SCHOOL_A}/files/private_a`]: { schoolId: SCHOOL_A, name: 'private.pdf', folderId: '' },
  });
  const folderPath = 'platformForum/root/folders/general';
  await assertSucceeds(getDoc(doc(context('principal_a').firestore(), folderPath)));
  await assertSucceeds(getDoc(doc(context('scoped_manager_a').firestore(), folderPath)));
  await assertFails(getDoc(doc(context('pending_delegate').firestore(), folderPath)));
  await assertSucceeds(getDoc(doc(context('approved_delegate').firestore(), folderPath)));
  await assertFails(getDoc(doc(context('approved_delegate').firestore(), `schools/${SCHOOL_A}/files/private_a`)));

  const managerDb = context('scoped_manager_a').firestore();
  const newFolderRef = doc(managerDb, 'platformForum/root/folders/educators');
  await assertSucceeds(setDoc(newFolderRef, {
    name: 'Educators', description: '', status: 'active', writeMode: 'spark-client', schemaVersion: 1,
    createdBy: 'scoped_manager_a', updatedBy: 'scoped_manager_a', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));

  const delegateDb = context('approved_delegate').firestore();
  const threadRef = doc(delegateDb, 'platformForum/root/threads/spark_thread');
  const identity = {
    userId: 'approved_delegate', fullName: 'Approved Delegate', publicRole: 'איש צוות',
    schoolId: SCHOOL_A, schoolName: 'School A', avatarUrl: '',
  };
  await assertSucceeds(setDoc(threadRef, {
    folderId: 'general', title: 'Short question', body: 'A short forum message', attachmentIds: [],
    authorId: 'approved_delegate', author: identity, status: 'active', pinned: false, locked: false,
    replyCount: 0, followers: [], writeMode: 'spark-client', schemaVersion: 1,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));

  const postRef = doc(delegateDb, 'platformForum/root/threads/spark_thread/posts/spark_post');
  await assertSucceeds(setDoc(postRef, {
    threadId: 'spark_thread', body: 'A short reply', attachmentIds: [], authorId: 'approved_delegate',
    author: identity, status: 'active', writeMode: 'spark-client', schemaVersion: 1,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  assert.equal((await getDoc(postRef)).data().body, 'A short reply');

  await assertFails(setDoc(doc(delegateDb, 'platformForum/root/threads/too_long'), {
    folderId: 'general', title: 'Too long', body: 'x'.repeat(501), attachmentIds: [],
    authorId: 'approved_delegate', author: identity, status: 'active', pinned: false, locked: false,
    replyCount: 0, followers: [], writeMode: 'spark-client', schemaVersion: 1,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(delegateDb, 'platformForum/root/threads/with_attachment'), {
    folderId: 'general', title: 'Attachment', body: 'Files stay disabled in Spark mode', attachmentIds: ['file_a'],
    authorId: 'approved_delegate', author: identity, status: 'active', pinned: false, locked: false,
    replyCount: 0, followers: [], writeMode: 'spark-client', schemaVersion: 1,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));

  await assertFails(setDoc(doc(context('pending_delegate').firestore(), 'platformForum/root/threads/blocked'), {
    folderId: 'general', title: 'Blocked', body: 'No membership', status: 'active', authorId: 'pending_delegate',
  }));
});

test('Spark forum access requests require a school manager and Platform Admin approval', async () => {
  await seedFirestore({
    'users/principal_a': { ...user({ schoolId: SCHOOL_A, role: 'principal' }), uid: 'principal_a' },
    'users/viewer_a': { ...user({ schoolId: SCHOOL_A }), uid: 'viewer_a' },
    'users/teacher_a': { ...user({ schoolId: SCHOOL_A }), uid: 'teacher_a' },
    'users/teacher_b': { ...user({ schoolId: SCHOOL_B }), uid: 'teacher_b' },
  });

  const requestData = {
    schoolId: SCHOOL_A,
    institutionId: SCHOOL_A,
    userId: 'teacher_a',
    requestedPermissions: ['forum.createThread', 'forum.reply'],
    reason: 'Teacher needs access to the shared forum',
    expiresAt: null,
    status: 'pending_admin_approval',
    requestedBy: 'principal_a',
    writeMode: 'spark-client',
    schemaVersion: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const requestRef = doc(context('principal_a').firestore(), 'platformForumAccessRequests/request_a');
  await assertSucceeds(setDoc(requestRef, requestData));

  await assertFails(setDoc(doc(context('viewer_a').firestore(), 'platformForumAccessRequests/viewer_request'), {
    ...requestData,
    requestedBy: 'viewer_a',
  }));
  await assertFails(setDoc(doc(context('principal_a').firestore(), 'platformForumAccessRequests/cross_school'), {
    ...requestData,
    userId: 'teacher_b',
  }));
  await assertFails(setDoc(doc(context('principal_a').firestore(), 'platformForumAccessRequests/unsafe_permission'), {
    ...requestData,
    requestedPermissions: ['forum.managePermissions'],
  }));

  await assertFails(updateDoc(doc(context('principal_a').firestore(), 'platformForumAccessRequests/request_a'), {
    status: 'approved',
    approvedPermissions: requestData.requestedPermissions,
    reviewedBy: 'principal_a',
    reviewReason: 'A school manager cannot approve the request',
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(context('teacher_a').firestore(), 'platformForumMemberships/teacher_a'), {
    userId: 'teacher_a',
    schoolId: SCHOOL_A,
    institutionId: SCHOOL_A,
    status: 'active',
    permissions: ['forum.access', 'forum.read', ...requestData.requestedPermissions],
    approvedRequestId: 'request_a',
    expiresAt: null,
    approvedBy: 'teacher_a',
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    writeMode: 'spark-client',
    schemaVersion: 1,
  }));

  const platformDb = context('platform_admin', { platform_admin: true }).firestore();
  const approvalBatch = writeBatch(platformDb);
  approvalBatch.update(doc(platformDb, 'platformForumAccessRequests/request_a'), {
    status: 'approved',
    approvedPermissions: requestData.requestedPermissions,
    reviewedBy: 'platform_admin',
    reviewReason: 'Approved for school collaboration',
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  approvalBatch.set(doc(platformDb, 'platformForumMemberships/teacher_a'), {
    userId: 'teacher_a',
    schoolId: SCHOOL_A,
    institutionId: SCHOOL_A,
    status: 'active',
    permissions: ['forum.access', 'forum.read', ...requestData.requestedPermissions],
    approvedRequestId: 'request_a',
    expiresAt: null,
    approvedBy: 'platform_admin',
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    writeMode: 'spark-client',
    schemaVersion: 1,
  });
  await assertSucceeds(approvalBatch.commit());
  assert.equal((await getDoc(doc(context('teacher_a').firestore(), 'platformForumMemberships/teacher_a'))).data().status, 'active');

  await assertSucceeds(setDoc(doc(context('principal_a').firestore(), 'platformForumAccessRequests/request_b'), requestData));
  const escalationBatch = writeBatch(platformDb);
  escalationBatch.update(doc(platformDb, 'platformForumAccessRequests/request_b'), {
    status: 'approved',
    approvedPermissions: requestData.requestedPermissions,
    reviewedBy: 'platform_admin',
    reviewReason: 'Attempted privilege expansion',
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  escalationBatch.set(doc(platformDb, 'platformForumMemberships/teacher_a'), {
    userId: 'teacher_a', schoolId: SCHOOL_A, institutionId: SCHOOL_A, status: 'active',
    permissions: ['forum.access', 'forum.read', ...requestData.requestedPermissions, 'forum.moderate'],
    approvedRequestId: 'request_b', expiresAt: null, approvedBy: 'platform_admin',
    approvedAt: serverTimestamp(), updatedAt: serverTimestamp(), writeMode: 'spark-client', schemaVersion: 1,
  });
  await assertFails(escalationBatch.commit());
});

test('Spark forum blocks new attachments while support storage retains scoped uploads', async () => {
  await seedFirestore({
    'users/forum_uploader': { ...user({ schoolId: SCHOOL_A }), uid: 'forum_uploader' },
    'users/principal_a': user({ schoolId: SCHOOL_A, role: 'principal' }),
    'users/scoped_manager_a': {
      ...user({ schoolId: SCHOOL_A }),
      activeSchoolId: SCHOOL_A,
      rolesBySchool: { [SCHOOL_A]: 'institution_manager' },
    },
    'platformForumMemberships/forum_uploader': { userId: 'forum_uploader', schoolId: SCHOOL_A, status: 'active', permissions: ['forum.access', 'forum.read', 'forum.uploadAttachment'] },
    'platformForum/root/attachments/attachment_a': { uploadedBy: 'forum_uploader', status: 'pending', storagePath: 'platform-forum/attachments/attachment_a/share.pdf', mimeType: 'application/pdf', size: 4 },
    'platformForum/root/attachments/attachment_manager': { uploadedBy: 'scoped_manager_a', status: 'pending', storagePath: 'platform-forum/attachments/attachment_manager/share.pdf', mimeType: 'application/pdf', size: 4 },
    'supportAttachments/support_a': { schoolId: SCHOOL_A, uploadedBy: 'principal_a', status: 'pending', storagePath: `platform-support/${SCHOOL_A}/support_a/screenshot.png`, mimeType: 'image/png', size: 4 },
  });
  await assertFails(uploadBytes(ref(context('forum_uploader').storage(), 'platform-forum/attachments/attachment_a/share.pdf'), new Uint8Array([1, 2, 3, 4]), { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(context('scoped_manager_a').storage(), 'platform-forum/attachments/attachment_manager/share.pdf'), new Uint8Array([1, 2, 3, 4]), { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(context('forum_uploader').storage(), 'platform-forum/attachments/unregistered/share.pdf'), new Uint8Array([1]), { contentType: 'application/pdf' }));
  await assertSucceeds(uploadBytes(ref(context('principal_a').storage(), `platform-support/${SCHOOL_A}/support_a/screenshot.png`), new Uint8Array([1, 2, 3, 4]), { contentType: 'image/png' }));
});

test('outcome definitions are tenant isolated and all writes are server-only', async () => {
  await seedFirestore({
    'users/outcome_manager_a': user({ schoolId: SCHOOL_A, permissions: { 'outcomes.view': true, 'outcomes.manageDefinitions': true } }),
    'users/outcome_manager_b': user({ schoolId: SCHOOL_B, permissions: { 'outcomes.view': true } }),
    [`schools/${SCHOOL_A}/outcomeDefinitions/full`]: { schoolId: SCHOOL_A, academicYearId: 'year_2026_2027', name: 'Full', active: true, version: 1 },
  });
  const path = `schools/${SCHOOL_A}/outcomeDefinitions/full`;
  await assertSucceeds(getDoc(doc(context('outcome_manager_a').firestore(), path)));
  await assertFails(getDoc(doc(context('outcome_manager_b').firestore(), path)));
  await assertFails(updateDoc(doc(context('outcome_manager_a').firestore(), path), { name: 'Client bypass' }));
});
