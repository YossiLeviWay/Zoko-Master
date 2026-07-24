import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { schoolCollection, schoolDoc } from './paths';

export const TASK_SCOPES = Object.freeze({
  PERSONAL: 'personal',
  ASSIGNED: 'assigned',
  TEAM: 'team',
});

export function isTaskComplete(task) {
  return task?.status === 'done' || task?.status === 'completed';
}

export function taskDueDate(task) {
  return task?.dueDate || task?.dueAt || '';
}

export function normalizeOrganizationTask(item) {
  return {
    ...item,
    scope: item.scope || TASK_SCOPES.TEAM,
    _source: 'organization',
    _key: `organization:${item.id}`,
  };
}

function normalizePersonalTask(item) {
  return {
    ...item,
    scope: TASK_SCOPES.PERSONAL,
    assigneeType: 'personal',
    _source: 'personal',
    _key: `personal:${item.id}`,
  };
}

function personalTasksCollection(db, uid) {
  return collection(db, 'users', uid, 'personalTasks');
}

function personalTaskDoc(db, uid, taskId) {
  return doc(db, 'users', uid, 'personalTasks', taskId);
}

function subscribeToQuerySet(queries, normalize, onData, onError) {
  const resultSets = new Map();
  const emit = () => {
    const merged = new Map();
    resultSets.forEach(items => items.forEach(item => merged.set(item.id, item)));
    onData([...merged.values()].map(normalize));
  };

  const unsubscribers = queries.map((taskQuery, index) => onSnapshot(
    taskQuery,
    snapshot => {
      resultSets.set(index, snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      emit();
    },
    onError,
  ));
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}

export function subscribePersonalTasks({ db, uid, schoolId, onData, onError }) {
  if (!uid || !schoolId) return () => undefined;
  return subscribeToQuerySet(
    [query(personalTasksCollection(db, uid), where('schoolId', '==', schoolId))],
    normalizePersonalTask,
    onData,
    onError,
  );
}

export function subscribeOrganizationTasks({
  db,
  schoolId,
  uid,
  teamIds = [],
  canViewAll = false,
  onData,
  onError,
}) {
  if (!uid || !schoolId) return () => undefined;
  const tasksRef = schoolCollection(db, schoolId, 'tasks');
  if (canViewAll) {
    return subscribeToQuerySet([tasksRef], normalizeOrganizationTask, onData, onError);
  }

  const queries = [
    query(tasksRef, where('assigneeType', '==', 'all_school')),
    query(tasksRef, where('assigneeIds', 'array-contains', uid)),
    query(tasksRef, where('participantIds', 'array-contains', uid)),
    query(tasksRef, where('createdBy', '==', uid)),
    ...teamIds.map(teamId => query(tasksRef, where('assigneeTeamId', '==', teamId))),
  ];
  return subscribeToQuerySet(queries, normalizeOrganizationTask, onData, onError);
}

function editableFields(input) {
  return {
    title: input.title.trim(),
    description: input.description?.trim() || '',
    priority: input.priority || 'medium',
    status: input.status || 'todo',
    dueDate: input.dueDate || '',
    reminderAt: input.reminderAt || '',
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 20) : [],
    attachedFileId: input.attachedFileId || '',
    attachedFileName: input.attachedFileName || '',
  };
}

export async function createPersonalTask({ db, schoolId, user, input }) {
  if (!user?.uid || !schoolId || !input.title?.trim()) throw new Error('Invalid personal task');
  return addDoc(personalTasksCollection(db, user.uid), {
    ...editableFields(input),
    scope: TASK_SCOPES.PERSONAL,
    schoolId,
    ownerId: user.uid,
    createdBy: user.uid,
    createdByName: user.fullName || '',
    assigneeIds: [],
    teamId: '',
    assigneeTeamId: '',
    completedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
  });
}

