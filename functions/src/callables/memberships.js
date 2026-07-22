import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { membershipSchema } from '../validation/schemas.js';
import {
  requireActor,
  requireSchoolManager,
  requireTargetInSchool,
} from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';

async function safely(handler, request) {
  try {
    return await handler(request);
  } catch (error) {
    logger.error('School membership operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

export async function approveMembershipHandler(request) {
  const actor = await requireActor(request);
  const input = membershipSchema.parse(request.data);
  requireSchoolManager(actor, input.schoolId);
  if (actor.uid === input.userId) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'approveSchoolMembership', limit: 30 });

  const targetRef = adminDb.collection('users').doc(input.userId);
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(targetRef);
    if (!snapshot.exists) throw permissionDenied();
    const data = snapshot.data();
    if (!actor.globalAdmin && ['principal', 'global_admin'].includes(data.role)) throw permissionDenied();
    transaction.update(targetRef, {
      schoolIds: FieldValue.arrayUnion(input.schoolId),
      pendingSchools: FieldValue.arrayRemove(input.schoolId),
      schoolId: data.schoolId || input.schoolId,
      accountStatus: 'active',
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  await writeAuditLog({
    actorUid: actor.uid,
    action: 'membership.approve',
    targetUid: input.userId,
    schoolId: input.schoolId,
  });
  return { ok: true };
}

export async function removeMembershipHandler(request) {
  const actor = await requireActor(request);
  const input = membershipSchema.parse(request.data);
  requireSchoolManager(actor, input.schoolId);
  let target;
  if (input.pendingOnly) {
    if (actor.uid === input.userId) throw permissionDenied();
    const ref = adminDb.collection('users').doc(input.userId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw permissionDenied();
    const data = snapshot.data();
    if (!actor.globalAdmin && (
      ['principal', 'global_admin'].includes(data.role)
      || !(data.pendingSchools || []).includes(input.schoolId)
    )) throw permissionDenied();
    const ids = new Set(Array.isArray(data.schoolIds) ? data.schoolIds : []);
    if (data.schoolId) ids.add(data.schoolId);
    target = { ref, data, schoolIds: ids };
  } else {
    target = await requireTargetInSchool(actor, input.userId, input.schoolId);
  }
  await enforceRateLimit({ uid: actor.uid, action: 'removeSchoolMembership', limit: 30 });

  const remaining = [...target.schoolIds].filter(id => id !== input.schoolId);
  const update = input.pendingOnly
    ? { pendingSchools: FieldValue.arrayRemove(input.schoolId) }
    : {
        schoolIds: FieldValue.arrayRemove(input.schoolId),
        pendingSchools: FieldValue.arrayRemove(input.schoolId),
        schoolId: target.data.schoolId === input.schoolId ? remaining[0] || '' : target.data.schoolId || '',
        accountStatus: remaining.length > 0 ? 'active' : 'pending',
      };
  update.updatedAt = FieldValue.serverTimestamp();
  await target.ref.update(update);

  await writeAuditLog({
    actorUid: actor.uid,
    action: input.pendingOnly ? 'membership.reject' : 'membership.remove',
    targetUid: input.userId,
    schoolId: input.schoolId,
  });
  return { ok: true };
}

export const approveSchoolMembership = onCall(
  CALLABLE_OPTIONS,
  request => safely(approveMembershipHandler, request),
);
export const removeSchoolMembership = onCall(
  CALLABLE_OPTIONS,
  request => safely(removeMembershipHandler, request),
);
