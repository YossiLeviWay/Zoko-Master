function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}
function ids(value) {
  return Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string' && item))] : [];
}

function legacyMilestoneStatus(status) {
  if (status === 'completed' || status === 'approved') return 'done';
  if (status === 'in_progress' || status === 'awaiting_approval') return 'in_progress';
  return 'todo';
}

export function normalizeTaskSteps(task) {
  const stored = Array.isArray(task?.workPlanSteps) ? task.workPlanSteps : [];
  if (stored.length) return stored.map((step, index) => ({
    ...step,
    id: text(step.id, `step_${index + 1}`),
    title: text(step.title),
    dueDate: text(step.dueDate || step.date),
    status: ['todo', 'in_progress', 'done'].includes(step.status) ? step.status : 'todo',
    responsibleIds: ids(step.responsibleIds),
    teamId: text(step.teamId),
    dependencyStepId: text(step.dependencyStepId || step.dependencyId),
    order: Number.isFinite(Number(step.order)) ? Number(step.order) : index,
  })).filter(step => step.title).sort((left, right) => left.order - right.order);

  return (Array.isArray(task?.subtasks) ? task.subtasks : []).map((title, index) => ({
    id: `legacy_subtask_${index + 1}`,
    title: text(title),
    dueDate: '',
    status: 'todo',
    responsibleIds: [],
    teamId: '',
    dependencyStepId: '',
    order: index,
    _legacySubtask: true,
  })).filter(step => step.title);
}

// Read-only adapter. It never writes, copies or migrates legacy initiative data.
export function legacyInitiativeToUnifiedTask(initiative, milestones = []) {
  const steps = milestones.map((milestone, index) => ({
    id: text(milestone.id, `milestone_${index + 1}`),
    title: text(milestone.title, 'שלב ללא שם'),
    dueDate: text(milestone.startDate || milestone.endDate || milestone.proposedDate),
    status: legacyMilestoneStatus(milestone.status),
    responsibleIds: ids([milestone.ownerId, ...(milestone.participantIds || [])]),
    teamId: '',
    dependencyStepId: text(milestone.dependencyId),
    order: Number.isFinite(Number(milestone.order)) ? Number(milestone.order) : index,
    _legacyMilestone: true,
  })).sort((left, right) => left.order - right.order);

  return {
    id: text(initiative?.id),
    _key: `legacy-initiative:${text(initiative?.id)}`,
    _source: 'legacy_initiative',
    title: text(initiative?.title, 'משימה ללא כותרת'),
    description: text(initiative?.description),
    status: initiative?.status === 'completed' ? 'done' : 'in_progress',
    dueDate: text(initiative?.endDate),
    startDate: text(initiative?.startDate),
    responsibleIds: ids([initiative?.ownerId]),
    partnerIds: ids(initiative?.memberIds),
    teamIds: ids(initiative?.teamIds),
    classIds: ids(initiative?.classIds),
    workPlanSteps: steps,
    legacyInitiative: initiative,
    isLegacyCompatible: true,
  };
}
