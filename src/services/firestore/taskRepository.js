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
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { schoolCollection, schoolDoc } from './paths.js';

export const TASK_SCOPES = Object.freeze({
  PERSONAL: 'personal',
  ASSIGNED: 'assigned',
  TEAM: 'team',
});

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function safeIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter(item => typeof item === 'string' || typeof item === 'number')
    .map(String)
    .filter(Boolean))];
}

function safeDateValue(value) {
  if (typeof value === 'string') return value;
  let date = value instanceof Date ? value : null;
  if (!date && typeof value?.toDate === 'function') {
    try { date = value.toDate(); } catch { date = null; }
  }
  return date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 10)
    : '';
}

export function isTaskComplete(task) {
  return task?.status === 'done' || task?.status === 'completed';
}

export function taskDueDate(task) {
  return safeDateValue(task?.dueDate || task?.dueAt);
}

export function normalizeOrganizationTask(item, storageMode = 'nested') {
  return {
    ...item,
    id: safeString(item.id),
    title: safeString(item.title, safeString(item.name, 'משימה ללא כותרת')),
    description: safeString(item.description),
    priority: safeString(item.priority, 'medium'),
    status: safeString(item.status, 'todo'),
    dueDate: safeDateValue(item.dueDate || item.dueAt),
    reminderAt: safeString(item.reminderAt),
    assigneeIds: safeIdList(item.assigneeIds),
    participantIds: safeIdList(item.participantIds),
    pinnedBy: safeIdList(item.pinnedBy),
    tags: safeIdList(item.tags),
    scope: safeString(item.scope, TASK_SCOPES.TEAM),
    assigneeType: safeString(item.assigneeType),
    teamId: safeString(item.teamId),
    assigneeTeamId: safeString(item.assigneeTeamId),
    createdBy: safeString(item.createdBy),
    createdByName: safeString(item.createdByName),
    assignedByName: safeString(item.assignedByName),
    sourceTaskId: safeString(item.sourceTaskId),
    initiativeId: safeString(item.initiativeId),
    milestoneId: safeString(item.milestoneId),
    workflowType: safeString(item.workflowType),
    communicationStatus: safeString(item.communicationStatus),
    communicationDraftId: safeString(item.communicationDraftId),
    communicationTrackingId: safeString(item.communicationTrackingId),
    communicationSubject: safeString(item.communicationSubject),
    externalRecipientLabel: safeString(item.externalRecipientLabel),
    linkedContextType: safeString(item.linkedContextType),
    linkedContextId: safeString(item.linkedContextId),
    linkedContextLabel: safeString(item.linkedContextLabel),
    nextFollowUpAt: safeString(item.nextFollowUpAt),
    attachedFileId: safeString(item.attachedFileId),
    attachedFileName: safeString(item.attachedFileName),
    _storageMode: storageMode,
    _source: 'organization',
    _key: `organization:${storageMode}:${safeString(item.id)}`,
  };
}

export function normalizePersonalTask(item) {
  return {
    ...item,
    id: safeString(item.id),
    title: safeString(item.title, safeString(item.name, 'משימה ללא כותרת')),
    description: safeString(item.description),
    priority: safeString(item.priority, 'medium'),
    status: safeString(item.status, 'todo'),
    dueDate: safeDateValue(item.dueDate || item.dueAt),
    reminderAt: safeString(item.reminderAt),
    assigneeIds: [],
    participantIds: safeIdList(item.participantIds),
    pinnedBy: safeIdList(item.pinnedBy),
    tags: safeIdList(item.tags),
    attachedFileId: safeString(item.attachedFileId),
    attachedFileName: safeString(item.attachedFileName),
    sourceTaskId: safeString(item.sourceTaskId),
    initiativeId: safeString(item.initiativeId),
    milestoneId: safeString(item.milestoneId),
    workflowType: safeString(item.workflowType),
    communicationStatus: safeString(item.communicationStatus),
    communicationDraftId: safeString(item.communicationDraftId),
    communicationTrackingId: safeString(item.communicationTrackingId),
    communicationSubject: safeString(item.communicationSubject),
    externalRecipientLabel: safeString(item.externalRecipientLabel),
    linkedContextType: safeString(item.linkedContextType),
    linkedContextId: safeString(item.linkedContextId),
    linkedContextLabel: safeString(item.linkedContextLabel),
    nextFollowUpAt: safeString(item.nextFollowUpAt),
    scope: TASK_SCOPES.PERSONAL,
    assigneeType: 'personal',
    _storageMode: 'personal',
    _source: 'personal',
    _key: `personal:${safeString(item.id)}`,
  };
}

function personalTasksCollection(db, uid) {
  return collection(db, 'users', uid, 'personalTasks');
}

function personalTaskDoc(db, uid, taskId) {
  return doc(db, 'users', uid, 'personalTasks', taskId);
}

function organizationTaskDoc(db, schoolId, task) {
  return task._storageMode === 'legacy'
    ? doc(db, `tasks_${schoolId}`, task.id)
    : schoolDoc(db, schoolId, 'tasks', task.id, 'nested');
}

function taskChatCollection(db, schoolId, task) {
  return collection(organizationTaskDoc(db, schoolId, task), 'chat');
}

export function taskChatReceiptId(schoolId, task) {
  return `${schoolId}__${task._storageMode || 'nested'}__${task.id}`;
}

function taskChatReceiptDoc(db, uid, schoolId, task) {
  return doc(db, 'users', uid, 'taskChatReceipts', taskChatReceiptId(schoolId, task));
}

