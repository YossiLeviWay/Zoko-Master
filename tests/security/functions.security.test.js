import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  approveMembershipHandler,
} from '../../functions/src/callables/memberships.js';
import { createNotificationsHandler } from '../../functions/src/callables/notifications.js';
import { draftCommunicationWithAgentHandler } from '../../functions/src/callables/communicationAgent.js';
import { askZokiHandler, getZokiTaskGuidanceHandler, saveZokiBrainHandler, syncZokiConversationHandler } from '../../functions/src/callables/zoki.js';
import {
  executeZokiAttendanceHandler,
  executeZokiCalendarEventHandler,
  executeZokiCalendarEventCancelHandler,
  executeZokiCalendarEventUpdateHandler,
  executeZokiContactHandler,
  executeZokiDirectPermissionHandler,
  executeZokiGradeHandler,
  executeZokiRoleAssignmentHandler,
  executeZokiResourceAccessHandler,
  executeZokiResourceCreateHandler,
  executeZokiResourceMoveHandler,
  executeZokiResourceRenameHandler,
  executeZokiStudentNoteHandler,
  executeZokiStudentTrackHandler,
  executeZokiStudentTransferHandler,
  executeZokiTeamMembershipHandler,
  executeZokiTeamCreateHandler,
  executeZokiTeamManagerHandler,
  executeZokiTaskStatusHandler,
  executeZokiTaskAssignmentHandler,
  executeZokiTaskDetailsHandler,
} from '../../functions/src/callables/zokiActions.js';
import { createSchoolHandler, updateSchoolHandler } from '../../functions/src/callables/schools.js';
import { setActiveSchoolHandler } from '../../functions/src/callables/auth.js';
import {
  createMandatoryTaskHandler,
  executeZokiTaskHandler,
  inviteTaskCollaboratorsHandler,
  respondTaskInvitationHandler,
} from '../../functions/src/callables/tasks.js';
import { createStaffHandler, setRoleHandler, updateStaffHandler } from '../../functions/src/callables/staff.js';
import { createForumThreadHandler, upsertForumFolderHandler } from '../../functions/src/callables/forum.js';
import {
  assignCustomRoleHandler,
  createCustomRoleHandler,
  updateCustomRoleHandler,
} from '../../functions/src/callables/roles.js';
import {
  archivePersonalFileItemHandler,
  recordPersonalFileAccessHandler,
  upsertPersonalFileItemHandler,
} from '../../functions/src/callables/personalFiles.js';
import {
  createCvDocumentHandler,
  finalizeCvDocumentHandler,
  registerCvPdfHandler,
  saveCvDraftHandler,
} from '../../functions/src/callables/cvDocuments.js';
import {
  bulkCreateCvDraftsHandler,
  previewBulkCvDraftsHandler,
  upsertCvTemplateHandler,
} from '../../functions/src/callables/cvTemplates.js';
import { bulkImportStudentsHandler } from '../../functions/src/callables/studentImports.js';
import { fileTrashActionHandler } from '../../functions/src/callables/fileTrash.js';
import {
  evaluatePreviewAccessHandler,
  startPermissionPreviewHandler,
  upsertResourceAclHandler,
} from '../../functions/src/callables/permissions.js';
import { adminAuth, adminDb, Timestamp } from '../../functions/src/services/firebaseAdmin.js';
import { acceptInvitationToken } from '../../functions/src/services/invitations.js';
import { calendarEventVersion } from '../../functions/src/services/calendarEventState.js';

const SCHOOL_A = 'school_a';
const SCHOOL_B = 'school_b';
const createdAuthUsers = new Set();

function actorRequest(uid, data, claims = {}) {
  return { auth: { uid, token: claims }, data };
}

async function seedUser(uid, schoolId, role = 'viewer', extra = {}) {
  await adminDb.collection('users').doc(uid).set({
    uid,
    schoolId,
    schoolIds: [schoolId],
    pendingSchools: [],
    role,
    accountStatus: 'active',
    permissions: {},
    teamIds: [],
    ...extra,
  });
}

beforeEach(async () => {
  const collections = await adminDb.listCollections();
  await Promise.all(collections.map(collectionRef => adminDb.recursiveDelete(collectionRef)));
});

afterEach(async () => {
  await Promise.all([...createdAuthUsers].map(uid => adminAuth.deleteUser(uid).catch(() => undefined)));
  createdAuthUsers.clear();
});

test('privileged functions reject unauthenticated and cross-school actors', async () => {
  await assert.rejects(
    createNotificationsHandler({ auth: null, data: {} }),
    error => error.code === 'unauthenticated',
  );
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await assert.rejects(createStaffHandler(actorRequest('principal_a', {
    email: 'member@example.test',
    fullName: 'Member',
    role: 'viewer',
    schoolId: SCHOOL_B,
  })), error => error.code === 'permission-denied');
});

test('communication agent is server-authorized, tenant-scoped and audit-only until confirmation', async () => {
  await seedUser('agent_user_a', SCHOOL_A, 'viewer', {
    permissions: { 'communications.useAgent': true },
  });
  await seedUser('no_agent_a', SCHOOL_A, 'viewer');
  await seedUser('assignee_a', SCHOOL_A, 'viewer', { fullName: 'Assignee A' });
  await seedUser('assignee_b', SCHOOL_B, 'viewer', { fullName: 'Assignee B' });
  await adminDb.doc(`users/agent_user_a/contactDirectory/private/items/contact_a`).set({
    ownerId: 'agent_user_a',
    schoolId: SCHOOL_A,
    fullName: 'Recipient A',
    primaryEmail: 'recipient@example.test',
    organization: '',
    category: '',
    archived: false,
  });
  await adminDb.doc(`users/agent_user_a/contactDirectory/private/items/contact_b`).set({
    ownerId: 'agent_user_a',
    schoolId: SCHOOL_B,
    fullName: 'Wrong School Contact',
    primaryEmail: 'wrong-school@example.test',
    archived: false,
  });
  const generated = {
    recipients: ['recipient@example.test'], cc: [], bcc: [], subject: 'עדכון',
    body: 'שלום, נשמח לקבל עדכון.', summary: 'מעקב', priority: 'normal',
    followUpAt: '2026-08-04', completionCriteria: 'התקבלה תשובה',
    suggestedAssigneeId: 'assignee_a',
    linkedEntities: [{ type: 'task', id: 'task_a', label: 'משימה א' }],
    missingFields: [], suggestedNextAction: 'בדיקת הטיוטה',
  };
  let providerPayload;
  const data = {
    schoolId: SCHOOL_A,
    request: 'נסח מייל קצר לאיש הקשר',
    operation: 'compose',
    language: 'he',
    style: 'respectful',
    context: { type: 'task', id: 'task_a', label: 'משימה א' },
    contactRefs: [{ id: 'contact_a', scope: 'private' }, { id: 'contact_b', scope: 'private' }],
    assigneeIds: ['assignee_a', 'assignee_b'],
    currentDraft: {
      recipients: [], cc: [], bcc: [], subject: '', body: '', summary: '',
      priority: 'normal', followUpAt: null, completionCriteria: '',
    },
  };
  const result = await draftCommunicationWithAgentHandler(actorRequest('agent_user_a', data), {
    apiKey: 'server-test-key',
    model: 'test-model',
    fetchImpl: async (_url, options) => {
      providerPayload = JSON.parse(options.body);
      return { ok: true, json: async () => ({ id: 'response_agent_a', output_text: JSON.stringify(generated) }) };
    },
  });
  assert.deepEqual(result.proposal, generated);
  const serialized = JSON.stringify(providerPayload);
  assert.equal(serialized.includes('Recipient A'), true);
  assert.equal(serialized.includes('Wrong School Contact'), false);
  assert.equal(serialized.includes('Assignee A'), true);
  assert.equal(serialized.includes('Assignee B'), false);
  assert.equal((await adminDb.collection('auditLogs').where('action', '==', 'communication.agent.propose').get()).size, 1);
  assert.equal((await adminDb.collection(`schools/${SCHOOL_A}/communicationDrafts`).get()).size, 0);

  await assert.rejects(draftCommunicationWithAgentHandler(actorRequest('no_agent_a', data), {
    apiKey: 'server-test-key', model: 'test-model', fetchImpl: async () => { throw new Error('must not run'); },
  }), error => error.code === 'permission-denied');
  await assert.rejects(draftCommunicationWithAgentHandler(actorRequest('agent_user_a', {
    ...data, schoolId: SCHOOL_B,
  }), {
    apiKey: 'server-test-key', model: 'test-model', fetchImpl: async () => { throw new Error('must not run'); },
  }), error => error.code === 'permission-denied');
});

test('Zoki sends the model only records inside the teacher class scope', async () => {
  await seedUser('teacher_a', SCHOOL_A, 'viewer', {
    customRoleAssignments: { [SCHOOL_A]: ['homeroom_role'] },
  });
  await adminDb.doc(`schools/${SCHOOL_A}/roleDefinitions/homeroom_role`).set({
    name: 'מחנך כיתה א', status: 'active',
    permissions: { 'students.view': true, 'classes.view': true },
    accessScope: { type: 'classes', classIds: ['class_a'] },
  });
  await adminDb.doc(`schools/${SCHOOL_A}/classes/class_a`).set({ schoolId: SCHOOL_A, name: 'כיתה א', status: 'active' });
  await adminDb.doc(`schools/${SCHOOL_A}/classes/class_b`).set({ schoolId: SCHOOL_A, name: 'כיתה ב', status: 'active' });
  await adminDb.doc(`schools/${SCHOOL_A}/students/student_a`).set({ schoolId: SCHOOL_A, fullName: 'נועה מורשית', classId: 'class_a', className: 'כיתה א', status: 'active' });
  await adminDb.doc(`schools/${SCHOOL_A}/students/student_b`).set({ schoolId: SCHOOL_A, fullName: 'נועה חסומה', classId: 'class_b', className: 'כיתה ב', status: 'active' });

  let providerInput = null;
  const result = await askZokiHandler(actorRequest('teacher_a', {
    schoolId: SCHOOL_A,
    question: 'באיזו כיתה לומדת נועה?',
  }), {
    apiKey: 'server-test-key',
    model: 'test-model',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      providerInput = JSON.parse(body.contents[0].parts[0].text);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'נועה מורשית לומדת בכיתה א.', sourceIds: ['student:student_a'], followUpQuestion: null }) }] } }] }) };
    },
  });

  const serialized = JSON.stringify(providerInput.authorizedSources);
  assert.equal(serialized.includes('נועה מורשית'), true, serialized);
  assert.equal(serialized.includes('נועה חסומה'), false);
  assert.deepEqual(result.sources.map(item => item.id), ['student:student_a']);
  const audit = await adminDb.collection('auditLogs').where('action', '==', 'zoki.ask').get();
  assert.equal(audit.size, 1);
  const auditText = JSON.stringify(audit.docs[0].data());
  assert.equal(auditText.includes('נועה מורשית'), false);
  assert.equal(auditText.includes('לומדת בכיתה'), false);
  assert.equal(audit.docs[0].data().metadata.sourceTypes.includes('student'), true);
  await assert.rejects(askZokiHandler(actorRequest('teacher_a', {
    schoolId: SCHOOL_B,
    question: 'איפה לומדת נועה?',
  }), { apiKey: 'server-test-key', fetchImpl: async () => { throw new Error('must not run'); } }), error => error.code === 'permission-denied');
});

test('Zoki staff details include app-visible assignments but permissions only for managers', async () => {
  await seedUser('staff_viewer', SCHOOL_A, 'viewer', { permissions: { 'staff.view': true } });
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('teacher_target', SCHOOL_A, 'viewer', {
    fullName: 'רות מורה', email: 'ruth@example.test', phone: '0500000000', jobTitle: 'מחנכת',
    teamIds: ['team_a'], customRoleIds: ['role_a'], permissions: { 'grades.edit': true },
  });
  await adminDb.doc(`schools/${SCHOOL_A}/teams/team_a`).set({ name: 'צוות שכבה' });
  await adminDb.doc(`schools/${SCHOOL_A}/roleDefinitions/role_a`).set({ name: 'מחנכת כיתה', status: 'active' });

  async function contextFor(uid) {
    let input = null;
    await askZokiHandler(actorRequest(uid, { schoolId: SCHOOL_A, question: 'מה התפקיד ופרטי הקשר של רות מורה?' }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        input = JSON.parse(body.contents[0].parts[0].text);
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'נמצאו פרטי איש צוות.', sourceIds: [], followUpQuestion: null }) }] } }] }) };
      },
    });
    return input;
  }

  const viewerText = JSON.stringify((await contextFor('staff_viewer')).authorizedSources);
  assert.equal(viewerText.includes('ruth@example.test'), true, viewerText);
  assert.equal(viewerText.includes('צוות שכבה'), true, viewerText);
  assert.equal(viewerText.includes('מחנכת כיתה'), true, viewerText);
  assert.equal(viewerText.includes('grades.edit'), false, viewerText);
  const managerText = JSON.stringify((await contextFor('principal_a')).authorizedSources);
  assert.equal(managerText.includes('grades.edit'), true, managerText);
});

test('Zoki exposes operational templates, outcomes and audit layers only to their permitted audience', async () => {
  await seedUser('knowledge_viewer', SCHOOL_A, 'viewer', { permissions: {
    'initiatives.view': true, 'cvTemplates.view': true, 'outcomes.view': true, 'classes.view': true,
  } });
  await seedUser('audit_viewer', SCHOOL_A, 'viewer', { permissions: { 'institution.audit.view': true } });
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('other_teacher', SCHOOL_A, 'viewer', { fullName: 'מורה אחר' });
  await adminDb.doc(`schools/${SCHOOL_A}/classes/class_a`).set({ schoolId: SCHOOL_A, name: 'כיתה א', status: 'active' });
  await adminDb.doc(`schools/${SCHOOL_A}/initiativeTemplates/template_a`).set({
    schoolId: SCHOOL_A, title: 'תבנית מסע לימודי', description: 'תבנית יוזמה מורשית', status: 'active', milestoneTemplates: [],
  });
  await adminDb.doc(`schools/${SCHOOL_A}/cvTemplates/school_template`).set({
    schoolId: SCHOOL_A, name: 'תבנית קורות חיים מוסדית', status: 'active', scope: 'school', type: 'content', content: { summaryTemplate: 'סיכום מוסדי' }, createdBy: 'principal_a',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/cvTemplates/private_template`).set({
    schoolId: SCHOOL_A, name: 'תבנית אישית חסומה', status: 'active', scope: 'personal', type: 'content', content: { summaryTemplate: 'סוד אישי' }, createdBy: 'other_teacher',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/outcomeDefinitions/outcome_a`).set({
    schoolId: SCHOOL_A, name: 'זכאות לתעודה מקצועית', description: 'הגדרה מורשית', active: true, version: 2, criteria: [{ type: 'average_min', minimum: 60 }],
  });
  await adminDb.doc(`schools/${SCHOOL_A}/classOutcomeTargets/target_a`).set({
    schoolId: SCHOOL_A, classId: 'class_a', outcomeDefinitionId: 'outcome_a', status: 'active',
  });
  await adminDb.collection('auditLogs').doc('audit_a').set({
    schoolId: SCHOOL_A, action: 'student.update', targetType: 'student', targetId: 'student_a', actorUid: 'principal_a',
    before: { privateValue: 'AUDIT-SECRET' }, createdAt: Timestamp.now(),
  });
  await adminDb.doc(`schools/${SCHOOL_A}/loginActivity/other_teacher/entries/login_a`).set({
    userId: 'other_teacher', schoolId: SCHOOL_A, eventType: 'school_login', loggedInAt: Timestamp.now(), schemaVersion: 1,
  });

  async function authorizedSources(uid, question) {
    let input = null;
    await askZokiHandler(actorRequest(uid, { schoolId: SCHOOL_A, question }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        input = JSON.parse(body.contents[0].parts[0].text);
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'נבדק המידע המורשה.', sourceIds: [], followUpQuestion: null }) }] } }] }) };
      },
    });
    return input;
  }

  const knowledge = JSON.stringify((await authorizedSources('knowledge_viewer', 'מה תבניות היוזמה וקורות החיים והגדרות הזכאות?')).authorizedSources);
  assert.equal(knowledge.includes('תבנית מסע לימודי'), true, knowledge);
  assert.equal(knowledge.includes('תבנית קורות חיים מוסדית'), true, knowledge);
  assert.equal(knowledge.includes('תבנית אישית חסומה'), false, knowledge);
  assert.equal(knowledge.includes('זכאות לתעודה מקצועית'), true, knowledge);

  const auditOnly = JSON.stringify((await authorizedSources('audit_viewer', 'מה פעולות המערכת ומי נכנס?')).authorizedSources);
  assert.equal(auditOnly.includes('student.update'), true, auditOnly);
  assert.equal(auditOnly.includes('AUDIT-SECRET'), false, auditOnly);
  assert.equal(auditOnly.includes('login_activity'), false, auditOnly);
  const principal = JSON.stringify((await authorizedSources('principal_a', 'מה פעולות המערכת ומי נכנס?')).authorizedSources);
  assert.equal(principal.includes('student.update'), true, principal);
  assert.equal(principal.includes('כניסות למערכת'), true, principal);
});

