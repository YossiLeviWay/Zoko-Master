import { PERMISSION_GROUPS } from '../../functions/src/permissionCatalog.js';

const LABELS = new Map(PERMISSION_GROUPS.flatMap(group => group.permissions));
const SCOPES = { school: 'כל המוסד', classes: 'כיתות שנבחרו', own: 'שלי', team: 'הצוות' };

export function permissionLabel(key) {
  const label = LABELS.get(String(key || ''));
  return label || 'הרשאה';
}

export function permissionScopeLabel(scope) {
  if (!scope || typeof scope === 'string') return SCOPES[scope] || 'כל המוסד';
  return SCOPES[scope.type] || 'כל המוסד';
}
