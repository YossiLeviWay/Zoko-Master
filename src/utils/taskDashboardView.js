const TEAM_SCOPES = new Set(['team']);

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

export function isTeamTask(task) {
  return TEAM_SCOPES.has(task?.scope)
    || ['team', 'all_school'].includes(task?.assigneeType);
}

export function belongsToTaskView(task, view, uid) {
  if (view === 'teams') return isTeamTask(task);
  if (view !== 'mine' || isTeamTask(task)) return false;
  if (task?._source === 'personal' || task?.scope === 'personal' || task?.scope === 'shared') return true;
  return task?.createdBy === uid
    || safeList(task?.assigneeIds).includes(uid)
    || safeList(task?.participantIds).includes(uid);
}

export function taskDateBucket(task, todayKey, completed = false) {
  if (completed) return 'completed';
  const dueDate = String(task?.dueDate || task?.dueAt || '').slice(0, 10);
  if (!dueDate) return 'no_date';
  if (dueDate < todayKey) return 'overdue';
  if (dueDate === todayKey) return 'today';
  return 'upcoming';
}

export function overdueDayCount(task, todayKey) {
  const dueDate = String(task?.dueDate || task?.dueAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate >= todayKey) return 0;
  const due = new Date(`${dueDate}T00:00:00Z`).getTime();
  const today = new Date(`${todayKey}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((today - due) / 86400000));
}

export const TASK_GROUP_ORDER = Object.freeze(['overdue', 'today', 'upcoming', 'no_date', 'completed']);