test('Zoki exposes student identity and phones only with sensitive-field permission', async () => {
  await seedUser('teacher_basic', SCHOOL_A, 'viewer', { permissions: { 'students.view': true } });
  await seedUser('teacher_sensitive', SCHOOL_A, 'viewer', { permissions: { 'students.view': true, 'students.viewSensitiveFields': true } });
  await adminDb.doc(`schools/${SCHOOL_A}/students/student_a`).set({
    schoolId: SCHOOL_A, fullName: 'נועה תלמידה', classId: 'class_a', phone: '0501111111', parentPhone: '0502222222', idNumber: 'LEGACY-123', status: 'active',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/students/student_a/sensitive/identity`).set({ schoolId: SCHOOL_A, studentId: 'student_a', idNumber: 'SECURE-456' });

  async function sourceText(uid) {
    let input = null;
    await askZokiHandler(actorRequest(uid, { schoolId: SCHOOL_A, question: 'מה הטלפון ומספר הזהות של התלמידה נועה?' }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        input = JSON.parse(body.contents[0].parts[0].text);
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'נבדקו הפרטים.', sourceIds: [], followUpQuestion: null }) }] } }] }) };
      },
    });
    return JSON.stringify(input.authorizedSources);
  }

  const basic = await sourceText('teacher_basic');
  assert.equal(basic.includes('0501111111'), false, basic);
  assert.equal(basic.includes('SECURE-456'), false, basic);
  const sensitive = await sourceText('teacher_sensitive');
  assert.equal(sensitive.includes('0501111111'), true, sensitive);
  assert.equal(sensitive.includes('0502222222'), true, sensitive);
  assert.equal(sensitive.includes('SECURE-456'), true, sensitive);
  assert.equal(sensitive.includes('LEGACY-123'), false, sensitive);
});

test('Zoki student history and notes remain class-scoped and note-permission-scoped', async () => {
  await seedUser('counselor_a', SCHOOL_A, 'viewer', { customRoleAssignments: { [SCHOOL_A]: ['class_notes_role'] } });
  await seedUser('teacher_without_notes', SCHOOL_A, 'viewer', { permissions: { 'students.view': true } });
  await adminDb.doc(`schools/${SCHOOL_A}/roleDefinitions/class_notes_role`).set({
    name: 'יועצת כיתה א', status: 'active', permissions: { 'students.view': true, 'students.viewSensitiveNotes': true },
    accessScope: { type: 'classes', classIds: ['class_a'] },
  });
  await adminDb.doc(`schools/${SCHOOL_A}/students/student_a`).set({ schoolId: SCHOOL_A, fullName: 'נועה מורשית', classId: 'class_a', status: 'active' });
  await adminDb.doc(`schools/${SCHOOL_A}/students/student_b`).set({ schoolId: SCHOOL_A, fullName: 'נועה חסומה', classId: 'class_b', status: 'active' });
  await adminDb.doc(`schools/${SCHOOL_A}/students/student_a/notes/note_a`).set({ content: 'הערה מורשית לכיתה א', visibility: 'class_staff', createdAt: Timestamp.now() });
  await adminDb.doc(`schools/${SCHOOL_A}/students/student_b/notes/note_b`).set({ content: 'הערה חסומה מכיתה ב', visibility: 'class_staff', createdAt: Timestamp.now() });

  async function providerContext(uid) {
    let input = null;
    await askZokiHandler(actorRequest(uid, { schoolId: SCHOOL_A, question: 'מה ההערות על נועה?' }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        input = JSON.parse(body.contents[0].parts[0].text);
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'נבדקו ההערות המורשות.', sourceIds: [], followUpQuestion: null }) }] } }] }) };
      },
    });
    return input;
  }

  const counselorContext = await providerContext('counselor_a');
  const counselorText = JSON.stringify(counselorContext.authorizedSources);
  assert.equal(counselorText.includes('הערה מורשית לכיתה א'), true, counselorText);
  assert.equal(counselorText.includes('הערה חסומה מכיתה ב'), false, counselorText);

  const teacherContext = await providerContext('teacher_without_notes');
  assert.equal(JSON.stringify(teacherContext.authorizedSources).includes('הערה מורשית'), false);
  assert.equal(teacherContext.denied.some(item => item.capability === 'students.viewSensitiveNotes'), true);
});

test('Zoki does not broaden support-ticket visibility beyond Firestore rules', async () => {
  await seedUser('teacher_a', SCHOOL_A, 'viewer', {
    permissions: { 'support.viewOwnSchool': true },
  });
  await adminDb.doc('supportTickets/own_ticket').set({
    schoolId: SCHOOL_A, createdBy: 'teacher_a', title: 'הפנייה שלי', description: 'מידע מורשה', status: 'open',
  });
  await adminDb.doc('supportTickets/other_ticket').set({
    schoolId: SCHOOL_A, createdBy: 'teacher_b', title: 'פנייה של מורה אחר', description: 'מידע חסום', status: 'open',
  });

  let providerInput = null;
  await askZokiHandler(actorRequest('teacher_a', {
    schoolId: SCHOOL_A,
    question: 'מה מצב פניית התמיכה בשם הפנייה שלי?',
  }), {
    apiKey: 'server-test-key',
    model: 'test-model',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      providerInput = JSON.parse(body.contents[0].parts[0].text);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'הפנייה שלך פתוחה.', sourceIds: ['support_ticket:own_ticket'], followUpQuestion: null }) }] } }] }) };
    },
  });

  const serialized = JSON.stringify(providerInput.authorizedSources);
  assert.equal(serialized.includes('הפנייה שלי'), true, serialized);
  assert.equal(serialized.includes('פנייה של מורה אחר'), false, serialized);
});

test('Zoki extracts file content only after the resource ACL allows that file', async () => {
  await seedUser('teacher_a', SCHOOL_A, 'viewer', { permissions: { 'files.view': true } });
  await adminDb.doc(`schools/${SCHOOL_A}/files/allowed_file`).set({
    schoolId: SCHOOL_A, name: 'מסמך מורשה', fileType: 'document', content: '<p>הנוהל המורשה הוא לצאת בשעה שמונה.</p>',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/files/denied_file`).set({
    schoolId: SCHOOL_A, name: 'מסמך חסום', fileType: 'document', content: '<p>הסוד שאסור להעביר לזוקי.</p>',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/resourceAcls/deny_file_teacher`).set({
    schoolId: SCHOOL_A, resourceType: 'file', resourceId: 'denied_file', principalType: 'user', principalId: 'teacher_a',
    accessLevel: 'view', explicitDeny: true, inherit: false, active: true,
  });

  let providerInput = null;
  await askZokiHandler(actorRequest('teacher_a', { schoolId: SCHOOL_A, question: 'מה כתוב בקבצים?' }), {
    apiKey: 'server-test-key', model: 'test-model',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      providerInput = JSON.parse(body.contents[0].parts[0].text);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'היציאה בשעה שמונה.', sourceIds: ['file:allowed_file'], followUpQuestion: null }) }] } }] }) };
    },
  });

  const serialized = JSON.stringify(providerInput.authorizedSources);
  assert.equal(serialized.includes('הנוהל המורשה'), true, serialized);
  assert.equal(serialized.includes('הסוד שאסור'), false, serialized);
  assert.equal(serialized.includes('מסמך חסום'), false, serialized);
});

test('Zoki task answers honor resource ACL precedence and direct grants', async () => {
  await seedUser('task_viewer', SCHOOL_A, 'viewer', { permissions: { 'tasks.viewAll': true } });
  await seedUser('task_guest', SCHOOL_A, 'viewer');
  await adminDb.doc(`schools/${SCHOOL_A}/tasks/normal_task`).set({ schoolId: SCHOOL_A, title: 'משימה כללית מורשית', createdBy: 'someone_else' });
  await adminDb.doc(`schools/${SCHOOL_A}/tasks/restricted_task`).set({ schoolId: SCHOOL_A, title: 'משימה חסומה ב-ACL', createdBy: 'someone_else' });
  await adminDb.doc(`schools/${SCHOOL_A}/tasks/granted_task`).set({ schoolId: SCHOOL_A, title: 'משימה שהוענקה ישירות', createdBy: 'someone_else' });
  await adminDb.doc(`schools/${SCHOOL_A}/resourceAcls/deny_task_viewer`).set({
    schoolId: SCHOOL_A, resourceType: 'task', resourceId: 'restricted_task', principalType: 'user', principalId: 'task_viewer',
    accessLevel: 'view', explicitDeny: true, inherit: false, active: true,
  });
  await adminDb.doc(`schools/${SCHOOL_A}/resourceAcls/grant_task_guest`).set({
    schoolId: SCHOOL_A, resourceType: 'task', resourceId: 'granted_task', principalType: 'user', principalId: 'task_guest',
    accessLevel: 'view', explicitDeny: false, inherit: false, active: true,
  });

  async function authorizedSourceIds(uid) {
    let ids = [];
    await askZokiHandler(actorRequest(uid, { schoolId: SCHOOL_A, question: 'אילו משימות קיימות?' }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        ids = JSON.parse(body.contents[0].parts[0].text).authorizedSources.filter(source => source.type === 'task').map(source => source.id);
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'נמצאה משימה.', sourceIds: ids.slice(0, 1), followUpQuestion: null }) }] } }] }) };
      },
    });
    return ids;
  }

  assert.deepEqual(await authorizedSourceIds('task_viewer'), ['task:normal_task']);
  assert.deepEqual(await authorizedSourceIds('task_guest'), ['task:granted_task']);
});

test('Zoki includes only the actor personal tasks and task invitations', async () => {
  await seedUser('teacher_a', SCHOOL_A, 'viewer');
  await seedUser('teacher_b', SCHOOL_A, 'viewer');
  await adminDb.doc('users/teacher_a/personalTasks/own_personal').set({ schoolId: SCHOOL_A, ownerId: 'teacher_a', title: 'משימה אישית מורשית', status: 'todo' });
  await adminDb.doc('users/teacher_b/personalTasks/other_personal').set({ schoolId: SCHOOL_A, ownerId: 'teacher_b', title: 'משימה אישית חסומה', status: 'todo' });
  await adminDb.doc(`schools/${SCHOOL_A}/taskInvitations/own_invitation`).set({ recipientId: 'teacher_a', inviterId: 'teacher_b', taskTitle: 'הזמנה מורשית', status: 'pending' });
  await adminDb.doc(`schools/${SCHOOL_A}/taskInvitations/other_invitation`).set({ recipientId: 'teacher_b', inviterId: 'someone_else', taskTitle: 'הזמנה חסומה', status: 'pending' });

  let providerInput = null;
  await askZokiHandler(actorRequest('teacher_a', { schoolId: SCHOOL_A, question: 'אילו משימות והזמנות למשימה יש לי?' }), {
    apiKey: 'server-test-key', model: 'test-model',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      providerInput = JSON.parse(body.contents[0].parts[0].text);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'נמצאו פריטים אישיים.', sourceIds: [], followUpQuestion: null }) }] } }] }) };
    },
  });
  const serialized = JSON.stringify(providerInput.authorizedSources);
  assert.equal(serialized.includes('משימה אישית מורשית'), true, serialized);
  assert.equal(serialized.includes('הזמנה מורשית'), true, serialized);
  assert.equal(serialized.includes('משימה אישית חסומה'), false, serialized);
  assert.equal(serialized.includes('הזמנה חסומה'), false, serialized);
});

test('Zoki initiative details are limited to initiatives visible to the actor', async () => {
  await seedUser('teacher_a', SCHOOL_A, 'viewer', { permissions: { 'initiatives.view': true } });
  await adminDb.doc(`schools/${SCHOOL_A}/initiatives/own_initiative`).set({ title: 'תכנית מורשית', ownerId: 'teacher_a', status: 'active' });
  await adminDb.doc(`schools/${SCHOOL_A}/initiatives/hidden_initiative`).set({ title: 'תכנית חסומה', ownerId: 'teacher_b', status: 'active' });
  await adminDb.doc(`schools/${SCHOOL_A}/initiatives/own_initiative/milestones/own_milestone`).set({ title: 'אבן דרך מורשית', status: 'planned' });
  await adminDb.doc(`schools/${SCHOOL_A}/initiatives/hidden_initiative/milestones/hidden_milestone`).set({ title: 'אבן דרך חסומה', status: 'planned' });

  let providerInput = null;
  await askZokiHandler(actorRequest('teacher_a', { schoolId: SCHOOL_A, question: 'מה אבני הדרך בתכניות?' }), {
    apiKey: 'server-test-key', model: 'test-model',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      providerInput = JSON.parse(body.contents[0].parts[0].text);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'נמצאה אבן דרך.', sourceIds: [], followUpQuestion: null }) }] } }] }) };
    },
  });
  const serialized = JSON.stringify(providerInput.authorizedSources);
  assert.equal(serialized.includes('אבן דרך מורשית'), true, serialized);
  assert.equal(serialized.includes('אבן דרך חסומה'), false, serialized);
  assert.equal(serialized.includes('תכנית חסומה'), false, serialized);
});

test('Zoki communication events and templates stay within communication visibility', async () => {
  await seedUser('teacher_a', SCHOOL_A, 'viewer', { permissions: { 'communications.viewOwn': true, 'communications.useAgent': true } });
  await adminDb.doc(`schools/${SCHOOL_A}/communicationDrafts/own_draft`).set({ createdBy: 'teacher_a', subject: 'מעקב מורשה', body: 'תוכן מורשה' });
  await adminDb.doc(`schools/${SCHOOL_A}/communicationDrafts/other_draft`).set({ createdBy: 'teacher_b', subject: 'מעקב חסום', body: 'תוכן חסום' });
  await adminDb.doc(`schools/${SCHOOL_A}/communicationEvents/own_event`).set({ draftId: 'own_draft', type: 'sent', summary: 'אירוע מורשה' });
  await adminDb.doc(`schools/${SCHOOL_A}/communicationEvents/other_event`).set({ draftId: 'other_draft', type: 'sent', summary: 'אירוע חסום' });
  await adminDb.doc('users/teacher_a/communicationTemplates/private_template').set({ schoolId: SCHOOL_A, name: 'תבנית פרטית מורשית', bodyTemplate: 'שלום' });
  await adminDb.doc(`schools/${SCHOOL_A}/communicationTemplates/institutional_template`).set({ schoolId: SCHOOL_A, scope: 'institutional', name: 'תבנית מוסדית מורשית', bodyTemplate: 'שלום צוות' });

  let providerInput = null;
  await askZokiHandler(actorRequest('teacher_a', { schoolId: SCHOOL_A, question: 'מה המעקב ותבניות המייל שלי?' }), {
    apiKey: 'server-test-key', model: 'test-model',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      providerInput = JSON.parse(body.contents[0].parts[0].text);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'נמצאו פריטי תקשורת.', sourceIds: [], followUpQuestion: null }) }] } }] }) };
    },
  });
  const serialized = JSON.stringify(providerInput.authorizedSources);
  assert.equal(serialized.includes('מעקב מורשה'), true, serialized);
  assert.equal(serialized.includes('אירוע מורשה'), true, serialized);
  assert.equal(serialized.includes('תבנית פרטית מורשית'), true, serialized);
  assert.equal(serialized.includes('תבנית מוסדית מורשית'), true, serialized);
  assert.equal(serialized.includes('מעקב חסום'), false, serialized);
  assert.equal(serialized.includes('אירוע חסום'), false, serialized);
});

test('Zoki task agent receives only published brain rules for its audience', async () => {
  await seedUser('teacher_a', SCHOOL_A, 'viewer', {
    customRoleAssignments: { [SCHOOL_A]: ['homeroom_role'] },
  });
  await adminDb.doc(`schools/${SCHOOL_A}/roleDefinitions/homeroom_role`).set({
    name: 'מחנך', status: 'active', permissions: { 'tasks.useAssistant': true }, accessScope: { type: 'school' },
  });
  await adminDb.doc(`schools/${SCHOOL_A}/settings/zoki_brain`).set({
    schoolId: SCHOOL_A,
    instructions: 'הוראת ניהול פנימית שלא מוחזרת ללקוח',
    entries: [
      { id: 'school', title: 'כלל בית ספרי', body: 'יש לאשר תאריך.', status: 'published', audience: { type: 'school' } },
      { id: 'role', title: 'כלל למחנכים', body: 'יש לשתף את רכז השכבה.', status: 'published', audience: { type: 'roles', roleIds: ['homeroom_role'] } },
      { id: 'other', title: 'כלל חסוי', body: 'לא להציג.', status: 'published', audience: { type: 'users', userIds: ['someone_else'] } },
      { id: 'draft', title: 'טיוטה', body: 'לא להציג.', status: 'draft', audience: { type: 'school' } },
    ],
  });

  const result = await getZokiTaskGuidanceHandler(actorRequest('teacher_a', { schoolId: SCHOOL_A }));
  assert.equal(result.rules.some(rule => rule.includes('כלל בית ספרי')), true);
  assert.equal(result.rules.some(rule => rule.includes('כלל למחנכים')), true);
  assert.equal(JSON.stringify(result).includes('כלל חסוי'), false);
  assert.equal(JSON.stringify(result).includes('טיוטה'), false);
  assert.equal(JSON.stringify(result).includes('הוראת ניהול פנימית'), false);
});

test('Zoki conversation persistence is bound to the signed-in user and school', async () => {
  await seedUser('teacher_a', SCHOOL_A, 'viewer');
  const state = {
    messages: [{ id: 'user_1', role: 'user', text: 'איפה הקובץ שלי?' }],
    pendingTask: null,
    taskActionResult: null,
    taskAgentTurn: null,
  };
  const saved = await syncZokiConversationHandler(actorRequest('teacher_a', { schoolId: SCHOOL_A, operation: 'save', state }));
  assert.equal(saved.saved, true);
  const loaded = await syncZokiConversationHandler(actorRequest('teacher_a', { schoolId: SCHOOL_A, operation: 'load' }));
  assert.deepEqual(loaded.state, state);
  await assert.rejects(
    syncZokiConversationHandler(actorRequest('teacher_a', { schoolId: SCHOOL_B, operation: 'load' })),
    error => error.code === 'permission-denied',
  );
  const ended = await syncZokiConversationHandler(actorRequest('teacher_a', { schoolId: SCHOOL_A, operation: 'end' }));
  assert.equal(ended.ended, true);
  assert.equal((await adminDb.doc(`schools/${SCHOOL_A}/zokiConversations/teacher_a`).get()).exists, false);
});

test('Zoki executes a confirmed task once and rechecks creation and assignment permissions on the server', async () => {
  await seedUser('zoki_creator', SCHOOL_A, 'viewer', { permissions: { 'tasks.useAssistant': true, 'tasks.create': true } });
  await seedUser('zoki_assigner', SCHOOL_A, 'viewer', { permissions: { 'tasks.useAssistant': true, 'tasks.create': true, 'tasks.assign': true } });
  await seedUser('zoki_recipient', SCHOOL_A, 'viewer');
  const personalPayload = {
    schoolId: SCHOOL_A,
    requestId: 'request_personal_1',
    confirm: true,
    task: {
      scope: 'personal', title: 'הכנת ישיבת צוות', description: 'תוכן שהמשתמש אישר', priority: 'medium',
      dueDate: '2026-09-01', startDate: '', endDate: '', completionCriteria: '', workPlanSteps: [],
      assigneeIds: [], teamId: '', agentSessionId: 'session_1',
    },
  };
  const first = await executeZokiTaskHandler(actorRequest('zoki_creator', personalPayload));
  const repeated = await executeZokiTaskHandler(actorRequest('zoki_creator', personalPayload));
  assert.equal(first.created, true);
  assert.equal(repeated.created, false);
  assert.equal(first.taskId, repeated.taskId);
  assert.equal((await adminDb.collection('users/zoki_creator/personalTasks').get()).size, 1);
  const personalTask = (await adminDb.doc(`users/zoki_creator/personalTasks/${first.taskId}`).get()).data();
  assert.equal(personalTask.creationSource, 'zoki');
  assert.equal(personalTask.title, 'הכנת ישיבת צוות');
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'zoki.action.task.create').get();
  assert.equal(audits.size, 1);
  assert.equal(JSON.stringify(audits.docs[0].data()).includes('תוכן שהמשתמש אישר'), false);

  const assignedPayload = {
    ...personalPayload,
    requestId: 'request_assigned_1',
    task: { ...personalPayload.task, scope: 'assigned', title: 'משימה מוקצית', assigneeIds: ['zoki_recipient'] },
  };
  await assert.rejects(
    executeZokiTaskHandler(actorRequest('zoki_creator', assignedPayload)),
    error => error.code === 'permission-denied',
  );
  const assigned = await executeZokiTaskHandler(actorRequest('zoki_assigner', assignedPayload));
  assert.equal((await adminDb.doc(`schools/${SCHOOL_A}/tasks/${assigned.taskId}`).get()).data().assigneeIds[0], 'zoki_recipient');
  assert.equal((await adminDb.doc(`notifications/zoki_task_${assigned.taskId.replace(/^zoki_/u, '')}_zoki_recipient`).get()).exists, true);
  await assert.rejects(
    executeZokiTaskHandler(actorRequest('zoki_assigner', { ...assignedPayload, schoolId: SCHOOL_B, requestId: 'cross_school' })),
    error => error.code === 'permission-denied',
  );
});

test('Zoki changes an exact task status only for its owner, assignee, participant or an all-task editor', async () => {
  await seedUser('task_owner', SCHOOL_A, 'viewer', { permissions: { 'tasks.viewOwn': true } });
  await seedUser('task_assignee', SCHOOL_A, 'viewer');
  await seedUser('task_outsider', SCHOOL_A, 'viewer', { permissions: { 'tasks.viewOwn': true } });
  await seedUser('task_editor', SCHOOL_A, 'viewer', { permissions: { 'tasks.viewAll': true, 'tasks.editAll': true } });
  await adminDb.doc('users/task_owner/personalTasks/personal_a').set({
    schoolId: SCHOOL_A, scope: 'personal', ownerId: 'task_owner', createdBy: 'task_owner',
    title: 'הכנת סיכום אישי', status: 'todo', assigneeIds: [],
  });
  const organizationTask = {
    schoolId: SCHOOL_A, scope: 'assigned', assigneeType: 'individual', assigneeIds: ['task_assignee'],
    participantIds: [], createdBy: 'task_editor', title: 'הכנת דוח נוכחות', status: 'todo',
  };
  await adminDb.doc(`schools/${SCHOOL_A}/tasks/task_a`).set(organizationTask);
  await adminDb.doc(`tasks_${SCHOOL_A}/task_a`).set(organizationTask);

  async function proposedTaskStatus(uid, question, title, status) {
    const result = await askZokiHandler(actorRequest(uid, { schoolId: SCHOOL_A, question }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const task = context.authorizedSources.find(item => ['task', 'personal_task'].includes(item.type)
          && item.fields.title === title && item.fields.canUpdateStatus === true);
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: task ? 'הכנתי שינוי מצב שממתין לאישור.' : 'לא נמצאה משימה מורשית מתאימה.',
          sourceIds: task ? [task.id] : [], followUpQuestion: null,
          actionProposal: task ? { type: 'task_status_change', taskSourceId: task.id, status } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const personal = await proposedTaskStatus('task_owner', 'סיים את המשימה הכנת סיכום אישי', 'הכנת סיכום אישי', 'done');
  assert.deepEqual({ taskId: personal.taskId, storageMode: personal.storageMode, expectedStatus: personal.expectedStatus, status: personal.status }, {
    taskId: 'personal_a', storageMode: 'personal', expectedStatus: 'todo', status: 'done',
  });
  const personalPayload = {
    schoolId: SCHOOL_A, requestId: 'task_status_personal_1', confirm: true,
    taskId: personal.taskId, storageMode: personal.storageMode, expectedStatus: personal.expectedStatus, status: personal.status,
  };
  assert.equal((await executeZokiTaskStatusHandler(actorRequest('task_owner', personalPayload))).executed, true);
  assert.equal((await executeZokiTaskStatusHandler(actorRequest('task_owner', personalPayload))).executed, false);
  assert.equal((await adminDb.doc('users/task_owner/personalTasks/personal_a').get()).data().status, 'done');

  const assigned = await proposedTaskStatus('task_assignee', 'התחל את המשימה הכנת דוח נוכחות', 'הכנת דוח נוכחות', 'in_progress');
  assert.equal(assigned.taskId, 'task_a');
  assert.equal(await proposedTaskStatus('task_outsider', 'התחל את המשימה הכנת דוח נוכחות', 'הכנת דוח נוכחות', 'in_progress'), null);
  const assignedPayload = {
    schoolId: SCHOOL_A, requestId: 'task_status_assigned_1', confirm: true,
    taskId: assigned.taskId, storageMode: assigned.storageMode, expectedStatus: assigned.expectedStatus, status: assigned.status,
  };
  await assert.rejects(executeZokiTaskStatusHandler(actorRequest('task_outsider', assignedPayload)), error => error.code === 'permission-denied');
  assert.equal((await executeZokiTaskStatusHandler(actorRequest('task_assignee', assignedPayload))).executed, true);
  assert.equal((await adminDb.doc(`schools/${SCHOOL_A}/tasks/task_a`).get()).data().status, 'in_progress');
  assert.equal((await adminDb.doc(`tasks_${SCHOOL_A}/task_a`).get()).data().status, 'in_progress');

  const stale = await proposedTaskStatus('task_editor', 'סיים את המשימה הכנת דוח נוכחות', 'הכנת דוח נוכחות', 'done');
  await adminDb.doc(`schools/${SCHOOL_A}/tasks/task_a`).update({ status: 'todo' });
  await assert.rejects(executeZokiTaskStatusHandler(actorRequest('task_editor', {
    schoolId: SCHOOL_A, requestId: 'task_status_stale', confirm: true,
    taskId: stale.taskId, storageMode: stale.storageMode, expectedStatus: stale.expectedStatus, status: stale.status,
  })), error => error.details?.reason === 'task-status-changed');
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'zoki.action.task.status.update').get();
  assert.equal(audits.size, 2);
  assert.equal(JSON.stringify(audits.docs.map(item => item.data())).includes('הכנת'), false);
});

test('Zoki adds and removes one exact task assignee with separate assignment authorities and stale-state protection', async () => {
  await seedUser('task_assigner', SCHOOL_A, 'viewer', { permissions: {
    'tasks.viewAll': true, 'tasks.assign': true, 'staff.view': true,
  } });
  await seedUser('task_assignment_manager', SCHOOL_A, 'viewer', { permissions: {
    'tasks.viewAll': true, 'tasks.manageAssignments': true, 'staff.view': true,
  } });
  await seedUser('task_assignment_outsider', SCHOOL_A, 'viewer', { permissions: {
    'tasks.viewAll': true, 'staff.view': true,
  } });
  await seedUser('task_new_owner', SCHOOL_A, 'viewer');
  const task = {
    schoolId: SCHOOL_A, scope: 'assigned', assigneeType: 'individual', assigneeIds: [], participantIds: [],
    createdBy: 'task_assigner', title: 'איסוף אישורי טיול', status: 'todo',
  };
  await adminDb.doc(`schools/${SCHOOL_A}/tasks/assignment_task`).set(task);
  await adminDb.doc(`tasks_${SCHOOL_A}/assignment_task`).set(task);

  async function proposedAssignment(uid, question, operation) {
    const result = await askZokiHandler(actorRequest(uid, { schoolId: SCHOOL_A, question }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const taskSource = context.authorizedSources.find(item => item.type === 'task' && item.fields.id === 'assignment_task');
        const staffSource = context.authorizedSources.find(item => item.type === 'staff' && item.fields.id === 'task_new_owner');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: taskSource && staffSource ? 'הכנתי שינוי אחראי שממתין לאישור.' : 'לא נמצא צירוף מורשה.',
          sourceIds: [taskSource?.id, staffSource?.id].filter(Boolean), followUpQuestion: null,
          actionProposal: taskSource && staffSource
            ? { type: 'task_assignment_change', taskSourceId: taskSource.id, staffSourceId: staffSource.id, operation }
            : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const add = await proposedAssignment('task_assigner', 'הקצה את המשימה איסוף אישורי טיול ל-task_new_owner', 'add');
  assert.deepEqual({ taskId: add.taskId, userId: add.userId, operation: add.operation, expectedAssigneeIds: add.expectedAssigneeIds }, {
    taskId: 'assignment_task', userId: 'task_new_owner', operation: 'add', expectedAssigneeIds: [],
  });
  const addPayload = {
    schoolId: SCHOOL_A, requestId: 'task_assignment_add_1', confirm: true,
    taskId: add.taskId, storageMode: add.storageMode, userId: add.userId, action: add.operation,
    expectedCurrentlyAssigned: add.expectedCurrentlyAssigned, expectedAssigneeIds: add.expectedAssigneeIds,
  };
  await assert.rejects(executeZokiTaskAssignmentHandler(actorRequest('task_assignment_outsider', addPayload)), error => error.code === 'permission-denied');
  assert.equal((await executeZokiTaskAssignmentHandler(actorRequest('task_assigner', addPayload))).executed, true);
  assert.equal((await executeZokiTaskAssignmentHandler(actorRequest('task_assigner', addPayload))).executed, false);
  for (const path of [`schools/${SCHOOL_A}/tasks/assignment_task`, `tasks_${SCHOOL_A}/assignment_task`]) {
    const saved = (await adminDb.doc(path).get()).data();
    assert.deepEqual(saved.assigneeIds, ['task_new_owner']);
    assert.deepEqual(saved.participantIds, ['task_new_owner']);
  }
  assert.equal((await adminDb.doc(`notifications/zoki_task_assignment_${createHash('sha256').update(['task_assigner', SCHOOL_A, 'task_assignment_add_1'].join('\u0000')).digest('hex').slice(0, 40)}`).get()).exists, true);

  assert.equal(await proposedAssignment('task_assigner', 'הסר את task_new_owner מהמשימה איסוף אישורי טיול', 'remove'), null);
  const remove = await proposedAssignment('task_assignment_manager', 'הסר את task_new_owner מהמשימה איסוף אישורי טיול', 'remove');
  const removePayload = {
    schoolId: SCHOOL_A, requestId: 'task_assignment_remove_1', confirm: true,
    taskId: remove.taskId, storageMode: remove.storageMode, userId: remove.userId, action: remove.operation,
    expectedCurrentlyAssigned: remove.expectedCurrentlyAssigned, expectedAssigneeIds: remove.expectedAssigneeIds,
  };
  await adminDb.doc(`schools/${SCHOOL_A}/tasks/assignment_task`).update({ assigneeIds: ['task_new_owner', 'another_user'] });
  await assert.rejects(executeZokiTaskAssignmentHandler(actorRequest('task_assignment_manager', {
    ...removePayload, requestId: 'task_assignment_stale',
  })), error => error.details?.reason === 'task-assignees-changed');
  await adminDb.doc(`schools/${SCHOOL_A}/tasks/assignment_task`).update({ assigneeIds: ['task_new_owner'] });
  assert.equal((await executeZokiTaskAssignmentHandler(actorRequest('task_assignment_manager', removePayload))).executed, true);
  assert.deepEqual((await adminDb.doc(`schools/${SCHOOL_A}/tasks/assignment_task`).get()).data().assigneeIds, []);
  assert.deepEqual((await adminDb.doc(`tasks_${SCHOOL_A}/assignment_task`).get()).data().assigneeIds, []);
  const audits = await adminDb.collection('auditLogs').where('targetId', '==', 'assignment_task').get();
  assert.equal(audits.size, 2);
  assert.equal(JSON.stringify(audits.docs.map(item => item.data())).includes('איסוף אישורי'), false);
});

test('Zoki edits only explicitly named task details for the personal owner or an all-task editor', async () => {
  await seedUser('task_details_owner', SCHOOL_A, 'viewer', { permissions: { 'tasks.viewOwn': true } });
  await seedUser('task_details_editor', SCHOOL_A, 'viewer', { permissions: { 'tasks.viewAll': true, 'tasks.editAll': true } });
  await seedUser('task_details_assignee', SCHOOL_A, 'viewer');
  await adminDb.doc('users/task_details_owner/personalTasks/details_personal').set({
    schoolId: SCHOOL_A, scope: 'personal', ownerId: 'task_details_owner', createdBy: 'task_details_owner',
    title: 'הכנת מצגת', description: 'טיוטה ראשונה', priority: 'medium', dueDate: '2026-09-01', status: 'todo',
  });
  const organizationTask = {
    schoolId: SCHOOL_A, scope: 'assigned', assigneeType: 'individual', assigneeIds: ['task_details_assignee'], participantIds: [],
    createdBy: 'task_details_editor', title: 'בדיקת ציוד', description: 'בדיקת ציוד מעבדה', priority: 'low', dueDate: '2026-09-02', status: 'todo',
  };
  await adminDb.doc(`schools/${SCHOOL_A}/tasks/details_org`).set(organizationTask);
  await adminDb.doc(`tasks_${SCHOOL_A}/details_org`).set(organizationTask);

  async function proposedDetails(uid, question, taskId, next) {
    const result = await askZokiHandler(actorRequest(uid, { schoolId: SCHOOL_A, question }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const source = context.authorizedSources.find(item => ['task', 'personal_task'].includes(item.type)
          && item.fields.id === taskId && item.fields.canEditDetails === true);
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: source ? 'הכנתי עריכת משימה שממתינה לאישור.' : 'אין משימה מורשית לעריכה.',
          sourceIds: source ? [source.id] : [], followUpQuestion: null,
          actionProposal: source ? {
            type: 'task_details_update', taskSourceId: source.id,
            title: next.title ?? source.fields.title, description: next.description ?? source.fields.description,
            priority: next.priority ?? source.fields.priority, dueDate: next.dueDate ?? source.fields.dueDate,
          } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const personal = await proposedDetails(
    'task_details_owner', 'שנה את כותרת המשימה הכנת מצגת לכותרת הכנת מצגת הנהלה',
    'details_personal', { title: 'הכנת מצגת הנהלה' },
  );
  assert.deepEqual(personal.changedFields, ['title']);
  const personalPayload = {
    schoolId: SCHOOL_A, requestId: 'task_details_personal_1', confirm: true,
    taskId: personal.taskId, storageMode: personal.storageMode, expected: personal.expected, task: personal.task,
  };
  assert.equal((await executeZokiTaskDetailsHandler(actorRequest('task_details_owner', personalPayload))).executed, true);
  assert.equal((await executeZokiTaskDetailsHandler(actorRequest('task_details_owner', personalPayload))).executed, false);
  assert.equal((await adminDb.doc('users/task_details_owner/personalTasks/details_personal').get()).data().title, 'הכנת מצגת הנהלה');

  assert.equal(await proposedDetails(
    'task_details_assignee', 'עדכן את העדיפות של המשימה בדיקת ציוד לגבוהה',
    'details_org', { priority: 'high' },
  ), null);
  const organization = await proposedDetails(
    'task_details_editor', 'עדכן את העדיפות של המשימה בדיקת ציוד לגבוהה ואת תאריך היעד ל-2026-09-05',
    'details_org', { priority: 'high', dueDate: '2026-09-05' },
  );
  assert.deepEqual(organization.changedFields.sort(), ['dueDate', 'priority']);
  const organizationPayload = {
    schoolId: SCHOOL_A, requestId: 'task_details_org_1', confirm: true,
    taskId: organization.taskId, storageMode: organization.storageMode,
    expected: organization.expected, task: organization.task,
  };
  await assert.rejects(executeZokiTaskDetailsHandler(actorRequest('task_details_assignee', organizationPayload)), error => error.code === 'permission-denied');
  await adminDb.doc(`schools/${SCHOOL_A}/tasks/details_org`).update({ dueDate: '2026-09-03' });
  await assert.rejects(executeZokiTaskDetailsHandler(actorRequest('task_details_editor', {
    ...organizationPayload, requestId: 'task_details_stale',
  })), error => error.details?.reason === 'task-details-changed');
  await adminDb.doc(`schools/${SCHOOL_A}/tasks/details_org`).update({ dueDate: '2026-09-02' });
  assert.equal((await executeZokiTaskDetailsHandler(actorRequest('task_details_editor', organizationPayload))).executed, true);
  for (const path of [`schools/${SCHOOL_A}/tasks/details_org`, `tasks_${SCHOOL_A}/details_org`]) {
    const saved = (await adminDb.doc(path).get()).data();
    assert.equal(saved.priority, 'high');
    assert.equal(saved.dueDate, '2026-09-05');
  }
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'zoki.action.task.details.update').get();
  assert.equal(audits.size, 2);
  assert.equal(JSON.stringify(audits.docs.map(item => item.data())).includes('מצגת'), false);
  assert.equal(JSON.stringify(audits.docs.map(item => item.data())).includes('מעבדה'), false);
});

test('Zoki proposes and executes an exact grade change only with edit permission, confirmation and an unchanged prior value', async () => {
  await seedUser('grade_editor', SCHOOL_A, 'viewer', { permissions: { 'students.view': true, 'grades.view': true, 'grades.edit': true } });
  await seedUser('grade_viewer', SCHOOL_A, 'viewer', { permissions: { 'students.view': true, 'grades.view': true } });
  await adminDb.doc(`schools/${SCHOOL_A}/classes/class_a`).set({ schoolId: SCHOOL_A, name: 'כיתה א', status: 'active' });
  await adminDb.doc(`schools/${SCHOOL_A}/students/student_a`).set({ schoolId: SCHOOL_A, fullName: 'נועה כהן', classId: 'class_a', className: 'כיתה א', status: 'active' });
  await adminDb.doc(`schools/${SCHOOL_A}/gradebooks/gradebook_a`).set({
    schoolId: SCHOOL_A, classId: 'class_a', className: 'כיתה א', status: 'active',
    subjects: [{ id: 'math', name: 'מתמטיקה', components: [{ id: 'exam', name: 'מבחן', weight: 50 }, { id: 'work', name: 'עבודה', weight: 50 }] }],
  });
  await adminDb.doc(`schools/${SCHOOL_A}/gradebooks/gradebook_a/grades/student_a`).set({
    schoolId: SCHOOL_A, gradebookId: 'gradebook_a', classId: 'class_a', studentId: 'student_a', displayName: 'נועה כהן',
    scores: { math: { exam: '70', work: '80' } }, calculated: { math: 75 },
  });

  async function proposedAction(uid) {
    const result = await askZokiHandler(actorRequest(uid, { schoolId: SCHOOL_A, question: 'עדכן לנועה כהן את ציון המבחן במתמטיקה ל-90' }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const gradeSource = context.authorizedSources.find(item => item.type === 'grade');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: 'הכנתי שינוי ציון שממתין לאישור.',
          sourceIds: gradeSource ? [gradeSource.id] : [], followUpQuestion: null,
          actionProposal: gradeSource ? { type: 'grade_update', sourceId: gradeSource.id, subjectId: 'math', componentId: 'exam', score: 90 } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const editorProposal = await proposedAction('grade_editor');
  assert.deepEqual({
    studentId: editorProposal.studentId, subjectId: editorProposal.subjectId,
    componentId: editorProposal.componentId, previousScore: editorProposal.previousScore, score: editorProposal.score,
  }, { studentId: 'student_a', subjectId: 'math', componentId: 'exam', previousScore: 70, score: 90 });
  assert.equal(await proposedAction('grade_viewer'), null);

  const payload = {
    schoolId: SCHOOL_A, requestId: 'grade_action_1', confirm: true,
    gradebookId: 'gradebook_a', studentId: 'student_a', subjectId: 'math', componentId: 'exam',
    score: 90, expectedPreviousScore: 70,
  };
  await assert.rejects(executeZokiGradeHandler(actorRequest('grade_viewer', payload)), error => error.code === 'permission-denied');
  const first = await executeZokiGradeHandler(actorRequest('grade_editor', payload));
  const repeated = await executeZokiGradeHandler(actorRequest('grade_editor', payload));
  assert.equal(first.executed, true);
  assert.equal(repeated.executed, false);
  const row = (await adminDb.doc(`schools/${SCHOOL_A}/gradebooks/gradebook_a/grades/student_a`).get()).data();
  assert.equal(row.scores.math.exam, '90');
  assert.equal(row.calculated.math, 85);
  await assert.rejects(executeZokiGradeHandler(actorRequest('grade_editor', {
    ...payload, requestId: 'grade_action_stale', score: 95, expectedPreviousScore: 70,
  })), error => error.code === 'aborted');
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'zoki.action.grade.update').get();
  assert.equal(audits.size, 1);
  const auditData = audits.docs[0].data();
  assert.deepEqual(auditData.before, {});
  assert.deepEqual(auditData.after, {});
  assert.equal(Object.hasOwn(auditData.metadata, 'score'), false);
  assert.equal(Object.hasOwn(auditData.metadata, 'previousScore'), false);
});

test('Zoki transfers one student atomically only to an authorized class in the same academic year', async () => {
  await seedUser('transfer_editor', SCHOOL_A, 'viewer', { permissions: {
    'students.view': true, 'classes.view': true, 'students.transferClass': true,
  } });
  await seedUser('transfer_viewer', SCHOOL_A, 'viewer', { permissions: { 'students.view': true, 'classes.view': true } });
  await adminDb.doc(`schools/${SCHOOL_A}/classes/class_a`).set({
    schoolId: SCHOOL_A, name: 'כיתה א1', gradeLevel: 'א', academicYearId: 'year_2026', academicYear: 'תשפ״ז', status: 'active',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/classes/class_b`).set({
    schoolId: SCHOOL_A, name: 'כיתה א2', gradeLevel: 'א', academicYearId: 'year_2026', academicYear: 'תשפ״ז', status: 'active',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/classes/class_c`).set({
    schoolId: SCHOOL_A, name: 'כיתה ב1', gradeLevel: 'ב', academicYearId: 'year_2027', academicYear: 'תשפ״ח', status: 'active',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/students/student_a`).set({
    schoolId: SCHOOL_A, fullName: 'נועה כהן', classId: 'class_a', className: 'כיתה א1', gradeLevel: 'א',
    academicYearId: 'year_2026', academicYear: 'תשפ״ז', currentEnrollmentId: 'student_a__year_2026', status: 'active',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/studentEnrollments/student_a__year_2026`).set({
    schoolId: SCHOOL_A, studentId: 'student_a', academicYearId: 'year_2026', academicYearLabel: 'תשפ״ז',
    classId: 'class_a', className: 'כיתה א1', grade: 'א', enrollmentStatus: 'active', createdBy: 'principal_a', createdAt: Timestamp.now(),
  });

  async function proposedTransfer(uid) {
    const result = await askZokiHandler(actorRequest(uid, {
      schoolId: SCHOOL_A, question: 'העבר את נועה כהן מכיתה א1 לכיתה א2 בתאריך 2026-09-05 בגלל בקשת משפחה',
    }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const student = context.authorizedSources.find(item => item.type === 'student' && item.fields.fullName === 'נועה כהן');
        const target = context.authorizedSources.find(item => item.type === 'class' && item.fields.name === 'כיתה א2');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: 'הכנתי העברה שממתינה לאישור.',
          sourceIds: [student?.id, target?.id].filter(Boolean), followUpQuestion: null,
          actionProposal: student && target ? {
            type: 'student_transfer', studentSourceId: student.id, targetClassSourceId: target.id,
            effectiveDate: '2026-09-05', reason: 'בקשת משפחה',
          } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const proposal = await proposedTransfer('transfer_editor');
  assert.deepEqual({
    studentId: proposal.studentId, expectedCurrentClassId: proposal.expectedCurrentClassId,
    targetClassId: proposal.targetClassId, effectiveDate: proposal.effectiveDate,
  }, { studentId: 'student_a', expectedCurrentClassId: 'class_a', targetClassId: 'class_b', effectiveDate: '2026-09-05' });
  assert.equal(await proposedTransfer('transfer_viewer'), null);

  const payload = {
    schoolId: SCHOOL_A, requestId: 'transfer_action_1', confirm: true,
    studentId: 'student_a', targetClassId: 'class_b', expectedCurrentClassId: 'class_a',
    effectiveDate: '2026-09-05', reason: 'בקשת משפחה סודית',
  };
  await assert.rejects(executeZokiStudentTransferHandler(actorRequest('transfer_viewer', payload)), error => error.code === 'permission-denied');
  const first = await executeZokiStudentTransferHandler(actorRequest('transfer_editor', payload));
  const repeated = await executeZokiStudentTransferHandler(actorRequest('transfer_editor', payload));
  assert.equal(first.executed, true);
  assert.equal(repeated.executed, false);
  const student = (await adminDb.doc(`schools/${SCHOOL_A}/students/student_a`).get()).data();
  assert.equal(student.classId, 'class_b');
  const enrollment = (await adminDb.doc(`schools/${SCHOOL_A}/studentEnrollments/student_a__year_2026`).get()).data();
  assert.equal(enrollment.classId, 'class_b');
  const history = await adminDb.collection(`schools/${SCHOOL_A}/students/student_a/history`).get();
  assert.equal(history.size, 1);
  assert.equal(history.docs[0].data().previousClassId, 'class_a');
  assert.equal(history.docs[0].data().nextClassId, 'class_b');
  await assert.rejects(executeZokiStudentTransferHandler(actorRequest('transfer_editor', {
    ...payload, requestId: 'transfer_stale', targetClassId: 'class_a', expectedCurrentClassId: 'class_a',
  })), error => error.code === 'aborted');
  await assert.rejects(executeZokiStudentTransferHandler(actorRequest('transfer_editor', {
    ...payload, requestId: 'transfer_cross_year', targetClassId: 'class_c', expectedCurrentClassId: 'class_b',
  })), error => error.code === 'failed-precondition');
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'zoki.action.student.transferClass').get();
  assert.equal(audits.size, 1);
  assert.equal(JSON.stringify(audits.docs[0].data()).includes('בקשת משפחה סודית'), false);
});

test('Zoki assigns an existing role only after confirmation and through the established role authority', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('role_viewer', SCHOOL_A, 'viewer', { permissions: { 'staff.view': true, 'roles.view': true } });
  await seedUser('target_staff', SCHOOL_A, 'viewer', { fullName: 'דנה לוי' });
  await adminAuth.createUser({ uid: 'target_staff', email: 'zoki-role-target@example.test' });
  createdAuthUsers.add('target_staff');
  await adminDb.doc(`schools/${SCHOOL_A}/roleDefinitions/grade_viewer_role`).set({
    schoolId: SCHOOL_A,
    name: 'צפייה בציונים',
    description: 'גישה לקריאת ציונים בלבד',
    permissions: { 'students.view': true, 'grades.view': true },
    delegatedPermissionKeys: [],
    accessScope: { type: 'school', classIds: [] },
    delegable: false,
    protected: false,
    status: 'active',
  });

  async function proposedRoleAssignment(uid) {
    const result = await askZokiHandler(actorRequest(uid, {
      schoolId: SCHOOL_A, question: 'הקצה לדנה לוי את תפקיד צפייה בציונים',
    }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const staff = context.authorizedSources.find(item => item.type === 'staff' && item.fields.name === 'דנה לוי');
        const role = context.authorizedSources.find(item => item.type === 'role' && item.fields.name === 'צפייה בציונים');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: 'הכנתי שינוי תפקיד שממתין לאישור.',
          sourceIds: [staff?.id, role?.id].filter(Boolean), followUpQuestion: null,
          actionProposal: staff && role ? {
            type: 'role_assignment', staffSourceId: staff.id, roleSourceId: role.id, operation: 'assign',
          } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const proposal = await proposedRoleAssignment('principal_a');
  assert.deepEqual({
    userId: proposal.userId, roleId: proposal.roleId, operation: proposal.operation,
    expectedCurrentlyAssigned: proposal.expectedCurrentlyAssigned,
  }, {
    userId: 'target_staff', roleId: 'grade_viewer_role', operation: 'assign',
    expectedCurrentlyAssigned: false,
  });
  assert.equal(await proposedRoleAssignment('role_viewer'), null);

  const payload = {
    schoolId: SCHOOL_A, requestId: 'role_action_1', confirm: true,
    userId: 'target_staff', roleId: 'grade_viewer_role', action: 'assign',
    expectedCurrentlyAssigned: false,
  };
  await assert.rejects(executeZokiRoleAssignmentHandler(actorRequest('role_viewer', payload)), error => error.code === 'permission-denied');
  const first = await executeZokiRoleAssignmentHandler(actorRequest('principal_a', payload));
  const repeated = await executeZokiRoleAssignmentHandler(actorRequest('principal_a', payload));
  assert.equal(first.executed, true);
  assert.equal(repeated.executed, false);
  const target = (await adminDb.doc('users/target_staff').get()).data();
  assert.deepEqual(target.customRoleAssignments[SCHOOL_A], ['grade_viewer_role']);
  assert.equal(target.rolePermissionsBySchool[SCHOOL_A]['grades.view'], true);

  await assert.rejects(executeZokiRoleAssignmentHandler(actorRequest('principal_a', {
    ...payload, requestId: 'role_action_stale', action: 'remove', expectedCurrentlyAssigned: false,
  })), error => error.code === 'aborted');
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'zoki.action.role.assign').get();
  assert.equal(audits.size, 1);
  assert.equal(JSON.stringify(audits.docs[0].data()).includes('צפייה בציונים'), false);
});

test('Zoki grants and revokes one exact staff permission while preserving aliases and unrelated settings', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('permission_viewer', SCHOOL_A, 'viewer', { permissions: { 'staff.view': true } });
  await seedUser('target_staff', SCHOOL_A, 'viewer', {
    fullName: 'דנה לוי',
    permissions: { tasks_view: true, legacy_setting: true },
  });
  await seedUser('protected_manager', SCHOOL_A, 'principal', { fullName: 'מנהל מוגן' });

  async function proposedPermission(uid, targetName = 'דנה לוי') {
    const result = await askZokiHandler(actorRequest(uid, {
      schoolId: SCHOOL_A, question: `תן ל${targetName} הרשאת עריכת לוח השנה`,
    }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const staff = context.authorizedSources.find(item => item.type === 'staff' && item.fields.name === targetName);
        const permission = context.authorizedSources.find(item => item.type === 'permission' && item.fields.key === 'calendar.edit');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: 'הכנתי שינוי הרשאה שממתין לאישור.',
          sourceIds: [staff?.id, permission?.id].filter(Boolean), followUpQuestion: null,
          actionProposal: staff && permission ? {
            type: 'direct_permission_change', staffSourceId: staff.id,
            permissionSourceId: permission.id, operation: 'grant',
          } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const proposal = await proposedPermission('principal_a');
  assert.deepEqual({
    userId: proposal.userId,
    permissionKey: proposal.permissionKey,
    operation: proposal.operation,
    expectedCurrentlyEnabled: proposal.expectedCurrentlyEnabled,
  }, {
    userId: 'target_staff',
    permissionKey: 'calendar.edit',
    operation: 'grant',
    expectedCurrentlyEnabled: false,
  });
  assert.equal(await proposedPermission('permission_viewer'), null);
  assert.equal(await proposedPermission('principal_a', 'מנהל מוגן'), null);

  const grantPayload = {
    schoolId: SCHOOL_A, requestId: 'permission_action_grant', confirm: true,
    userId: 'target_staff', permissionKey: 'calendar.edit', action: 'grant',
    expectedCurrentlyEnabled: false,
  };
  await assert.rejects(
    executeZokiDirectPermissionHandler(actorRequest('permission_viewer', grantPayload)),
    error => error.code === 'permission-denied',
  );
  const granted = await executeZokiDirectPermissionHandler(actorRequest('principal_a', grantPayload));
  const repeated = await executeZokiDirectPermissionHandler(actorRequest('principal_a', grantPayload));
  assert.equal(granted.executed, true);
  assert.equal(repeated.executed, false);
  let permissions = (await adminDb.doc('users/target_staff').get()).data().permissions;
  assert.equal(permissions['calendar.edit'], true);
  assert.equal(permissions.calendar_edit, true);
  assert.equal(permissions.tasks_view, true);
  assert.equal(permissions.legacy_setting, true);

  await assert.rejects(executeZokiDirectPermissionHandler(actorRequest('principal_a', {
    ...grantPayload, requestId: 'permission_action_stale', action: 'revoke', expectedCurrentlyEnabled: false,
  })), error => error.code === 'aborted');
  const revoked = await executeZokiDirectPermissionHandler(actorRequest('principal_a', {
    ...grantPayload, requestId: 'permission_action_revoke', action: 'revoke', expectedCurrentlyEnabled: true,
  }));
  assert.equal(revoked.executed, true);
  permissions = (await adminDb.doc('users/target_staff').get()).data().permissions;
  assert.equal(permissions['calendar.edit'], false);
  assert.equal(permissions.calendar_edit, false);
  assert.equal(permissions.tasks_view, true);
  assert.equal(permissions.legacy_setting, true);

  await assert.rejects(executeZokiDirectPermissionHandler(actorRequest('principal_a', {
    ...grantPayload, requestId: 'permission_action_protected', userId: 'protected_manager',
  })), error => error.code === 'permission-denied');
  const audits = await adminDb.collection('auditLogs').where('targetType', '==', 'staffPermission').get();
  assert.equal(audits.size, 2);
  const auditText = JSON.stringify(audits.docs.map(item => item.data()));
  assert.equal(auditText.includes('דנה לוי'), false);
  assert.equal(auditText.includes('עריכת אירועים'), false);
});

test('Zoki manages exact file access with explicit deny, rule removal and materialized policy updates', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('acl_manager', SCHOOL_A, 'viewer', { permissions: {
    'staff.view': true, 'files.view': true, 'files.managePermissions': true,
  } });
  await seedUser('file_viewer', SCHOOL_A, 'viewer', { permissions: {
    'staff.view': true, 'files.view': true,
  } });
  await seedUser('target_staff', SCHOOL_A, 'viewer', {
    fullName: 'דנה לוי', permissions: { 'files.view': true },
  });
  await seedUser('protected_manager', SCHOOL_A, 'principal', { fullName: 'מנהל מוגן' });
  await adminDb.doc(`schools/${SCHOOL_A}/files/safety_policy`).set({
    schoolId: SCHOOL_A, name: 'תקנון בטיחות', fileType: 'document', status: 'active',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/folders/procedures_folder`).set({
    schoolId: SCHOOL_A, name: 'נהלים', status: 'active',
  });

  async function proposedResourceAccess(uid) {
    const result = await askZokiHandler(actorRequest(uid, {
      schoolId: SCHOOL_A, question: 'תן לדנה לוי הרשאת עריכה לקובץ תקנון בטיחות',
    }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const staff = context.authorizedSources.find(item => item.type === 'staff' && item.fields.name === 'דנה לוי');
        const file = context.authorizedSources.find(item => item.type === 'file' && item.fields.name === 'תקנון בטיחות');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: 'הכנתי שינוי גישה לקובץ שממתין לאישור.',
          sourceIds: [staff?.id, file?.id].filter(Boolean), followUpQuestion: null,
          actionProposal: staff && file ? {
            type: 'resource_access_change', staffSourceId: staff.id,
            resourceSourceId: file.id, operation: 'grant', accessLevel: 'edit',
          } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const proposal = await proposedResourceAccess('acl_manager');
  assert.deepEqual({
    userId: proposal.userId, resourceType: proposal.resourceType, resourceId: proposal.resourceId,
    operation: proposal.operation, accessLevel: proposal.accessLevel,
    expectedDirectState: proposal.expectedDirectState,
  }, {
    userId: 'target_staff', resourceType: 'file', resourceId: 'safety_policy',
    operation: 'grant', accessLevel: 'edit', expectedDirectState: 'none',
  });
  assert.equal(await proposedResourceAccess('file_viewer'), null);

  const folderProposal = await askZokiHandler(actorRequest('acl_manager', {
    schoolId: SCHOOL_A, question: 'חסום לדנה לוי גישה לתיקייה נהלים',
  }), {
    apiKey: 'server-test-key', model: 'test-model',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const context = JSON.parse(body.contents[0].parts[0].text);
      const staff = context.authorizedSources.find(item => item.type === 'staff' && item.fields.name === 'דנה לוי');
      const folder = context.authorizedSources.find(item => item.type === 'folder' && item.fields.name === 'נהלים');
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        answer: 'הכנתי חסימת תיקייה שממתינה לאישור.',
        sourceIds: [staff?.id, folder?.id].filter(Boolean), followUpQuestion: null,
        actionProposal: staff && folder ? {
          type: 'resource_access_change', staffSourceId: staff.id,
          resourceSourceId: folder.id, operation: 'deny', accessLevel: 'view',
        } : null,
      }) }] } }] }) };
    },
  });
  assert.deepEqual({
    resourceType: folderProposal.actionProposal?.resourceType,
    resourceId: folderProposal.actionProposal?.resourceId,
    operation: folderProposal.actionProposal?.operation,
    expectedDirectState: folderProposal.actionProposal?.expectedDirectState,
  }, {
    resourceType: 'folder', resourceId: 'procedures_folder', operation: 'deny', expectedDirectState: 'none',
  });

  const grantPayload = {
    schoolId: SCHOOL_A, requestId: 'resource_access_grant', confirm: true,
    userId: 'target_staff', resourceType: 'file', resourceId: 'safety_policy',
    action: 'grant', accessLevel: 'edit', expectedDirectState: 'none',
  };
  await assert.rejects(
    executeZokiResourceAccessHandler(actorRequest('file_viewer', grantPayload)),
    error => error.code === 'permission-denied',
  );
  const granted = await executeZokiResourceAccessHandler(actorRequest('acl_manager', grantPayload));
  const repeated = await executeZokiResourceAccessHandler(actorRequest('acl_manager', grantPayload));
  assert.equal(granted.executed, true);
  assert.equal(repeated.executed, false);
  let aclSnapshot = await adminDb.collection(`schools/${SCHOOL_A}/resourceAcls`)
    .where('resourceType', '==', 'file').where('resourceId', '==', 'safety_policy').get();
  assert.equal(aclSnapshot.size, 1);
  assert.equal(aclSnapshot.docs[0].data().principalId, 'target_staff');
  assert.equal(aclSnapshot.docs[0].data().accessLevel, 'edit');
  assert.equal(aclSnapshot.docs[0].data().explicitDeny, false);
  let policy = (await adminDb.doc(`schools/${SCHOOL_A}/resourceAclPolicies/file_safety_policy`).get()).data();
  assert.deepEqual(policy.edit.allowedUsers, ['target_staff']);

  await assert.rejects(executeZokiResourceAccessHandler(actorRequest('acl_manager', {
    ...grantPayload, requestId: 'resource_access_stale', action: 'deny', expectedDirectState: 'none',
  })), error => error.code === 'aborted');
  const denied = await executeZokiResourceAccessHandler(actorRequest('acl_manager', {
    ...grantPayload, requestId: 'resource_access_deny', action: 'deny', accessLevel: 'view',
    expectedDirectState: 'grant:edit',
  }));
  assert.equal(denied.executed, true);
  aclSnapshot = await adminDb.collection(`schools/${SCHOOL_A}/resourceAcls`)
    .where('resourceType', '==', 'file').where('resourceId', '==', 'safety_policy').get();
  assert.equal(aclSnapshot.docs[0].data().explicitDeny, true);
  policy = (await adminDb.doc(`schools/${SCHOOL_A}/resourceAclPolicies/file_safety_policy`).get()).data();
  assert.deepEqual(policy.view.deniedUsers, ['target_staff']);
  assert.deepEqual(policy.edit.allowedUsers, []);

  const removed = await executeZokiResourceAccessHandler(actorRequest('acl_manager', {
    ...grantPayload, requestId: 'resource_access_remove', action: 'remove', accessLevel: 'view',
    expectedDirectState: 'deny',
  }));
  assert.equal(removed.executed, true);
  aclSnapshot = await adminDb.collection(`schools/${SCHOOL_A}/resourceAcls`)
    .where('resourceType', '==', 'file').where('resourceId', '==', 'safety_policy').get();
  assert.equal(aclSnapshot.docs[0].data().active, false);
  policy = (await adminDb.doc(`schools/${SCHOOL_A}/resourceAclPolicies/file_safety_policy`).get()).data();
  assert.equal(policy.configured, false);

  const folderDenied = await executeZokiResourceAccessHandler(actorRequest('acl_manager', {
    schoolId: SCHOOL_A, requestId: 'resource_access_folder_deny', confirm: true,
    userId: 'target_staff', resourceType: 'folder', resourceId: 'procedures_folder',
    action: 'deny', accessLevel: 'view', expectedDirectState: 'none',
  }));
  assert.equal(folderDenied.executed, true);
  const folderPolicy = (await adminDb.doc(`schools/${SCHOOL_A}/resourceAclPolicies/folder_procedures_folder`).get()).data();
  assert.deepEqual(folderPolicy.view.deniedUsers, ['target_staff']);

  await assert.rejects(executeZokiResourceAccessHandler(actorRequest('principal_a', {
    ...grantPayload, requestId: 'resource_access_protected', userId: 'protected_manager',
  })), error => error.code === 'permission-denied');
  const audits = await adminDb.collection('auditLogs').where('targetType', '==', 'resourceAccess').get();
  assert.equal(audits.size, 4);
  const auditText = JSON.stringify(audits.docs.map(item => item.data()));
  assert.equal(auditText.includes('דנה לוי'), false);
  assert.equal(auditText.includes('תקנון בטיחות'), false);
});

