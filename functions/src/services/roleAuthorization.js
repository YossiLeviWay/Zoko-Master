import { adminDb } from './firebaseAdmin.js';
import { permissionDenied } from './errors.js';

function truePermissionKeys(permissions = {}) {
  return new Set(Object.entries(permissions)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key));
}

function roleCollection(schoolId) {
  return adminDb.collection(`roles_${schoolId}`);
}

export async function getRole(roleId, schoolId) {
  const [nested, legacy] = await adminDb.getAll(
    adminDb.doc(`schools/${schoolId}/roleDefinitions/${roleId}`),
    roleCollection(schoolId).doc(roleId),
  );
  const snapshot = nested.exists ? nested : legacy;
  if (!snapshot.exists || (snapshot.data().schoolId && snapshot.data().schoolId !== schoolId)) {
    throw permissionDenied();
  }
  return { ref: snapshot.ref, id: snapshot.id, data: snapshot.data() };
}

export async function resolveActorRoleAuthority(actor, schoolId) {
  if (actor.platformAdmin || actor.globalAdmin || (
    ['principal', 'institution_manager'].includes(actor.data.rolesBySchool?.[schoolId] || actor.data.role)
    && actor.schoolIds.has(schoolId)
  )) {
    return { unrestricted: true, permissions: new Set(), delegable: new Set(), scopes: new Map(), assignableRoleIds: new Set() };
  }
  if (!actor.schoolIds.has(schoolId)) throw permissionDenied();

  const permissions = truePermissionKeys(actor.data.permissions);
  const delegable = new Set(Array.isArray(actor.data.delegatedPermissionKeys)
    ? actor.data.delegatedPermissionKeys
    : []);
  const scopes = new Map([...permissions].map(key => [key, { type: 'school', classIds: [] }]));
  const assignableRoleIds = new Set();
  const assignedForSchool = actor.data.customRoleAssignments?.[schoolId];
  const roleIds = Array.isArray(assignedForSchool)
    ? [...new Set(assignedForSchool)]
    : actor.schoolIds.size === 1 && Array.isArray(actor.data.customRoleIds)
      ? [...new Set(actor.data.customRoleIds)] : [];
  if (roleIds.length > 0) {
    const nestedSnapshots = await adminDb.getAll(...roleIds.map(roleId => adminDb.doc(`schools/${schoolId}/roleDefinitions/${roleId}`)));
    const legacySnapshots = await adminDb.getAll(...roleIds.map(roleId => roleCollection(schoolId).doc(roleId)));
    roleIds.forEach((roleId, index) => {
      const snapshot = nestedSnapshots[index].exists ? nestedSnapshots[index] : legacySnapshots[index];
      if (!snapshot.exists || snapshot.data().status === 'archived') return;
      const role = snapshot.data();
      const scope = role.accessScope?.type === 'classes'
        ? { type: 'classes', classIds: role.accessScope.classIds || [] }
        : { type: 'school', classIds: [] };
      truePermissionKeys(role.permissions).forEach(key => {
        permissions.add(key);
        const current = scopes.get(key);
        if (!current || current.type === 'school' || scope.type === 'school') {
          scopes.set(key, current?.type === 'school' || scope.type === 'school'
            ? { type: 'school', classIds: [] }
            : scope);
          return;
        }
        scopes.set(key, {
          type: 'classes',
          classIds: [...new Set([...current.classIds, ...scope.classIds])],
        });
      });
      if (role.permissions?.['permissions.delegate'] === true) {
        (role.delegatedPermissionKeys || []).forEach(key => delegable.add(key));
      }
    });
  }
  const delegations = await adminDb.collection(`schools/${schoolId}/permissionDelegations`)
    .where('delegateUserId', '==', actor.uid).where('active', '==', true).get();
  delegations.docs.map(snapshot => snapshot.data()).filter(delegation => (
    !delegation.expiresAt || delegation.expiresAt.toMillis() > Date.now()
  )).forEach(delegation => {
    permissions.add('roles.assign');
    permissions.add('staff.assignRoles');
    permissions.add('permissions.delegate');
    (delegation.assignableRoleIds || []).forEach(roleId => assignableRoleIds.add(roleId));
    (delegation.maximumPermissions || []).forEach(key => {
      permissions.add(key);
      delegable.add(key);
      if (!scopes.has(key)) scopes.set(key, { type: 'school', classIds: [] });
    });
  });
  return { unrestricted: false, permissions, delegable, scopes, assignableRoleIds };
}

export function requireRoleAction(authority, permission) {
  if (authority.unrestricted || authority.permissions.has(permission)) return;
  throw permissionDenied();
}

