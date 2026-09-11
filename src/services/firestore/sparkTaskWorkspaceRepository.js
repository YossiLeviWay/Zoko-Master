import { doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { createPersonalTask, updateTask, updateTaskStatus } from './taskRepository.js';

// Spark uses existing Firestore rules and records. No callable or new shared ACL.
export function subscribeSparkWorkspace({ db, uid, schoolId, onLists, onPreferences, onInvitations, onError }) {
  onInvitations([]);
  return onSnapshot(doc(db, 'users', uid, 'taskBoardPreferences', schoolId), snapshot => {
    const preferences = snapshot.data() || {};
    onPreferences(preferences);
    onLists(Object.values(preferences.personalLists || {}));
  }, onError);
}

export async function sparkWorkspaceAction({ db, schoolId, user, tasks, input }) {
  const ref = doc(db, 'users', user.uid, 'taskBoardPreferences', schoolId);
  if (input.operation === 'list') {
    const listId = input.listId || `list_${input.requestId}`;
    await runTransaction(db, async transaction => {
      const preferences = (await transaction.get(ref)).data() || {};
      const previous = preferences.personalLists?.[listId];
      if (input.listId && !previous) throw new Error('not-found');
      const list = { id: listId, kind: 'personal', ownerId: user.uid, memberIds: [user.uid], archived: false, ...previous };
      if (input.name !== undefined) list.name = input.name.trim().slice(0, 120);
      if (!list.name) throw new Error('invalid-input');
      if (input.archived !== undefined) list.archived = Boolean(input.archived);
      transaction.set(ref, { personalLists: { ...preferences.personalLists, [listId]: list } }, { merge: true });
    });
    return { listId };
  }
  if (input.operation === 'create') {
    if (input.teamId || input.recipientIds?.length) throw new Error('shared-action-paused');
    const taskIds = [];
    for (const [index, title] of input.titles.entries()) {
      const result = await createPersonalTask({ db, schoolId, user, input: { title }, requestId: `${input.requestId}_${index}` });
      taskIds.push(result.id);
    }
    if (input.listId) await runTransaction(db, async transaction => {
      const preferences = (await transaction.get(ref)).data() || {};
      if (!preferences.personalLists?.[input.listId] || preferences.personalLists[input.listId].archived) throw new Error('not-found');
      transaction.set(ref, { placements: { ...preferences.placements, ...Object.fromEntries(taskIds.map(id => [`personal:${id}`, input.listId])) } }, { merge: true });
    });
    return { taskIds };
  }
  const task = tasks.find(item => item.id === input.taskId && (item._source === 'personal' ? 'personal' : item._storageMode) === input.storage);
  if (!task || task.assignmentVersion === 2) throw new Error('shared-action-paused');
  if (input.operation === 'progress') return updateTaskStatus({ db, schoolId, uid: user.uid, task, status: input.status });
  if (input.operation === 'edit') return updateTask({ db, schoolId, uid: user.uid, task, input: { ...task, ...input } });
  throw new Error('shared-action-paused');
}
