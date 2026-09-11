// Shared, deterministic task semantics used by the server and board.
export const uniqueIds = values => [...new Set((values || []).filter(value => typeof value === 'string' && value))];
export const taskIdentity = task => `${task._source === 'personal' || task.scope === 'personal' ? 'personal' : task._storageMode || 'nested'}:${task.id}`;
export function assignedIds(task) {
  return uniqueIds(task.assignmentVersion === 2 ? Object.keys(task.assignmentSources || {}).filter(uid => task.assignmentSources[uid]?.length) : [...(task.assigneeIds || []), ...(task.responsibleIds || []), ...(task.partnerIds || []), ...(task.scope === 'shared' ? task.participantIds || [] : [])]);
}
export function personStatus(task, uid) {
  if (task.progressBy?.[uid]) return task.progressBy[uid].status;
  return ['done', 'completed'].includes(task.status) ? 'done' : 'todo';
}
export function progressSummary(task) {
  const members = assignedIds(task);
  const done = members.filter(uid => personStatus(task, uid) === 'done').length;
  const started = members.some(uid => personStatus(task, uid) !== 'todo');
  return { total: members.length, done, status: members.length && done === members.length ? 'done' : started ? 'in_progress' : 'todo' };
}
export function initializeAssignments(task, teamMembers = []) {
  if (task.assignmentVersion === 2) return task;
  const sources = {};
  for (const uid of assignedIds(task)) sources[uid] = ['direct'];
  for (const uid of teamMembers) sources[uid] = uniqueIds([...(sources[uid] || []), `team:${task.teamId || task.assigneeTeamId}`]);
  const progressBy = { ...(task.progressBy || {}) };
  for (const uid of Object.keys(sources)) if (!progressBy[uid]) progressBy[uid] = { status: ['done', 'completed'].includes(task.status) ? 'done' : 'todo', inherited: true };
  return { ...task, assignmentVersion: 2, assignmentSources: sources, progressBy };
}
export function reconcileSource(task, source, members) {
  const next = { ...task, assignmentSources: { ...task.assignmentSources }, progressBy: { ...task.progressBy } };
  const wanted = new Set(members.filter(uid => !(task.assignmentExclusions?.[source] || []).includes(uid)));
  for (const uid of uniqueIds([...Object.keys(next.assignmentSources), ...members])) {
    const remaining = (next.assignmentSources[uid] || []).filter(item => item !== source);
    next.assignmentSources[uid] = wanted.has(uid) ? uniqueIds([...remaining, source]) : remaining;
    if (wanted.has(uid) && !task.assignmentSources?.[uid]?.length) next.progressBy[uid] = { status: 'todo' };
  }
  next.assigneeIds = assignedIds(next);
  next.status = progressSummary(next).status;
  return next;
}
export function primaryLane(task, lists, preferences = {}) {
  const personal = preferences.placements?.[taskIdentity(task)];
  if (personal === 'personal' || lists.some(list => list.id === personal && list.kind === 'personal' && !list.archived)) return personal;
  if (task.listId && lists.some(list => list.id === task.listId && !list.archived)) return task.listId;
  if (task.teamId || task.assigneeTeamId) return `team:${task.teamId || task.assigneeTeamId}`;
  return task.scope === 'personal' || task._source === 'personal' ? 'personal' : 'shared';
}
export function rankBetween(before, after) {
  if (before == null && after == null) return 1024;
  if (before == null) return after - 1024;
  if (after == null) return before + 1024;
  return (before + after) / 2;
}