test('Zoki creates exact empty folders and in-app documents once in both stores', async () => {
  await seedUser('resource_creator', SCHOOL_A, 'viewer', { permissions: {
    'files.view': true, 'files.create': true,
  } });
  await seedUser('resource_viewer', SCHOOL_A, 'viewer', { permissions: { 'files.view': true } });

  async function proposedCreation(uid, question, kind, name, folderName = '') {
    const result = await askZokiHandler(actorRequest(uid, { schoolId: SCHOOL_A, question }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const config = context.authorizedSources.find(item => item.type === 'file_create_config');
        const folder = context.authorizedSources.find(item => item.type === 'folder' && item.fields.name === folderName);
        const actionable = config && (kind === 'folder' || folder);
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: 'הכנתי פריט חדש שממתין לאישור.',
          sourceIds: [config?.id, folder?.id].filter(Boolean), followUpQuestion: null,
          actionProposal: actionable ? {
            type: 'resource_create', configSourceId: config.id, kind, name,
            folderSourceId: kind === 'folder' ? null : folder.id, visibility: 'all',
          } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const folderProposal = await proposedCreation(
    'resource_creator', 'צור תיקייה חדשה בשם נהלי בטיחות', 'folder', 'נהלי בטיחות'
  );
  assert.deepEqual({ kind: folderProposal.kind, name: folderProposal.name, visibility: folderProposal.visibility }, {
    kind: 'folder', name: 'נהלי בטיחות', visibility: 'all',
  });
  assert.equal(await proposedCreation(
    'resource_viewer', 'צור תיקייה חדשה בשם נהלי בטיחות', 'folder', 'נהלי בטיחות'
  ), null);
  const folderPayload = {
    schoolId: SCHOOL_A, requestId: 'resource_create_folder_1', confirm: true,
    kind: 'folder', name: folderProposal.name, folderId: '', visibility: folderProposal.visibility,
  };
  await assert.rejects(executeZokiResourceCreateHandler(actorRequest('resource_viewer', folderPayload)), error => error.code === 'permission-denied');
  const createdFolder = await executeZokiResourceCreateHandler(actorRequest('resource_creator', folderPayload));
  assert.equal(createdFolder.executed, true);
  assert.equal((await executeZokiResourceCreateHandler(actorRequest('resource_creator', folderPayload))).executed, false);
  const [nestedFolder, legacyFolder] = await Promise.all([
    adminDb.doc(`schools/${SCHOOL_A}/folders/${createdFolder.resourceId}`).get(),
    adminDb.doc(`folders_${SCHOOL_A}/${createdFolder.resourceId}`).get(),
  ]);
  assert.equal(nestedFolder.data().name, 'נהלי בטיחות');
  assert.equal(legacyFolder.data().visibility, 'all');
  await assert.rejects(executeZokiResourceCreateHandler(actorRequest('resource_creator', {
    ...folderPayload, requestId: 'resource_create_folder_duplicate',
  })), error => error.details?.reason === 'resource-name-exists');

  const documentProposal = await proposedCreation(
    'resource_creator', 'צור מסמך חדש בשם נוהל יציאה בתוך תיקיית נהלי בטיחות',
    'document', 'נוהל יציאה', 'נהלי בטיחות'
  );
  assert.deepEqual({ kind: documentProposal.kind, name: documentProposal.name, folderId: documentProposal.folderId }, {
    kind: 'document', name: 'נוהל יציאה', folderId: createdFolder.resourceId,
  });
  const documentPayload = {
    schoolId: SCHOOL_A, requestId: 'resource_create_document_1', confirm: true,
    kind: 'document', name: documentProposal.name, folderId: documentProposal.folderId, visibility: 'all',
  };
  const createdDocument = await executeZokiResourceCreateHandler(actorRequest('resource_creator', documentPayload));
  assert.equal(createdDocument.executed, true);
  const [nestedDocument, legacyDocument] = await Promise.all([
    adminDb.doc(`schools/${SCHOOL_A}/files/${createdDocument.resourceId}`).get(),
    adminDb.doc(`files_${SCHOOL_A}/${createdDocument.resourceId}`).get(),
  ]);
  assert.equal(nestedDocument.data().content, '<p></p>');
  assert.equal(legacyDocument.data().folderId, createdFolder.resourceId);
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'zoki.action.resource.create').get();
  assert.equal(audits.size, 2);
  const auditText = JSON.stringify(audits.docs.map(item => item.data()));
  assert.equal(auditText.includes('נהלי בטיחות'), false);
  assert.equal(auditText.includes('נוהל יציאה'), false);
});

test('Zoki renames and recycles exact resources with dual-store and stale-state protection', async () => {
  await seedUser('resource_editor', SCHOOL_A, 'viewer', { permissions: {
    'files.view': true, 'files.edit': true, 'files.delete': true,
  } });
  await seedUser('resource_reader', SCHOOL_A, 'viewer', { permissions: { 'files.view': true } });
  const originFolder = { schoolId: SCHOOL_A, name: 'נהלים ישנים', visibility: 'all' };
  const targetFolder = { schoolId: SCHOOL_A, name: 'נהלים בתוקף', visibility: 'all' };
  const file = { schoolId: SCHOOL_A, name: 'נוהל טיולים ישן', fileType: 'document', folderId: 'old_policies', content: 'תוכן פנימי' };
  await Promise.all([
    adminDb.doc(`schools/${SCHOOL_A}/folders/old_policies`).set(originFolder),
    adminDb.doc(`folders_${SCHOOL_A}/old_policies`).set(originFolder),
    adminDb.doc(`schools/${SCHOOL_A}/folders/active_policies`).set(targetFolder),
    adminDb.doc(`folders_${SCHOOL_A}/active_policies`).set(targetFolder),
    adminDb.doc(`schools/${SCHOOL_A}/files/trip_policy`).set(file),
    adminDb.doc(`files_${SCHOOL_A}/trip_policy`).set(file),
  ]);

  async function proposedResourceMutation(uid, question, type) {
    const result = await askZokiHandler(actorRequest(uid, { schoolId: SCHOOL_A, question }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const source = context.authorizedSources.find(item => item.type === 'file' && item.fields.id === 'trip_policy');
        const target = context.authorizedSources.find(item => item.type === 'folder' && item.fields.id === 'active_policies');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: 'הכנתי פעולה שממתינה לאישור.',
          sourceIds: [source?.id, type === 'resource_move' ? target?.id : null].filter(Boolean), followUpQuestion: null,
          actionProposal: source && (type !== 'resource_move' || target) ? (type === 'resource_move' ? {
            type, fileSourceId: source.id, targetFolderSourceId: target.id,
          } : {
            type, resourceSourceId: source.id,
            ...(type === 'resource_rename' ? { newName: 'נוהל טיולים מעודכן' } : {}),
          }) : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const rename = await proposedResourceMutation(
    'resource_editor', 'שנה את השם של הקובץ נוהל טיולים ישן לשם נוהל טיולים מעודכן', 'resource_rename'
  );
  assert.deepEqual({ type: rename.type, resourceId: rename.resourceId, currentName: rename.currentName, newName: rename.newName }, {
    type: 'resource_rename', resourceId: 'trip_policy', currentName: 'נוהל טיולים ישן', newName: 'נוהל טיולים מעודכן',
  });
  assert.equal(await proposedResourceMutation(
    'resource_reader', 'שנה את השם של הקובץ נוהל טיולים ישן לשם נוהל טיולים מעודכן', 'resource_rename'
  ), null);
  const renamePayload = {
    schoolId: SCHOOL_A, requestId: 'resource_rename_1', confirm: true,
    resourceType: 'file', resourceId: 'trip_policy', expectedName: rename.currentName, newName: rename.newName,
  };
  await assert.rejects(executeZokiResourceRenameHandler(actorRequest('resource_reader', renamePayload)), error => error.code === 'permission-denied');
  assert.equal((await executeZokiResourceRenameHandler(actorRequest('resource_editor', renamePayload))).executed, true);
  assert.equal((await executeZokiResourceRenameHandler(actorRequest('resource_editor', renamePayload))).executed, false);
  const [nestedRenamed, legacyRenamed] = await Promise.all([
    adminDb.doc(`schools/${SCHOOL_A}/files/trip_policy`).get(),
    adminDb.doc(`files_${SCHOOL_A}/trip_policy`).get(),
  ]);
  assert.equal(nestedRenamed.data().name, 'נוהל טיולים מעודכן');
  assert.equal(legacyRenamed.data().name, 'נוהל טיולים מעודכן');
  await assert.rejects(executeZokiResourceRenameHandler(actorRequest('resource_editor', {
    ...renamePayload, requestId: 'resource_rename_stale', newName: 'שם אחר',
  })), error => error.details?.reason === 'resource-changed');

  const trash = await proposedResourceMutation(
    'resource_editor', 'העבר את הקובץ נוהל טיולים מעודכן לסל המחזור', 'resource_trash'
  );
  assert.equal(trash.resourceName, 'נוהל טיולים מעודכן');
  const trashPayload = {
    schoolId: SCHOOL_A, resourceType: 'file', resourceId: 'trip_policy', action: 'trash',
    source: 'zoki', requestId: 'resource_trash_1', expectedName: trash.resourceName,
  };
  await assert.rejects(fileTrashActionHandler(actorRequest('resource_reader', trashPayload)), error => error.code === 'permission-denied');
  await assert.rejects(fileTrashActionHandler(actorRequest('resource_editor', {
    ...trashPayload, requestId: 'resource_trash_stale', expectedName: 'שם ישן',
  })), error => error.details?.reason === 'resource-changed');
  assert.equal((await fileTrashActionHandler(actorRequest('resource_editor', trashPayload))).executed, true);
  assert.equal((await fileTrashActionHandler(actorRequest('resource_editor', trashPayload))).executed, false);
  const [nestedTrashed, legacyTrashed] = await Promise.all([
    adminDb.doc(`schools/${SCHOOL_A}/files/trip_policy`).get(),
    adminDb.doc(`files_${SCHOOL_A}/trip_policy`).get(),
  ]);
  assert.ok(nestedTrashed.data().trashedAt);
  assert.ok(legacyTrashed.data().trashedAt);
  const restore = await proposedResourceMutation(
    'resource_editor', 'שחזר את הקובץ נוהל טיולים מעודכן מסל המחזור', 'resource_restore'
  );
  assert.equal(restore.resourceName, 'נוהל טיולים מעודכן');
  const restorePayload = {
    schoolId: SCHOOL_A, resourceType: 'file', resourceId: 'trip_policy', action: 'restore',
    source: 'zoki', requestId: 'resource_restore_1', expectedName: restore.resourceName,
  };
  assert.equal((await fileTrashActionHandler(actorRequest('resource_editor', restorePayload))).executed, true);
  assert.equal((await fileTrashActionHandler(actorRequest('resource_editor', restorePayload))).executed, false);
  assert.equal((await adminDb.doc(`schools/${SCHOOL_A}/files/trip_policy`).get()).data().trashedAt, undefined);
  assert.equal((await adminDb.doc(`files_${SCHOOL_A}/trip_policy`).get()).data().trashedAt, undefined);

  const move = await proposedResourceMutation(
    'resource_editor', 'העבר את הקובץ נוהל טיולים מעודכן אל תיקיית נהלים בתוקף', 'resource_move'
  );
  assert.deepEqual({ fileId: move.fileId, expectedFolderId: move.expectedFolderId, targetFolderId: move.targetFolderId }, {
    fileId: 'trip_policy', expectedFolderId: 'old_policies', targetFolderId: 'active_policies',
  });
  const movePayload = {
    schoolId: SCHOOL_A, requestId: 'resource_move_1', confirm: true,
    fileId: move.fileId, expectedName: move.fileName,
    expectedFolderId: move.expectedFolderId, targetFolderId: move.targetFolderId,
  };
  assert.equal((await executeZokiResourceMoveHandler(actorRequest('resource_editor', movePayload))).executed, true);
  assert.equal((await executeZokiResourceMoveHandler(actorRequest('resource_editor', movePayload))).executed, false);
  assert.equal((await adminDb.doc(`schools/${SCHOOL_A}/files/trip_policy`).get()).data().folderId, 'active_policies');
  assert.equal((await adminDb.doc(`files_${SCHOOL_A}/trip_policy`).get()).data().folderId, 'active_policies');
  await assert.rejects(executeZokiResourceMoveHandler(actorRequest('resource_editor', {
    ...movePayload, requestId: 'resource_move_stale', expectedFolderId: 'wrong_folder', targetFolderId: 'old_policies',
  })), error => error.details?.reason === 'resource-changed');
  const audits = await adminDb.collection('auditLogs').where('targetId', '==', 'trip_policy').get();
  assert.equal(audits.docs.some(item => item.data().action === 'zoki.action.resource.rename'), true);
  assert.equal(audits.docs.some(item => item.data().action === 'zoki.action.resource.restore'), true);
  assert.equal(audits.docs.some(item => item.data().action === 'zoki.action.resource.move'), true);
  assert.equal(JSON.stringify(audits.docs.map(item => item.data())).includes('נוהל טיולים'), false);
});

test('Zoki changes one student track atomically and keeps the active enrollment synchronized', async () => {
  await seedUser('track_editor', SCHOOL_A, 'viewer', { permissions: {
    'students.view': true, 'students.managePrograms': true,
  } });
  await seedUser('track_viewer', SCHOOL_A, 'viewer', { permissions: { 'students.view': true } });
  await adminDb.doc(`schools/${SCHOOL_A}/students/student_a`).set({
    schoolId: SCHOOL_A, fullName: 'נועה כהן', classId: 'class_a', className: 'כיתה א1',
    academicYearId: 'year_2026', currentEnrollmentId: 'student_a__year_2026',
    trackIds: [], status: 'active',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/studentEnrollments/student_a__year_2026`).set({
    schoolId: SCHOOL_A, studentId: 'student_a', academicYearId: 'year_2026',
    classId: 'class_a', majorIds: [], enrollmentStatus: 'active',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/tracks/robotics`).set({
    schoolId: SCHOOL_A, name: 'רובוטיקה', description: 'מגמת רובוטיקה', status: 'active',
  });

  async function proposedTrackChange(uid) {
    const result = await askZokiHandler(actorRequest(uid, {
      schoolId: SCHOOL_A, question: 'הוסף את נועה כהן למגמת רובוטיקה',
    }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const student = context.authorizedSources.find(item => item.type === 'student' && item.fields.fullName === 'נועה כהן');
        const track = context.authorizedSources.find(item => item.type === 'track' && item.fields.name === 'רובוטיקה');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: 'הכנתי שינוי מגמה שממתין לאישור.',
          sourceIds: [student?.id, track?.id].filter(Boolean), followUpQuestion: null,
          actionProposal: student && track ? {
            type: 'student_track_change', studentSourceId: student.id, trackSourceId: track.id, operation: 'add',
          } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const proposal = await proposedTrackChange('track_editor');
  assert.deepEqual({
    studentId: proposal.studentId, trackId: proposal.trackId, operation: proposal.operation,
    expectedCurrentlyAssigned: proposal.expectedCurrentlyAssigned,
  }, { studentId: 'student_a', trackId: 'robotics', operation: 'add', expectedCurrentlyAssigned: false });
  assert.equal(await proposedTrackChange('track_viewer'), null);

  const payload = {
    schoolId: SCHOOL_A, requestId: 'student_track_1', confirm: true,
    studentId: 'student_a', trackId: 'robotics', action: 'add', expectedCurrentlyAssigned: false,
  };
  await assert.rejects(executeZokiStudentTrackHandler(actorRequest('track_viewer', payload)), error => error.code === 'permission-denied');
  const first = await executeZokiStudentTrackHandler(actorRequest('track_editor', payload));
  const repeated = await executeZokiStudentTrackHandler(actorRequest('track_editor', payload));
  assert.equal(first.executed, true);
  assert.equal(repeated.executed, false);
  assert.deepEqual((await adminDb.doc(`schools/${SCHOOL_A}/students/student_a`).get()).data().trackIds, ['robotics']);
  assert.deepEqual((await adminDb.doc(`schools/${SCHOOL_A}/studentEnrollments/student_a__year_2026`).get()).data().majorIds, ['robotics']);
  const history = await adminDb.collection(`schools/${SCHOOL_A}/students/student_a/history`).get();
  assert.equal(history.size, 1);
  assert.equal(history.docs[0].data().type, 'track_added');
  await assert.rejects(executeZokiStudentTrackHandler(actorRequest('track_editor', {
    ...payload, requestId: 'student_track_stale', action: 'remove', expectedCurrentlyAssigned: false,
  })), error => error.code === 'aborted');
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'zoki.action.student.track.add').get();
  assert.equal(audits.size, 1);
  assert.equal(JSON.stringify(audits.docs[0].data()).includes('רובוטיקה'), false);
});

test('Zoki updates one exact attendance cell only with edit permission and unchanged source data', async () => {
  await seedUser('attendance_editor', SCHOOL_A, 'viewer', { permissions: {
    attendance_view: true, attendance_edit: true,
  } });
  await seedUser('attendance_viewer', SCHOOL_A, 'viewer', { permissions: { attendance_view: true } });
  await seedUser('teacher_a', SCHOOL_A, 'viewer');
  await adminDb.doc(`schools/${SCHOOL_A}/classes/class_a`).set({
    schoolId: SCHOOL_A, name: 'כיתה א', status: 'active', teacherId: 'teacher_a',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/students/student_a`).set({
    schoolId: SCHOOL_A, fullName: 'נועה כהן', classId: 'class_a', className: 'כיתה א', status: 'active',
  });
  const filePath = `schools/${SCHOOL_A}/files/attendance_a`;
  await adminDb.doc(filePath).set({
    schoolId: SCHOOL_A, name: 'נוכחות כיתה א', fileType: 'attendance', classId: 'class_a',
    status: 'active', setupStatus: 'ready', dateRange: { start: '2026-09-01', end: '2026-09-30' },
  });
  await adminDb.doc(`${filePath}/attendanceMembers/student_a`).set({
    schoolId: SCHOOL_A, fileId: 'attendance_a', classId: 'class_a', studentId: 'student_a', included: true,
  });
  await adminDb.doc(`${filePath}/attendanceDays/2026-09-03`).set({
    schoolId: SCHOOL_A, fileId: 'attendance_a', dateKey: '2026-09-03', scheduled: true, blocked: false,
  });
  await adminDb.doc(`${filePath}/attendanceLegend/present`).set({
    schoolId: SCHOOL_A, fileId: 'attendance_a', label: 'נוכחות', shortCode: '✓',
    type: 'status', attendanceEffect: 'present', active: true,
  });
  await adminDb.doc(`${filePath}/attendanceLegend/absent`).set({
    schoolId: SCHOOL_A, fileId: 'attendance_a', label: 'לא הגיע', shortCode: 'ל',
    type: 'status', attendanceEffect: 'absent', active: true,
  });
  const recordPath = `${filePath}/attendanceRecords/student_a__2026-09-03`;
  await adminDb.doc(recordPath).set({
    schoolId: SCHOOL_A, fileId: 'attendance_a', classId: 'class_a', studentId: 'student_a',
    dateKey: '2026-09-03', primaryStatusId: 'present', actionIds: ['follow_up'], note: 'הערה קיימת',
  });

  async function proposedAttendance(uid) {
    const result = await askZokiHandler(actorRequest(uid, {
      schoolId: SCHOOL_A, question: 'סמן את נועה כהן כחסרה בתאריך 2026-09-03',
    }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const attendance = context.authorizedSources.find(item => item.type === 'attendance');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: 'הכנתי עדכון נוכחות שממתין לאישור.',
          sourceIds: attendance ? [attendance.id] : [], followUpQuestion: null,
          actionProposal: attendance ? {
            type: 'attendance_update', attendanceSourceId: attendance.id,
            dateKey: '2026-09-03', statusId: 'absent',
          } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const proposal = await proposedAttendance('attendance_editor');
  assert.deepEqual({
    fileId: proposal.fileId, studentId: proposal.studentId, dateKey: proposal.dateKey,
    statusId: proposal.statusId, expectedPreviousStatusId: proposal.expectedPreviousStatusId,
  }, {
    fileId: 'attendance_a', studentId: 'student_a', dateKey: '2026-09-03',
    statusId: 'absent', expectedPreviousStatusId: 'present',
  });
  assert.equal((await proposedAttendance('teacher_a')).studentId, 'student_a');
  assert.equal(await proposedAttendance('attendance_viewer'), null);

  const payload = {
    schoolId: SCHOOL_A, requestId: 'attendance_action_1', confirm: true,
    fileId: 'attendance_a', studentId: 'student_a', dateKey: '2026-09-03',
    statusId: 'absent', expectedPreviousStatusId: 'present',
  };
  await assert.rejects(executeZokiAttendanceHandler(actorRequest('attendance_viewer', payload)), error => error.code === 'permission-denied');
  const first = await executeZokiAttendanceHandler(actorRequest('attendance_editor', payload));
  const repeated = await executeZokiAttendanceHandler(actorRequest('attendance_editor', payload));
  assert.equal(first.executed, true);
  assert.equal(repeated.executed, false);
  const record = (await adminDb.doc(recordPath).get()).data();
  assert.equal(record.primaryStatusId, 'absent');
  assert.deepEqual(record.actionIds, ['follow_up']);
  assert.equal(record.note, 'הערה קיימת');
  const history = await adminDb.collection(`${filePath}/attendanceHistory`).get();
  assert.equal(history.size, 1);
  assert.equal(history.docs[0].data().previous.primaryStatusId, 'present');
  await assert.rejects(executeZokiAttendanceHandler(actorRequest('attendance_editor', {
    ...payload, requestId: 'attendance_action_stale', statusId: 'present', expectedPreviousStatusId: 'present',
  })), error => error.code === 'aborted');
  await adminDb.doc(`${filePath}/attendanceDays/2026-09-03`).update({ blocked: true });
  await assert.rejects(executeZokiAttendanceHandler(actorRequest('attendance_editor', {
    ...payload, requestId: 'attendance_action_blocked', statusId: 'present', expectedPreviousStatusId: 'absent',
  })), error => error.code === 'permission-denied');
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'zoki.action.attendance.update').get();
  assert.equal(audits.size, 1);
  const auditText = JSON.stringify(audits.docs[0].data());
  assert.equal(auditText.includes('לא הגיע'), false);
  assert.equal(auditText.includes('הערה קיימת'), false);
});

test('Zoki creates one structured student note only after source-bound confirmation and current class authorization', async () => {
  await seedUser('note_editor', SCHOOL_A, 'viewer', { permissions: {
    'students.view': true, 'students.addNotes': true,
  } });
  await seedUser('note_viewer', SCHOOL_A, 'viewer', { permissions: { 'students.view': true } });
  await adminDb.doc(`schools/${SCHOOL_A}/classes/class_a`).set({
    schoolId: SCHOOL_A, name: 'כיתה א', status: 'active',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/students/student_a`).set({
    schoolId: SCHOOL_A, fullName: 'נועה כהן', classId: 'class_a', className: 'כיתה א', status: 'active',
  });

  async function proposedNote(uid) {
    const result = await askZokiHandler(actorRequest(uid, {
      schoolId: SCHOOL_A, question: 'הוסף לנועה כהן הערה לימודית לצוות הכיתה: השתתפה היטב בדיון והגישה את העבודה בזמן',
    }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const student = context.authorizedSources.find(item => item.type === 'student' && item.fields.fullName === 'נועה כהן');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: 'הכנתי הערה לימודית שממתינה לאישור.',
          sourceIds: student ? [student.id] : [], followUpQuestion: null,
          actionProposal: student ? {
            type: 'student_note_create', studentSourceId: student.id,
            content: 'השתתפה היטב בדיון והגישה את העבודה בזמן',
            noteType: 'academic', visibility: 'class_staff',
          } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const proposal = await proposedNote('note_editor');
  assert.deepEqual({
    studentId: proposal.studentId, expectedClassId: proposal.expectedClassId,
    content: proposal.content, noteType: proposal.noteType, visibility: proposal.visibility,
  }, {
    studentId: 'student_a', expectedClassId: 'class_a',
    content: 'השתתפה היטב בדיון והגישה את העבודה בזמן', noteType: 'academic', visibility: 'class_staff',
  });
  assert.equal(await proposedNote('note_viewer'), null);

  const payload = {
    schoolId: SCHOOL_A, requestId: 'student_note_1', confirm: true,
    studentId: 'student_a', expectedClassId: 'class_a',
    content: proposal.content, type: 'academic', visibility: 'class_staff',
  };
  await assert.rejects(executeZokiStudentNoteHandler(actorRequest('note_viewer', payload)), error => error.code === 'permission-denied');
  const first = await executeZokiStudentNoteHandler(actorRequest('note_editor', payload));
  const repeated = await executeZokiStudentNoteHandler(actorRequest('note_editor', payload));
  assert.equal(first.executed, true);
  assert.equal(repeated.executed, false);
  const notes = await adminDb.collection(`schools/${SCHOOL_A}/students/student_a/notes`).get();
  assert.equal(notes.size, 1);
  assert.equal(notes.docs[0].data().content, proposal.content);
  assert.equal(notes.docs[0].data().type, 'academic');
  assert.equal(notes.docs[0].data().visibility, 'class_staff');

  await adminDb.doc(`schools/${SCHOOL_A}/classes/class_b`).set({ schoolId: SCHOOL_A, name: 'כיתה ב', status: 'active' });
  await adminDb.doc(`schools/${SCHOOL_A}/students/student_a`).update({ classId: 'class_b', className: 'כיתה ב' });
  await assert.rejects(executeZokiStudentNoteHandler(actorRequest('note_editor', {
    ...payload, requestId: 'student_note_stale',
  })), error => error.code === 'aborted');
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'zoki.action.student.note.create').get();
  assert.equal(audits.size, 1);
  const auditText = JSON.stringify(audits.docs[0].data());
  assert.equal(auditText.includes('השתתפה היטב'), false);
  assert.equal(auditText.includes('academic'), false);
});

test('Zoki creates one calendar event for exact current categories and teams with dual-store compatibility', async () => {
  await seedUser('calendar_creator', SCHOOL_A, 'viewer', { permissions: {
    'calendar.view': true, 'calendar.create': true,
  } });
  await seedUser('calendar_viewer', SCHOOL_A, 'viewer', { permissions: { 'calendar.view': true } });
  await adminDb.doc(`schools/${SCHOOL_A}/categories/trips`).set({ schoolId: SCHOOL_A, name: 'טיולים' });
  await adminDb.doc(`schools/${SCHOOL_A}/teams/trips_team`).set({
    schoolId: SCHOOL_A, name: 'צוות טיולים', status: 'active', memberIds: ['calendar_creator'],
  });

  async function proposedEvent(uid) {
    const result = await askZokiHandler(actorRequest(uid, {
      schoolId: SCHOOL_A,
      question: 'צור אירוע בשם תדריך טיול בתאריך 2026-10-12 בשעה 14:30, בקטגוריית טיולים, גלוי וניתן לעריכה לצוות טיולים. תיאור: מעבר על נוהל הבטיחות',
    }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const config = context.authorizedSources.find(item => item.type === 'calendar_config');
        const team = config?.fields.teams.find(item => item.name === 'צוות טיולים');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: 'הכנתי אירוע שממתין לאישור.',
          sourceIds: config ? [config.id] : [], followUpQuestion: null,
          actionProposal: config && team ? {
            type: 'calendar_event_create', configSourceId: config.id,
            title: 'תדריך טיול', description: 'מעבר על נוהל הבטיחות',
            date: '2026-10-12', time: '14:30', category: 'טיולים', color: '#bae6fd',
            visibleTo: [team.id], editableBy: [team.id],
          } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const proposal = await proposedEvent('calendar_creator');
  assert.deepEqual({
    title: proposal.title, date: proposal.date, time: proposal.time, category: proposal.category,
    visibleTo: proposal.visibleTo, editableBy: proposal.editableBy,
  }, {
    title: 'תדריך טיול', date: '2026-10-12', time: '14:30', category: 'טיולים',
    visibleTo: ['trips_team'], editableBy: ['trips_team'],
  });
  assert.equal(await proposedEvent('calendar_viewer'), null);

  const payload = {
    schoolId: SCHOOL_A, requestId: 'calendar_event_1', confirm: true,
    title: proposal.title, description: proposal.description, date: proposal.date, time: proposal.time,
    category: proposal.category, color: proposal.color,
    visibleTo: proposal.visibleTo, editableBy: proposal.editableBy,
  };
  await assert.rejects(executeZokiCalendarEventHandler(actorRequest('calendar_viewer', payload)), error => error.code === 'permission-denied');
  const first = await executeZokiCalendarEventHandler(actorRequest('calendar_creator', payload));
  const repeated = await executeZokiCalendarEventHandler(actorRequest('calendar_creator', payload));
  assert.equal(first.executed, true);
  assert.equal(repeated.executed, false);
  const [nested, legacy] = await Promise.all([
    adminDb.doc(`schools/${SCHOOL_A}/events/${first.eventId}`).get(),
    adminDb.doc(`events_${SCHOOL_A}/${first.eventId}`).get(),
  ]);
  assert.equal(nested.exists, true);
  assert.equal(legacy.exists, true);
  assert.equal(nested.data().title, 'תדריך טיול');
  assert.equal(legacy.data().date, '2026-10-12');
  assert.equal(legacy.data().year, 2026);
  assert.equal(legacy.data().month, 9);
  assert.deepEqual(legacy.data().visibleTo, ['trips_team']);

  await adminDb.doc(`schools/${SCHOOL_A}/teams/trips_team`).update({ status: 'archived' });
  await assert.rejects(executeZokiCalendarEventHandler(actorRequest('calendar_creator', {
    ...payload, requestId: 'calendar_event_stale_team',
  })), error => error.details?.reason === 'calendar-team-changed');
  await assert.rejects(executeZokiCalendarEventHandler(actorRequest('calendar_creator', {
    ...payload, requestId: 'calendar_event_bad_date', date: '2026-02-30',
  })), error => error.details?.reason === 'invalid-calendar-date');
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'zoki.action.calendar.event.create').get();
  assert.equal(audits.size, 1);
  const auditText = JSON.stringify(audits.docs[0].data());
  assert.equal(auditText.includes('תדריך טיול'), false);
  assert.equal(auditText.includes('נוהל הבטיחות'), false);
  assert.equal(auditText.includes('צוות טיולים'), false);
});

test('Zoki updates and cancels an exact calendar event with stale-state protection', async () => {
  await seedUser('calendar_editor', SCHOOL_A, 'viewer', { permissions: {
    'calendar.view': true, 'calendar.edit': true,
  } });
  await seedUser('calendar_read_only', SCHOOL_A, 'viewer', { permissions: { 'calendar.view': true } });
  await adminDb.doc(`schools/${SCHOOL_A}/categories/general`).set({ schoolId: SCHOOL_A, name: 'כללי' });
  const initial = {
    schoolId: SCHOOL_A, title: 'ישיבת צוות אוגוסט', description: 'סדר יום פנימי',
    date: '2026-08-30', time: '09:00', category: 'כללי', color: '#bae6fd',
    visibleTo: 'all', editableBy: [], year: 2026, month: 7,
  };
  await Promise.all([
    adminDb.doc(`schools/${SCHOOL_A}/events/team_august`).set(initial),
    adminDb.doc(`events_${SCHOOL_A}/team_august`).set(initial),
  ]);

  async function proposedMutation(question, type) {
    return askZokiHandler(actorRequest('calendar_editor', { schoolId: SCHOOL_A, question }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const event = context.authorizedSources.find(item => item.type === 'calendar_event' && item.fields.id === 'team_august');
        const config = context.authorizedSources.find(item => item.type === 'calendar_config');
        const actionProposal = type === 'calendar_event_update' && event && config ? {
          type, eventSourceId: event.id, configSourceId: config.id,
          title: event.fields.title, description: event.fields.description,
          date: '2026-08-31', time: '10:30', category: event.fields.category,
          color: event.fields.color, visibleTo: event.fields.visibleTo, editableBy: event.fields.editableBy,
        } : type === 'calendar_event_cancel' && event ? { type, eventSourceId: event.id } : null;
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: 'הכנתי שינוי שממתין לאישור.',
          sourceIds: [event?.id, config?.id].filter(Boolean), followUpQuestion: null, actionProposal,
        }) }] } }] }) };
      },
    });
  }

  const update = (await proposedMutation(
    'שנה את אירוע ישיבת צוות אוגוסט ל-2026-08-31 בשעה 10:30', 'calendar_event_update'
  )).actionProposal;
  assert.equal(update.type, 'calendar_event_update');
  assert.equal(update.expectedVersion, calendarEventVersion(initial, 'team_august'));
  const updatePayload = {
    schoolId: SCHOOL_A, requestId: 'calendar_update_1', confirm: true,
    eventId: update.eventId, expectedVersion: update.expectedVersion,
    title: update.title, description: update.description, date: update.date, time: update.time,
    category: update.category, color: update.color, visibleTo: update.visibleTo, editableBy: update.editableBy,
  };
  await assert.rejects(executeZokiCalendarEventUpdateHandler(actorRequest('calendar_read_only', updatePayload)), error => error.code === 'permission-denied');
  assert.equal((await executeZokiCalendarEventUpdateHandler(actorRequest('calendar_editor', updatePayload))).executed, true);
  assert.equal((await executeZokiCalendarEventUpdateHandler(actorRequest('calendar_editor', updatePayload))).executed, false);
  const legacyAfterUpdate = await adminDb.doc(`events_${SCHOOL_A}/team_august`).get();
  assert.equal(legacyAfterUpdate.data().date, '2026-08-31');
  assert.equal(legacyAfterUpdate.data().time, '10:30');
  await assert.rejects(executeZokiCalendarEventUpdateHandler(actorRequest('calendar_editor', {
    ...updatePayload, requestId: 'calendar_update_stale', time: '11:00',
  })), error => error.details?.reason === 'calendar-event-changed');

  const cancel = (await proposedMutation('בטל את אירוע ישיבת צוות אוגוסט', 'calendar_event_cancel')).actionProposal;
  assert.equal(cancel.type, 'calendar_event_cancel');
  await adminDb.doc(`events_${SCHOOL_A}/team_august`).update({ description: 'שינוי מקביל' });
  await assert.rejects(executeZokiCalendarEventCancelHandler(actorRequest('calendar_editor', {
    schoolId: SCHOOL_A, requestId: 'calendar_cancel_stale', confirm: true,
    eventId: cancel.eventId, expectedVersion: cancel.expectedVersion,
  })), error => error.details?.reason === 'calendar-event-changed');
  const currentLegacy = await adminDb.doc(`events_${SCHOOL_A}/team_august`).get();
  const cancelPayload = {
    schoolId: SCHOOL_A, requestId: 'calendar_cancel_1', confirm: true, eventId: cancel.eventId,
    expectedVersion: calendarEventVersion(currentLegacy.data(), cancel.eventId),
  };
  assert.equal((await executeZokiCalendarEventCancelHandler(actorRequest('calendar_editor', cancelPayload))).executed, true);
  assert.equal((await executeZokiCalendarEventCancelHandler(actorRequest('calendar_editor', cancelPayload))).executed, false);
  const [nestedAfterCancel, legacyAfterCancel] = await Promise.all([
    adminDb.doc(`schools/${SCHOOL_A}/events/team_august`).get(),
    adminDb.doc(`events_${SCHOOL_A}/team_august`).get(),
  ]);
  assert.equal(nestedAfterCancel.exists, false);
  assert.equal(legacyAfterCancel.exists, false);
  const audits = await adminDb.collection('auditLogs').where('targetId', '==', 'team_august').get();
  assert.equal(audits.docs.some(item => item.data().action === 'zoki.action.calendar.event.update'), true);
  assert.equal(audits.docs.some(item => item.data().action === 'zoki.action.calendar.event.cancel'), true);
  assert.equal(JSON.stringify(audits.docs.map(item => item.data())).includes('סדר יום פנימי'), false);
});

test('Zoki creates private and authorized institutional contacts once without exposing contact data in audit', async () => {
  await seedUser('contact_creator', SCHOOL_A, 'viewer', { permissions: {
    'contacts.view': true, 'contacts.create': true, 'staff.view': true,
  } });
  await seedUser('contact_viewer', SCHOOL_A, 'viewer');
  await seedUser('contact_owner', SCHOOL_A, 'viewer', { fullName: 'רות מנהלת קשרי קהילה' });

  async function proposedContact(uid, scope) {
    const institutional = scope === 'institutional';
    const result = await askZokiHandler(actorRequest(uid, {
      schoolId: SCHOOL_A,
      question: institutional
        ? 'צור איש קשר מוסדי בשם יעל ישראלי, מייל yael@example.test, ארגון מרכז קהילתי, טלפון 03-5551234, אחראית רות מנהלת קשרי קהילה'
        : 'צור איש קשר פרטי בשם דנה לוי עם מייל dana@example.test',
    }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const config = context.authorizedSources.find(item => item.type === 'contact_config');
        const owner = config?.fields.responsibleStaff.find(item => item.name === 'רות מנהלת קשרי קהילה');
        const permitted = config?.fields.scopes.includes(scope);
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: permitted ? 'הכנתי איש קשר שממתין לאישור.' : 'אין הרשאה ליצירת איש קשר מוסדי.',
          sourceIds: config ? [config.id] : [], followUpQuestion: null,
          actionProposal: permitted ? {
            type: 'contact_create', configSourceId: config.id, scope,
            fullName: institutional ? 'יעל ישראלי' : 'דנה לוי',
            organization: institutional ? 'מרכז קהילתי' : '', jobTitle: '',
            primaryEmail: institutional ? 'yael@example.test' : 'dana@example.test', additionalEmails: [],
            phone: institutional ? '03-5551234' : '', category: institutional ? 'קהילה' : '', tags: [], notes: '',
            visibility: institutional ? 'responsible_staff' : 'institution',
            ownerStaffIds: institutional && owner ? [owner.id] : [],
          } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const institutionalProposal = await proposedContact('contact_creator', 'institutional');
  assert.deepEqual({
    scope: institutionalProposal.scope, fullName: institutionalProposal.fullName,
    primaryEmail: institutionalProposal.primaryEmail, ownerStaffIds: institutionalProposal.ownerStaffIds,
  }, {
    scope: 'institutional', fullName: 'יעל ישראלי', primaryEmail: 'yael@example.test',
    ownerStaffIds: ['contact_owner'],
  });
  assert.equal(await proposedContact('contact_viewer', 'institutional'), null);

  const institutionalPayload = {
    schoolId: SCHOOL_A, requestId: 'contact_institutional_1', confirm: true,
    scope: institutionalProposal.scope, fullName: institutionalProposal.fullName,
    organization: institutionalProposal.organization, jobTitle: institutionalProposal.jobTitle,
    primaryEmail: institutionalProposal.primaryEmail, additionalEmails: institutionalProposal.additionalEmails,
    phone: institutionalProposal.phone, category: institutionalProposal.category,
    tags: institutionalProposal.tags, notes: institutionalProposal.notes,
    visibility: institutionalProposal.visibility, ownerStaffIds: institutionalProposal.ownerStaffIds,
  };
  await assert.rejects(executeZokiContactHandler(actorRequest('contact_viewer', institutionalPayload)), error => error.code === 'permission-denied');
  const first = await executeZokiContactHandler(actorRequest('contact_creator', institutionalPayload));
  const repeated = await executeZokiContactHandler(actorRequest('contact_creator', institutionalPayload));
  assert.equal(first.executed, true);
  assert.equal(repeated.executed, false);
  const institutional = await adminDb.doc(`schools/${SCHOOL_A}/contactDirectory/institutional/items/${first.contactId}`).get();
  assert.equal(institutional.exists, true);
  assert.equal(institutional.data().primaryEmail, 'yael@example.test');
  assert.deepEqual(institutional.data().ownerStaffIds, ['contact_owner']);
  assert.equal(institutional.data().visibility, 'responsible_staff');

  const privateProposal = await proposedContact('contact_viewer', 'private');
  const privateResult = await executeZokiContactHandler(actorRequest('contact_viewer', {
    schoolId: SCHOOL_A, requestId: 'contact_private_1', confirm: true,
    scope: privateProposal.scope, fullName: privateProposal.fullName, organization: '', jobTitle: '',
    primaryEmail: privateProposal.primaryEmail, additionalEmails: [], phone: '', category: '', tags: [], notes: '',
    visibility: 'institution', ownerStaffIds: [],
  }));
  const privateContact = await adminDb.doc(`users/contact_viewer/contactDirectory/private/items/${privateResult.contactId}`).get();
  assert.equal(privateContact.exists, true);
  assert.equal(privateContact.data().ownerId, 'contact_viewer');

  await assert.rejects(executeZokiContactHandler(actorRequest('contact_creator', {
    ...institutionalPayload, requestId: 'contact_duplicate',
  })), error => error.details?.reason === 'duplicate-contact');
  await adminDb.doc('users/contact_owner').update({ accountStatus: 'disabled' });
  await assert.rejects(executeZokiContactHandler(actorRequest('contact_creator', {
    ...institutionalPayload, requestId: 'contact_stale_owner', primaryEmail: 'new@example.test',
  })), error => error.details?.reason === 'contact-staff-changed');

  const audits = await adminDb.collection('auditLogs').where('action', '==', 'zoki.action.contact.create').get();
  assert.equal(audits.size, 2);
  const auditText = JSON.stringify(audits.docs.map(item => item.data()));
  assert.equal(auditText.includes('יעל ישראלי'), false);
  assert.equal(auditText.includes('yael@example.test'), false);
  assert.equal(auditText.includes('דנה לוי'), false);
  assert.equal(auditText.includes('dana@example.test'), false);
});

test('Zoki changes exact team membership for team editors and team managers with stale-state protection', async () => {
  await seedUser('team_editor', SCHOOL_A, 'viewer', { permissions: {
    teams_view: true, teams_edit: true, 'staff.view': true,
  } });
  await seedUser('team_manager', SCHOOL_A, 'viewer', { fullName: 'מנהלת צוות', permissions: { 'staff.view': true } });
  await seedUser('team_viewer', SCHOOL_A, 'viewer', { permissions: { teams_view: true, 'staff.view': true } });
  await seedUser('team_target', SCHOOL_A, 'viewer', { fullName: 'ליאור כהן', teamIds: [], teamIdsBySchool: { [SCHOOL_A]: [] } });
  await adminAuth.createUser({ uid: 'team_target', email: 'team-target@example.test' });
  createdAuthUsers.add('team_target');
  const teamRecord = {
    schoolId: SCHOOL_A, name: 'צוות פדגוגי', memberIds: [], managerIds: ['team_manager'], status: 'active',
  };
  await Promise.all([
    adminDb.doc(`teams_${SCHOOL_A}/pedagogy`).set(teamRecord),
    adminDb.doc(`schools/${SCHOOL_A}/teams/pedagogy`).set(teamRecord),
  ]);

  async function proposedMembership(uid, operation) {
    const result = await askZokiHandler(actorRequest(uid, {
      schoolId: SCHOOL_A,
      question: operation === 'add' ? 'הוסף את ליאור כהן לצוות הפדגוגי' : 'הסר את ליאור כהן מהצוות הפדגוגי',
    }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const staff = context.authorizedSources.find(item => item.type === 'staff' && item.fields.name === 'ליאור כהן');
        const team = context.authorizedSources.find(item => item.type === 'team' && item.fields.name === 'צוות פדגוגי');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: staff && team?.fields.canManage ? 'הכנתי שינוי בהרכב הצוות שממתין לאישור.' : 'אין הרשאה לשינוי הצוות.',
          sourceIds: [staff?.id, team?.id].filter(Boolean), followUpQuestion: null,
          actionProposal: staff && team?.fields.canManage ? {
            type: 'team_membership_change', staffSourceId: staff.id, teamSourceId: team.id, operation,
          } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const addProposal = await proposedMembership('team_editor', 'add');
  assert.deepEqual({
    userId: addProposal.userId, teamId: addProposal.teamId,
    operation: addProposal.operation, expectedCurrentlyMember: addProposal.expectedCurrentlyMember,
  }, { userId: 'team_target', teamId: 'pedagogy', operation: 'add', expectedCurrentlyMember: false });
  assert.equal(await proposedMembership('team_viewer', 'add'), null);

  const addPayload = {
    schoolId: SCHOOL_A, requestId: 'team_membership_add_1', confirm: true,
    userId: addProposal.userId, teamId: addProposal.teamId,
    action: addProposal.operation, expectedCurrentlyMember: addProposal.expectedCurrentlyMember,
  };
  await assert.rejects(executeZokiTeamMembershipHandler(actorRequest('team_viewer', addPayload)), error => error.code === 'permission-denied');
  const added = await executeZokiTeamMembershipHandler(actorRequest('team_editor', addPayload));
  const repeatedAdd = await executeZokiTeamMembershipHandler(actorRequest('team_editor', addPayload));
  assert.equal(added.executed, true);
  assert.equal(repeatedAdd.executed, false);
  const [teamAfterAdd, nestedTeamAfterAdd, userAfterAdd] = await Promise.all([
    adminDb.doc(`teams_${SCHOOL_A}/pedagogy`).get(), adminDb.doc(`schools/${SCHOOL_A}/teams/pedagogy`).get(),
    adminDb.doc('users/team_target').get(),
  ]);
  assert.deepEqual(teamAfterAdd.data().memberIds, ['team_target']);
  assert.deepEqual(nestedTeamAfterAdd.data().memberIds, ['team_target']);
  assert.deepEqual(userAfterAdd.data().teamIds, ['pedagogy']);
  assert.deepEqual(userAfterAdd.data().teamIdsBySchool[SCHOOL_A], ['pedagogy']);
  const notification = await adminDb.doc(`notifications/zoki_team_${createHash('sha256').update(['team_editor', SCHOOL_A, 'team_membership_add_1'].join('\u0000')).digest('hex').slice(0, 40)}`).get();
  assert.equal(notification.exists, true);
  assert.equal(notification.data().userId, 'team_target');

  const removeProposal = await proposedMembership('team_manager', 'remove');
  assert.equal(removeProposal.expectedCurrentlyMember, true);
  const removePayload = {
    schoolId: SCHOOL_A, requestId: 'team_membership_remove_1', confirm: true,
    userId: removeProposal.userId, teamId: removeProposal.teamId,
    action: removeProposal.operation, expectedCurrentlyMember: removeProposal.expectedCurrentlyMember,
  };
  const removed = await executeZokiTeamMembershipHandler(actorRequest('team_manager', removePayload));
  const repeatedRemove = await executeZokiTeamMembershipHandler(actorRequest('team_manager', removePayload));
  assert.equal(removed.executed, true);
  assert.equal(repeatedRemove.executed, false);
  assert.deepEqual((await adminDb.doc(`teams_${SCHOOL_A}/pedagogy`).get()).data().memberIds, []);

  await adminDb.doc(`teams_${SCHOOL_A}/pedagogy`).update({ memberIds: ['team_target'] });
  await assert.rejects(executeZokiTeamMembershipHandler(actorRequest('team_editor', {
    ...addPayload, requestId: 'team_membership_stale',
  })), error => error.details?.reason === 'team-membership-changed');
  const audits = await adminDb.collection('auditLogs').where('targetType', '==', 'teamMembership').get();
  assert.equal(audits.size, 2);
  const auditText = JSON.stringify(audits.docs.map(item => item.data()));
  assert.equal(auditText.includes('ליאור כהן'), false);
  assert.equal(auditText.includes('צוות פדגוגי'), false);
});

test('Zoki creates one synchronized team with exact initial members and dual-store compatibility', async () => {
  await seedUser('team_creator', SCHOOL_A, 'viewer', { permissions: {
    teams_view: true, teams_edit: true, 'staff.view': true,
  }, fullName: 'יוצרת הצוות' });
  await seedUser('team_create_viewer', SCHOOL_A, 'viewer', { permissions: { teams_view: true, 'staff.view': true } });
  await seedUser('team_member_a', SCHOOL_A, 'viewer', { fullName: 'איילת לוי', teamIds: [], teamIdsBySchool: { [SCHOOL_A]: [] } });
  await seedUser('team_member_b', SCHOOL_A, 'viewer', { fullName: 'נועם כהן', teamIds: [], teamIdsBySchool: { [SCHOOL_A]: [] } });

  async function proposedTeam(uid) {
    const result = await askZokiHandler(actorRequest(uid, {
      schoolId: SCHOOL_A,
      question: 'צור צוות בשם צוות חדשנות. תיאור: קידום יוזמות דיגיטליות. תחומי אחריות: פדגוגיה דיגיטלית. משימות שכיחות: הטמעת כלים. צרף את איילת לוי ואת נועם כהן',
    }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const config = context.authorizedSources.find(item => item.type === 'team_config');
        const members = ['איילת לוי', 'נועם כהן'].map(name => (
          context.authorizedSources.find(item => item.type === 'staff' && item.fields.name === name)
        )).filter(Boolean);
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: config ? 'הכנתי צוות חדש שממתין לאישור.' : 'אין הרשאה ליצור צוות.',
          sourceIds: config ? [config.id, ...members.map(item => item.id)] : [], followUpQuestion: null,
          actionProposal: config && members.length === 2 ? {
            type: 'team_create', configSourceId: config.id, name: 'צוות חדשנות',
            description: 'קידום יוזמות דיגיטליות', responsibilityAreas: ['פדגוגיה דיגיטלית'],
            keywords: ['חדשנות'], aliases: [], supportingRoles: [], typicalTaskTypes: ['הטמעת כלים'],
            memberSourceIds: members.map(item => item.id),
          } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const proposal = await proposedTeam('team_creator');
  assert.deepEqual({
    name: proposal.name, responsibilityAreas: proposal.responsibilityAreas,
    memberIds: proposal.memberIds, memberLabels: proposal.memberLabels,
  }, {
    name: 'צוות חדשנות', responsibilityAreas: ['פדגוגיה דיגיטלית'],
    memberIds: ['team_member_a', 'team_member_b'], memberLabels: ['איילת לוי', 'נועם כהן'],
  });
  assert.equal(await proposedTeam('team_create_viewer'), null);

  const payload = {
    schoolId: SCHOOL_A, requestId: 'team_create_1', confirm: true,
    name: proposal.name, description: proposal.description,
    responsibilityAreas: proposal.responsibilityAreas, keywords: proposal.keywords,
    aliases: proposal.aliases, supportingRoles: proposal.supportingRoles,
    typicalTaskTypes: proposal.typicalTaskTypes, memberIds: proposal.memberIds,
  };
  await assert.rejects(executeZokiTeamCreateHandler(actorRequest('team_create_viewer', payload)), error => error.code === 'permission-denied');
  const first = await executeZokiTeamCreateHandler(actorRequest('team_creator', payload));
  const repeated = await executeZokiTeamCreateHandler(actorRequest('team_creator', payload));
  assert.equal(first.executed, true);
  assert.equal(repeated.executed, false);
  const [nested, legacy, memberA, memberB] = await Promise.all([
    adminDb.doc(`schools/${SCHOOL_A}/teams/${first.teamId}`).get(),
    adminDb.doc(`teams_${SCHOOL_A}/${first.teamId}`).get(),
    adminDb.doc('users/team_member_a').get(), adminDb.doc('users/team_member_b').get(),
  ]);
  assert.equal(nested.exists, true);
  assert.equal(legacy.exists, true);
  assert.equal(nested.data().name, 'צוות חדשנות');
  assert.deepEqual(legacy.data().memberIds, ['team_member_a', 'team_member_b']);
  assert.deepEqual(legacy.data().managerIds, ['team_creator']);
  assert.equal(memberA.data().teamIds.includes(first.teamId), true);
  assert.equal(memberB.data().teamIdsBySchool[SCHOOL_A].includes(first.teamId), true);
  const notifications = await adminDb.collection('notifications').where('schoolId', '==', SCHOOL_A).get();
  assert.equal(notifications.size, 2);
  assert.deepEqual(notifications.docs.map(item => item.data().userId).sort(), ['team_member_a', 'team_member_b']);

  await assert.rejects(executeZokiTeamCreateHandler(actorRequest('team_creator', {
    ...payload, requestId: 'team_create_duplicate',
  })), error => error.details?.reason === 'team-name-exists');
  await adminDb.doc('users/team_member_b').update({ accountStatus: 'disabled' });
  await assert.rejects(executeZokiTeamCreateHandler(actorRequest('team_creator', {
    ...payload, requestId: 'team_create_stale_member', name: 'צוות חדשנות נוסף',
  })), error => error.details?.reason === 'team-staff-changed');
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'zoki.action.team.create').get();
  assert.equal(audits.size, 1);
  const auditText = JSON.stringify(audits.docs[0].data());
  assert.equal(auditText.includes('צוות חדשנות'), false);
  assert.equal(auditText.includes('איילת לוי'), false);
  assert.equal(auditText.includes('נועם כהן'), false);
  assert.equal(auditText.includes('פדגוגיה דיגיטלית'), false);
});

test('Zoki appoints and removes exact team managers while preserving one manager and both team stores', async () => {
  await seedUser('team_manager_editor', SCHOOL_A, 'viewer', { permissions: {
    teams_view: true, teams_edit: true, 'staff.view': true,
  } });
  await seedUser('team_manager_actor', SCHOOL_A, 'viewer', { fullName: 'מנהל קיים', permissions: { 'staff.view': true } });
  await seedUser('team_manager_target', SCHOOL_A, 'viewer', { fullName: 'שירה לוי' });
  await seedUser('team_manager_outsider', SCHOOL_A, 'viewer', { fullName: 'אורי כהן' });
  await seedUser('team_manager_viewer', SCHOOL_A, 'viewer', { permissions: { teams_view: true, 'staff.view': true } });
  await Promise.all(['team_manager_actor', 'team_manager_target', 'team_manager_outsider'].map(async uid => {
    await adminAuth.createUser({ uid, email: `${uid}@example.test` });
    createdAuthUsers.add(uid);
  }));
  const team = {
    schoolId: SCHOOL_A, name: 'צוות קהילה', status: 'active',
    memberIds: ['team_manager_actor', 'team_manager_target'], managerIds: ['team_manager_actor'],
  };
  await Promise.all([
    adminDb.doc(`teams_${SCHOOL_A}/community`).set(team),
    adminDb.doc(`schools/${SCHOOL_A}/teams/community`).set(team),
  ]);

  async function proposedManager(uid, operation, targetName = 'שירה לוי') {
    const result = await askZokiHandler(actorRequest(uid, {
      schoolId: SCHOOL_A,
      question: operation === 'assign'
        ? `מנה את ${targetName} למנהלת צוות קהילה`
        : `הסר את ${targetName} מניהול צוות קהילה`,
    }), {
      apiKey: 'server-test-key', model: 'test-model',
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const context = JSON.parse(body.contents[0].parts[0].text);
        const staff = context.authorizedSources.find(item => item.type === 'staff' && item.fields.name === targetName);
        const teamSource = context.authorizedSources.find(item => item.type === 'team' && item.fields.name === 'צוות קהילה');
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
          answer: staff && teamSource?.fields.canManage ? 'הכנתי שינוי מנהל צוות שממתין לאישור.' : 'אין הרשאה.',
          sourceIds: [staff?.id, teamSource?.id].filter(Boolean), followUpQuestion: null,
          actionProposal: staff && teamSource?.fields.canManage ? {
            type: 'team_manager_change', staffSourceId: staff.id, teamSourceId: teamSource.id, operation,
          } : null,
        }) }] } }] }) };
      },
    });
    return result.actionProposal;
  }

  const assignProposal = await proposedManager('team_manager_editor', 'assign');
  assert.deepEqual({
    userId: assignProposal.userId, teamId: assignProposal.teamId,
    operation: assignProposal.operation, expectedCurrentlyManager: assignProposal.expectedCurrentlyManager,
  }, { userId: 'team_manager_target', teamId: 'community', operation: 'assign', expectedCurrentlyManager: false });
  assert.equal(await proposedManager('team_manager_viewer', 'assign'), null);
  assert.equal(await proposedManager('team_manager_editor', 'assign', 'אורי כהן'), null);

  const assignPayload = {
    schoolId: SCHOOL_A, requestId: 'team_manager_assign_1', confirm: true,
    userId: assignProposal.userId, teamId: assignProposal.teamId,
    action: assignProposal.operation, expectedCurrentlyManager: assignProposal.expectedCurrentlyManager,
  };
  await assert.rejects(executeZokiTeamManagerHandler(actorRequest('team_manager_viewer', assignPayload)), error => error.code === 'permission-denied');
  const assigned = await executeZokiTeamManagerHandler(actorRequest('team_manager_editor', assignPayload));
  const repeatedAssign = await executeZokiTeamManagerHandler(actorRequest('team_manager_editor', assignPayload));
  assert.equal(assigned.executed, true);
  assert.equal(repeatedAssign.executed, false);
  const [legacyAssigned, nestedAssigned] = await Promise.all([
    adminDb.doc(`teams_${SCHOOL_A}/community`).get(), adminDb.doc(`schools/${SCHOOL_A}/teams/community`).get(),
  ]);
  assert.deepEqual(legacyAssigned.data().managerIds, ['team_manager_actor', 'team_manager_target']);
  assert.deepEqual(nestedAssigned.data().managerIds, ['team_manager_actor', 'team_manager_target']);

  const removeProposal = await proposedManager('team_manager_actor', 'remove');
  const removePayload = {
    schoolId: SCHOOL_A, requestId: 'team_manager_remove_1', confirm: true,
    userId: removeProposal.userId, teamId: removeProposal.teamId,
    action: removeProposal.operation, expectedCurrentlyManager: removeProposal.expectedCurrentlyManager,
  };
  const removed = await executeZokiTeamManagerHandler(actorRequest('team_manager_actor', removePayload));
  assert.equal(removed.executed, true);
  assert.deepEqual((await adminDb.doc(`teams_${SCHOOL_A}/community`).get()).data().managerIds, ['team_manager_actor']);
  assert.deepEqual((await adminDb.doc(`schools/${SCHOOL_A}/teams/community`).get()).data().managerIds, ['team_manager_actor']);
  assert.equal(await proposedManager('team_manager_editor', 'remove', 'מנהל קיים'), null);
  await assert.rejects(executeZokiTeamManagerHandler(actorRequest('team_manager_editor', {
    ...removePayload, requestId: 'team_manager_last', userId: 'team_manager_actor', expectedCurrentlyManager: true,
  })), error => error.details?.reason === 'team-last-manager');

  await adminDb.doc(`teams_${SCHOOL_A}/community`).update({ managerIds: ['team_manager_actor', 'team_manager_target'] });
  await assert.rejects(executeZokiTeamManagerHandler(actorRequest('team_manager_editor', {
    ...assignPayload, requestId: 'team_manager_stale',
  })), error => error.details?.reason === 'team-managers-changed');
  const audits = await adminDb.collection('auditLogs').where('targetType', '==', 'teamManager').get();
  assert.equal(audits.size, 2);
  const auditText = JSON.stringify(audits.docs.map(item => item.data()));
  assert.equal(auditText.includes('שירה לוי'), false);
  assert.equal(auditText.includes('צוות קהילה'), false);
});

