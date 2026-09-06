export const ZOKI_TASK_WORKFLOW_UPDATE = 'zoki:task-workflow-update';
export const ZOKI_TASK_WORKFLOW_COMMAND = 'zoki:task-workflow-command';

export function publishZokiTaskWorkflowUpdate(detail) {
  if (typeof window === 'undefined' || !detail?.workflowId) return;
  window.dispatchEvent(new CustomEvent(ZOKI_TASK_WORKFLOW_UPDATE, { detail }));
}

export function sendZokiTaskWorkflowCommand(detail) {
  if (typeof window === 'undefined' || !detail?.workflowId) return;
  window.dispatchEvent(new CustomEvent(ZOKI_TASK_WORKFLOW_COMMAND, { detail }));
}
