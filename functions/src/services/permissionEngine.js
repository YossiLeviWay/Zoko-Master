import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';

const LEVELS = Object.freeze({ view: 1, comment: 2, edit: 3, manage: 4 });
const PROTECTED_ROLES = new Set(['principal', 'institution_manager']);

function timestampMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function activeAt(record, nowMs) {
  if (record?.active === false || record?.status === 'archived') return false;
  const expiresAt = timestampMillis(record?.expiresAt);
  return expiresAt === null || expiresAt > nowMs;
}

function enabledKeys(permissions = {}) {
  if (Array.isArray(permissions)) return permissions.filter(value => typeof value === 'string');
  return Object.entries(permissions).filter(([, enabled]) => enabled === true).map(([key]) => key);
}

export function normalizeScope(scope = {}) {
  const type = ['school', 'self', 'classes', 'grades', 'tracks', 'teams', 'resources'].includes(scope.type)
    ? scope.type
    : 'school';
  const values = scope.values || scope.classIds || scope.gradeIds || scope.trackIds || scope.teamIds || scope.resourceIds || [];
  return { type, values: [...new Set(Array.isArray(values) ? values.filter(Boolean) : [])] };
}

export function scopeAllows(scope, resource = {}, subjectUid = '') {
  const normalized = normalizeScope(scope);
  if (normalized.type === 'school') return true;
  if (normalized.type === 'self') return resource.ownerId === subjectUid || resource.userId === subjectUid;
  const field = {
    classes: 'classId', grades: 'gradeId', tracks: 'trackId', teams: 'teamId', resources: 'resourceId',
  }[normalized.type];
  const candidate = resource[field];
  if (Array.isArray(candidate)) return candidate.some(value => normalized.values.includes(value));
  return typeof candidate === 'string' && normalized.values.includes(candidate);
}

function principalMatches(acl, subject) {
  if (acl.principalType === 'user') return acl.principalId === subject.uid;
  if (acl.principalType === 'team') return subject.teamIds.includes(acl.principalId);
  if (acl.principalType === 'role') return subject.roleIds.includes(acl.principalId);
  if (acl.principalType === 'class') return subject.classIds.includes(acl.principalId);
  return false;
}

function aclAllows(acl, requestedLevel) {
  return (LEVELS[acl.accessLevel] || 0) >= (LEVELS[requestedLevel] || 1);
}

function denied(capability, reason, source = 'default', scope = null, expiresAt = null) {
  return { allowed: false, capability, scope, source, reason, expiresAt };
}

/**
 * Pure permission evaluator. All database reads happen in buildPermissionContext so
 * Functions, previews and unit tests use exactly the same decision code.
 */
export function evaluatePermission(context, request) {
  const { subject, schoolId, nowMs = Date.now() } = context;
  const capability = request.capability;
  if (!subject?.uid || subject.accountStatus === 'disabled' || subject.accountStatus === 'deleting') {
    return denied(capability, 'inactive-user');
  }
  if (!subject.schoolIds.includes(schoolId) && !subject.platformAdmin && !subject.globalAdmin) {
    return denied(capability, 'cross-school');
  }

  if (subject.platformAdmin || subject.globalAdmin || PROTECTED_ROLES.has(subject.systemRole)) {
    return { allowed: true, capability, scope: { type: 'school', values: [] }, source: 'system-role', reason: 'protected-system-role', expiresAt: null };
  }

  const relevantAcls = (context.resourceAcls || []).filter(acl => (
    activeAt(acl, nowMs)
    && acl.resourceType === request.resourceType
    && acl.resourceId === request.resourceId
    && principalMatches(acl, subject)
  ));
  const explicitDeny = relevantAcls.find(acl => acl.explicitDeny === true);
  if (explicitDeny) {
    return denied(capability, 'explicit-deny', explicitDeny.inheritedFrom ? 'parent-acl' : 'resource-acl', null, explicitDeny.expiresAt || null);
  }

  const directAcl = relevantAcls.find(acl => aclAllows(acl, request.accessLevel || 'view'));
  if (directAcl) {
    return {
      allowed: true,
      capability,
      scope: { type: 'resources', values: [request.resourceId] },
      source: directAcl.inheritedFrom ? 'parent-acl' : `${directAcl.principalType}-acl`,
      reason: directAcl.inheritedFrom ? 'inherited-resource-grant' : 'direct-resource-grant',
      expiresAt: directAcl.expiresAt || null,
    };
  }

  const grant = (context.capabilityGrants || []).find(item => (
    item.capability === capability
    && activeAt(item, nowMs)
    && scopeAllows(item.scope, request.resource || {}, subject.uid)
  ));
  if (grant) {
    return {
      allowed: true,
      capability,
      scope: normalizeScope(grant.scope),
      source: grant.source || 'role',
      reason: grant.reason || 'capability-grant',
      expiresAt: grant.expiresAt || null,
    };
  }
  return denied(capability, 'no-matching-grant');
}