test('Zoki brain updates are manager-only, audience-validated and audited without content', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('teacher_a', SCHOOL_A, 'viewer');
  await seedUser('teacher_b', SCHOOL_B, 'viewer');
  await adminDb.doc(`schools/${SCHOOL_A}/roleDefinitions/homeroom_role`).set({ name: 'מחנך', status: 'active' });
  const payload = {
    schoolId: SCHOOL_A,
    instructions: 'הוראה פנימית רגישה לזוקי',
    entries: [{
      id: 'trip_policy', title: 'נוהל טיולים', body: 'תוכן רגיש של הנוהל', category: 'נוהל', validUntil: '', status: 'published',
      audience: { type: 'roles', roleIds: ['homeroom_role'], userIds: [] },
    }],
  };

  const result = await saveZokiBrainHandler(actorRequest('principal_a', payload));
  assert.equal(result.publishedCount, 1);
  const brain = (await adminDb.doc(`schools/${SCHOOL_A}/settings/zoki_brain`).get()).data();
  assert.equal(brain.updatedBy, 'principal_a');
  assert.equal(brain.entries[0].audience.roleIds[0], 'homeroom_role');
  const audit = await adminDb.collection('auditLogs').where('action', '==', 'zoki.brain.update').get();
  assert.equal(audit.size, 1);
  const auditText = JSON.stringify(audit.docs[0].data());
  assert.equal(auditText.includes('הוראה פנימית רגישה'), false);
  assert.equal(auditText.includes('תוכן רגיש'), false);

  await assert.rejects(saveZokiBrainHandler(actorRequest('teacher_a', payload)), error => error.code === 'permission-denied');
  await assert.rejects(saveZokiBrainHandler(actorRequest('principal_a', {
    ...payload,
    entries: [{ ...payload.entries[0], audience: { type: 'users', roleIds: [], userIds: ['teacher_b'] } }],
  })), error => error.code === 'permission-denied');
});

