import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { getDoc, getDocs, query, where } from 'firebase/firestore';
import { schoolCollection, schoolDoc } from '../services/firestore/paths';
import { ALL_PERMISSION_KEYS } from '../../functions/src/permissionCatalog.js';

export const VIEWER_DEFAULTS = {
  ...Object.fromEntries(ALL_PERMISSION_KEYS.map(key => [key, false])),
  calendar_view: true,
  calendar_edit: false,
  categories_view: true,
  categories_edit: false,
  staff_view: true,
  staff_edit: false,
  tasks_view: true,
  tasks_edit: false,
  tasks_assign: false,
  teams_view: true,
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
  files_view: true,
  files_upload: false,
  files_delete: false,
  messages_send: true,
  messages_delete: false,
  holidays_view: true,
  holidays_edit: false,
  data_mapping_view: true,
  data_mapping_edit: false,
  schools_manage: false,
  settings_edit: true,
};

export const FULL_PERMISSIONS = Object.fromEntries(
  Object.keys(VIEWER_DEFAULTS).map(k => [k, true])
);

export function usePermissions() {
  const { userData, selectedSchool, isGlobalAdmin, isPrincipal } = useAuth();
  const [permissions, setPermissions] = useState(VIEWER_DEFAULTS);
  const [schoolWidePermissions, setSchoolWidePermissions] = useState({});
  const [permissionScopes, setPermissionScopes] = useState({});
  const [loading, setLoading] = useState(true);

  const schoolId = selectedSchool || userData?.schoolId;
  const hasFullAccess = isGlobalAdmin() || isPrincipal();

  useEffect(() => {
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
      const roleIds = userData.customRoleAssignments?.[schoolId] || userData.customRoleIds || [];
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
                  base[key] = true;
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
          base[key] = val;
          explicit[key] = val;
          if (val === true) scopes[key] = { type: 'school', classIds: [] };
          else delete scopes[key];
        }
      }

      // A homeroom teacher or explicitly assigned class staff member must be able
      // to open the page, while their Firestore access remains scoped per class.
      if (!base.students_view && schoolId && userData.uid) {
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

      setPermissions(base);
      setSchoolWidePermissions(explicit);
      setPermissionScopes(scopes);
      setLoading(false);
    }

    resolve();
  }, [hasFullAccess, schoolId, userData]);

  return { permissions, schoolWidePermissions, permissionScopes, loading };
}
