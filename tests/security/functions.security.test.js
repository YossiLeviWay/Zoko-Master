import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  approveMembershipHandler,
} from '../../functions/src/callables/memberships.js';
import { createNotificationsHandler } from '../../functions/src/callables/notifications.js';
import { draftCommunicationWithAgentHandler } from '../../functions/src/callables/communicationAgent.js';
import { askZokiHandler, getZokiTaskGuidanceHandler, saveZokiBrainHandler } from '../../functions/src/callables/zoki.js';
import { executeZokiGradeHandler, executeZokiStudentTransferHandler } from '../../functions/src/callables/zokiActions.js';
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