test('Zoki reads only conversations in which the teacher participates', async () => {
  await seedUser('teacher_a', SCHOOL_A, 'viewer');
  await seedUser('colleague_a', SCHOOL_A, 'viewer');
  await seedUser('other_a', SCHOOL_A, 'viewer');
  await adminDb.doc('conversations/own_conversation').set({
    schoolId: SCHOOL_A, participants: ['teacher_a', 'colleague_a'], participantNames: { teacher_a: 'מורה א', colleague_a: 'עמיתה' },
    lastMessage: 'המסמך מוכן', lastMessageAt: '2026-08-28T10:00:00.000Z',
  });
  await adminDb.doc('conversations/own_conversation/messages/own_message').set({
    senderId: 'colleague_a', senderName: 'עמיתה', text: 'המסמך מוכן לבדיקה', createdAt: '2026-08-28T10:00:00.000Z',
  });
  await adminDb.doc('conversations/private_conversation').set({
    schoolId: SCHOOL_A, participants: ['colleague_a', 'other_a'], participantNames: { colleague_a: 'עמיתה', other_a: 'אחר' },
    lastMessage: 'סוד שאסור לחשוף', lastMessageAt: '2026-08-28T11:00:00.000Z',
  });
  await adminDb.doc('conversations/private_conversation/messages/private_message').set({
    senderId: 'other_a', senderName: 'אחר', text: 'סוד שאסור לחשוף', createdAt: '2026-08-28T11:00:00.000Z',
  });

  let providerInput = null;
  await askZokiHandler(actorRequest('teacher_a', { schoolId: SCHOOL_A, question: 'מה כתבה לי עמיתה בשיחה?' }), {
    apiKey: 'server-test-key', model: 'test-model',
    fetchImpl: async (_url, options) => {
      providerInput = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'המסמך מוכן לבדיקה.', sourceIds: ['conversation:own_conversation'], followUpQuestion: null }) }] } }] }) };
    },
  });
  const serialized = JSON.stringify(providerInput.authorizedSources);
  assert.equal(serialized.includes('המסמך מוכן לבדיקה'), true, serialized);
  assert.equal(serialized.includes('סוד שאסור לחשוף'), false, serialized);
});