export async function createOrganizationTask({ db, schoolId, user, input }) {
  if (!user?.uid || !schoolId || !input.title?.trim()) throw new Error('Invalid task');
  const scope = input.scope === TASK_SCOPES.ASSIGNED ? TASK_SCOPES.ASSIGNED : TASK_SCOPES.TEAM;
  const assigneeIds = scope === TASK_SCOPES.ASSIGNED ? input.assigneeIds?.slice(0, 1) || [] : [];
  const teamId = scope === TASK_SCOPES.TEAM ? input.teamId || input.assigneeTeamId || '' : '';
  return addDoc(schoolCollection(db, schoolId, 'tasks'), {
    ...editableFields(input),
    scope,
    schoolId,
    ownerId: '',
    createdBy: user.uid,
    createdByName: user.fullName || '',
    assigneeType: scope === TASK_SCOPES.ASSIGNED ? 'individual' : 'team',
    assigneeIds,
    teamId,
    assigneeTeamId: teamId,
    completedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateTask({ db, schoolId, uid, task, input }) {
  const taskRef = task._source === 'personal'
    ? personalTaskDoc(db, uid, task.id)
    : schoolDoc(db, schoolId, 'tasks', task.id);
  const organizationAssignment = task._source === 'organization' ? {
    scope: input.scope === TASK_SCOPES.ASSIGNED ? TASK_SCOPES.ASSIGNED : TASK_SCOPES.TEAM,
    assigneeType: input.scope === TASK_SCOPES.ASSIGNED ? 'individual' : 'team',
    assigneeIds: input.scope === TASK_SCOPES.ASSIGNED ? input.assigneeIds?.slice(0, 1) || [] : [],
    teamId: input.scope === TASK_SCOPES.TEAM ? input.teamId || input.assigneeTeamId || '' : '',
    assigneeTeamId: input.scope === TASK_SCOPES.TEAM ? input.teamId || input.assigneeTeamId || '' : '',
  } : {};
  return updateDoc(taskRef, {
    ...editableFields(input),
    ...organizationAssignment,
    completedAt: isTaskComplete(input) ? task.completedAt || serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });
}

export async function updateTaskStatus({ db, schoolId, uid, task, status }) {
  const taskRef = task._source === 'personal'
    ? personalTaskDoc(db, uid, task.id)
    : schoolDoc(db, schoolId, 'tasks', task.id);
  return updateDoc(taskRef, {
    status,
    completedAt: status === 'done' || status === 'completed' ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });
}

export async function toggleTaskPin({ db, schoolId, uid, task, isPinned }) {
  const taskRef = task._source === 'personal'
    ? personalTaskDoc(db, uid, task.id)
    : schoolDoc(db, schoolId, 'tasks', task.id);
  return updateDoc(taskRef, {
    pinnedBy: isPinned ? arrayRemove(uid) : arrayUnion(uid),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTask({ db, schoolId, uid, task }) {
  const taskRef = task._source === 'personal'
    ? personalTaskDoc(db, uid, task.id)
    : schoolDoc(db, schoolId, 'tasks', task.id);
  return deleteDoc(taskRef);
}

export async function convertPersonalTask({ db, schoolId, user, task, assignment }) {
  if (task._source !== 'personal') throw new Error('Only personal tasks can be converted');
  const scope = assignment.scope === TASK_SCOPES.ASSIGNED ? TASK_SCOPES.ASSIGNED : TASK_SCOPES.TEAM;
  const assigneeIds = scope === TASK_SCOPES.ASSIGNED ? assignment.assigneeIds?.slice(0, 1) || [] : [];
  const teamId = scope === TASK_SCOPES.TEAM ? assignment.teamId || '' : '';
  const organizationRef = schoolDoc(db, schoolId, 'tasks', task.id);
  const personalRef = personalTaskDoc(db, user.uid, task.id);
  const batch = writeBatch(db);
  batch.set(organizationRef, {
    ...editableFields(task),
    scope,
    schoolId,
    ownerId: '',
    createdBy: user.uid,
    createdByName: user.fullName || '',
    assigneeType: scope === TASK_SCOPES.ASSIGNED ? 'individual' : 'team',
    assigneeIds,
    teamId,
    assigneeTeamId: teamId,
    completedAt: task.completedAt || null,
    sourcePersonalTaskId: task.id,
    convertedAt: serverTimestamp(),
    convertedBy: user.uid,
    createdAt: task.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.delete(personalRef);
  return batch.commit();
}

export async function createPersonalFollowUp({ db, schoolId, user, task }) {
  return createPersonalTask({
    db,
    schoolId,
    user,
    input: {
      title: `המשך: ${task.title}`,
      description: task.description || '',
      priority: task.priority || 'medium',
      status: 'todo',
      dueDate: '',
      sourceTaskId: task.id,
    },
  });
}
