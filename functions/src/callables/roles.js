import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import {
  assignCustomRoleSchema,
  cloneCustomRoleSchema,
  createCustomRoleSchema,
  roleIdSchema,
  updateCustomRoleSchema,
} from '../validation/schemas.js';
import { requireActor, requireTargetInSchool, assertReferencesBelongToSchool } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import {
  assertRoleCanBeGranted,
  buildMaterializedRoleGrants,
  customRoleCollection,
  getRole,
  refreshRoleHolders,
  requireRoleAction,
  resolveActorRoleAuthority,
  canGrantRole,
} from '../services/roleAuthorization.js';

async function runSafely(operation, request) {
  try {
    return await operation(request);
  } catch (error) {
    logger.error('Role operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

function roleFields(input, actorUid) {
  const permissions = Object.fromEntries(Object.entries(input.permissions).filter(([, value]) => value === true));
  const delegatedPermissionKeys = (input.delegatedPermissionKeys || []).filter(key => permissions[key] === true);
  return {
    schoolId: input.schoolId,
    name: input.name,
    description: input.description,
    permissions,
    delegatedPermissionKeys,
    accessScope: input.accessScope || { type: 'school', classIds: [] },
    scopes: input.accessScope || { type: 'school', classIds: [] },
    icon: input.icon || 'shield',
    color: input.color || '#2563eb',
    delegable: input.delegable === true,
    assignableBy: input.assignableBy || [],
    defaultForInvites: input.defaultForInvites === true,
    protected: false,
    legacy: false,
    version: 1,
    updatedBy: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function validateClassScope(input) {
  if (input.accessScope.type === 'classes') {
    await assertReferencesBelongToSchool(input.schoolId, 'classes', input.accessScope.classIds);
  }
}

export async function createCustomRoleHandler(request) {
  const actor = await requireActor(request);
  const input = createCustomRoleSchema.parse(request.data);
  const authority = await resolveActorRoleAuthority(actor, input.schoolId);
  requireRoleAction(authority, 'roles.create');
  assertRoleCanBeGranted(authority, input);
  await validateClassScope(input);
  await enforceRateLimit({ uid: actor.uid, action: 'roles.create', limit: 20 });
  const ref = customRoleCollection(input.schoolId).doc();
  const fields = {
    ...roleFields(input, actor.uid),
    status: 'active',
    createdBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
  };
  const batch = adminDb.batch();
  batch.create(ref, fields);
  batch.create(adminDb.doc(`schools/${input.schoolId}/roleDefinitions/${ref.id}`), fields);
  await batch.commit();
  await writeAuditLog({ actorUid: actor.uid, action: 'role.create', schoolId: input.schoolId, metadata: { roleId: ref.id } });
  return { roleId: ref.id };
}

export async function updateCustomRoleHandler(request) {
  const actor = await requireActor(request);
  const input = updateCustomRoleSchema.parse(request.data);
  const authority = await resolveActorRoleAuthority(actor, input.schoolId);
  requireRoleAction(authority, 'roles.update');
  assertRoleCanBeGranted(authority, input);
  await validateClassScope(input);
  const role = await getRole(input.roleId, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: 'roles.update', limit: 30 });
  const fields = roleFields(input, actor.uid);
  const batch = adminDb.batch();
  batch.set(customRoleCollection(input.schoolId).doc(role.id), fields, { merge: true });
  batch.set(adminDb.doc(`schools/${input.schoolId}/roleDefinitions/${role.id}`), fields, { merge: true });
  await batch.commit();
  const affectedUserCount = await refreshRoleHolders(role.id, input.schoolId);
  await writeAuditLog({ actorUid: actor.uid, action: 'role.update', schoolId: input.schoolId, metadata: { roleId: role.id, affectedUserCount } });
  return { ok: true };
}

export async function archiveCustomRoleHandler(request) {
  const actor = await requireActor(request);
  const input = roleIdSchema.parse(request.data);
  const authority = await resolveActorRoleAuthority(actor, input.schoolId);
  requireRoleAction(authority, 'roles.archive');
  const role = await getRole(input.roleId, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: 'roles.archive', limit: 15 });
  if (role.data.protected === true) throw permissionDenied();
  const archived = { status: 'archived', active: false, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() };
  const batch = adminDb.batch();
  batch.set(customRoleCollection(input.schoolId).doc(role.id), archived, { merge: true });
  batch.set(adminDb.doc(`schools/${input.schoolId}/roleDefinitions/${role.id}`), archived, { merge: true });
  await batch.commit();
  const affectedUserCount = await refreshRoleHolders(role.id, input.schoolId);
  await writeAuditLog({ actorUid: actor.uid, action: 'role.archive', schoolId: input.schoolId, metadata: { roleId: role.id, affectedUserCount } });
  return { ok: true };
}

export async function cloneCustomRoleHandler(request) {
  const actor = await requireActor(request);
  const input = cloneCustomRoleSchema.parse(request.data);
  const authority = await resolveActorRoleAuthority(actor, input.schoolId);
  requireRoleAction(authority, 'roles.update');
  const source = await getRole(input.roleId, input.schoolId);
  const cloneInput = {
    ...source.data,
    name: input.name,
    schoolId: input.schoolId,
    accessScope: source.data.accessScope || { type: 'school', classIds: [] },
    delegatedPermissionKeys: source.data.delegatedPermissionKeys || [],
  };
  assertRoleCanBeGranted(authority, cloneInput);
  await validateClassScope(cloneInput);
  const ref = customRoleCollection(input.schoolId).doc();
  const fields = {
    ...roleFields(cloneInput, actor.uid),
    status: 'active', createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(),
  };
  const batch = adminDb.batch();
  batch.create(ref, fields);
  batch.create(adminDb.doc(`schools/${input.schoolId}/roleDefinitions/${ref.id}`), fields);
  await batch.commit();
  await writeAuditLog({ actorUid: actor.uid, action: 'role.clone', schoolId: input.schoolId, metadata: { roleId: ref.id, sourceRoleId: source.id } });
  return { roleId: ref.id };
}

export async function assignCustomRoleHandler(request) {
  const actor = await requireActor(request);
  const input = assignCustomRoleSchema.parse(request.data);
  const authority = await resolveActorRoleAuthority(actor, input.schoolId);
  requireRoleAction(authority, 'roles.assign');
  const role = await getRole(input.roleId, input.schoolId);
  if (role.data.status === 'archived') throw permissionDenied();
  const target = await requireTargetInSchool(actor, input.userId, input.schoolId);
  if (!canGrantRole({ authority, actor, target, role: { id: role.id, ...role.data, schoolId: input.schoolId } })) {
    throw permissionDenied();
  }
  await enforceRateLimit({ uid: actor.uid, action: 'roles.assign', limit: 30 });
  const assignments = target.data.customRoleAssignments || {};
  const currentIds = Array.isArray(assignments[input.schoolId])
    ? assignments[input.schoolId]
    : Array.isArray(target.data.customRoleIds) ? target.data.customRoleIds : [];
  const nextIds = input.action === 'assign'
    ? [...new Set([...currentIds, input.roleId])]
    : currentIds.filter(roleId => roleId !== input.roleId);
  const materialized = await buildMaterializedRoleGrants(nextIds, input.schoolId);
  const nextAssignments = { ...assignments, [input.schoolId]: nextIds };
  const allRoleIds = [...new Set(Object.values(nextAssignments).flatMap(value => (
    Array.isArray(value) ? value : []
  )))];
  const batch = adminDb.batch();
  batch.update(target.ref, {
    customRoleIds: allRoleIds,
    customRoleAssignments: nextAssignments,
    rolePermissionsBySchool: {
      ...(target.data.rolePermissionsBySchool || {}),
      [input.schoolId]: materialized.permissions,
    },
    classRolePermissionsBySchool: {
      ...(target.data.classRolePermissionsBySchool || {}),
      [input.schoolId]: materialized.classPermissions,
    },
    updatedAt: FieldValue.serverTimestamp(),
  });
  const assignmentRef = adminDb.doc(`schools/${input.schoolId}/roleAssignments/${input.userId}_${input.roleId}`);
  batch.set(assignmentRef, {
    userId: input.userId,
    roleId: input.roleId,
    schoolId: input.schoolId,
    scopeOverrides: {},
    assignedBy: actor.uid,
    assignedAt: FieldValue.serverTimestamp(),
    active: input.action === 'assign',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  await writeAuditLog({
    actorUid: actor.uid,
    action: input.action === 'assign' ? 'role.assign' : 'role.remove',
    targetUid: input.userId,
    schoolId: input.schoolId,
    metadata: { roleId: role.id },
  });
  return { ok: true };
}

export const createCustomRole = onCall(CALLABLE_OPTIONS, request => runSafely(createCustomRoleHandler, request));
export const updateCustomRole = onCall(CALLABLE_OPTIONS, request => runSafely(updateCustomRoleHandler, request));
export const archiveCustomRole = onCall(CALLABLE_OPTIONS, request => runSafely(archiveCustomRoleHandler, request));
export const cloneCustomRole = onCall(CALLABLE_OPTIONS, request => runSafely(cloneCustomRoleHandler, request));
export const assignCustomRole = onCall(CALLABLE_OPTIONS, request => runSafely(assignCustomRoleHandler, request));