test('Zoki uses recent questions for follow-up retrieval without expanding class scope', async () => {
  await seedUser('teacher_a', SCHOOL_A, 'viewer', { customRoleAssignments: { [SCHOOL_A]: ['class_role'] } });
  await adminDb.doc(`schools/${SCHOOL_A}/roleDefinitions/class_role`).set({
    name: 'מורה כיתה א', status: 'active', permissions: { 'students.view': true, 'grades.view': true },
    accessScope: { type: 'classes', classIds: ['class_a'] },
  });
  await adminDb.doc(`schools/${SCHOOL_A}/students/noa`).set({ schoolId: SCHOOL_A, fullName: 'נועה מורשית', classId: 'class_a' });
  await adminDb.doc(`schools/${SCHOOL_A}/students/dana`).set({ schoolId: SCHOOL_A, fullName: 'דנה חסומה', classId: 'class_b' });
  await adminDb.doc(`schools/${SCHOOL_A}/gradebooks/math_a`).set({ schoolId: SCHOOL_A, classId: 'class_a', className: 'כיתה א', subjects: ['מתמטיקה'] });
  await adminDb.doc(`schools/${SCHOOL_A}/gradebooks/math_a/grades/noa`).set({ schoolId: SCHOOL_A, studentId: 'noa', scores: { math: 94 } });

  let providerInput = null;
  await askZokiHandler(actorRequest('teacher_a', {
    schoolId: SCHOOL_A,
    question: 'ומה הציון שלה?',
    history: [{ role: 'user', text: 'אני שואל על נועה מורשית' }, { role: 'assistant', text: 'נועה נמצאה.' }],
  }), {
    apiKey: 'server-test-key', model: 'test-model',
    fetchImpl: async (_url, options) => {
      providerInput = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'לא נמצא ציון מורשה.', sourceIds: [], followUpQuestion: null }) }] } }] }) };
    },
  });
  const serialized = JSON.stringify(providerInput);
  assert.equal(serialized.includes('נועה מורשית'), true, serialized);
  assert.equal(serialized.includes('דנה חסומה'), false, serialized);
  assert.equal(providerInput.conversationHistory.length, 2);
});

