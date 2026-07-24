import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import {
  createStaffSchema,
  deleteStaffSchema,
  passwordResetSchema,
  setRoleSchema,
  updateStaffSchema,
} from '../validation/schemas.js';
import {
  assertReferencesBelongToSchool,
  requireActor,
  requireSchoolManager,
  requireTargetInSchool,
} from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminAuth, adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { createInvitationRecord } from '../services/invitations.js';
import { EMAIL_PROVIDER_API_KEY, APP_BASE_URL, sendPasswordResetLinkEmail } from '../services/email.js';
import {
  assertNotLastGlobalAdmin,
  ensurePrincipalCanGrantRole,
  setGlobalAdminClaim,
} from '../services/userManagement.js';

async function runSafely(operation, request) {
  try {
    return await operation(request);
  } catch (error) {
    logger.error('Privileged user operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

export async function createStaffHandler(request) {
  const actor = await requireActor(request);
  const input = createStaffSchema.parse(request.data);
  requireSchoolManager(actor, input.schoolId);
  ensurePrincipalCanGrantRole(actor, input.role);
  await enforceRateLimit({ uid: actor.uid, action: 'createStaffUser', limit: 10 });

  return createInvitationRecord({ actor, ...input });
}

export async function updateStaffHandler(request) {
  const actor = await requireActor(request);
  const input = updateStaffSchema.parse(request.data);
  requireSchoolManager(actor, input.schoolId);
  const target = await requireTargetInSchool(actor, input.userId, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: 'updateStaffUser', limit: 30 });

  if (input.customRoleIds) {
    await assertReferencesBelongToSchool(input.schoolId, 'roles', input.customRoleIds);
  }
  if (input.teamIds) {
    await assertReferencesBelongToSchool(input.schoolId, 'teams', input.teamIds);
  }

  const authUpdate = {};
  if (input.email && input.email !== target.auth.email) authUpdate.email = input.email;
  if (input.fullName && input.fullName !== target.auth.displayName) authUpdate.displayName = input.fullName;
  if (Object.keys(authUpdate).length > 0) await adminAuth.updateUser(input.userId, authUpdate);

  const allowedFields = ['fullName', 'email', 'phone', 'jobTitle', 'customRoleIds', 'teamIds', 'permissions'];
  const update = Object.fromEntries(
    allowedFields.filter(field => input[field] !== undefined).map(field => [field, input[field]]),
  );
  update.updatedAt = FieldValue.serverTimestamp();
  await target.ref.update(update);

  await writeAuditLog({
    actorUid: actor.uid,
    action: 'staff.update',
    targetUid: input.userId,
    schoolId: input.schoolId,
    metadata: { changedFieldCount: Object.keys(update).length - 1 },
  });
  return { ok: true };
}

export async function deleteStaffHandler(request) {
  const actor = await requireActor(request);
  const input = deleteStaffSchema.parse(request.data);
  requireSchoolManager(actor, input.schoolId);
  if (actor.uid === input.userId) throw permissionDenied();
  const target = await requireTargetInSchool(actor, input.userId, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: 'deleteStaffUser', limit: 5 });
  await assertNotLastGlobalAdmin(input.userId);

  await target.ref.update({ accountStatus: 'deleting', updatedAt: FieldValue.serverTimestamp() });
  await writeAuditLog({
    actorUid: actor.uid,
    action: 'staff.delete',
    targetUid: input.userId,
    schoolId: input.schoolId,
  });
  await adminAuth.revokeRefreshTokens(input.userId);
  await adminAuth.deleteUser(input.userId);
  await target.ref.delete();
  return { ok: true };
}

export async function setRoleHandler(request) {
  const actor = await requireActor(request);
  const input = setRoleSchema.parse(request.data);
  requireSchoolManager(actor, input.schoolId);
  const target = await requireTargetInSchool(actor, input.userId, input.schoolId);
  ensurePrincipalCanGrantRole(actor, input.role);
  await enforceRateLimit({ uid: actor.uid, action: 'setUserRole', limit: 15 });

  const currentlyGlobal = target.auth.customClaims?.global_admin === true;
  const nextGlobal = input.role === 'global_admin';
  if ((currentlyGlobal || nextGlobal) && !actor.globalAdmin) throw permissionDenied();
  if (currentlyGlobal && !nextGlobal) {
    if (actor.uid === input.userId) throw permissionDenied();
    await assertNotLastGlobalAdmin(input.userId);
  }
  if (currentlyGlobal !== nextGlobal) await setGlobalAdminClaim(input.userId, nextGlobal);

  const batch = adminDb.batch();
  batch.update(target.ref, {
    role: input.role,
    updatedAt: FieldValue.serverTimestamp(),
    ...(input.role === 'principal' ? {
      schoolId: input.schoolId,
      schoolIds: FieldValue.arrayUnion(input.schoolId),
    } : {}),
  });
  if (input.assignAsPrincipal && input.role === 'principal') {
    batch.update(adminDb.collection('schools').doc(input.schoolId), {
      principalId: input.userId,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  await writeAuditLog({
    actorUid: actor.uid,
    action: 'staff.role.set',
    targetUid: input.userId,
    schoolId: input.schoolId,
    metadata: { role: input.role },
  });
  return { ok: true, tokenRefreshRequired: currentlyGlobal !== nextGlobal };
}

export async function requestPasswordResetHandler(request) {
  const actor = await requireActor(request);
  const input = passwordResetSchema.parse(request.data);
  requireSchoolManager(actor, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: 'requestStaffPasswordReset', limit: 10 });
  const target = await requireTargetInSchool(actor, input.userId, input.schoolId);
  const resetLink = await adminAuth.generatePasswordResetLink(target.auth.email, {
    url: `${APP_BASE_URL.value().replace(/\/$/, '')}/#/login`,
  });
  await sendPasswordResetLinkEmail({ email: target.auth.email, fullName: target.data.fullName, resetLink });
  await writeAuditLog({
    actorUid: actor.uid,
    action: 'staff.password_reset.request',
    targetUid: input.userId,
    schoolId: input.schoolId,
  });
  return { ok: true };
}

const STAFF_EMAIL_OPTIONS = { ...CALLABLE_OPTIONS, secrets: [EMAIL_PROVIDER_API_KEY] };
export const createStaffUser = onCall(STAFF_EMAIL_OPTIONS, request => runSafely(createStaffHandler, request));
export const updateStaffUser = onCall(CALLABLE_OPTIONS, request => runSafely(updateStaffHandler, request));
export const deleteStaffUser = onCall(CALLABLE_OPTIONS, request => runSafely(deleteStaffHandler, request));
export const setUserRole = onCall(CALLABLE_OPTIONS, request => runSafely(setRoleHandler, request));
export const requestStaffPasswordReset = onCall(STAFF_EMAIL_OPTIONS, request => runSafely(requestPasswordResetHandler, request));