function subscribeToQuerySet(queryEntries, normalize, onData, onError) {
  const resultSets = new Map();
  const emit = () => {
    const merged = new Map();
    [...resultSets.entries()].sort(([left], [right]) => left - right)
      .forEach(([, items]) => items.forEach(item => merged.set(item.id, item)));
    onData([...merged.values()]);
  };

  const unsubscribers = queryEntries.map((entry, index) => onSnapshot(
    entry.query,
    snapshot => {
      resultSets.set(index, snapshot.docs.map(item => normalize(
        { ...item.data(), id: item.id },
        entry.storageMode,
      )));
      emit();
    },
    onError,
  ));
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}

export function subscribePersonalTasks({ db, uid, schoolId, onData, onError }) {
  if (!uid || !schoolId) return () => undefined;
  return subscribeToQuerySet(
    [{ query: query(personalTasksCollection(db, uid), where('schoolId', '==', schoolId)), storageMode: 'personal' }],
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
  const taskCollections = [
    { ref: collection(db, `tasks_${schoolId}`), storageMode: 'legacy' },
    { ref: schoolCollection(db, schoolId, 'tasks', 'nested'), storageMode: 'nested' },
  ];
  if (canViewAll) {
    return subscribeToQuerySet(
      taskCollections.map(item => ({ query: item.ref, storageMode: item.storageMode })),
      normalizeOrganizationTask,
      onData,
      onError,
    );
  }

  const queryEntries = taskCollections.flatMap(item => [
    { query: query(item.ref, where('assigneeType', '==', 'all_school')), storageMode: item.storageMode },
    { query: query(item.ref, where('assigneeIds', 'array-contains', uid)), storageMode: item.storageMode },
    { query: query(item.ref, where('participantIds', 'array-contains', uid)), storageMode: item.storageMode },
    { query: query(item.ref, where('createdBy', '==', uid)), storageMode: item.storageMode },
    ...teamIds.map(teamId => ({
      query: query(item.ref, where('assigneeTeamId', '==', teamId)),
      storageMode: item.storageMode,
    })),
  ]);
  return subscribeToQuerySet(queryEntries, normalizeOrganizationTask, onData, onError);
}

export function subscribeTaskChatReceipts({ db, uid, onData, onError }) {
  if (!uid) return () => undefined;
  return onSnapshot(collection(db, 'users', uid, 'taskChatReceipts'), snapshot => {
    onData(Object.fromEntries(snapshot.docs.map(item => [item.id, item.data()])));
  }, onError);
}

export function subscribeTaskChat({ db, schoolId, task, onData, onError }) {
  return onSnapshot(query(taskChatCollection(db, schoolId, task)), snapshot => {
    const messages = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    messages.sort((left, right) => {
      const leftMillis = left.createdAt?.toMillis?.() || 0;
      const rightMillis = right.createdAt?.toMillis?.() || 0;
      return leftMillis - rightMillis;
    });
    onData(messages);
  }, onError);
}

export async function markTaskChatRead({ db, schoolId, uid, task }) {
  if (!uid || !schoolId || !task?.id) return;
  await setDoc(taskChatReceiptDoc(db, uid, schoolId, task), {
    userId: uid,
    schoolId,
    taskId: task.id,
    storageMode: task._storageMode || 'nested',
    readAt: serverTimestamp(),
  }, { merge: true });
}

export async function sendTaskChatMessage({ db, schoolId, task, user, text }) {
  const cleanText = String(text || '').trim();
  if (!user?.uid || !schoolId || !task?.id || !cleanText) throw new Error('Invalid task message');
  const taskRef = organizationTaskDoc(db, schoolId, task);
  const messageRef = doc(taskChatCollection(db, schoolId, task));
  const receiptRef = taskChatReceiptDoc(db, user.uid, schoolId, task);
  const batch = writeBatch(db);
  batch.set(messageRef, {
    text: cleanText.slice(0, 4000),
    author: user.fullName || 'משתמש',
    authorId: user.uid,
    createdAt: serverTimestamp(),
  });
  batch.update(taskRef, {
    lastChatMessageAt: serverTimestamp(),
    lastChatMessageBy: user.uid,
    lastChatPreview: cleanText.slice(0, 120),
    updatedAt: serverTimestamp(),
  });
  batch.set(receiptRef, {
    userId: user.uid,
    schoolId,
    taskId: task.id,
    storageMode: task._storageMode || 'nested',
    readAt: serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return messageRef.id;
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
    initiativeId: input.initiativeId || '',
    milestoneId: input.initiativeId ? input.milestoneId || '' : '',
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
    : organizationTaskDoc(db, schoolId, task);
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
    : organizationTaskDoc(db, schoolId, task);
  return updateDoc(taskRef, {
    status,
    completedAt: status === 'done' || status === 'completed' ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });
}

export async function toggleTaskPin({ db, schoolId, uid, task, isPinned }) {
  const taskRef = task._source === 'personal'
    ? personalTaskDoc(db, uid, task.id)
    : organizationTaskDoc(db, schoolId, task);
  return updateDoc(taskRef, {
    pinnedBy: isPinned ? arrayRemove(uid) : arrayUnion(uid),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTask({ db, schoolId, uid, task }) {
  const taskRef = task._source === 'personal'
    ? personalTaskDoc(db, uid, task.id)
    : organizationTaskDoc(db, schoolId, task);
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
      initiativeId: task.initiativeId || '',
      milestoneId: task.milestoneId || '',
    },
  });
}

export async function linkTaskToInitiative({ db, schoolId, uid, task, initiativeId, milestoneId = '' }) {
  const taskRef = task._source === 'personal'
    ? personalTaskDoc(db, uid, task.id)
    : organizationTaskDoc(db, schoolId, task);
  return updateDoc(taskRef, {
    initiativeId: initiativeId || '',
    milestoneId: initiativeId ? milestoneId || '' : '',
    updatedAt: serverTimestamp(),
  });
}
