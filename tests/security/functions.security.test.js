import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  approveMembershipHandler,
} from '../../functions/src/callables/memberships.js';
import { createNotificationsHandler } from '../../functions/src/callables/notifications.js';
import { createSchoolHandler, updateSchoolHandler } from '../../functions/src/callables/schools.js';
import { setActiveSchoolHandler } from '../../functions/src/callables/auth.js';
import {
  createMandatoryTaskHandler,
  inviteTaskCollaboratorsHandler,
  respondTaskInvitationHandler,
} from '../../functions/src/callables/tasks.js';
import { createStaffHandler, setRoleHandler } from '../../functions/src/callables/staff.js';
import {
  assignCustomRoleHandler,
  createCustomRoleHandler,
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
