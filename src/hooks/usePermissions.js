import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';

export const VIEWER_DEFAULTS = {
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
  const [loading, setLoading] = useState(true);

  const schoolId = selectedSchool || userData?.schoolId;

  useEffect(() => {
    if (!userData) {
      setLoading(false);
      return;
    }

    if (isGlobalAdmin() || isPrincipal()) {
      setPermissions(FULL_PERMISSIONS);
      setLoading(false);
      return;
    }

    async function resolve() {
      let base = { ...VIEWER_DEFAULTS };

      // Merge all custom roles (OR logic — any role that grants a permission enables it)
      const roleIds = userData.customRoleIds || [];
      if (roleIds.length > 0 && schoolId) {
        for (const roleId of roleIds) {
          try {
            const roleDoc = await getDoc(doc(db, `roles_${schoolId}`, roleId));
            if (roleDoc.exists()) {
              const rp = roleDoc.data().permissions || {};
              for (const [key, val] of Object.entries(rp)) {
                if (val === true) base[key] = true;
              }
            }
          } catch {}
        }
      }

      // Apply individual overrides stored directly on the user doc
      const userPerms = userData.permissions || {};
      for (const [key, val] of Object.entries(userPerms)) {
        if (val !== undefined) base[key] = val;
      }

      setPermissions(base);
      setLoading(false);
    }

    resolve();
  }, [userData?.uid, userData?.role, userData?.customRoleIds, userData?.permissions, schoolId]);

  return { permissions, loading };
}
