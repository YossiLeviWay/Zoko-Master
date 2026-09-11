import { profileGrants } from '../../functions/src/accessCatalog.js';
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { getDoc, getDocs, query, where, onSnapshot } from 'firebase/firestore';
import { schoolCollection, schoolDoc } from '../services/firestore/paths';
import { ALL_PERMISSION_KEYS } from '../../functions/src/permissionCatalog.js';

/** @type {Record<string, boolean>} */
export const VIEWER_DEFAULTS = {
  ...Object.fromEntries(ALL_PERMISSION_KEYS.map(key => [key, false])),
  // An approved teacher starts with one small, predictable workspace:
  // dashboard (route-level), read-only calendar and the tasks they may see.
  calendar_view: true,
  'calendar.view': true,
  calendar_edit: false,
  categories_view: false,
  categories_edit: false,
  staff_view: false,
  staff_edit: false,
  tasks_view: true,
  'tasks.viewOwn': true,
  'tasks.viewTeam': true,
  'tasks.create': true,
  'tasks.inviteCollaborators': true,
  'tasks.useAssistant': true,
  tasks_edit: false,
  tasks_assign: false,
  teams_view: false,
  teams_edit: false,
  classes_view: false,
  classes_create: false,
  classes_update: false,
  classes_archive: false,
  classes_assign_teacher: false,
  students_view: false,
  students_edit: false,
  students_create: false,
  students_update: false,
  students_archive: false,
  students_transfer_class: false,
  students_manage_programs: false,
  students_add_notes: false,
  students_view_notes: false,
  attendance_create: false,
  attendance_view: false,
  attendance_edit: false,
  attendance_manage_legend: false,
  attendance_manage_dates: false,
  attendance_block_days: false,
  files_view: false,
  files_upload: false,
  files_delete: false,
  messages_send: false,
  messages_delete: false,
  holidays_view: false,
  holidays_edit: false,
  data_mapping_view: true,
  data_mapping_edit: false,
  schools_manage: false,
  settings_edit: false,
};

/** @type {Record<string, boolean>} */
export const FULL_PERMISSIONS = Object.fromEntries(
  Object.keys(VIEWER_DEFAULTS).map(k => [k, true])
);

const PERMISSION_ALIASES = Object.freeze({
  calendar_view: 'calendar.view',
  calendar_edit: 'calendar.edit',
  tasks_view: 'tasks.viewOwn',
  tasks_edit: 'tasks.editAll',
  tasks_assign: 'tasks.assign',
  staff_view: 'staff.view',
  staff_edit: 'staff.edit',
  files_view: 'files.view',
  files_upload: 'files.create',
  files_delete: 'files.delete',
  classes_view: 'classes.view',
  classes_create: 'classes.create',
  classes_update: 'classes.update',
  classes_archive: 'classes.archive',
  classes_assign_teacher: 'classes.assignTeacher',
  students_view: 'students.view',
  students_create: 'students.create',
  students_update: 'students.update',
  students_archive: 'students.archive',
  students_transfer_class: 'students.transferClass',
});

function setPermissionWithAlias(target, key, value) {
  target[key] = value;
  const alias = PERMISSION_ALIASES[key]
    || Object.entries(PERMISSION_ALIASES).find(([, granular]) => granular === key)?.[0];
  if (alias) target[alias] = value;
}

