function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value, maxLength = 5000) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function normalizeSource(value) {
  if (!isRecord(value)) return null;
  const id = safeText(value.id, 128);
  const label = safeText(value.label, 240);
  const route = safeText(value.route, 500);
  return id && label && route ? { id, label, route } : null;
}

function normalizeTaskWorkflowAction(value) {
  if (!isRecord(value) || value.type !== 'task_role_selection') return null;
  const workflowId = safeText(value.workflowId, 128);
  if (!workflowId) return null;
  const options = Array.isArray(value.options) ? value.options.map(option => isRecord(option) ? {
    id: safeText(option.id, 128),
    name: safeText(option.name, 160),
    jobTitle: safeText(option.jobTitle, 160),
  } : null).filter(option => option?.id && option.name).slice(0, 100) : [];
  return {
    type: 'task_role_selection',
    workflowId,
    targetLabel: safeText(value.targetLabel, 160),
    selectedStaffId: safeText(value.selectedStaffId, 128),
    canAssignRole: value.canAssignRole === true,
    roleMissing: value.roleMissing === true,
    options,
  };
}

function normalizeMessage(value, index) {
  if (!isRecord(value) || !['user', 'zoki'].includes(value.role)) return null;
  const text = safeText(value.text);
  if (!text) return null;
  const sources = Array.isArray(value.sources) ? value.sources.map(normalizeSource).filter(Boolean).slice(0, 20) : [];
  const workflowAction = normalizeTaskWorkflowAction(value.actionProposal);
  return {
    id: safeText(value.id, 128) || `restored_${index}`,
    role: value.role,
    text,
    ...(value.error === true ? { error: true } : {}),
    ...(safeText(value.followUpQuestion, 2000) ? { followUpQuestion: safeText(value.followUpQuestion, 2000) } : {}),
    ...(sources.length ? { sources } : {}),
    ...(workflowAction ? { actionProposal: workflowAction, actionStatus: safeText(value.actionStatus, 40) } : {}),
  };
}

export function normalizeZokiConversationState(value) {
  if (!isRecord(value) || !Array.isArray(value.messages)) return null;
  const messages = value.messages.slice(-60).map(normalizeMessage).filter(Boolean);
  const pendingTask = isRecord(value.pendingTask) && isRecord(value.pendingTask.proposal)
    ? value.pendingTask : null;
  const taskActionResult = isRecord(value.taskActionResult) ? value.taskActionResult : null;
  const taskAgentTurn = isRecord(value.taskAgentTurn) && typeof value.taskAgentTurn.request === 'string'
    && isRecord(value.taskAgentTurn.proposal) ? value.taskAgentTurn : null;
  return { messages, pendingTask, taskActionResult, taskAgentTurn };
}
