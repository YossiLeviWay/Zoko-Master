import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import {
  createCvDocumentSchema,
  cvAccessSchema,
  cvDocumentActionSchema,
  registerCvPdfSchema,
  saveCvDraftSchema,
} from '../validation/schemas.js';
import { requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { resolveActorRoleAuthority } from '../services/roleAuthorization.js';

async function runSafely(operation, request) {
  try {
    return await operation(request);
  } catch (error) {
    logger.error('CV operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

async function getStudent(schoolId, studentId) {
  const legacy = adminDb.doc(`students_${schoolId}/${studentId}`);
  const nested = adminDb.doc(`schools/${schoolId}/students/${studentId}`);
  const [legacySnapshot, nestedSnapshot] = await adminDb.getAll(legacy, nested);
  const snapshot = legacySnapshot.exists ? legacySnapshot : nestedSnapshot;
  if (!snapshot.exists || snapshot.data().schoolId !== schoolId) throw permissionDenied();
  return snapshot.data();
}

function permissionApplies(authority, permission, classId) {
  if (authority.unrestricted) return true;
  if (!authority.permissions.has(permission)) return false;
  const scope = authority.scopes.get(permission);
  return !scope || scope.type === 'school' || scope.classIds.includes(classId);
}

async function authorize(request, schoolId, studentId, permission) {
  const actor = await requireActor(request);
  if (!actor.globalAdmin && !actor.schoolIds.has(schoolId)) throw permissionDenied();
  const student = await getStudent(schoolId, studentId);
  const authority = await resolveActorRoleAuthority(actor, schoolId);
  if (!permissionApplies(authority, permission, student.classId)) throw permissionDenied();
  return { actor, student };
}

function personalFileRef(schoolId, studentId) {
  return adminDb.doc(`personal_files_${schoolId}/${studentId}`);
}

function cvCollection(schoolId, studentId) {
  return personalFileRef(schoolId, studentId).collection('cvDocuments');
}

function safeAttachmentPath(input) {
  const prefix = `schools/${input.schoolId}/students/${input.studentId}/cv/${input.documentId}/${input.versionId}/${input.exportId}/`;
  return input.attachment.storagePath.startsWith(prefix)
    && input.attachment.contentType === 'application/pdf'
    && input.attachment.originalName.toLowerCase().endsWith('.pdf');
}

export async function createCvDocumentHandler(request) {
  const input = createCvDocumentSchema.parse(request.data);
  const { actor } = await authorize(request, input.schoolId, input.studentId, 'cv.create');
  await enforceRateLimit({ uid: actor.uid, action: 'cv.create', limit: 30 });
  const fileSnapshot = await personalFileRef(input.schoolId, input.studentId).get();
  if (!fileSnapshot.exists) throw permissionDenied();
  const ref = cvCollection(input.schoolId, input.studentId).doc();
  await ref.create({
    schoolId: input.schoolId,
    studentId: input.studentId,
    title: input.title,
    purpose: input.purpose,
    templateId: input.templateId,
    status: 'draft',
    versionNumber: 0,
    snapshot: input.snapshot,
    createdBy: actor.uid,
    updatedBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAuditLog({
    actorUid: actor.uid, action: 'cv.create', schoolId: input.schoolId,
    metadata: { studentId: input.studentId, documentId: ref.id },
  });
  return { documentId: ref.id };
}

export async function saveCvDraftHandler(request) {
  const input = saveCvDraftSchema.parse(request.data);
  const { actor } = await authorize(request, input.schoolId, input.studentId, 'cv.edit');
  await enforceRateLimit({ uid: actor.uid, action: 'cv.save', limit: 120 });
  const ref = cvCollection(input.schoolId, input.studentId).doc(input.documentId);
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (!snapshot.exists || data.schoolId !== input.schoolId || data.studentId !== input.studentId) throw permissionDenied();
    if (!['draft', 'ready'].includes(data.status)) throw permissionDenied();
    transaction.update(ref, {
      title: input.title,
      purpose: input.purpose,
      status: input.status,
      snapshot: input.snapshot,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
}

export async function duplicateCvDocumentHandler(request) {
  const input = cvDocumentActionSchema.parse(request.data);
  const { actor } = await authorize(request, input.schoolId, input.studentId, 'cv.create');
  const source = cvCollection(input.schoolId, input.studentId).doc(input.documentId);
  const sourceSnapshot = await source.get();
  const data = sourceSnapshot.data();
  if (!sourceSnapshot.exists || data.schoolId !== input.schoolId || data.studentId !== input.studentId) throw permissionDenied();
  const ref = cvCollection(input.schoolId, input.studentId).doc();
  await ref.create({
    schoolId: input.schoolId,
    studentId: input.studentId,
    title: input.title || `${data.title} — עותק עבודה`,
    purpose: data.purpose || '',
    templateId: data.templateId || 'classic_professional',
    status: 'draft',
    versionNumber: data.versionNumber || 0,
    sourceDocumentId: source.id,
    snapshot: data.snapshot,
    createdBy: actor.uid,
    updatedBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAuditLog({
    actorUid: actor.uid, action: 'cv.duplicate', schoolId: input.schoolId,
    metadata: { studentId: input.studentId, sourceDocumentId: source.id, documentId: ref.id },
  });
  return { documentId: ref.id };
}

export async function finalizeCvDocumentHandler(request) {
  const input = cvDocumentActionSchema.parse(request.data);
  if (input.confirm !== true) throw permissionDenied();
  const { actor } = await authorize(request, input.schoolId, input.studentId, 'cv.finalize');
  await enforceRateLimit({ uid: actor.uid, action: 'cv.finalize', limit: 20 });
  const ref = cvCollection(input.schoolId, input.studentId).doc(input.documentId);
  let versionId = '';
  let versionNumber = 0;
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (!snapshot.exists || data.schoolId !== input.schoolId || data.studentId !== input.studentId) throw permissionDenied();
    if (!['draft', 'ready'].includes(data.status)) throw permissionDenied();
    versionNumber = Number(data.versionNumber || 0) + 1;
    versionId = `v${String(versionNumber).padStart(3, '0')}`;
    const versionRef = ref.collection('versions').doc(versionId);
    transaction.create(versionRef, {
      schoolId: input.schoolId,
      studentId: input.studentId,
      documentId: ref.id,
      versionNumber,
      templateId: data.templateId || 'classic_professional',
      title: data.title,
      purpose: data.purpose || '',
      snapshot: data.snapshot,
      status: 'final',
      createdBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(ref, {
      status: 'final', versionNumber, finalizedBy: actor.uid,
      finalizedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await writeAuditLog({
    actorUid: actor.uid, action: 'cv.finalize', schoolId: input.schoolId,
    metadata: { studentId: input.studentId, documentId: input.documentId, versionId, versionNumber },
  });
  return { versionId, versionNumber };
}

export async function archiveCvDocumentHandler(request) {
  const input = cvDocumentActionSchema.parse(request.data);
  if (input.confirm !== true) throw permissionDenied();
  const { actor, student } = await authorize(request, input.schoolId, input.studentId, 'cv.deleteDraft');
  const ref = cvCollection(input.schoolId, input.studentId).doc(input.documentId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data().studentId !== input.studentId || snapshot.data().status === 'final') {
    throw permissionDenied();
  }
  await ref.update({
    status: 'archived', archivedBy: actor.uid, archivedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAuditLog({
    actorUid: actor.uid, action: 'cv.archiveDraft', schoolId: input.schoolId,
    metadata: { studentId: input.studentId, documentId: input.documentId, classId: student.classId || '' },
  });
  return { ok: true };
}

export async function registerCvPdfHandler(request) {
  const input = registerCvPdfSchema.parse(request.data);
  if (!safeAttachmentPath(input)) throw permissionDenied();
  const { actor } = await authorize(request, input.schoolId, input.studentId, 'cv.exportPdf');
  await enforceRateLimit({ uid: actor.uid, action: 'cv.exportPdf', limit: 20 });
  const documentRef = cvCollection(input.schoolId, input.studentId).doc(input.documentId);
  const versionRef = documentRef.collection('versions').doc(input.versionId);
  const exportRef = versionRef.collection('exports').doc(input.exportId);
  const personalDocumentRef = personalFileRef(input.schoolId, input.studentId).collection('documents').doc();
  await adminDb.runTransaction(async transaction => {
    const [documentSnapshot, versionSnapshot] = await Promise.all([
      transaction.get(documentRef), transaction.get(versionRef),
    ]);
    if (!documentSnapshot.exists || documentSnapshot.data().studentId !== input.studentId) throw permissionDenied();
    if (!versionSnapshot.exists || versionSnapshot.data().status !== 'final') throw permissionDenied();
    const exportRecord = {
      schoolId: input.schoolId,
      studentId: input.studentId,
      documentId: input.documentId,
      versionId: input.versionId,
      attachment: input.attachment,
      createdBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
    };
    transaction.create(exportRef, exportRecord);
    transaction.create(personalDocumentRef, {
      schoolId: input.schoolId,
      studentId: input.studentId,
      title: input.attachment.originalName,
      description: 'קובץ PDF סופי של קורות החיים',
      status: 'verified',
      attachments: [input.attachment],
      cvDocumentId: input.documentId,
      cvVersionId: input.versionId,
      createdBy: actor.uid,
      verifiedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      verifiedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await writeAuditLog({
    actorUid: actor.uid, action: 'cv.exportPdf', schoolId: input.schoolId,
    metadata: { studentId: input.studentId, documentId: input.documentId, versionId: input.versionId, exportId: input.exportId },
  });
  return { exportId: input.exportId, personalDocumentId: personalDocumentRef.id };
}

export async function recordCvAccessHandler(request) {
  const input = cvAccessSchema.parse(request.data);
  const { actor } = await authorize(request, input.schoolId, input.studentId, 'cv.view');
  await enforceRateLimit({ uid: actor.uid, action: `cv.${input.action}`, limit: 120 });
  await writeAuditLog({
    actorUid: actor.uid, action: `cv.${input.action}`, schoolId: input.schoolId,
    metadata: { studentId: input.studentId, documentId: input.documentId || '' },
  });
  return { ok: true };
}

export const createCvDocument = onCall(CALLABLE_OPTIONS, request => runSafely(createCvDocumentHandler, request));
export const saveCvDraft = onCall(CALLABLE_OPTIONS, request => runSafely(saveCvDraftHandler, request));
export const duplicateCvDocument = onCall(CALLABLE_OPTIONS, request => runSafely(duplicateCvDocumentHandler, request));
export const finalizeCvDocument = onCall(CALLABLE_OPTIONS, request => runSafely(finalizeCvDocumentHandler, request));
export const archiveCvDocument = onCall(CALLABLE_OPTIONS, request => runSafely(archiveCvDocumentHandler, request));
export const registerCvPdf = onCall(CALLABLE_OPTIONS, request => runSafely(registerCvPdfHandler, request));
export const recordCvAccess = onCall(CALLABLE_OPTIONS, request => runSafely(recordCvAccessHandler, request));