test('Zoki includes only the actor notifications and collective-brain audience', async () => {
  await seedUser('teacher_a', SCHOOL_A, 'viewer');
  await seedUser('teacher_b', SCHOOL_A, 'viewer');
  await adminDb.doc('notifications/own_notification').set({ userId: 'teacher_a', title: 'משימה חדשה', body: 'יש לבדוק את המסמך', read: false });
  await adminDb.doc('notifications/other_notification').set({ userId: 'teacher_b', title: 'התראה חסויה', body: 'אסור לחשוף', read: false });
  await adminDb.doc(`schools/${SCHOOL_A}/collectiveBrainBoards/school_board`).set({
    schoolId: SCHOOL_A, question: 'איך משפרים נוכחות?', description: 'איסוף הצעות', status: 'open', audienceMode: 'school', audienceUserIds: [],
  });
  await adminDb.doc(`schools/${SCHOOL_A}/collectiveBrainBoards/school_board/responses/response_a`).set({
    schoolId: SCHOOL_A, boardId: 'school_board', authorId: 'teacher_b', authorName: 'מורה ב', body: 'שיחה אישית עם תלמידים', status: 'active',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/collectiveBrainBoards/restricted_board`).set({
    schoolId: SCHOOL_A, question: 'שאלה חסויה', description: 'אסור לחשוף', status: 'open', audienceMode: 'restricted', audienceUserIds: ['teacher_b'],
  });

  let providerInput = null;
  await askZokiHandler(actorRequest('teacher_a', { schoolId: SCHOOL_A, question: 'מה ההתראות שלי ומה כתבו בתשובות הצוות במוח המשותף?' }), {
    apiKey: 'server-test-key', model: 'test-model',
    fetchImpl: async (_url, options) => {
      providerInput = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'נמצאה התראה ותשובת צוות.', sourceIds: [], followUpQuestion: null }) }] } }] }) };
    },
  });
  const serialized = JSON.stringify(providerInput.authorizedSources);
  assert.equal(serialized.includes('משימה חדשה'), true, serialized);
  assert.equal(serialized.includes('שיחה אישית עם תלמידים'), true, serialized);
  assert.equal(serialized.includes('התראה חסויה'), false, serialized);
  assert.equal(serialized.includes('שאלה חסויה'), false, serialized);
});

test('permission preview supports legacy staff documents without an Auth account', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('legacy_staff_a', SCHOOL_A, 'viewer', { fullName: 'Legacy Staff' });
  const preview = await startPermissionPreviewHandler(actorRequest('principal_a', {
    schoolId: SCHOOL_A,
    targetUserId: 'legacy_staff_a',
  }));
  assert.equal(preview.target.userId, 'legacy_staff_a');
  assert.equal(preview.readOnly, true);
});

test('institution manager patches page permissions without erasing existing legacy settings', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('legacy_staff_a', SCHOOL_A, 'viewer', {
    fullName: 'Legacy Staff',
    permissions: { tasks_view: true, legacy_setting: true },
  });
  await updateStaffHandler(actorRequest('principal_a', {
    schoolId: SCHOOL_A,
    userId: 'legacy_staff_a',
    permissions: { calendar_view: true, calendar_edit: true, 'calendar.view': true, 'calendar.edit': true },
  }));
  const updated = (await adminDb.doc('users/legacy_staff_a').get()).data().permissions;
  assert.equal(updated.calendar_edit, true);
  assert.equal(updated['calendar.edit'], true);
  assert.equal(updated.tasks_view, true);
  assert.equal(updated.legacy_setting, true);
});

test('school-scoped institution manager can grant calendar editing to staff', async () => {
  await seedUser('manager_a', SCHOOL_A, 'viewer', {
    rolesBySchool: { [SCHOOL_A]: 'institution_manager' },
  });
  await seedUser('staff_a', SCHOOL_A, 'viewer');
  await updateStaffHandler(actorRequest('manager_a', {
    schoolId: SCHOOL_A,
    userId: 'staff_a',
    permissions: { calendar_view: true, calendar_edit: true, 'calendar.view': true, 'calendar.edit': true },
  }));
  const permissions = (await adminDb.doc('users/staff_a').get()).data().permissions;
  assert.equal(permissions.calendar_edit, true);
  assert.equal(permissions['calendar.edit'], true);
});

test('active institution-manager membership authorizes role management only in its school', async () => {
  await seedUser('membership_manager', '', 'viewer', { schoolId: '', schoolIds: [] });
  await seedUser('staff_a', SCHOOL_A, 'viewer');
  await adminAuth.createUser({ uid: 'staff_a', email: 'membership-role-target@example.test' });
  createdAuthUsers.add('staff_a');
  await adminDb.doc(`schools/${SCHOOL_A}/memberships/membership_manager`).set({
    schoolId: SCHOOL_A,
    userId: 'membership_manager',
    role: 'institution_manager',
    status: 'active',
  });

  const created = await createCustomRoleHandler(actorRequest('membership_manager', {
    schoolId: SCHOOL_A,
    name: 'רכז מוסדי',
    description: 'תפקיד שנוצר על ידי מנהל המוסד',
    permissions: { 'students.view': true, 'students.update': true },
    delegatedPermissionKeys: ['students.view'],
    accessScope: { type: 'school', classIds: [] },
  }));
  assert.ok(created.roleId);

  await updateCustomRoleHandler(actorRequest('membership_manager', {
    schoolId: SCHOOL_A,
    roleId: created.roleId,
    name: 'רכז מוסדי מעודכן',
    description: '',
    permissions: { 'students.view': true },
    delegatedPermissionKeys: [],
    accessScope: { type: 'school', classIds: [] },
  }));
  assert.equal(
    (await adminDb.doc(`schools/${SCHOOL_A}/roleDefinitions/${created.roleId}`).get()).data().name,
    'רכז מוסדי מעודכן',
  );

  await assignCustomRoleHandler(actorRequest('membership_manager', {
    schoolId: SCHOOL_A,
    roleId: created.roleId,
    userId: 'staff_a',
    action: 'assign',
    confirmSensitiveChange: true,
  }));
  assert.deepEqual(
    (await adminDb.doc('users/staff_a').get()).data().customRoleAssignments[SCHOOL_A],
    [created.roleId],
  );

  await assert.rejects(createCustomRoleHandler(actorRequest('membership_manager', {
    schoolId: SCHOOL_B,
    name: 'אסור',
    description: '',
    permissions: { 'students.view': true },
    delegatedPermissionKeys: [],
    accessScope: { type: 'school', classIds: [] },
  })), error => error.code === 'permission-denied');
});

test('ordinary active membership does not grant unrestricted role management', async () => {
  await seedUser('membership_viewer', '', 'viewer', { schoolId: '', schoolIds: [] });
  await adminDb.doc(`schools/${SCHOOL_A}/memberships/membership_viewer`).set({
    schoolId: SCHOOL_A,
    userId: 'membership_viewer',
    role: 'viewer',
    status: 'active',
  });
  await assert.rejects(createCustomRoleHandler(actorRequest('membership_viewer', {
    schoolId: SCHOOL_A,
    name: 'אסור',
    description: '',
    permissions: { 'students.view': true },
    delegatedPermissionKeys: [],
    accessScope: { type: 'school', classIds: [] },
  })), error => error.code === 'permission-denied');
});

test('school manager can create forum folders and discussions without a delegate membership', async () => {
  await seedUser('manager_a', SCHOOL_A, 'viewer', {
    fullName: 'Manager',
    rolesBySchool: { [SCHOOL_A]: 'principal' },
    activeSchoolId: SCHOOL_A,
  });
  await adminDb.doc(`schools/${SCHOOL_A}`).set({ name: 'School A' });
  await adminDb.doc(`schoolPublicDirectory/${SCHOOL_A}`).set({ schoolId: SCHOOL_A, name: 'School A', status: 'active' });
  const folder = await upsertForumFolderHandler(actorRequest('manager_a', {
    name: 'מנהלים משתפים',
    description: '',
  }));
  const thread = await createForumThreadHandler(actorRequest('manager_a', {
    folderId: folder.folderId,
    title: 'עדכון מוסדי',
    body: 'שיתוף בין מנהלי מוסדות.',
    attachmentIds: [],
  }));
  assert.equal((await adminDb.doc(`platformForum/root/folders/${folder.folderId}`).get()).exists, true);
  assert.equal((await adminDb.doc(`platformForum/root/threads/${thread.threadId}`).get()).exists, true);
});

test('file and folder deletion uses a recoverable server-side recycle bin', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('viewer_a', SCHOOL_A, 'viewer');
  await adminDb.doc(`folders_${SCHOOL_A}/folder_1`).set({ schoolId: SCHOOL_A, name: 'Mappings' });
  await adminDb.doc(`files_${SCHOOL_A}/file_1`).set({
    schoolId: SCHOOL_A, folderId: 'folder_1', name: 'Grades',
    fileType: 'gradebook', gradebookId: 'gradebook_1',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/gradebooks/gradebook_1`).set({ schoolId: SCHOOL_A, classId: 'class_1' });
  const trashInput = { schoolId: SCHOOL_A, resourceType: 'folder', resourceId: 'folder_1', action: 'trash' };
  await assert.rejects(fileTrashActionHandler(actorRequest('viewer_a', trashInput)), error => error.code === 'permission-denied');
  await fileTrashActionHandler(actorRequest('principal_a', trashInput));
  assert.ok((await adminDb.doc(`folders_${SCHOOL_A}/folder_1`).get()).data().trashedAt);
  assert.equal((await adminDb.doc(`files_${SCHOOL_A}/file_1`).get()).data().trashedWithFolderId, 'folder_1');
  assert.ok((await adminDb.doc(`schools/${SCHOOL_A}/gradebooks/gradebook_1`).get()).data().trashedAt);
  await fileTrashActionHandler(actorRequest('principal_a', { ...trashInput, action: 'restore' }));
  assert.equal((await adminDb.doc(`folders_${SCHOOL_A}/folder_1`).get()).data().trashedAt, undefined);
  assert.equal((await adminDb.doc(`schools/${SCHOOL_A}/gradebooks/gradebook_1`).get()).data().trashedAt, undefined);
  await fileTrashActionHandler(actorRequest('principal_a', { ...trashInput, action: 'trash' }));
  await fileTrashActionHandler(actorRequest('principal_a', { ...trashInput, action: 'purge', confirmPermanent: true }));
  assert.equal((await adminDb.doc(`folders_${SCHOOL_A}/folder_1`).get()).exists, false);
  assert.equal((await adminDb.doc(`files_${SCHOOL_A}/file_1`).get()).exists, false);
  assert.equal((await adminDb.doc(`schools/${SCHOOL_A}/gradebooks/gradebook_1`).get()).exists, false);
});

test('principal cannot grant global_admin through setUserRole', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('target_a', SCHOOL_A);
  await adminAuth.createUser({ uid: 'target_a', email: 'target@example.test' });
  createdAuthUsers.add('target_a');
  await assert.rejects(setRoleHandler(actorRequest('principal_a', {
    userId: 'target_a',
    schoolId: SCHOOL_A,
    role: 'global_admin',
  })), error => error.code === 'permission-denied');
});

test('authorized membership approval writes an audit log', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await adminDb.collection('users').doc('pending_user').set({
    uid: 'pending_user',
    role: 'viewer',
    schoolId: '',
    schoolIds: [],
    pendingSchools: [SCHOOL_A],
    accountStatus: 'pending',
  });
  const result = await approveMembershipHandler(actorRequest('principal_a', {
    userId: 'pending_user',
    schoolId: SCHOOL_A,
  }));
  assert.deepEqual(result, { ok: true });
  const updated = await adminDb.collection('users').doc('pending_user').get();
  assert.equal(updated.data().accountStatus, 'active');
  assert.ok(updated.data().schoolIds.includes(SCHOOL_A));
  const audit = await adminDb.collection('auditLogs')
    .where('action', '==', 'membership.approve')
    .get();
  assert.equal(audit.size, 1);
  assert.equal(audit.docs[0].data().schoolId, SCHOOL_A);
});

test('authorized server notification validates school and records audit metadata only', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('recipient_a', SCHOOL_A);
  const result = await createNotificationsHandler(actorRequest('principal_a', {
    schoolId: SCHOOL_A,
    userIds: ['recipient_a'],
    title: 'Authorized update',
    body: 'A short body',
    type: 'system',
    link: '/notifications',
  }));
  assert.equal(result.createdCount, 1);
  const notifications = await adminDb.collection('notifications').get();
  assert.equal(notifications.size, 1);
  assert.equal(notifications.docs[0].data().userId, 'recipient_a');
  const audit = await adminDb.collection('auditLogs')
    .where('action', '==', 'notification.create')
    .get();
  assert.equal(audit.size, 1);
  assert.deepEqual(audit.docs[0].data().metadata, { recipientCount: 1, type: 'system' });
});

test('communication reminders may notify self while reassignment requires explicit permission', async () => {
  await seedUser('staff_a', SCHOOL_A);
  await seedUser('staff_b', SCHOOL_A);
  const selfResult = await createNotificationsHandler(actorRequest('staff_a', {
    schoolId: SCHOOL_A,
    userIds: ['staff_a'],
    title: 'Follow-up reminder',
    body: 'The follow-up is due.',
    type: 'communication',
    link: '/tasks?view=communications',
  }));
  assert.equal(selfResult.createdCount, 1);

  await assert.rejects(createNotificationsHandler(actorRequest('staff_a', {
    schoolId: SCHOOL_A,
    userIds: ['staff_b'],
    title: 'Reassigned follow-up',
    body: '',
    type: 'communication',
    link: '/tasks?view=communications',
  })));

  await seedUser('reassigner_a', SCHOOL_A, 'viewer', {
    permissions: { 'communications.reassign': true },
  });
  const reassigned = await createNotificationsHandler(actorRequest('reassigner_a', {
    schoolId: SCHOOL_A,
    userIds: ['staff_b'],
    title: 'Reassigned follow-up',
    body: '',
    type: 'communication',
    link: '/tasks?view=communications',
  }));
  assert.equal(reassigned.createdCount, 1);
});

test('task assign permission may notify only a recipient in the same school', async () => {
  await seedUser('assigner_a', SCHOOL_A, 'viewer', { permissions: { tasks_assign: true } });
  await seedUser('recipient_a', SCHOOL_A);
  await seedUser('recipient_b', SCHOOL_B);
  const result = await createNotificationsHandler(actorRequest('assigner_a', {
    schoolId: SCHOOL_A,
    userIds: ['recipient_a'],
    title: 'Assigned task',
    body: '',
    type: 'task',
    link: '/tasks?task=task_1',
  }));
  assert.equal(result.createdCount, 1);
  await assert.rejects(createNotificationsHandler(actorRequest('assigner_a', {
    schoolId: SCHOOL_A,
    userIds: ['recipient_b'],
    title: 'Invalid assignment',
    body: '',
    type: 'task',
    link: '/tasks',
  })), error => error.code === 'permission-denied');
});

test('school administration is server-authorized and audited', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('platform_admin', SCHOOL_A, 'viewer');
  await adminDb.collection('schools').doc(SCHOOL_A).set({ name: 'School A', status: 'active' });
  await assert.rejects(createSchoolHandler(actorRequest('principal_a', {
    name: 'Not allowed',
  })), error => error.code === 'permission-denied');
  const created = await createSchoolHandler(actorRequest('platform_admin', {
    name: 'New School', code: 'school_new', address: '', phone: '', institutionalEmail: '',
    activeAcademicYearId: 'year_2026_2027', status: 'active',
    manager: { fullName: 'New Manager', email: 'new-manager@example.test' },
  }, { platform_admin: true }));
  assert.equal(created.schoolId, 'school_new');
  const result = await updateSchoolHandler(actorRequest('principal_a', {
    schoolId: SCHOOL_A,
    name: 'Updated A',
    code: SCHOOL_A,
    address: '',
    phone: '',
    institutionalEmail: '',
    activeAcademicYearId: 'year_2026_2027',
    status: 'disabled',
  }));
  assert.deepEqual(result, { ok: true });
  assert.equal((await adminDb.collection('schools').doc(SCHOOL_A).get()).data().status, 'active');
  const audit = await adminDb.collection('auditLogs')
    .where('action', '==', 'school.update')
    .get();
  assert.equal(audit.size, 1);
});

test('active school selection requires a real active membership', async () => {
  await seedUser('member_a', SCHOOL_A);
  await adminDb.collection('schools').doc(SCHOOL_A).set({ name: 'School A', status: 'active' });
  await adminDb.collection('schools').doc(SCHOOL_B).set({ name: 'School B', status: 'active' });
  await setActiveSchoolHandler(actorRequest('member_a', { schoolId: SCHOOL_A }));
  await assert.rejects(
    setActiveSchoolHandler(actorRequest('member_a', { schoolId: SCHOOL_B })),
    error => error.code === 'permission-denied',
  );
});

test('mandatory tasks require explicit authority and are audited', async () => {
  await seedUser('viewer_a', SCHOOL_A);
  await seedUser('assigner_a', SCHOOL_A, 'viewer', { permissions: { 'tasks.assignMandatory': true } });
  await seedUser('recipient_a', SCHOOL_A);
  const input = {
    schoolId: SCHOOL_A, recipientIds: ['recipient_a'], title: 'Required action',
    description: '', dueDate: '', priority: 'high',
  };
  await assert.rejects(
    createMandatoryTaskHandler(actorRequest('viewer_a', input)),
    error => error.code === 'permission-denied',
  );
  const result = await createMandatoryTaskHandler(actorRequest('assigner_a', input));
  const task = await adminDb.doc(`schools/${SCHOOL_A}/tasks/${result.taskId}`).get();
  assert.equal(task.data().mandatory, true);
  assert.deepEqual(task.data().assigneeIds, ['recipient_a']);
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'task.mandatory.create').get();
  assert.equal(audits.size, 1);
});

test('task invitations can be accepted only by their recipient', async () => {
  await seedUser('owner_a', SCHOOL_A);
  await seedUser('recipient_a', SCHOOL_A);
  await seedUser('other_a', SCHOOL_A);
  await adminDb.doc('users/owner_a/personalTasks/personal_1').set({
    schoolId: SCHOOL_A, ownerId: 'owner_a', createdBy: 'owner_a', scope: 'personal',
    title: 'Private until accepted', description: 'Details', status: 'todo', dueDate: '', priority: 'medium',
  });
  await inviteTaskCollaboratorsHandler(actorRequest('owner_a', {
    schoolId: SCHOOL_A, personalTaskId: 'personal_1', recipientIds: ['recipient_a'], message: '',
  }));
  const invitations = await adminDb.collection(`schools/${SCHOOL_A}/taskInvitations`).get();
  assert.equal(invitations.size, 1);
  const invitationId = invitations.docs[0].id;
  await assert.rejects(respondTaskInvitationHandler(actorRequest('other_a', {
    schoolId: SCHOOL_A, invitationId, action: 'accept', response: '',
  })), error => error.code === 'permission-denied');
  await respondTaskInvitationHandler(actorRequest('recipient_a', {
    schoolId: SCHOOL_A, invitationId, action: 'accept', response: 'Accepted',
  }));
  const updated = await invitations.docs[0].ref.get();
  assert.equal(updated.data().status, 'accepted');
  assert.ok(updated.data().sharedTaskId);
});

