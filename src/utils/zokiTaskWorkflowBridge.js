import { subscribePrivateSession } from './browserPrivacy.js';

export const ZOKI_TASK_WORKFLOW_UPDATE = 'zoki:task-workflow-update';
export const ZOKI_TASK_WORKFLOW_COMMAND = 'zoki:task-workflow-command';
const pendingDrafts = new Map();
subscribePrivateSession(() => pendingDrafts.clear());

export function storeZokiTaskDraft(schoolId, draft) {
  const id = crypto.randomUUID();
  pendingDrafts.clear();
  pendingDrafts.set(id, { schoolId, draft });
  return id;
}
export function getZokiTaskDraft(id, schoolId) {
  const entry = pendingDrafts.get(id);
  return entry?.schoolId === schoolId ? entry.draft : null;
}
export function discardZokiTaskDraft(id) { pendingDrafts.delete(id); }

export function publishZokiTaskWorkflowUpdate(detail) {
  if (typeof window === 'undefined' || !detail?.workflowId) return;
  window.dispatchEvent(new CustomEvent(ZOKI_TASK_WORKFLOW_UPDATE, { detail }));
}

export function sendZokiTaskWorkflowCommand(detail) {
  if (typeof window === 'undefined' || !detail?.workflowId) return;
  window.dispatchEvent(new CustomEvent(ZOKI_TASK_WORKFLOW_COMMAND, { detail }));
}
