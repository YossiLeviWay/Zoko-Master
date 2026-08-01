import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { normalizeEmailList } from '../../utils/mailto.js';

export const COMMUNICATION_WORKFLOW_TYPE = 'external_email_followup';

export const COMMUNICATION_STATUS = Object.freeze({
  AWAITING_SEND: 'awaiting_send',
  AWAITING_REPLY: 'awaiting_reply',
  REPLY_RECEIVED_IN_PROGRESS: 'reply_received_in_progress',
  ACTION_REQUIRED: 'action_required',
  POSTPONED: 'postponed',
  RESOLVED: 'resolved',
  CLOSED_WITHOUT_REPLY: 'closed_without_reply',
  CANCELLED: 'cancelled',
});

export async function getEmailDraft({ db, schoolId, draftId }) {
  const snapshot = await getDoc(doc(db, 'schools', schoolId, 'communicationDrafts', draftId));
  if (!snapshot.exists()) throw new Error('Communication draft not found');
  return { id: snapshot.id, ...snapshot.data() };
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function safeLinks(value) {
  return (Array.isArray(value) ? value : [])
    .map(item => cleanText(item, 1000))
    .filter(Boolean)
    .slice(0, 20);
}

function communicationEvent(batch, db, schoolId, draftId, taskId, userId, type) {
  const eventRef = doc(collection(db, 'schools', schoolId, 'communicationEvents'));
  batch.set(eventRef, {
    schoolId,
    draftId,
    taskId,
    actorId: userId,
    type,
    schemaVersion: 1,
    createdAt: serverTimestamp(),
  });
}

export async function createEmailFollowUp({ db, schoolId, user, sourceTask, input }) {
  if (!db || !schoolId || !user?.uid || !sourceTask?.id) throw new Error('Invalid communication context');
  const recipients = normalizeEmailList(input.to);
  if (!recipients.length || !cleanText(input.subject, 300) || !cleanText(input.body, 10000)) {
    throw new Error('Missing communication fields');
  }

  const taskRef = doc(collection(db, 'users', user.uid, 'personalTasks'));
  const draftRef = doc(collection(db, 'schools', schoolId, 'communicationDrafts'));
  const trackingId = `MAIL-${draftRef.id}`;
  const batch = writeBatch(db);
  const nextFollowUpAt = cleanText(input.nextFollowUpAt, 40);
  const subject = cleanText(input.subject, 300);
  const summary = cleanText(input.summary, 1000);
  const sourceStorageMode = cleanText(sourceTask._storageMode || 'nested', 20);

  batch.set(taskRef, {
    title: `מעקב מייל: ${subject}`.slice(0, 300),
    description: summary || 'מעקב אחר מייל חיצוני',
    priority: ['low', 'medium', 'high'].includes(input.priority) ? input.priority : 'medium',
    status: 'todo',
    taskStatus: 'todo',
    dueDate: nextFollowUpAt.slice(0, 10),
    reminderAt: '',
    tags: ['מייל', 'מעקב'],
    attachedFileId: '',
    attachedFileName: '',
    initiativeId: sourceTask.initiativeId || '',
    milestoneId: sourceTask.initiativeId ? sourceTask.milestoneId || '' : '',
    scope: 'personal',
    schoolId,
    ownerId: user.uid,
    createdBy: user.uid,
    createdByName: cleanText(user.fullName, 200),
    assigneeIds: [],
    participantIds: [user.uid],
    teamId: '',
    assigneeTeamId: '',
    completedAt: null,
    workflowType: COMMUNICATION_WORKFLOW_TYPE,
    communicationStatus: COMMUNICATION_STATUS.AWAITING_SEND,
    communicationDraftId: draftRef.id,
    communicationTrackingId: trackingId,
    nextFollowUpAt,
    completionCriteria: cleanText(input.completionCriteria, 1000),
    sourceTaskId: sourceTask.id,
    sourceTaskStorageMode: sourceStorageMode,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(draftRef, {
    schoolId,
    trackingId,
    taskId: taskRef.id,
    workflowType: COMMUNICATION_WORKFLOW_TYPE,
    communicationStatus: COMMUNICATION_STATUS.AWAITING_SEND,
    subject,
    draftBody: cleanText(input.body, 10000),
    summary,
    to: recipients,
    cc: normalizeEmailList(input.cc).slice(0, 20),
    bcc: normalizeEmailList(input.bcc).slice(0, 20),
    linkedContactId: '',
    createdBy: user.uid,
    confirmedSentBy: '',
    confirmedSentAt: null,
    followUpAssigneeId: user.uid,
    nextFollowUpAt,
    priority: ['low', 'medium', 'high'].includes(input.priority) ? input.priority : 'medium',
    completionCriteria: cleanText(input.completionCriteria, 1000),
    sourceTaskId: sourceTask.id,
    sourceTaskStorageMode: sourceStorageMode,
    sourceTaskOwnerId: sourceTask._source === 'personal' ? user.uid : '',
    linkedStudentId: '',
    linkedClassId: '',
    linkedTeamId: sourceTask.teamId || sourceTask.assigneeTeamId || '',
    linkedInitiativeId: sourceTask.initiativeId || '',
    linkedMilestoneId: sourceTask.milestoneId || '',
    linkedEventId: '',
    linkedFileIds: sourceTask.attachedFileId ? [sourceTask.attachedFileId] : [],
    links: safeLinks(input.links),
    actionHistory: [],
    reminderHistory: [],
    visibility: 'private',
    participantIds: [user.uid],
    schemaVersion: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  communicationEvent(batch, db, schoolId, draftRef.id, taskRef.id, user.uid, 'draft_created');
  await batch.commit();
  return {
    draftId: draftRef.id,
    taskId: taskRef.id,
    trackingId,
    communicationStatus: COMMUNICATION_STATUS.AWAITING_SEND,
  };
}

export async function markEmailDraftOpened({ db, schoolId, userId, draftId, taskId }) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'schools', schoolId, 'communicationDrafts', draftId), {
    lastOpenedBy: userId,
    lastOpenedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  communicationEvent(batch, db, schoolId, draftId, taskId, userId, 'mailto_opened');
  await batch.commit();
}

export async function confirmEmailSent({ db, schoolId, userId, draftId, taskId }) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'schools', schoolId, 'communicationDrafts', draftId), {
    communicationStatus: COMMUNICATION_STATUS.AWAITING_REPLY,
    confirmedSentBy: userId,
    confirmedSentAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', userId, 'personalTasks', taskId), {
    communicationStatus: COMMUNICATION_STATUS.AWAITING_REPLY,
    updatedAt: serverTimestamp(),
  });
  communicationEvent(batch, db, schoolId, draftId, taskId, userId, 'send_confirmed');
  await batch.commit();
}

export async function cancelEmailFollowUp({ db, schoolId, userId, draftId, taskId }) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'schools', schoolId, 'communicationDrafts', draftId), {
    communicationStatus: COMMUNICATION_STATUS.CANCELLED,
    cancelledBy: userId,
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', userId, 'personalTasks', taskId), {
    communicationStatus: COMMUNICATION_STATUS.CANCELLED,
    taskStatus: 'done',
    status: 'done',
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  communicationEvent(batch, db, schoolId, draftId, taskId, userId, 'cancelled');
  await batch.commit();
}
