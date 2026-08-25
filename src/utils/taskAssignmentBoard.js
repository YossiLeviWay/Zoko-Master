export function isAssignmentBankTask(task) {
  return ['organization', 'personal'].includes(task?._source)
    && task?.workflowType !== 'external_email_followup';
}

export function assignedTasksForStaff(tasks, staffId) {
  if (!staffId) return [];
  return (Array.isArray(tasks) ? tasks : []).filter(task => (
    task?._source === 'organization'
    && Array.isArray(task.assigneeIds)
    && task.assigneeIds.includes(staffId)
  ));
}

export function assignmentMutationForTask(task, staffId, assigned) {
  if (!task || !staffId) return null;
  if (task._source === 'personal') {
    return assigned ? {
      kind: 'convert',
      assignment: { scope: 'assigned', assigneeIds: [staffId] },
    } : null;
  }
  if (task._source !== 'organization') return null;
  return { kind: 'update', staffId, assigned: Boolean(assigned) };
}
