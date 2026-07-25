import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { platformDirectoryQuerySchema, platformPermissionRepairSchema, platformStaffActionSchema } from '../validation/schemas.js';
import { requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { APP_BASE_URL, EMAIL_PROVIDER_API_KEY, sendPasswordResetLinkEmail } from '../services/email.js';
import { adminAuth, adminDb } from '../services/firebaseAdmin.js';
import { failedPrecondition, permissionDenied, toPublicError } from '../services/errors.js';
import { requirePlatformAdmin, requireRecentMfa } from '../services/platformSecurity.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { buildMaterializedRoleGrants } from '../services/roleAuthorization.js';

async function targetStaff(input) {
  const [user, school] = await adminDb.getAll(adminDb.doc(`users/${input.userId}`), adminDb.doc(`schools/${input.schoolId}`));
  const data = user.data();
  const schoolIds = new Set([...(data?.schoolIds || []), data?.schoolId].filter(Boolean));
  if (!user.exists || !school.exists || !schoolIds.has(input.schoolId)) throw permissionDenied();
  return { user, school, data };
}

export async function listPlatformInstitutionsHandler(request) {
  const actor = await requireActor(request);
  requirePlatformAdmin(actor);
  const input = platformDirectoryQuerySchema.parse(request.data || {});
  const snapshot = await adminDb.collection('schools').orderBy('name').limit(input.limit).get();
  return {
    institutions: snapshot.docs.map(item => {
      const data = item.data();
      return {
        id: item.id,
        name: data.name || '',
        code: data.code || '',
        status: data.status || 'active',
        primaryManagerId: data.primaryManagerId || data.principalId || '',
        managerIds: data.managerIds || [],
        activeAcademicYearId: data.activeAcademicYearId || '',
      };
    }),
  };
}

export async function listPlatformStaffHandler(request) {
  const actor = await requireActor(request);
  requirePlatformAdmin(actor);
  const input = platformDirectoryQuerySchema.parse(request.data || {});
  let query = adminDb.collection('users').limit(input.limit);
  if (input.schoolId) query = adminDb.collection('users').where('schoolIds', 'array-contains', input.schoolId).limit(input.limit);
  const snapshot = await query.get();
  const staff = snapshot.docs.filter(item => {
    const data = item.data();
    return !input.schoolId || (data.schoolIds || [data.schoolId]).includes(input.schoolId);
  }).map(item => {
    const data = item.data();
    return {
      userId: item.id,
      fullName: data.fullName || '',
      email: data.email || '',
      jobTitle: data.jobTitle || '',
      role: data.role || 'viewer',
      rolesBySchool: data.rolesBySchool || {},
      customRoleIds: data.customRoleIds || [],
      customRoleAssignments: data.customRoleAssignments || {},
      permissions: data.permissions || {},
      accountStatus: data.accountStatus || 'active',
      invitationStatus: data.invitationStatus || '',
      lastLoginAt: data.lastLoginAt || null,
      schoolIds: data.schoolIds || [data.schoolId].filter(Boolean),
    };
  });
  await writeAuditLog({ actorUid: actor.uid, actorRole: 'platform_admin', action: 'platform.staff.directory.view', targetType: 'school', targetId: input.schoolId || 'all', reason: 'support-directory', after: { resultCount: staff.length }, collectionName: 'platformAuditLogs' });
  return { staff };
}

export async function platformStaffActionHandler(request) {
  const actor = await requireActor(request);
  requirePlatformAdmin(actor);
  requireRecentMfa(request);
  const input = platformStaffActionSchema.parse(request.data);
  if (input.userId === actor.uid) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: `platform.staff.${input.action}`, limit: 15, windowSeconds: 3600 });
  const target = await targetStaff(input);
  const authUser = await adminAuth.getUser(input.userId);
  const beforeStatus = target.data.accountStatus || 'active';
  if (input.action === 'send_password_reset') {
    const resetLink = await adminAuth.generatePasswordResetLink(authUser.email, { url: `${APP_BASE_URL.value().replace(/\/$/, '')}/#/login` });
    await sendPasswordResetLinkEmail({ email: authUser.email, fullName: target.data.fullName || authUser.displayName || '', resetLink });
    if (input.revokeSessions) await adminAuth.revokeRefreshTokens(input.userId);
  } else if (input.action === 'revoke_sessions') {
    await adminAuth.revokeRefreshTokens(input.userId);
  } else {
    const disabled = input.action === 'disable_account';
    await adminAuth.updateUser(input.userId, { disabled });
    if (disabled) await adminAuth.revokeRefreshTokens(input.userId);
    await target.user.ref.update({ accountStatus: disabled ? 'disabled' : 'active', updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
    if (disabled) {
      await adminDb.doc(`platformForumMemberships/${input.userId}`).set({ status: 'revoked', permissions: [], revokedBy: actor.uid, revokeReason: 'account-disabled', revokedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  }
  await writeAuditLog({
    actorUid: actor.uid,
    actorRole: 'platform_admin',
    action: `platform.staff.${input.action}`,
    targetUid: input.userId,
    targetType: 'staffAccount',
    targetId: input.userId,
    schoolId: input.schoolId,
    reason: input.reason,
    before: { accountStatus: beforeStatus },
    after: { accountStatus: input.action === 'disable_account' ? 'disabled' : input.action === 'enable_account' ? 'active' : beforeStatus, sessionsRevoked: input.revokeSessions || ['revoke_sessions', 'disable_account'].includes(input.action) },
    collectionName: 'platformAuditLogs',
  });
  return { ok: true };
}

export async function repairPlatformStaffPermissionsHandler(request) {
  const actor = await requireActor(request);
  requirePlatformAdmin(actor);
  requireRecentMfa(request);
  const input = platformPermissionRepairSchema.parse(request.data);
  if (input.userId === actor.uid) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'platform.permissions.repair', limit: 20, windowSeconds: 3600 });
  const target = await targetStaff(input);
  if (['platform_admin', 'global_admin'].includes(target.data.role)) throw permissionDenied();
  if (input.customRoleIds.length) {
    const nested = await adminDb.getAll(...input.customRoleIds.map(id => adminDb.doc(`schools/${input.schoolId}/roleDefinitions/${id}`)));
    const legacy = await adminDb.getAll(...input.customRoleIds.map(id => adminDb.doc(`roles_${input.schoolId}/${id}`)));
    if (input.customRoleIds.some((id, index) => {
      const snapshot = nested[index].exists ? nested[index] : legacy[index];
      return !snapshot.exists || snapshot.data().status === 'archived' || snapshot.data().protected === true;
    })) throw failedPrecondition();
  }
  const materialized = await buildMaterializedRoleGrants(input.customRoleIds, input.schoolId);
  const assignments = { ...(target.data.customRoleAssignments || {}), [input.schoolId]: input.customRoleIds };
  const rolePermissions = { ...(target.data.rolePermissionsBySchool || {}), [input.schoolId]: materialized.permissions };
  const classPermissions = { ...(target.data.classRolePermissionsBySchool || {}), [input.schoolId]: materialized.classPermissions };
  await target.user.ref.update({ customRoleAssignments: assignments, customRoleIds: input.customRoleIds, rolePermissionsBySchool: rolePermissions, classRolePermissionsBySchool: classPermissions, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
  await writeAuditLog({ actorUid: actor.uid, actorRole: 'platform_admin', action: 'platform.permissions.repair', targetUid: input.userId, targetType: 'staffPermissions', targetId: input.userId, schoolId: input.schoolId, reason: input.reason, before: { roleCount: (target.data.customRoleAssignments?.[input.schoolId] || []).length }, after: { roleCount: input.customRoleIds.length }, collectionName: 'platformAuditLogs' });
  return { ok: true };
}

async function runSafely(handler, request) {
  try { return await handler(request); }
  catch (error) {
    logger.error('Platform administration operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

const PLATFORM_EMAIL_OPTIONS = { ...CALLABLE_OPTIONS, secrets: [EMAIL_PROVIDER_API_KEY] };
export const listPlatformInstitutions = onCall(CALLABLE_OPTIONS, request => runSafely(listPlatformInstitutionsHandler, request));
export const listPlatformStaff = onCall(CALLABLE_OPTIONS, request => runSafely(listPlatformStaffHandler, request));
export const platformStaffAction = onCall(PLATFORM_EMAIL_OPTIONS, request => runSafely(platformStaffActionHandler, request));
export const repairPlatformStaffPermissions = onCall(CALLABLE_OPTIONS, request => runSafely(repairPlatformStaffPermissionsHandler, request));