test('staff invitation tokens expire and cannot be reused', async () => {
  await adminDb.collection('schools').doc(SCHOOL_A).set({ name: 'School A', status: 'active' });
  const expiredToken = 'expired_token_value_that_is_long_enough_123456';
  await adminDb.doc(`schools/${SCHOOL_A}/invitations/expired_invite`).set({
    schoolId: SCHOOL_A, normalizedEmail: 'expired@example.test', fullName: 'Expired', role: 'viewer',
    status: 'pending', expiresAt: Timestamp.fromMillis(Date.now() - 1000), inviterId: 'principal_a',
  });
  await adminDb.doc('_invitationSecrets/expired_invite').set({
    schoolId: SCHOOL_A,
    tokenHash: createHash('sha256').update(expiredToken).digest('hex'),
    expiresAt: Timestamp.fromMillis(Date.now() - 1000),
  });
  await assert.rejects(acceptInvitationToken({
    invitationId: 'expired_invite', token: expiredToken, password: 'A-secure-pass-123', fullName: 'Expired',
  }), error => error.details?.reason === 'invitation-expired');

  const validToken = 'valid_token_value_that_is_long_enough_12345678';
  await adminDb.doc(`schools/${SCHOOL_A}/invitations/valid_invite`).set({
    schoolId: SCHOOL_A, normalizedEmail: 'accepted@example.test', fullName: 'Accepted', role: 'viewer',
    status: 'pending', expiresAt: Timestamp.fromMillis(Date.now() + 60_000), inviterId: 'principal_a',
    customRoleIds: [], teamIds: [], classIds: [], permissions: {},
  });
  await adminDb.doc('_invitationSecrets/valid_invite').set({
    schoolId: SCHOOL_A,
    tokenHash: createHash('sha256').update(validToken).digest('hex'),
    expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
  });
  const accepted = await acceptInvitationToken({
    invitationId: 'valid_invite', token: validToken, password: 'A-secure-pass-123', fullName: 'Accepted',
  });
  const acceptedAuth = await adminAuth.getUserByEmail('accepted@example.test');
  createdAuthUsers.add(acceptedAuth.uid);
  assert.equal(accepted.ok, true);
  await assert.rejects(acceptInvitationToken({
    invitationId: 'valid_invite', token: validToken, password: 'A-secure-pass-123', fullName: 'Accepted',
  }), error => error.details?.reason === 'invitation-invalid');
});

test('delegated role manager grants only owned and explicitly delegable permissions', async () => {
  await seedUser('coordinator_a', SCHOOL_A, 'viewer', { customRoleIds: ['delegator_role'] });
  await seedUser('target_a', SCHOOL_A);
  await adminAuth.createUser({ uid: 'target_a', email: 'role-target@example.test' });
  createdAuthUsers.add('target_a');
  await adminDb.collection(`roles_${SCHOOL_A}`).doc('delegator_role').set({
    schoolId: SCHOOL_A,
    name: 'Delegator',
    status: 'active',
    permissions: {
      'permissions.delegate': true,
      'roles.create': true,
      'roles.assign': true,
      'students.view': true,
    },
    delegatedPermissionKeys: ['students.view'],
    accessScope: { type: 'school', classIds: [] },
  });

  const created = await createCustomRoleHandler(actorRequest('coordinator_a', {
    schoolId: SCHOOL_A,
    name: 'Scoped viewer',
    description: '',
    permissions: { 'students.view': true },
    delegatedPermissionKeys: [],
    accessScope: { type: 'school', classIds: [] },
  }));
  assert.ok(created.roleId);

  await assert.rejects(createCustomRoleHandler(actorRequest('coordinator_a', {
    schoolId: SCHOOL_A,
    name: 'Escalated editor',
    description: '',
    permissions: { 'students.update': true },
    delegatedPermissionKeys: [],
    accessScope: { type: 'school', classIds: [] },
  })), error => error.code === 'permission-denied');

  await assert.rejects(assignCustomRoleHandler(actorRequest('coordinator_a', {
    schoolId: SCHOOL_A,
    roleId: created.roleId,
    userId: 'coordinator_a',
    action: 'assign',
    confirmSensitiveChange: true,
  })), error => error.code === 'permission-denied');

  await assignCustomRoleHandler(actorRequest('coordinator_a', {
    schoolId: SCHOOL_A,
    roleId: created.roleId,
    userId: 'target_a',
    action: 'assign',
    confirmSensitiveChange: true,
  }));
  const target = (await adminDb.collection('users').doc('target_a').get()).data();
  assert.deepEqual(target.customRoleAssignments[SCHOOL_A], [created.roleId]);
  assert.equal(target.rolePermissionsBySchool[SCHOOL_A]['students.view'], true);
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'role.assign').get();
  assert.equal(audits.size, 1);
});

test('class-scoped delegated role cannot be widened to school scope', async () => {
  await seedUser('class_coordinator', SCHOOL_A, 'viewer', { customRoleIds: ['class_delegator'] });
  await adminDb.collection(`roles_${SCHOOL_A}`).doc('class_delegator').set({
    schoolId: SCHOOL_A,
    name: 'Class delegator',
    status: 'active',
    permissions: {
      'permissions.delegate': true,
      'roles.create': true,
      'students.view': true,
    },
    delegatedPermissionKeys: ['students.view'],
    accessScope: { type: 'classes', classIds: ['class_a'] },
  });
  await assert.rejects(createCustomRoleHandler(actorRequest('class_coordinator', {
    schoolId: SCHOOL_A,
    name: 'Too wide',
    description: '',
    permissions: { 'students.view': true },
    delegatedPermissionKeys: [],
    accessScope: { type: 'school', classIds: [] },
  })), error => error.code === 'permission-denied');
});

test('personal-file mutations require the matching permission and preserve ownership', async () => {
  await seedUser('viewer_a', SCHOOL_A);
  await seedUser('employment_a', SCHOOL_A, 'viewer', {
    permissions: { 'personalFile.view': true, 'cv.manageExperience': true },
  });
  await adminDb.doc(`students_${SCHOOL_A}/student_a`).set({
    schoolId: SCHOOL_A, classId: 'class_a', fullName: 'Student A',
  });
  await adminDb.doc(`personal_files_${SCHOOL_A}/student_a`).set({
    schoolId: SCHOOL_A, studentId: 'student_a', status: 'active',
  });
  const payload = {
    title: '', description: 'Practical work', status: 'active', workplace: 'Zoko',
    roleTitle: 'Assistant', field: 'Technical', startDate: '2026-01-01', endDate: '',
    isCurrent: true, workload: '', responsibilities: ['Safe work'], achievements: [],
    supervisorName: '', recommendationLink: '', attachments: [],
  };
  await assert.rejects(upsertPersonalFileItemHandler(actorRequest('viewer_a', {
    schoolId: SCHOOL_A, studentId: 'student_a', kind: 'experiences', payload,
  })), error => error.code === 'permission-denied');
  const result = await upsertPersonalFileItemHandler(actorRequest('employment_a', {
    schoolId: SCHOOL_A, studentId: 'student_a', kind: 'experiences', payload,
  }));
  const item = await adminDb.doc(`personal_files_${SCHOOL_A}/student_a/experiences/${result.itemId}`).get();
  assert.equal(item.data().schoolId, SCHOOL_A);
  assert.equal(item.data().studentId, 'student_a');
  assert.equal(item.data().createdBy, 'employment_a');
  const audits = await adminDb.collection('auditLogs').where('action', '==', 'personalFile.experiences.create').get();
  assert.equal(audits.size, 1);
});

test('class-scoped personal-file role cannot access a student in another class', async () => {
  await seedUser('coordinator_a', SCHOOL_A, 'viewer', { customRoleIds: ['class_file_role'] });
  await adminDb.doc(`roles_${SCHOOL_A}/class_file_role`).set({
    schoolId: SCHOOL_A,
    status: 'active',
    permissions: { 'personalFile.view': true, 'personalFile.manage': true },
    accessScope: { type: 'classes', classIds: ['class_a'] },
  });
  await Promise.all(['student_a', 'student_b'].map((studentId, index) => Promise.all([
    adminDb.doc(`students_${SCHOOL_A}/${studentId}`).set({
      schoolId: SCHOOL_A, classId: index === 0 ? 'class_a' : 'class_b', fullName: studentId,
    }),
    adminDb.doc(`personal_files_${SCHOOL_A}/${studentId}`).set({
      schoolId: SCHOOL_A, studentId, status: 'active',
    }),
  ])));
  await recordPersonalFileAccessHandler(actorRequest('coordinator_a', {
    schoolId: SCHOOL_A, studentId: 'student_a', action: 'view',
  }));
  await assert.rejects(recordPersonalFileAccessHandler(actorRequest('coordinator_a', {
    schoolId: SCHOOL_A, studentId: 'student_b', action: 'view',
  })), error => error.code === 'permission-denied');
});

test('personal-file archive is soft and audited', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await adminDb.doc(`students_${SCHOOL_A}/student_a`).set({ schoolId: SCHOOL_A, classId: 'class_a' });
  await adminDb.doc(`personal_files_${SCHOOL_A}/student_a`).set({ schoolId: SCHOOL_A, studentId: 'student_a', status: 'active' });
  await adminDb.doc(`personal_files_${SCHOOL_A}/student_a/credentials/credential_a`).set({
    schoolId: SCHOOL_A, studentId: 'student_a', status: 'verified', createdBy: 'principal_a',
  });
  await archivePersonalFileItemHandler(actorRequest('principal_a', {
    schoolId: SCHOOL_A, studentId: 'student_a', kind: 'credentials', itemId: 'credential_a',
  }));
  const item = await adminDb.doc(`personal_files_${SCHOOL_A}/student_a/credentials/credential_a`).get();
  assert.equal(item.exists, true);
  assert.equal(item.data().status, 'archived');
  assert.equal(item.data().archivedBy, 'principal_a');
});

function cvSnapshot(fullName = 'תלמיד א') {
  return {
    personal: { fullName, professionalTitle: 'טכנאי', phone: '', email: '', city: '', birthDate: '', professionalLink: '', photoPath: '' },
    summary: 'תקציר מאושר', education: [], experiences: [], practicalExperience: [], projects: [], skills: [], credentials: [], recommendations: [], languages: [],
    sectionOrder: ['summary', 'experiences', 'skills'], hiddenSections: [],
    design: { templateId: 'classic_professional', templateName: 'קלאסי מקצועי', accentColor: '#607D8B', showPhoto: false, sidebarSections: ['skills'] },
  };
}

test('CV lifecycle is server-authorized, snapshots final versions and never overwrites final content', async () => {
  await seedUser('cv_viewer', SCHOOL_A, 'viewer', { permissions: { 'cv.view': true } });
  await seedUser('cv_editor', SCHOOL_A, 'viewer', { permissions: {
    'cv.view': true, 'cv.create': true, 'cv.edit': true, 'cv.finalize': true, 'cv.exportPdf': true,
  } });
  await adminDb.doc(`students_${SCHOOL_A}/student_a`).set({ schoolId: SCHOOL_A, classId: 'class_a', fullName: 'תלמיד א' });
  await adminDb.doc(`personal_files_${SCHOOL_A}/student_a`).set({ schoolId: SCHOOL_A, studentId: 'student_a', status: 'active' });
  const createInput = {
    schoolId: SCHOOL_A, studentId: 'student_a', title: 'קורות חיים כלליים', purpose: '',
    templateId: 'classic_professional', snapshot: cvSnapshot(),
  };
  await assert.rejects(createCvDocumentHandler(actorRequest('cv_viewer', createInput)), error => error.code === 'permission-denied');
  const created = await createCvDocumentHandler(actorRequest('cv_editor', createInput));
  await saveCvDraftHandler(actorRequest('cv_editor', {
    schoolId: SCHOOL_A, studentId: 'student_a', documentId: created.documentId,
    title: 'קורות חיים למשרה טכנית', purpose: 'משרה טכנית', status: 'ready', snapshot: cvSnapshot('תלמיד א — נוסח גרסה'),
  }));
  const finalized = await finalizeCvDocumentHandler(actorRequest('cv_editor', {
    schoolId: SCHOOL_A, studentId: 'student_a', documentId: created.documentId, confirm: true,
  }));
  assert.equal(finalized.versionId, 'v001');
  const version = await adminDb.doc(`personal_files_${SCHOOL_A}/student_a/cvDocuments/${created.documentId}/versions/v001`).get();
  assert.equal(version.data().snapshot.personal.fullName, 'תלמיד א — נוסח גרסה');
  await assert.rejects(saveCvDraftHandler(actorRequest('cv_editor', {
    schoolId: SCHOOL_A, studentId: 'student_a', documentId: created.documentId,
    title: 'שינוי שקט', purpose: '', status: 'draft', snapshot: cvSnapshot('שונה'),
  })), error => error.code === 'permission-denied');
  const exportId = 'export_001';
  const filename = 'cv_student_2026-07-23.pdf';
  const attachment = {
    storagePath: `schools/${SCHOOL_A}/students/student_a/cv/${created.documentId}/v001/${exportId}/${filename}`,
    originalName: filename, contentType: 'application/pdf', size: 2048,
  };
  await assert.rejects(registerCvPdfHandler(actorRequest('cv_editor', {
    schoolId: SCHOOL_A, studentId: 'student_a', documentId: created.documentId,
    versionId: 'v001', exportId, attachment: { ...attachment, storagePath: `schools/${SCHOOL_B}/unsafe.pdf` },
  })), error => error.code === 'permission-denied');
  await registerCvPdfHandler(actorRequest('cv_editor', {
    schoolId: SCHOOL_A, studentId: 'student_a', documentId: created.documentId,
    versionId: 'v001', exportId, attachment,
  }));
  const exportRecord = await adminDb.doc(`personal_files_${SCHOOL_A}/student_a/cvDocuments/${created.documentId}/versions/v001/exports/${exportId}`).get();
  assert.equal(exportRecord.exists, true);
  const audit = await adminDb.collection('auditLogs').where('action', '==', 'cv.exportPdf').get();
  assert.equal(audit.size, 1);
});

test('school CV templates reject personal literals and bulk generation creates separate idempotent drafts', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await adminDb.doc(`schools/${SCHOOL_A}`).set({ name: 'בית ספר א' });
  await adminDb.doc(`cv_templates_${SCHOOL_A}/private_template`).set({
    schoolId: SCHOOL_A, name: 'פרטית', type: 'design', scope: 'personal', status: 'active',
    createdBy: 'another_user', design: { accentColor: '#607D8B', sectionOrder: ['summary'], sidebarSections: [], showPhotoDefault: false },
  });
  await assert.rejects(upsertCvTemplateHandler(actorRequest('principal_a', {
    schoolId: SCHOOL_A, templateId: 'private_template', name: 'ניסיון עריכה', type: 'design', scope: 'personal', isDefault: false,
    design: { accentColor: '#607D8B', sectionOrder: ['summary'], sidebarSections: [], showPhotoDefault: false },
  })), error => error.code === 'permission-denied');
  await assert.rejects(upsertCvTemplateHandler(actorRequest('principal_a', {
    schoolId: SCHOOL_A, name: 'תוכן לא בטוח', type: 'content', scope: 'school', isDefault: false,
    content: { summaryTemplate: 'צרו קשר 050-1234567', educationText: '', experienceText: '', suggestedSkills: [] },
  })), error => error.code === 'permission-denied');
  const template = await upsertCvTemplateHandler(actorRequest('principal_a', {
    schoolId: SCHOOL_A, name: 'תוכן מוסדי', type: 'content', scope: 'school', isDefault: true,
    content: { summaryTemplate: '{{student.fullName}} לומד/ת ב-{{school.name}}', educationText: 'לימודים מקצועיים', experienceText: '', suggestedSkills: ['עבודה בצוות'] },
  }));
  for (const [studentId, fullName] of [['student_a', 'תלמיד א'], ['student_b', 'תלמיד ב']]) {
    await adminDb.doc(`students_${SCHOOL_A}/${studentId}`).set({ schoolId: SCHOOL_A, classId: 'class_a', className: 'כיתה א', fullName, phone: '', email: '' });
    await adminDb.doc(`personal_files_${SCHOOL_A}/${studentId}`).set({ schoolId: SCHOOL_A, studentId, status: 'active' });
  }
  const input = { schoolId: SCHOOL_A, classId: 'class_a', academicYearId: 'year_2026_2027', studentIds: ['student_a', 'student_b'] };
  const preview = await previewBulkCvDraftsHandler(actorRequest('principal_a', input));
  assert.equal(preview.students.length, 2);
  assert.equal(preview.students[0].missingPhone, true);
  const createInput = { ...input, templateId: template.templateId, titlePrefix: 'קורות חיים', requestId: 'request_001' };
  const first = await bulkCreateCvDraftsHandler(actorRequest('principal_a', createInput));
  assert.deepEqual(first, { createdCount: 2, existingCount: 0 });
  const second = await bulkCreateCvDraftsHandler(actorRequest('principal_a', createInput));
  assert.deepEqual(second, { createdCount: 0, existingCount: 2 });
  const draftA = await adminDb.doc(`personal_files_${SCHOOL_A}/student_a/cvDocuments/student_a_request_001`).get();
  const draftB = await adminDb.doc(`personal_files_${SCHOOL_A}/student_b/cvDocuments/student_b_request_001`).get();
  assert.equal(draftA.exists && draftB.exists, true);
  assert.notEqual(draftA.data().studentId, draftB.data().studentId);
  assert.equal(draftA.data().snapshot.skills[0].level, 'הצעה לאימות');
});

test('bulk student import requires capability and is idempotent by requestId', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal', { activeSchoolId: SCHOOL_A });
  await seedUser('viewer_a', SCHOOL_A, 'viewer', { activeSchoolId: SCHOOL_A });
  await adminDb.doc(`schools/${SCHOOL_A}/classes/class_a`).set({ schoolId: SCHOOL_A, name: 'כיתה א', gradeLevel: 'י' });
  await adminDb.doc(`schools/${SCHOOL_A}/academic_years/year_a`).set({ schoolId: SCHOOL_A, label: 'תשפ״ז' });
  const data = {
    requestId: 'import_request_001',
    students: [{
      rowId: 'row_1', firstName: 'ישראל', lastName: 'ישראלי', idNumber: 'A-10001',
      classId: 'class_a', academicYearId: 'year_a', academicYear: 'תשפ״ז', status: 'active',
    }],
  };
  await assert.rejects(bulkImportStudentsHandler(actorRequest('viewer_a', data)), error => error.code === 'permission-denied');
  const first = await bulkImportStudentsHandler(actorRequest('principal_a', data));
  assert.equal(first.totals.created, 1);
  assert.equal(first.errors.length, 0);
  const second = await bulkImportStudentsHandler(actorRequest('principal_a', data));
  assert.equal(second.idempotentReplay, true);
  const students = await adminDb.collection(`schools/${SCHOOL_A}/students`).get();
  assert.equal(students.size, 1);
  const importedStudent = students.docs[0];
  assert.equal(Object.hasOwn(importedStudent.data(), 'idNumber'), false);
  assert.equal(Object.hasOwn(importedStudent.data(), 'normalizedIdNumber'), false);
  const protectedIdentity = await adminDb.doc(
    `schools/${SCHOOL_A}/students/${importedStudent.id}/sensitive/identity`,
  ).get();
  assert.equal(protectedIdentity.exists, true);
  assert.equal(protectedIdentity.data().normalizedIdNumber, 'A10001');
  const audit = await adminDb.collection('auditLogs').where('action', '==', 'students.bulkImport').get();
  assert.equal(audit.size, 1);
  assert.equal(JSON.stringify(audit.docs[0].data()).includes('A-10001'), false);
});

test('bulk import detects duplicate identifiers without returning the identifier', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal', { activeSchoolId: SCHOOL_A });
  await adminDb.doc(`schools/${SCHOOL_A}/classes/class_a`).set({ schoolId: SCHOOL_A, name: 'כיתה א' });
  await adminDb.doc(`schools/${SCHOOL_A}/academic_years/year_a`).set({ schoolId: SCHOOL_A, label: 'תשפ״ז' });
  const result = await bulkImportStudentsHandler(actorRequest('principal_a', {
    requestId: 'import_request_002',
    students: [1, 2].map(index => ({
      rowId: `row_${index}`, firstName: 'שם', lastName: `${index}`, idNumber: 'same-001',
      classId: 'class_a', academicYearId: 'year_a', academicYear: 'תשפ״ז', status: 'active',
    })),
  }));
  assert.equal(result.totals.created, 1);
  assert.equal(result.totals.failed, 1);
  assert.deepEqual(result.errors, [{ rowId: 'row_2', reason: 'duplicate-in-request' }]);
  assert.equal(JSON.stringify(result).includes('same-001'), false);
});

test('resource ACL is server-managed, audited and materializes explicit deny', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('teacher_a', SCHOOL_A);
  await adminAuth.createUser({ uid: 'teacher_a', email: 'teacher-acl@example.test' });
  createdAuthUsers.add('teacher_a');
  await adminDb.doc(`schools/${SCHOOL_A}/folders/folder_a`).set({ schoolId: SCHOOL_A, name: 'חסוי' });
  const result = await upsertResourceAclHandler(actorRequest('principal_a', {
    schoolId: SCHOOL_A, resourceType: 'folder', resourceId: 'folder_a', principalType: 'user',
    principalId: 'teacher_a', accessLevel: 'view', explicitDeny: true, inherit: true, expiresAt: null,
  }));
  assert.ok(result.aclId);
  const policy = await adminDb.doc(`schools/${SCHOOL_A}/resourceAclPolicies/folder_folder_a`).get();
  assert.deepEqual(policy.data().view.deniedUsers, ['teacher_a']);
  const audit = await adminDb.collection('auditLogs').where('action', '==', 'resourceAcl.deny').get();
  assert.equal(audit.size, 1);
});

test('task ACL management requires the task-specific capability', async () => {
  await seedUser('task_manager', SCHOOL_A, 'viewer', {
    permissions: { 'tasks.managePermissions': true },
  });
  await seedUser('teacher_a', SCHOOL_A);
  await adminAuth.createUser({ uid: 'teacher_a', email: 'teacher-task-acl@example.test' });
  createdAuthUsers.add('teacher_a');
  await adminDb.doc(`schools/${SCHOOL_A}/tasks/task_a`).set({
    schoolId: SCHOOL_A,
    title: 'Task A',
  });
  await adminDb.doc(`schools/${SCHOOL_A}/files/file_a`).set({
    schoolId: SCHOOL_A,
    name: 'File A',
  });
  const taskAcl = await upsertResourceAclHandler(actorRequest('task_manager', {
    schoolId: SCHOOL_A,
    resourceType: 'task',
    resourceId: 'task_a',
    principalType: 'user',
    principalId: 'teacher_a',
    accessLevel: 'edit',
    explicitDeny: false,
    inherit: false,
    expiresAt: null,
  }));
  assert.ok(taskAcl.aclId);
  await assert.rejects(upsertResourceAclHandler(actorRequest('task_manager', {
    schoolId: SCHOOL_A,
    resourceType: 'file',
    resourceId: 'file_a',
    principalType: 'user',
    principalId: 'teacher_a',
    accessLevel: 'view',
    explicitDeny: false,
    inherit: true,
    expiresAt: null,
  })), error => error.code === 'permission-denied');
});

test('permission preview is short-lived, read-only and computed for the target', async () => {
  await seedUser('principal_a', SCHOOL_A, 'principal');
  await seedUser('teacher_a', SCHOOL_A, 'viewer', { permissions: { 'students.view': true } });
  await adminAuth.createUser({ uid: 'teacher_a', email: 'teacher-preview@example.test' });
  createdAuthUsers.add('teacher_a');
  const preview = await startPermissionPreviewHandler(actorRequest('principal_a', {
    schoolId: SCHOOL_A, targetUserId: 'teacher_a',
  }));
  assert.equal(preview.readOnly, true);
  assert.equal(preview.capabilities.some(item => item.capability === 'students.view'), true);
  const decision = await evaluatePreviewAccessHandler(actorRequest('principal_a', {
    schoolId: SCHOOL_A, sessionId: preview.sessionId, capability: 'students.view', accessLevel: 'view', resource: {},
  }));
  assert.equal(decision.allowed, true);
  const session = await adminDb.doc(`schools/${SCHOOL_A}/permissionPreviewSessions/${preview.sessionId}`).get();
  assert.equal(session.data().readOnly, true);
});