export function usePermissions() {
  const { userData, selectedSchool, isGlobalAdmin, isPrincipal } = useAuth();
  const [permissions, setPermissions] = useState(VIEWER_DEFAULTS);
  const [schoolWidePermissions, setSchoolWidePermissions] = useState({});
  const [permissionScopes, setPermissionScopes] = useState({});
  const [loading, setLoading] = useState(true);
  const [classRevision, setClassRevision] = useState(0);

  const schoolId = selectedSchool || userData?.schoolId;
  const hasFullAccess = isGlobalAdmin() || isPrincipal();

  useEffect(() => {
    if (!schoolId || !userData?.uid || !userData.accessProfilesBySchool?.[schoolId]) return;
    const unsubscribers = ['legacy', 'nested'].flatMap(mode => {
      const classes = schoolCollection(db, schoolId, 'classes', mode);
      return [query(classes, where('teacherId', '==', userData.uid)), query(classes, where('staffIds', 'array-contains', userData.uid))];
    }).map(source => onSnapshot(source, () => setClassRevision(value => value + 1), () => {}));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, [schoolId, userData?.uid, userData?.accessProfilesBySchool]);

  useEffect(() => {
    let active = true;
    if (!userData) {
      setPermissions(VIEWER_DEFAULTS);
      setSchoolWidePermissions({});
      setPermissionScopes({});
      setLoading(false);
      return;
    }

    if (hasFullAccess) {
      setPermissions(FULL_PERMISSIONS);
      setSchoolWidePermissions(FULL_PERMISSIONS);
      setPermissionScopes(Object.fromEntries(Object.keys(FULL_PERMISSIONS).map(key => [
        key, { type: 'school', classIds: [] },
      ])));
      setLoading(false);
      return;
    }

    async function resolve() {
      let base = { ...VIEWER_DEFAULTS };
      const explicit = {};
      const scopes = {};

      // Merge all custom roles (OR logic — any role that grants a permission enables it)
      const memberships = [...new Set([userData.schoolId, ...(userData.schoolIds || [])].filter(Boolean))];
      const roleIds = userData.customRoleAssignments?.[schoolId]
        || (memberships.length === 1 ? userData.customRoleIds : [])
        || [];
      if (roleIds.length > 0 && schoolId) {
        for (const roleId of roleIds) {
          try {
            const roleDoc = await getDoc(schoolDoc(db, schoolId, 'roles', roleId));
            if (roleDoc.exists()) {
              const role = roleDoc.data();
              if (role.status === 'archived') continue;
              const rp = role.permissions || {};
              const roleScope = role.accessScope?.type === 'classes'
                ? { type: 'classes', classIds: role.accessScope.classIds || [] }
                : { type: 'school', classIds: [] };
              for (const [key, val] of Object.entries(rp)) {
                if (val === true) {
                  setPermissionWithAlias(base, key, true);
                  if (roleScope.type === 'school') {
                    explicit[key] = true;
                    scopes[key] = roleScope;
                  } else if (scopes[key]?.type !== 'school') {
                    scopes[key] = {
                      type: 'classes',
                      classIds: [...new Set([...(scopes[key]?.classIds || []), ...roleScope.classIds])],
                    };
                  }
                }
              }
            }
          } catch {}
        }
      }

      // Apply individual overrides stored directly on the user doc
      const userPerms = userData.permissions || {};
      for (const [key, val] of Object.entries(userPerms)) {
        if (val !== undefined) {
          setPermissionWithAlias(base, key, val);
          explicit[key] = val;
          if (val === true) scopes[key] = { type: 'school', classIds: [] };
          else delete scopes[key];
        }
      }

      const profile = userData.accessProfilesBySchool?.[schoolId];
      if (profile && schoolId && userData.uid) {
        try {
          const { data } = await httpsCallable(functions, 'getOwnAccessClasses')({ schoolId });
          const classes = /** @type {any} */ (data).classes || [];
          for (const grant of profileGrants(profile, classes, userData.uid)) {
            setPermissionWithAlias(base, grant.capability, true);
            if (grant.scope.type === 'school') {
              explicit[grant.capability] = true;
              scopes[grant.capability] = { type: 'school', classIds: [] };
            } else if (scopes[grant.capability]?.type !== 'school') {
              scopes[grant.capability] = { type: 'classes', classIds: [...new Set([...(scopes[grant.capability]?.classIds || []), ...grant.scope.classIds])] };
            }
          }
        } catch { /* No unverified class grants. */ }
      }

      // A homeroom teacher or explicitly assigned class staff member must be able
      // to open the page, while their Firestore access remains scoped per class.
      if (!profile && !base.students_view && schoolId && userData.uid) {
        try {
          const classesRef = schoolCollection(db, schoolId, 'classes');
          const [teacherClasses, staffClasses] = await Promise.all([
            getDocs(query(classesRef, where('teacherId', '==', userData.uid))),
            getDocs(query(classesRef, where('staffIds', 'array-contains', userData.uid))),
          ]);
          if (!teacherClasses.empty || !staffClasses.empty) {
            base.students_view = true;
            base.classes_view = true;
          } else {
            const legacySettings = await getDoc(schoolDoc(db, schoolId, 'settings', 'class_permissions'));
            const legacyClasses = legacySettings.data()?.classes || {};
            const legacyAssigned = Object.values(legacyClasses).some(classAccess => (
              classAccess?.teacherIds?.includes(userData.uid)
              || classAccess?.teamIds?.some(teamId => userData.teamIds?.includes(teamId))
            ));
            if (legacyAssigned) base.students_view = true;
          }
        } catch {
          // The page stays hidden when class membership cannot be verified.
        }
      }

      if (!active) return;
      setPermissions(base);
      setSchoolWidePermissions(explicit);
      setPermissionScopes(scopes);
      setLoading(false);
    }

    resolve();
    return () => { active = false; };
  }, [hasFullAccess, schoolId, userData, classRevision]);

  return { permissions, schoolWidePermissions, permissionScopes, loading };
}