export function assertRoleCanBeGranted(authority, roleInput) {
  if (authority.unrestricted) return;
  if (!authority.permissions.has('permissions.delegate')) throw permissionDenied();
  const granted = [...truePermissionKeys(roleInput.permissions)];
  if (granted.some(key => !authority.permissions.has(key) || !authority.delegable.has(key))) {
    throw permissionDenied();
  }
  if ((roleInput.delegatedPermissionKeys || []).some(key => (
    !granted.includes(key) || !authority.delegable.has(key)
  ))) throw permissionDenied();

  if (roleInput.accessScope?.type === 'classes') {
    const requested = new Set(roleInput.accessScope.classIds || []);
    for (const key of granted) {
      const actorScope = authority.scopes.get(key);
      if (!actorScope || actorScope.type === 'school') continue;
      if ([...requested].some(classId => !actorScope.classIds.includes(classId))) throw permissionDenied();
    }
  } else {
    const hasClassScopedPermission = granted.some(key => authority.scopes.get(key)?.type === 'classes');
    if (hasClassScopedPermission) throw permissionDenied();
  }
}

export function canGrantRole({ authority, actor, target, role }) {
  if (!actor.schoolIds.has(role.schoolId) && !actor.platformAdmin && !actor.globalAdmin) return false;
  if (!target.schoolIds.has(role.schoolId)) return false;
  if (['principal', 'institution_manager'].includes(target.data.role)) return false;
  if (role.protected === true || role.status === 'archived') return false;
  try {
    if (!authority.unrestricted
      && !authority.permissions.has('roles.assign')
      && !authority.permissions.has('staff.assignRoles')) throw permissionDenied();
    assertRoleCanBeGranted(authority, role);
  } catch {
    return false;
  }
  if (authority.unrestricted) return true;
  if (authority.assignableRoleIds?.size > 0) return authority.assignableRoleIds.has(role.id) && role.delegable !== false;
  if (role.delegable !== true) return false;
  const assignableBy = Array.isArray(role.assignableBy) ? role.assignableBy : [];
  const actorRoleIds = actor.data.customRoleAssignments?.[role.schoolId]
    || (actor.schoolIds.size === 1 ? actor.data.customRoleIds : [])
    || [];
  return assignableBy.length === 0 || assignableBy.includes(actor.uid)
    || actorRoleIds.some(roleId => assignableBy.includes(roleId));
}

export function customRoleCollection(schoolId) {
  return roleCollection(schoolId);
}

export async function buildMaterializedRoleGrants(roleIds, schoolId) {
  const uniqueIds = [...new Set(roleIds)];
  const permissions = {};
  const classPermissions = {};
  if (uniqueIds.length === 0) return { permissions, classPermissions };
  const nestedSnapshots = await adminDb.getAll(...uniqueIds.map(roleId => adminDb.doc(`schools/${schoolId}/roleDefinitions/${roleId}`)));
  const legacySnapshots = await adminDb.getAll(...uniqueIds.map(roleId => roleCollection(schoolId).doc(roleId)));
  uniqueIds.forEach((roleId, index) => {
    const snapshot = nestedSnapshots[index].exists ? nestedSnapshots[index] : legacySnapshots[index];
    if (!snapshot.exists || snapshot.data().status === 'archived') return;
    const role = snapshot.data();
    const enabledKeys = [...truePermissionKeys(role.permissions)];
    if (role.accessScope?.type !== 'classes') {
      enabledKeys.forEach(key => { permissions[key] = true; });
      return;
    }
    enabledKeys.forEach(key => {
      const values = new Set(classPermissions[key] || []);
      (role.accessScope.classIds || []).forEach(classId => values.add(classId));
      classPermissions[key] = [...values];
    });
  });
  return { permissions, classPermissions };
}

export async function refreshRoleHolders(roleId, schoolId) {
  const holders = await adminDb.collection('users').where('customRoleIds', 'array-contains', roleId).get();
  await Promise.all(holders.docs.map(async holder => {
    const data = holder.data();
    const assignments = data.customRoleAssignments || {};
    const roleIds = Array.isArray(assignments[schoolId])
      ? assignments[schoolId]
      : Array.isArray(data.customRoleIds) ? data.customRoleIds : [];
    const materialized = await buildMaterializedRoleGrants(roleIds, schoolId);
    await holder.ref.update({
      rolePermissionsBySchool: {
        ...(data.rolePermissionsBySchool || {}),
        [schoolId]: materialized.permissions,
      },
      classRolePermissionsBySchool: {
        ...(data.classRolePermissionsBySchool || {}),
        [schoolId]: materialized.classPermissions,
      },
    });
  }));
  return holders.size;
}
