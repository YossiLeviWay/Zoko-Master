import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import {
  permissionDelegationSchema,
  permissionPreviewSchema,
  previewAccessSchema,
  removeResourceAclSchema,
  resourceAclSchema,
} from '../validation/schemas.js';
import {
  assertReferencesBelongToSchool,
  requireActor,
  requireTargetInSchool,
} from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { getRole, requireRoleAction, resolveActorRoleAuthority } from '../services/roleAuthorization.js';
import { buildPermissionContext, evaluatePermission } from '../services/permissionEngine.js';

const RESOURCE_COLLECTIONS = Object.freeze({
  file: 'files', folder: 'folders', task: 'tasks', team: 'teams', student: 'students',
});
const RESOURCE_MANAGEMENT_CAPABILITIES = Object.freeze({
  file: 'files.managePermissions',
  folder: 'files.managePermissions',
  task: 'tasks.managePermissions',
  team: 'roles.manage',
  student: 'students.managePersonalFile',
});

async function runSafely(operation, request) {
  try {
    return await operation(request);
  } catch (error) {
    logger.error('Permission operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

async function requireCapability(actor, schoolId, capability) {
  const authority = await resolveActorRoleAuthority(actor, schoolId);
  requireRoleAction(authority, capability);
  return authority;
}

async function assertResourceExists(schoolId, type, resourceId) {
  const collectionName = RESOURCE_COLLECTIONS[type];
  const [nested, legacy] = await adminDb.getAll(
    adminDb.doc(`schools/${schoolId}/${collectionName}/${resourceId}`),
    adminDb.doc(`${collectionName}_${schoolId}/${resourceId}`),
  );
  if (!nested.exists && !legacy.exists) throw permissionDenied();
}

async function assertPrincipalExists(actor, input) {
  if (input.principalType === 'user') {
    await requireTargetInSchool(actor, input.principalId, input.schoolId, { allowSelf: true });
    return;
  }
  if (input.principalType === 'role') {
    await getRole(input.principalId, input.schoolId);
    return;
  }
  await assertReferencesBelongToSchool(
    input.schoolId,
    input.principalType === 'team' ? 'teams' : 'classes',
    [input.principalId],
  );
}

function policyField(acl, denied = false) {
  const prefix = denied ? 'denied' : 'allowed';
  const suffix = { user: 'Users', team: 'Teams', role: 'Roles', class: 'Classes' }[acl.principalType];
  return `${prefix}${suffix}`;
}

async function rebuildAclPolicy(schoolId, resourceType, resourceId) {
  const snapshot = await adminDb.collection(`schools/${schoolId}/resourceAcls`)
    .where('resourceType', '==', resourceType).where('resourceId', '==', resourceId).get();
  const levels = ['view', 'comment', 'edit', 'manage'];
  const policy = { configured: false };
  levels.forEach(level => {
    policy[level] = {
      allowedUsers: [], allowedTeams: [], allowedRoles: [], allowedClasses: [],
      deniedUsers: [], deniedTeams: [], deniedRoles: [], deniedClasses: [],
    };
  });
  snapshot.docs.map(item => item.data()).filter(item => item.active !== false).forEach(acl => {
    policy.configured = true;
    const field = policyField(acl, acl.explicitDeny === true);
    const targetLevels = acl.explicitDeny === true
      ? levels
      : levels.filter(level => LEVEL_ORDER[level] <= LEVEL_ORDER[acl.accessLevel]);
    targetLevels.forEach(level => policy[level][field].push(acl.principalId));
  });
  await adminDb.doc(`schools/${schoolId}/resourceAclPolicies/${resourceType}_${resourceId}`).set({
    schoolId, resourceType, resourceId, ...policy, updatedAt: FieldValue.serverTimestamp(),
  });
}

const LEVEL_ORDER = Object.freeze({ view: 1, comment: 2, edit: 3, manage: 4 });

export async function upsertResourceAclHandler(request) {
  const actor = await requireActor(request);
  const input = resourceAclSchema.parse(request.data);
  await requireCapability(actor, input.schoolId, RESOURCE_MANAGEMENT_CAPABILITIES[input.resourceType]);
  await enforceRateLimit({ uid: actor.uid, action: 'resourceAcl.upsert', limit: 50 });
  await Promise.all([
    assertResourceExists(input.schoolId, input.resourceType, input.resourceId),
    assertPrincipalExists(actor, input),
  ]);
  const ref = input.aclId
    ? adminDb.doc(`schools/${input.schoolId}/resourceAcls/${input.aclId}`)
    : adminDb.collection(`schools/${input.schoolId}/resourceAcls`).doc();
  if (input.aclId) {
    const existing = await ref.get();
    if (!existing.exists || existing.data().schoolId !== input.schoolId) throw permissionDenied();
  }
  await ref.set({
    schoolId: input.schoolId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    principalType: input.principalType,
    principalId: input.principalId,
    accessLevel: input.accessLevel,
    explicitDeny: input.explicitDeny,
    inherit: input.inherit,
    grantedBy: actor.uid,
    expiresAt: input.expiresAt ? Timestamp.fromDate(new Date(input.expiresAt)) : null,
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await rebuildAclPolicy(input.schoolId, input.resourceType, input.resourceId);
  await writeAuditLog({
    actorUid: actor.uid,
    action: input.explicitDeny ? 'resourceAcl.deny' : 'resourceAcl.grant',
    schoolId: input.schoolId,
    metadata: { aclId: ref.id, resourceType: input.resourceType, accessLevel: input.accessLevel },
  });
  return { aclId: ref.id };
}

export async function removeResourceAclHandler(request) {
  const actor = await requireActor(request);
  const input = removeResourceAclSchema.parse(request.data);
  const ref = adminDb.doc(`schools/${input.schoolId}/resourceAcls/${input.aclId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data().schoolId !== input.schoolId) throw permissionDenied();
  await requireCapability(
    actor,
    input.schoolId,
    RESOURCE_MANAGEMENT_CAPABILITIES[snapshot.data().resourceType],
  );
  await ref.update({ active: false, revokedBy: actor.uid, revokedAt: FieldValue.serverTimestamp() });
  await rebuildAclPolicy(input.schoolId, snapshot.data().resourceType, snapshot.data().resourceId);
  await writeAuditLog({ actorUid: actor.uid, action: 'resourceAcl.revoke', schoolId: input.schoolId, metadata: { aclId: input.aclId } });
  return { ok: true };
}

export async function setPermissionDelegationHandler(request) {
  const actor = await requireActor(request);
  const input = permissionDelegationSchema.parse(request.data);
  const authority = await requireCapability(actor, input.schoolId, 'roles.delegateAssignments');
  await requireTargetInSchool(actor, input.delegateUserId, input.schoolId, { allowSelf: false });
  const roles = await Promise.all(input.assignableRoleIds.map(roleId => getRole(roleId, input.schoolId)));
  if (!authority.unrestricted) {
    const ceiling = new Set(input.maximumPermissions);
    const roleKeys = roles.flatMap(role => Object.entries(role.data.permissions || {})
      .filter(([, enabled]) => enabled === true).map(([key]) => key));
    if (roleKeys.some(key => !ceiling.has(key) || !authority.permissions.has(key))) throw permissionDenied();
  }
  const ref = input.delegationId
    ? adminDb.doc(`schools/${input.schoolId}/permissionDelegations/${input.delegationId}`)
    : adminDb.collection(`schools/${input.schoolId}/permissionDelegations`).doc();
  await ref.set({
    schoolId: input.schoolId,
    delegateUserId: input.delegateUserId,
    assignableRoleIds: input.assignableRoleIds,
    maximumPermissions: input.maximumPermissions,
    createdBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt: input.expiresAt ? Timestamp.fromDate(new Date(input.expiresAt)) : null,
    active: input.active,
  }, { merge: true });
  await writeAuditLog({ actorUid: actor.uid, action: 'permissionDelegation.set', targetUid: input.delegateUserId, schoolId: input.schoolId, metadata: { delegationId: ref.id } });
  return { delegationId: ref.id };
}

export async function startPermissionPreviewHandler(request) {
  const actor = await requireActor(request);
  const input = permissionPreviewSchema.parse(request.data);
  await requireCapability(actor, input.schoolId, 'institution.permissionPreview');
  const target = await requireTargetInSchool(actor, input.targetUserId, input.schoolId, { allowSelf: false });
  await enforceRateLimit({ uid: actor.uid, action: 'permissionPreview.start', limit: 20 });
  const context = await buildPermissionContext({ userId: input.targetUserId, schoolId: input.schoolId });
  const expiresAt = Timestamp.fromMillis(Date.now() + (15 * 60 * 1000));
  const ref = adminDb.collection(`schools/${input.schoolId}/permissionPreviewSessions`).doc();
  await ref.create({
    schoolId: input.schoolId,
    actorUid: actor.uid,
    targetUserId: input.targetUserId,
    readOnly: true,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });
  await writeAuditLog({ actorUid: actor.uid, action: 'permissionPreview.start', targetUid: input.targetUserId, schoolId: input.schoolId, metadata: { sessionId: ref.id } });
  return {
    sessionId: ref.id,
    expiresAt: expiresAt.toDate().toISOString(),
    target: { userId: input.targetUserId, fullName: target.data.fullName || '' },
    roles: context.roles.map(role => ({ id: role.id, name: role.name || role.displayName || '', scope: role.scopes || role.accessScope || { type: 'school' } })),
    capabilities: context.capabilityGrants.map(grant => ({ capability: grant.capability, scope: grant.scope, source: grant.source })),
    readOnly: true,
  };
}

export async function evaluatePreviewAccessHandler(request) {
  const actor = await requireActor(request);
  const input = previewAccessSchema.parse(request.data);
  const session = await adminDb.doc(`schools/${input.schoolId}/permissionPreviewSessions/${input.sessionId}`).get();
  if (!session.exists) throw permissionDenied();
  const data = session.data();
  if (data.actorUid !== actor.uid || data.readOnly !== true || data.expiresAt.toMillis() <= Date.now()) throw permissionDenied();
  const resource = input.resourceType ? {
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    parentIds: input.resource.parentIds || [],
  } : null;
  const context = await buildPermissionContext({ userId: data.targetUserId, schoolId: input.schoolId, resource });
  return evaluatePermission(context, {
    capability: input.capability,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    accessLevel: input.accessLevel,
    resource: { ...input.resource, resourceId: input.resourceId },
  });
}

export const upsertResourceAcl = onCall(CALLABLE_OPTIONS, request => runSafely(upsertResourceAclHandler, request));
export const removeResourceAcl = onCall(CALLABLE_OPTIONS, request => runSafely(removeResourceAclHandler, request));
export const setPermissionDelegation = onCall(CALLABLE_OPTIONS, request => runSafely(setPermissionDelegationHandler, request));
export const startPermissionPreview = onCall(CALLABLE_OPTIONS, request => runSafely(startPermissionPreviewHandler, request));
export const evaluatePreviewAccess = onCall(CALLABLE_OPTIONS, request => runSafely(evaluatePreviewAccessHandler, request));
