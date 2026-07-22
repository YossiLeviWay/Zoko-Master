import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { requireActor, requireSchoolManager } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { failedPrecondition, permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import {
  createSchoolSchema,
  deleteSchoolSchema,
  updateSchoolSchema,
} from '../validation/schemas.js';

const LEGACY_SCHOOL_RESOURCES = [
  'tasks', 'students', 'files', 'file_history', 'folders', 'teams', 'events',
  'holidays', 'categories', 'roles', 'tracks', 'settings', 'sheets',
];

async function runSafely(handler, request) {
  try {
    return await handler(request);
  } catch (error) {
    logger.error('School administration operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

export async function createSchoolHandler(request) {
  const actor = await requireActor(request);
  if (!actor.globalAdmin) throw permissionDenied();
  const input = createSchoolSchema.parse(request.data);
  await enforceRateLimit({ uid: actor.uid, action: 'createSchool', limit: 5 });
  const ref = adminDb.collection('schools').doc();
  await ref.create({
    ...input,
    principalId: '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAuditLog({
    actorUid: actor.uid,
    action: 'school.create',
    schoolId: ref.id,
  });
  return { schoolId: ref.id };
}

export async function updateSchoolHandler(request) {
  const actor = await requireActor(request);
  const input = updateSchoolSchema.parse(request.data);
  requireSchoolManager(actor, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: 'updateSchool', limit: 20 });
  const ref = adminDb.collection('schools').doc(input.schoolId);
  if (!(await ref.get()).exists) throw failedPrecondition();
  await ref.update({
    name: input.name,
    address: input.address,
    phone: input.phone,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAuditLog({
    actorUid: actor.uid,
    action: 'school.update',
    schoolId: input.schoolId,
  });
  return { ok: true };
}

async function schoolHasData(schoolId, schoolRef) {
  const [primaryUsers, additionalUsers, nestedCollections, ...legacySnapshots] = await Promise.all([
    adminDb.collection('users').where('schoolId', '==', schoolId).limit(1).get(),
    adminDb.collection('users').where('schoolIds', 'array-contains', schoolId).limit(1).get(),
    schoolRef.listCollections(),
    ...LEGACY_SCHOOL_RESOURCES.map(resource => (
      adminDb.collection(`${resource}_${schoolId}`).limit(1).get()
    )),
  ]);
  if (!primaryUsers.empty || !additionalUsers.empty || legacySnapshots.some(snapshot => !snapshot.empty)) {
    return true;
  }
  const nestedSnapshots = await Promise.all(nestedCollections.map(collectionRef => collectionRef.limit(1).get()));
  return nestedSnapshots.some(snapshot => !snapshot.empty);
}

export async function deleteSchoolHandler(request) {
  const actor = await requireActor(request);
  if (!actor.globalAdmin) throw permissionDenied();
  const input = deleteSchoolSchema.parse(request.data);
  await enforceRateLimit({ uid: actor.uid, action: 'deleteSchool', limit: 3 });
  const ref = adminDb.collection('schools').doc(input.schoolId);
  if (!(await ref.get()).exists || await schoolHasData(input.schoolId, ref)) throw failedPrecondition();
  await ref.delete();
  await writeAuditLog({
    actorUid: actor.uid,
    action: 'school.delete',
    schoolId: input.schoolId,
  });
  return { ok: true };
}

export const createSchool = onCall(CALLABLE_OPTIONS, request => runSafely(createSchoolHandler, request));
export const updateSchool = onCall(CALLABLE_OPTIONS, request => runSafely(updateSchoolHandler, request));
export const deleteSchool = onCall(CALLABLE_OPTIONS, request => runSafely(deleteSchoolHandler, request));
