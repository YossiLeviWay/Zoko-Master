export const REGION = 'europe-west1';

export const CALLABLE_OPTIONS = {
  region: REGION,
  enforceAppCheck: true,
  maxInstances: 10,
  concurrency: 20,
  timeoutSeconds: 30,
};

export const SYSTEM_ROLES = Object.freeze({
  VIEWER: 'viewer',
  EDITOR: 'editor',
  PRINCIPAL: 'principal',
  GLOBAL_ADMIN: 'global_admin',
});

export const PERMISSION_KEYS = Object.freeze([
  'calendar_view',
  'calendar_edit',
  'categories_view',
  'categories_edit',
  'staff_view',
  'staff_edit',
  'staff_delete',
  'tasks_view',
  'tasks_edit',
  'tasks_assign',
  'teams_view',
  'teams_edit',
  'files_view',
  'files_upload',
  'files_delete',
  'messages_send',
  'messages_delete',
  'holidays_view',
  'holidays_edit',
  'data_mapping_view',
  'data_mapping_edit',
  'students_view',
  'students_edit',
  'schools_manage',
  'settings_edit',
]);
