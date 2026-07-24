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
  const snapshot = await roleCollection(schoolId).doc(roleId).get();
  if (!snapshot.exists || (snapshot.data().schoolId && snapshot.data().schoolId !== schoolId)) {
    throw permissionDenied();
  }
  return { ref: snapshot.ref, id: snapshot.id, data: snapshot.data() };
}

export async function resolveActorRoleAuthority(actor, schoolId) {
  if (actor.globalAdmin || actor.data.role === 'principal') {
    return { unrestricted: true, permissions: new Set(), delegable: new Set(), scopes: new Map() };
  }
  if (!actor.schoolIds.has(schoolId)) throw permissionDenied();

  const permissions = truePermissionKeys(actor.data.permissions);
  const delegable = new Set(Array.isArray(actor.data.delegatedPermissionKeys)
    ? actor.data.delegatedPermissionKeys
    : []);
  const scopes = new Map([...permissions].map(key => [key, { type: 'school', classIds: [] }]));
  const assignedForSchool = actor.data.customRoleAssignments?.[schoolId];
  const roleIds = Array.isArray(assignedForSchool)
    ? [...new Set(assignedForSchool)]
    : Array.isArray(actor.data.customRoleIds) ? [...new Set(actor.data.customRoleIds)] : [];
  if (roleIds.length > 0) {
    const snapshots = await adminDb.getAll(...roleIds.map(roleId => roleCollection(schoolId).doc(roleId)));
    snapshots.forEach(snapshot => {
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
  return { unrestricted: false, permissions, delegable, scopes };
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

export function customRoleCollection(schoolId) {
  return roleCollection(schoolId);
}

export async function buildMaterializedRoleGrants(roleIds, schoolId) {
  const uniqueIds = [...new Set(roleIds)];
  const permissions = {};
  const classPermissions = {};
  if (uniqueIds.length === 0) return { permissions, classPermissions };
  const snapshots = await adminDb.getAll(...uniqueIds.map(roleId => roleCollection(schoolId).doc(roleId)));
  snapshots.forEach(snapshot => {
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
