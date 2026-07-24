import { ALL_PERMISSION_KEYS } from './permissionCatalog.js';

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

export const PERMISSION_KEYS = ALL_PERMISSION_KEYS;
