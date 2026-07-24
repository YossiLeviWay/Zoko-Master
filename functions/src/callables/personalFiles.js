import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import {
  archivePersonalFileItemSchema,
  personalFileAccessSchema,
  upsertPersonalFileItemSchema,
  upsertSkillCatalogItemSchema,
} from '../validation/schemas.js';
import { requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { resolveActorRoleAuthority } from '../services/roleAuthorization.js';

const ITEM_PERMISSION = Object.freeze({
  documents: ['personalFile.manage'],
  credentials: ['cv.manageCredentials', 'personalFile.manage'],
  experiences: ['cv.manageExperience', 'personalFile.manage'],
  skills: ['cv.manageSkills', 'personalFile.manage'],
  recommendations: ['cv.manageRecommendations', 'personalFile.manage'],
});

async function runSafely(operation, request) {
  try {
    return await operation(request);
  } catch (error) {
    logger.error('Personal-file operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

async function getStudent(schoolId, studentId) {
  const legacy = adminDb.doc(`students_${schoolId}/${studentId}`);
  const nested = adminDb.doc(`schools/${schoolId}/students/${studentId}`);
  const [legacySnapshot, nestedSnapshot] = await adminDb.getAll(legacy, nested);
  const snapshot = legacySnapshot.exists ? legacySnapshot : nestedSnapshot;
  if (!snapshot.exists || snapshot.data().schoolId !== schoolId) throw permissionDenied();
  return { id: snapshot.id, data: snapshot.data() };
}

function permissionApplies(authority, permission, classId) {
  if (authority.unrestricted) return true;
  if (!authority.permissions.has(permission)) return false;
  const scope = authority.scopes.get(permission);
  return !scope || scope.type === 'school' || scope.classIds.includes(classId);
}

function requireOnePermission(authority, permissions, classId) {
  if (permissions.some(permission => permissionApplies(authority, permission, classId))) return;
  throw permissionDenied();
}

function personalFileRef(schoolId, studentId) {
  return adminDb.doc(`personal_files_${schoolId}/${studentId}`);
}

function itemCollection(schoolId, studentId, kind) {
  return personalFileRef(schoolId, studentId).collection(kind);
}

function assertAttachmentPaths(payload, schoolId, studentId, kind) {
  const prefix = `schools/${schoolId}/students/${studentId}/personal-file/${kind}/`;
  if ((payload.attachments || []).some(item => !item.storagePath.startsWith(prefix))) {
    throw permissionDenied();
  }
}

function itemFields(payload, actorUid) {
  const verified = payload.status === 'verified';
  return {
    ...payload,
    verifiedBy: verified ? actorUid : null,
    verifiedAt: verified ? FieldValue.serverTimestamp() : null,
    updatedBy: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function authorizeStudentAction(request, schoolId, studentId, permissions, { viewOnly = false } = {}) {
  const actor = await requireActor(request);
  if (!actor.globalAdmin && !actor.schoolIds.has(schoolId)) throw permissionDenied();
  const student = await getStudent(schoolId, studentId);
  const authority = await resolveActorRoleAuthority(actor, schoolId);
  requireOnePermission(authority, ['personalFile.view', 'personalFile.manage'], student.data.classId);
  if (!viewOnly) requireOnePermission(authority, permissions, student.data.classId);
  return { actor, student, authority };
}

export async function upsertPersonalFileItemHandler(request) {
  const input = upsertPersonalFileItemSchema.parse(request.data);
  const { actor } = await authorizeStudentAction(
    request, input.schoolId, input.studentId, ITEM_PERMISSION[input.kind],
  );
  assertAttachmentPaths(input.payload, input.schoolId, input.studentId, input.kind);
  await enforceRateLimit({ uid: actor.uid, action: `personalFile.${input.kind}.write`, limit: 60 });

  const fileRef = personalFileRef(input.schoolId, input.studentId);
  const ref = input.itemId
    ? itemCollection(input.schoolId, input.studentId, input.kind).doc(input.itemId)
    : itemCollection(input.schoolId, input.studentId, input.kind).doc();
  await adminDb.runTransaction(async transaction => {
    const fileSnapshot = await transaction.get(fileRef);
    if (!fileSnapshot.exists) throw permissionDenied();
    const existing = await transaction.get(ref);
    const fields = itemFields(input.payload, actor.uid);
    if (existing.exists) {
      const current = existing.data();
      if (current.schoolId !== input.schoolId || current.studentId !== input.studentId) throw permissionDenied();
      transaction.update(ref, fields);
    } else {
      transaction.create(ref, {
        ...fields,
        schoolId: input.schoolId,
        studentId: input.studentId,
        createdBy: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(fileRef, { updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
  });
  await writeAuditLog({
    actorUid: actor.uid,
    action: `personalFile.${input.kind}.${input.itemId ? 'update' : 'create'}`,
    schoolId: input.schoolId,
    metadata: { studentId: input.studentId, itemId: ref.id, kind: input.kind },
  });
  return { itemId: ref.id };
}

export async function archivePersonalFileItemHandler(request) {
  const input = archivePersonalFileItemSchema.parse(request.data);
  const { actor } = await authorizeStudentAction(
    request, input.schoolId, input.studentId, ITEM_PERMISSION[input.kind],
  );
  const ref = itemCollection(input.schoolId, input.studentId, input.kind).doc(input.itemId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data().studentId !== input.studentId) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: `personalFile.${input.kind}.archive`, limit: 30 });
  await ref.update({
    status: 'archived',
    archivedBy: actor.uid,
    archivedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAuditLog({
    actorUid: actor.uid,
    action: `personalFile.${input.kind}.archive`,
    schoolId: input.schoolId,
    metadata: { studentId: input.studentId, itemId: input.itemId, kind: input.kind },
  });
  return { ok: true };
}

export async function recordPersonalFileAccessHandler(request) {
  const input = personalFileAccessSchema.parse(request.data);
  const { actor } = await authorizeStudentAction(
    request, input.schoolId, input.studentId, [], { viewOnly: true },
  );
  await enforceRateLimit({ uid: actor.uid, action: `personalFile.${input.action}`, limit: 120 });
  await writeAuditLog({
    actorUid: actor.uid,
    action: `personalFile.${input.action}`,
    schoolId: input.schoolId,
    metadata: {
      studentId: input.studentId,
      kind: input.kind || '',
      itemId: input.itemId || '',
    },
  });
  return { ok: true };
}

export async function upsertSkillCatalogItemHandler(request) {
  const input = upsertSkillCatalogItemSchema.parse(request.data);
  const actor = await requireActor(request);
  if (!actor.globalAdmin && !actor.schoolIds.has(input.schoolId)) throw permissionDenied();
  const authority = await resolveActorRoleAuthority(actor, input.schoolId);
  requireOnePermission(authority, ['cv.manageSkills', 'personalFile.manage'], '');
  const ref = input.skillId
    ? adminDb.doc(`skill_catalog_${input.schoolId}/${input.skillId}`)
    : adminDb.collection(`skill_catalog_${input.schoolId}`).doc();
  const snapshot = await ref.get();
  const data = {
    schoolId: input.schoolId,
    name: input.name,
    category: input.category,
    description: input.description,
    status: input.status,
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (snapshot.exists) await ref.update(data);
  else await ref.create({ ...data, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() });
  await writeAuditLog({
    actorUid: actor.uid,
    action: 'skillCatalog.upsert',
    schoolId: input.schoolId,
    metadata: { skillId: ref.id, status: input.status },
  });
  return { skillId: ref.id };
}

export const upsertPersonalFileItem = onCall(CALLABLE_OPTIONS, request => runSafely(upsertPersonalFileItemHandler, request));
export const archivePersonalFileItem = onCall(CALLABLE_OPTIONS, request => runSafely(archivePersonalFileItemHandler, request));
export const recordPersonalFileAccess = onCall(CALLABLE_OPTIONS, request => runSafely(recordPersonalFileAccessHandler, request));
export const upsertSkillCatalogItem = onCall(CALLABLE_OPTIONS, request => runSafely(upsertSkillCatalogItemHandler, request));