function memberships(data = {}) {
  return [...new Set([data.schoolId, ...(data.schoolIds || [])].filter(Boolean))];
}

function scopedIds(data, mapField, legacyField, schoolId) {
  const scoped = data[mapField]?.[schoolId];
  if (Array.isArray(scoped)) return scoped;
  return memberships(data).length === 1 && Array.isArray(data[legacyField]) ? data[legacyField] : [];
}

async function getRoleSnapshots(schoolId, roleIds) {
  if (roleIds.length === 0) return [];
  const nested = roleIds.map(roleId => adminDb.doc(`schools/${schoolId}/roleDefinitions/${roleId}`));
  const legacy = roleIds.map(roleId => adminDb.doc(`roles_${schoolId}/${roleId}`));
  const snapshots = await adminDb.getAll(...nested, ...legacy);
  return roleIds.map((roleId, index) => {
    const preferred = snapshots[index];
    const fallback = snapshots[index + roleIds.length];
    const snapshot = preferred.exists ? preferred : fallback;
    return snapshot.exists ? { id: roleId, ...snapshot.data() } : null;
  }).filter(Boolean);
}

function roleScope(role) {
  if (role.scopes?.type) return role.scopes;
  return role.accessScope || { type: 'school', classIds: [] };
}

export async function buildPermissionContext({ userId, schoolId, resource = null, now = Timestamp.now() }) {
  const userSnapshot = await adminDb.doc(`users/${userId}`).get();
  if (!userSnapshot.exists) return { schoolId, subject: null, capabilityGrants: [], resourceAcls: [] };
  const data = userSnapshot.data();
  const roleIds = [...new Set(scopedIds(data, 'customRoleAssignments', 'customRoleIds', schoolId))];
  const roles = await getRoleSnapshots(schoolId, roleIds);
  const capabilityGrants = [];

  enabledKeys(data.permissions).forEach(capability => capabilityGrants.push({
    capability, scope: { type: 'school' }, source: 'direct-user', reason: 'legacy-compatible-direct-grant',
  }));
  roles.filter(role => activeAt(role, now.toMillis())).forEach(role => {
    enabledKeys(role.permissions).forEach(capability => capabilityGrants.push({
      capability,
      scope: roleScope(role),
      source: `role:${role.id}`,
      reason: role.legacy ? 'legacy-role-grant' : 'assigned-role-grant',
      expiresAt: role.expiresAt || null,
    }));
  });

  let resourceAcls = [];
  if (resource?.resourceType && resource?.resourceId) {
    const aclSnapshot = await adminDb.collection(`schools/${schoolId}/resourceAcls`)
      .where('resourceType', '==', resource.resourceType)
      .where('resourceId', '==', resource.resourceId)
      .get();
    resourceAcls = aclSnapshot.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
    if (resource.parentIds?.length) {
      const parents = await Promise.all(resource.parentIds.slice(0, 10).map(parentId => (
        adminDb.collection(`schools/${schoolId}/resourceAcls`)
          .where('resourceType', '==', 'folder').where('resourceId', '==', parentId).get()
      )));
      parents.forEach(snapshot => snapshot.docs.forEach(item => resourceAcls.push({
        id: item.id, ...item.data(), resourceType: resource.resourceType,
        resourceId: resource.resourceId, inheritedFrom: item.data().resourceId,
      })));
    }
  }

  return {
    schoolId,
    nowMs: now.toMillis(),
    subject: {
      uid: userId,
      accountStatus: data.accountStatus || 'active',
      schoolIds: memberships(data),
      systemRole: data.rolesBySchool?.[schoolId] || data.role || 'viewer',
      platformAdmin: false,
      globalAdmin: false,
      roleIds,
      teamIds: scopedIds(data, 'teamIdsBySchool', 'teamIds', schoolId),
      classIds: scopedIds(data, 'classIdsBySchool', 'classIds', schoolId),
    },
    roles,
    capabilityGrants,
    resourceAcls,
  };
}
