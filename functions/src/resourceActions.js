export const RESOURCE_ACTIONS = Object.freeze(['view', 'create', 'edit', 'comment', 'delete', 'manage']);
const LEGACY_ACTIONS = Object.freeze({
  view: ['view'], comment: ['view', 'comment'],
  edit: ['view', 'comment', 'create', 'edit'],
  manage: ['view', 'comment', 'create', 'edit', 'delete', 'manage'],
});
export function aclActions(acl) {
  return Array.isArray(acl.actions) ? acl.actions.filter(action => RESOURCE_ACTIONS.includes(action)) : LEGACY_ACTIONS[acl.accessLevel] || [];
}
export function aclHasAction(acl, action) { return aclActions(acl).includes(action); }
