import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import {
  bulkCvCreateSchema,
  bulkCvPreviewSchema,
  cvTemplateActionSchema,
  upsertCvTemplateSchema,
} from '../validation/schemas.js';
import { requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { resolveActorRoleAuthority } from '../services/roleAuthorization.js';

const PLACEHOLDERS = Object.freeze([
  '{{student.fullName}}', '{{student.phone}}', '{{student.email}}', '{{student.city}}',
  '{{student.major}}', '{{student.graduationYear}}', '{{school.name}}', '{{class.name}}',
]);
const SECTION_ORDER = Object.freeze([
  'summary', 'experiences', 'practicalExperience', 'projects', 'recommendations',
  'skills', 'credentials', 'education', 'languages',
]);

async function runSafely(operation, request) {
  try { return await operation(request); }
  catch (error) {
    logger.error('CV template operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

function templateCollection(schoolId) {
  return adminDb.collection(`cv_templates_${schoolId}`);
}

function permissionApplies(authority, permission, classId = '') {
  if (authority.unrestricted) return true;
  if (!authority.permissions.has(permission)) return false;
  const scope = authority.scopes.get(permission);
  return !scope || scope.type === 'school' || (classId && scope.classIds.includes(classId));
}

async function authorizeSchool(request, schoolId, permission, classId = '') {
  const actor = await requireActor(request);
  if (!actor.globalAdmin && !actor.schoolIds.has(schoolId)) throw permissionDenied();
  const authority = await resolveActorRoleAuthority(actor, schoolId);
  if (!permissionApplies(authority, permission, classId)) throw permissionDenied();
  return { actor, authority };
}

function templateText(input) {
  if (input.type !== 'content') return '';
  return [input.content.summaryTemplate, input.content.educationText, input.content.experienceText].join('\n');
}

function containsPersonalLiteral(input) {
  let text = templateText(input);
  PLACEHOLDERS.forEach(placeholder => { text = text.replaceAll(placeholder, ''); });
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)
    || /(?:\d[\s().-]*){7,}/.test(text)
    || /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(text)
    || /{{[^}]+}}/.test(text);
}

async function assertTemplateOwnership(actor, snapshot, schoolId) {
  const data = snapshot.data();
  if (!snapshot.exists || data.schoolId !== schoolId) throw permissionDenied();
  if (data.scope === 'personal' && data.createdBy !== actor.uid) throw permissionDenied();
}

async function clearDefaults({ schoolId, type, scope, actorUid, exceptId }) {
  let query = templateCollection(schoolId)
    .where('type', '==', type).where('scope', '==', scope).where('isDefault', '==', true);
  if (scope === 'personal') query = query.where('createdBy', '==', actorUid);
  const snapshot = await query.get();
  const batch = adminDb.batch();
  snapshot.docs.filter(item => item.id !== exceptId).forEach(item => batch.update(item.ref, {
    isDefault: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid,
  }));
  if (!snapshot.empty) await batch.commit();
}

export async function upsertCvTemplateHandler(request) {
  const input = upsertCvTemplateSchema.parse(request.data);
  const permission = input.templateId ? 'cvTemplates.update' : 'cvTemplates.create';
  const { actor, authority } = await authorizeSchool(request, input.schoolId, permission);
  if (input.scope === 'school' && !permissionApplies(authority, 'cvTemplates.manageSchoolTemplates')) throw permissionDenied();
  if (input.scope === 'school' && containsPersonalLiteral(input)) throw permissionDenied();
  const ref = input.templateId ? templateCollection(input.schoolId).doc(input.templateId) : templateCollection(input.schoolId).doc();
  const existing = await ref.get();
  if (existing.exists) await assertTemplateOwnership(actor, existing, input.schoolId);
  const data = {
    schoolId: input.schoolId, name: input.name, description: input.description,
    type: input.type, scope: input.scope, isDefault: input.isDefault,
    ...(input.type === 'design' ? { design: input.design } : { content: input.content }),
    updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
  };
  if (existing.exists) await ref.update(data);
  else await ref.create({ ...data, status: 'active', createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() });
  if (input.isDefault) await clearDefaults({
    schoolId: input.schoolId, type: input.type, scope: input.scope, actorUid: actor.uid, exceptId: ref.id,
  });
  await writeAuditLog({
    actorUid: actor.uid, action: `cvTemplate.${existing.exists ? 'update' : 'create'}`,
    schoolId: input.schoolId, metadata: { templateId: ref.id, type: input.type, scope: input.scope },
  });
  return { templateId: ref.id };
}

export async function cvTemplateActionHandler(request) {
  const input = cvTemplateActionSchema.parse(request.data);
  const permission = input.action === 'archive' ? 'cvTemplates.archive' : 'cvTemplates.create';
  const { actor, authority } = await authorizeSchool(request, input.schoolId, permission);
  const ref = templateCollection(input.schoolId).doc(input.templateId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data().schoolId !== input.schoolId) throw permissionDenied();
  await assertTemplateOwnership(actor, snapshot, input.schoolId);
  if (snapshot.data().scope === 'school' && !permissionApplies(authority, 'cvTemplates.manageSchoolTemplates')) throw permissionDenied();
  if (input.action === 'archive') {
    await ref.update({ status: 'archived', isDefault: false, archivedBy: actor.uid, archivedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
    await writeAuditLog({ actorUid: actor.uid, action: 'cvTemplate.archive', schoolId: input.schoolId, metadata: { templateId: ref.id } });
    return { ok: true };
  }
  const clone = templateCollection(input.schoolId).doc();
  const data = snapshot.data();
  await clone.create({
    ...data, name: input.name || `${data.name} — עותק`, scope: 'personal', isDefault: false,
    status: 'active', createdBy: actor.uid, updatedBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAuditLog({ actorUid: actor.uid, action: 'cvTemplate.clone', schoolId: input.schoolId, metadata: { sourceTemplateId: ref.id, templateId: clone.id } });
  return { templateId: clone.id };
}

async function getStudent(schoolId, studentId) {
  const refs = [adminDb.doc(`students_${schoolId}/${studentId}`), adminDb.doc(`schools/${schoolId}/students/${studentId}`)];
  const snapshots = await adminDb.getAll(...refs);
  const snapshot = snapshots.find(item => item.exists);
  if (!snapshot || snapshot.data().schoolId !== schoolId) throw permissionDenied();
  return { id: studentId, data: snapshot.data() };
}

async function getSourceItems(schoolId, studentId) {
  const base = adminDb.doc(`personal_files_${schoolId}/${studentId}`);
  const [experiences, skills, credentials, recommendations] = await Promise.all([
    base.collection('experiences').where('status', '!=', 'archived').get(),
    base.collection('skills').where('status', '==', 'verified').get(),
    base.collection('credentials').where('status', '==', 'verified').get(),
    base.collection('recommendations').where('status', '!=', 'archived').get(),
  ]);
  return {
    experiences: experiences.docs.map(item => ({ id: item.id, ...item.data() })),
    skills: skills.docs.map(item => ({ id: item.id, ...item.data() })),
    credentials: credentials.docs.map(item => ({ id: item.id, ...item.data() })),
    recommendations: recommendations.docs.map(item => ({ id: item.id, ...item.data() })),
  };
}

async function authorizeBulk(request, input) {
  const { actor, authority } = await authorizeSchool(request, input.schoolId, 'cv.bulkGenerate', input.classId);
  const students = await Promise.all(input.studentIds.map(studentId => getStudent(input.schoolId, studentId)));
  if (students.some(student => student.data.classId !== input.classId)) throw permissionDenied();
  if (!permissionApplies(authority, 'cv.bulkGenerate', input.classId)) throw permissionDenied();
  return { actor, students };
}

export async function previewBulkCvDraftsHandler(request) {
  const input = bulkCvPreviewSchema.parse(request.data);
  const { students } = await authorizeBulk(request, input);
  const sources = await Promise.all(students.map(student => getSourceItems(input.schoolId, student.id)));
  return { students: students.map((student, index) => ({
    studentId: student.id,
    missingPhone: !student.data.phone,
    missingEmail: !student.data.email,
    missingExperience: sources[index].experiences.length === 0,
    missingVerifiedSkills: sources[index].skills.length === 0,
    missingCredentials: sources[index].credentials.length === 0,
  })) };
}

function resolvePlaceholders(text, student, school, className) {
  return String(text || '')
    .replaceAll('{{student.fullName}}', student.fullName || student.displayName || '')
    .replaceAll('{{student.phone}}', student.phone || '')
    .replaceAll('{{student.email}}', student.email || '')
    .replaceAll('{{student.city}}', student.city || '')
    .replaceAll('{{student.major}}', (student.trackNames || []).join(', '))
    .replaceAll('{{student.graduationYear}}', student.graduationYear || '')
    .replaceAll('{{school.name}}', school.name || '')
    .replaceAll('{{class.name}}', className || '');
}

function cvEntry(overrides = {}) {
  return { title: '', subtitle: '', organization: '', period: '', description: '', bullets: [], category: '', level: '', quote: '', contact: '', link: '', ...overrides };
}

function buildSnapshot({ student, sources, template, school, className, academicYearId }) {
  const content = template?.content || {};
  const design = template?.design || {};
  return {
    personal: {
      fullName: student.fullName || student.displayName || '', professionalTitle: '', phone: student.phone || '',
      email: student.email || '', city: student.city || '', birthDate: '', professionalLink: '', photoPath: '',
    },
    summary: resolvePlaceholders(content.summaryTemplate, student, school, className),
    education: [cvEntry({ title: school.name || 'בית הספר', subtitle: className, period: academicYearId, description: resolvePlaceholders(content.educationText, student, school, className) })],
    experiences: sources.experiences.filter(item => item.showInCv === true).map(item => cvEntry({ sourceId: item.id, title: item.roleTitle || item.title, organization: item.workplace || item.organization, period: [item.startDate, item.isCurrent ? 'היום' : item.endDate].filter(Boolean).join(' – '), description: item.description || '', bullets: [...(item.responsibilities || []), ...(item.achievements || [])] })),
    practicalExperience: content.experienceText ? [cvEntry({ description: resolvePlaceholders(content.experienceText, student, school, className) })] : [],
    projects: [],
    skills: [
      ...sources.skills.filter(item => item.showInCv === true).map(item => cvEntry({ sourceId: item.id, title: item.name || item.title, category: item.category || '', level: item.proficiency || '' })),
      ...(content.suggestedSkills || []).map(name => cvEntry({ title: name, category: 'suggested', level: 'הצעה לאימות' })),
    ],
    credentials: sources.credentials.filter(item => item.showInCv === true).map(item => cvEntry({ sourceId: item.id, title: item.title, organization: item.issuer || '', period: item.issueDate || '', description: item.description || '' })),
    recommendations: sources.recommendations.filter(item => item.cvVisibility && item.cvVisibility !== 'hidden').map(item => cvEntry({ sourceId: item.id, title: item.recommenderName || '', subtitle: item.recommenderRole || '', organization: item.organization || '', quote: item.shortQuote || '', description: item.cvVisibility === 'full' ? item.content || '' : '', contact: item.cvVisibility === 'full' ? item.contact || '' : '' })),
    languages: [],
    sectionOrder: design.sectionOrder || [...SECTION_ORDER], hiddenSections: [],
    design: {
      templateId: template?.id || 'classic_professional', templateName: template?.name || 'קלאסי מקצועי',
      accentColor: design.accentColor || '#607D8B', showPhoto: design.showPhotoDefault || false,
      sidebarSections: design.sidebarSections || ['skills', 'credentials', 'education', 'languages'],
    },
  };
}

async function loadTemplate(input, actor) {
  if (input.templateId === 'classic_professional') return null;
  const snapshot = await templateCollection(input.schoolId).doc(input.templateId).get();
  if (!snapshot.exists || snapshot.data().schoolId !== input.schoolId || snapshot.data().status === 'archived') throw permissionDenied();
  if (snapshot.data().scope === 'personal' && snapshot.data().createdBy !== actor.uid) throw permissionDenied();
  return { id: snapshot.id, ...snapshot.data() };
}

export async function bulkCreateCvDraftsHandler(request) {
  const input = bulkCvCreateSchema.parse(request.data);
  const { actor, students } = await authorizeBulk(request, input);
  await enforceRateLimit({ uid: actor.uid, action: 'cv.bulkGenerate', limit: 5, windowSeconds: 300 });
  const [template, schoolSnapshot, sources] = await Promise.all([
    loadTemplate(input, actor),
    adminDb.doc(`schools/${input.schoolId}`).get(),
    Promise.all(students.map(student => getSourceItems(input.schoolId, student.id))),
  ]);
  const school = schoolSnapshot.data() || {};
  const batch = adminDb.batch();
  let createdCount = 0;
  let existingCount = 0;
  for (let index = 0; index < students.length; index += 1) {
    const student = students[index];
    const fileRef = adminDb.doc(`personal_files_${input.schoolId}/${student.id}`);
    const fileSnapshot = await fileRef.get();
    if (!fileSnapshot.exists) throw permissionDenied();
    const documentRef = fileRef.collection('cvDocuments').doc(`${student.id}_${input.requestId}`);
    const existing = await documentRef.get();
    if (existing.exists) { existingCount += 1; continue; }
    batch.create(documentRef, {
      schoolId: input.schoolId, studentId: student.id,
      title: `${input.titlePrefix} — ${student.data.fullName || student.data.displayName || ''}`,
      purpose: '', templateId: input.templateId, status: 'draft', versionNumber: 0,
      bulkRequestId: input.requestId,
      snapshot: buildSnapshot({ student: student.data, sources: sources[index], template, school, className: student.data.className || '', academicYearId: input.academicYearId }),
      createdBy: actor.uid, updatedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    createdCount += 1;
  }
  if (createdCount > 0) await batch.commit();
  await writeAuditLog({
    actorUid: actor.uid, action: 'cv.bulkGenerate', schoolId: input.schoolId,
    metadata: { classId: input.classId, academicYearId: input.academicYearId, templateId: input.templateId, createdCount, existingCount },
  });
  return { createdCount, existingCount };
}

export const upsertCvTemplate = onCall(CALLABLE_OPTIONS, request => runSafely(upsertCvTemplateHandler, request));
export const cvTemplateAction = onCall(CALLABLE_OPTIONS, request => runSafely(cvTemplateActionHandler, request));
export const previewBulkCvDrafts = onCall(CALLABLE_OPTIONS, request => runSafely(previewBulkCvDraftsHandler, request));
export const bulkCreateCvDrafts = onCall(CALLABLE_OPTIONS, request => runSafely(bulkCreateCvDraftsHandler, request));
