import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
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
    .filter(item => {
      try {
        const url = new URL(item);
        return ['http:', 'https:'].includes(url.protocol)
          && !/(^|\.)firebaseio\.com$|(^|\.)firebasestorage\.googleapis\.com$/i.test(url.hostname)
          && !(url.hostname === 'yossileviway.github.io' && url.pathname.startsWith('/Zoko-Master'));
      } catch {
        return false;
      }
    })
    .slice(0, 20);
}

function safeIds(value, max = 100) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => cleanText(item, 128))
    .filter(Boolean))].slice(0, max);
}

function communicationEvent(batch, eventRef, {
  schoolId,
  draftId,
  taskId,
  userId,
  type,
  previousStatus = '',
  newStatus = '',
  metadata = {},
}) {
  batch.set(eventRef, {
    schoolId,
    draftId,
    taskId,
    actorId: userId,
    type,
    previousStatus: cleanText(previousStatus, 40),
    newStatus: cleanText(newStatus, 40),
    metadata: {
      note: cleanText(metadata.note, 1000),
      previousDate: cleanText(metadata.previousDate, 40),
      nextDate: cleanText(metadata.nextDate, 40),
      previousAssigneeId: cleanText(metadata.previousAssigneeId, 128),
      nextAssigneeId: cleanText(metadata.nextAssigneeId, 128),
      reminderTone: cleanText(metadata.reminderTone, 20),
    },
    schemaVersion: 1,
    createdAt: serverTimestamp(),
  });
}

function eventRefFor(db, schoolId) {
  return doc(collection(db, 'schools', schoolId, 'communicationEvents'));
}

function dateValue(value) {
  return cleanText(value, 40).slice(0, 10);
}

export function normalizeCommunicationDraft(item) {
  const id = cleanText(item?.id, 128);
  return {
    ...item,
    id: cleanText(item?.taskId, 128) || id,
    communicationDraftId: id,
    communicationTrackingId: cleanText(item?.trackingId, 160),
    communicationSubject: cleanText(item?.subject, 300),
    externalRecipientLabel: cleanText(item?.to?.[0], 320),
    linkedContextType: cleanText(item?.linkedContextType, 30),
    linkedContextId: cleanText(item?.linkedContextId, 128),
    linkedContextLabel: cleanText(item?.linkedContextLabel, 300),
    nextFollowUpAt: cleanText(item?.nextFollowUpAt, 40),
    followUpAssigneeId: cleanText(item?.followUpAssigneeId, 128),
    title: `מעקב מייל: ${cleanText(item?.subject, 300)}`,
    description: cleanText(item?.summary, 1000),
    status: ['resolved', 'closed_without_reply', 'cancelled'].includes(item?.communicationStatus) ? 'done' : 'todo',
    taskStatus: ['resolved', 'closed_without_reply', 'cancelled'].includes(item?.communicationStatus) ? 'done' : 'todo',
    workflowType: COMMUNICATION_WORKFLOW_TYPE,
    _storageMode: 'communication',
    _source: 'communication',
    _key: `communication:${id}`,
  };
}

export function subscribeCommunicationDrafts({ db, schoolId, uid, canViewAll = false, onData, onError }) {
  const ref = collection(db, 'schools', schoolId, 'communicationDrafts');
  const draftQueries = canViewAll ? [query(ref)] : [
    query(ref, where('createdBy', '==', uid)),
    query(ref, where('followUpAssigneeId', '==', uid)),
    query(ref, where('participantIds', 'array-contains', uid)),
  ];
  const resultSets = new Map();
  const emit = () => {
    const merged = new Map();
    resultSets.forEach(items => items.forEach(item => merged.set(item.communicationDraftId, item)));
    onData([...merged.values()]);
  };
  const unsubscribers = draftQueries.map((draftQuery, index) => onSnapshot(draftQuery, snapshot => {
    resultSets.set(index, snapshot.docs.map(item => normalizeCommunicationDraft({ id: item.id, ...item.data() })));
    emit();
  }, onError));
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}

export function subscribeCommunicationEvents({ db, schoolId, draftId, onData, onError }) {
  const eventsQuery = query(
    collection(db, 'schools', schoolId, 'communicationEvents'),
    where('draftId', '==', draftId),
  );
  return onSnapshot(eventsQuery, snapshot => onData(snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0))), onError);
}

export function buildReminderDraft(draft, tone = 'gentle') {
  const subject = cleanText(draft?.subject, 300);
  const opening = tone === 'direct'
    ? 'שלום,\n\nטרם התקבל מענה לפנייה הקודמת. אשמח לקבל עדכון בהקדם.'
    : 'שלום,\n\nרציתי להזכיר בעדינות את הפנייה הקודמת ולבדוק האם יש עדכון בנושא.';
  return {
    to: normalizeEmailList(draft?.to),
    cc: normalizeEmailList(draft?.cc),
    bcc: normalizeEmailList(draft?.bcc),
    subject: subject.startsWith('תזכורת:') ? subject : `תזכורת: ${subject}`,
    body: `${opening}\n\nנושא הפנייה: ${subject}\n\nתודה רבה.`,
  };
}

export async function createEmailFollowUp({ db, schoolId, user, sourceTask, input }) {
  if (!db || !schoolId || !user?.uid || !sourceTask?.id) throw new Error('Invalid communication context');
  const recipients = normalizeEmailList(input.to);
  if (!recipients.length || !cleanText(input.subject, 300) || !cleanText(input.body, 10000)) {
    throw new Error('Missing communication fields');
  }

  const taskRef = doc(collection(db, 'users', user.uid, 'personalTasks'));
  const draftRef = doc(collection(db, 'schools', schoolId, 'communicationDrafts'));
  const createdEventRef = eventRefFor(db, schoolId);
  const trackingId = `MAIL-${draftRef.id}`;
  const batch = writeBatch(db);
  const nextFollowUpAt = cleanText(input.nextFollowUpAt, 40);
  const subject = cleanText(input.subject, 300);
  const summary = cleanText(input.summary, 1000);
  const sourceStorageMode = cleanText(sourceTask._storageMode || 'nested', 20);
  const context = sourceTask.communicationContext || {};
  const contextType = cleanText(context.type || (sourceStorageMode === 'context' ? 'general' : 'task'), 30);
  const contextId = cleanText(context.id || sourceTask.id, 128);
  const contextLabel = cleanText(context.label || sourceTask.title || 'פריט במערכת', 300);
  const linkedFileIds = safeIds(input.linkedFileIds || context.fileIds || (sourceTask.attachedFileId ? [sourceTask.attachedFileId] : []), 20);
  const requestedParticipants = safeIds(input.participantIds || context.participantIds, 100).filter(id => id !== user.uid);
  const participantIds = [user.uid, ...requestedParticipants];
  const visibility = contextType === 'student'
    ? 'private'
    : (input.visibility === 'team' && cleanText(context.teamId || sourceTask.teamId || sourceTask.assigneeTeamId, 128)
      ? 'team'
      : input.visibility === 'participants' && participantIds.length > 1 ? 'participants' : 'private');
  const visibleParticipantIds = visibility === 'private' ? [user.uid] : participantIds;
  const recipientLabel = cleanText(input.recipientLabel || recipients[0], 320);

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
    linkedContextType: contextType,
    linkedContextId: contextId,
    linkedContextLabel: contextLabel,
    communicationSubject: subject,
    externalRecipientLabel: recipientLabel,
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
    linkedContactId: cleanText(input.linkedContactId || context.contactId, 128),
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
    linkedStudentId: cleanText(context.studentId, 128),
    linkedClassId: cleanText(context.classId, 128),
    linkedTeamId: cleanText(context.teamId || sourceTask.teamId || sourceTask.assigneeTeamId, 128),
    linkedInitiativeId: cleanText(context.initiativeId || sourceTask.initiativeId, 128),
    linkedMilestoneId: cleanText(context.milestoneId || sourceTask.milestoneId, 128),
    linkedEventId: cleanText(context.eventId, 128),
    linkedContextType: contextType,
    linkedContextId: contextId,
    linkedContextLabel: contextLabel,
    linkedFileIds,
    links: safeLinks(input.links),
    actionHistory: [],
    reminderHistory: [],
    visibility,
    participantIds: visibleParticipantIds,
    lastEventId: createdEventRef.id,
    reminderNotifiedFor: '',
    schemaVersion: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  communicationEvent(batch, createdEventRef, {
    schoolId,
    draftId: draftRef.id,
    taskId: taskRef.id,
    userId: user.uid,
    type: 'draft_created',
    newStatus: COMMUNICATION_STATUS.AWAITING_SEND,
  });
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
  const eventRef = eventRefFor(db, schoolId);
  batch.update(doc(db, 'schools', schoolId, 'communicationDrafts', draftId), {
    lastOpenedBy: userId,
    lastOpenedAt: serverTimestamp(),
    lastEventId: eventRef.id,
    updatedAt: serverTimestamp(),
  });
  communicationEvent(batch, eventRef, { schoolId, draftId, taskId, userId, type: 'mailto_opened' });
  await batch.commit();
}

export async function confirmEmailSent({ db, schoolId, userId, draftId, taskId }) {
  const batch = writeBatch(db);
  const eventRef = eventRefFor(db, schoolId);
  batch.update(doc(db, 'schools', schoolId, 'communicationDrafts', draftId), {
    communicationStatus: COMMUNICATION_STATUS.AWAITING_REPLY,
    confirmedSentBy: userId,
    confirmedSentAt: serverTimestamp(),
    lastEventId: eventRef.id,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', userId, 'personalTasks', taskId), {
    communicationStatus: COMMUNICATION_STATUS.AWAITING_REPLY,
    updatedAt: serverTimestamp(),
  });
  communicationEvent(batch, eventRef, {
    schoolId, draftId, taskId, userId, type: 'send_confirmed',
    previousStatus: COMMUNICATION_STATUS.AWAITING_SEND,
    newStatus: COMMUNICATION_STATUS.AWAITING_REPLY,
  });
  await batch.commit();
}

export async function cancelEmailFollowUp({ db, schoolId, userId, draftId, taskId }) {
  const batch = writeBatch(db);
  const eventRef = eventRefFor(db, schoolId);
  batch.update(doc(db, 'schools', schoolId, 'communicationDrafts', draftId), {
    communicationStatus: COMMUNICATION_STATUS.CANCELLED,
    cancelledBy: userId,
    cancelledAt: serverTimestamp(),
    lastEventId: eventRef.id,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', userId, 'personalTasks', taskId), {
    communicationStatus: COMMUNICATION_STATUS.CANCELLED,
    taskStatus: 'done',
    status: 'done',
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  communicationEvent(batch, eventRef, {
    schoolId, draftId, taskId, userId, type: 'cancelled',
    previousStatus: COMMUNICATION_STATUS.AWAITING_SEND,
    newStatus: COMMUNICATION_STATUS.CANCELLED,
  });
  await batch.commit();
}

const FOLLOW_UP_ACTION = Object.freeze({
  reply_resolved: { status: COMMUNICATION_STATUS.RESOLVED, eventType: 'reply_received_resolved' },
  reply_continue: { status: COMMUNICATION_STATUS.REPLY_RECEIVED_IN_PROGRESS, eventType: 'reply_received' },
  no_reply: { status: COMMUNICATION_STATUS.POSTPONED, eventType: 'no_reply_reported', requiresDate: true },
  action_required: { status: COMMUNICATION_STATUS.ACTION_REQUIRED, eventType: 'action_required' },
  postpone: { status: COMMUNICATION_STATUS.POSTPONED, eventType: 'follow_up_postponed', requiresDate: true },
  close_without_reply: { status: COMMUNICATION_STATUS.CLOSED_WITHOUT_REPLY, eventType: 'closed_without_reply' },
  change_date: { eventType: 'follow_up_date_changed', requiresDate: true },
  reassign: { eventType: 'responsibility_reassigned', requiresAssignee: true },
});

function terminalCommunicationStatus(status) {
  return [
    COMMUNICATION_STATUS.RESOLVED,
    COMMUNICATION_STATUS.CLOSED_WITHOUT_REPLY,
    COMMUNICATION_STATUS.CANCELLED,
  ].includes(status);
}

export async function applyCommunicationFollowUpAction({
  db,
  schoolId,
  actorId,
  draft,
  action,
  note = '',
  nextFollowUpAt = '',
  nextAssigneeId = '',
}) {
  const config = FOLLOW_UP_ACTION[action];
  if (!config || !draft?.id || !draft?.taskId || !actorId) throw new Error('Invalid follow-up action');
  const nextDate = dateValue(nextFollowUpAt);
  const assigneeId = cleanText(nextAssigneeId, 128);
  if (config.requiresDate && !nextDate) throw new Error('Follow-up date is required');
  if (config.requiresAssignee && !assigneeId) throw new Error('Assignee is required');

  const previousStatus = cleanText(draft.communicationStatus, 40);
  const nextStatus = config.status || previousStatus;
  const eventRef = eventRefFor(db, schoolId);
  const draftRef = doc(db, 'schools', schoolId, 'communicationDrafts', draft.id);
  const batch = writeBatch(db);
  const draftUpdate = {
    lastEventId: eventRef.id,
    updatedAt: serverTimestamp(),
  };
  if (config.status) draftUpdate.communicationStatus = nextStatus;
  if (config.requiresDate) {
    draftUpdate.nextFollowUpAt = nextDate;
    draftUpdate.reminderNotifiedFor = '';
  }
  if (config.requiresAssignee) {
    draftUpdate.followUpAssigneeId = assigneeId;
    draftUpdate.participantIds = safeIds([...(draft.participantIds || []), assigneeId], 100);
  }
  batch.update(draftRef, draftUpdate);

  if (draft.createdBy === actorId && (config.status || config.requiresDate)) {
    const taskUpdate = { updatedAt: serverTimestamp() };
    if (config.status) {
      taskUpdate.communicationStatus = nextStatus;
      taskUpdate.status = terminalCommunicationStatus(nextStatus) ? 'done' : 'todo';
      taskUpdate.taskStatus = taskUpdate.status;
      taskUpdate.completedAt = terminalCommunicationStatus(nextStatus) ? serverTimestamp() : null;
    }
    if (config.requiresDate) {
      taskUpdate.nextFollowUpAt = nextDate;
      taskUpdate.dueDate = nextDate;
    }
    batch.update(doc(db, 'users', draft.createdBy, 'personalTasks', draft.taskId), taskUpdate);
  }

  communicationEvent(batch, eventRef, {
    schoolId,
    draftId: draft.id,
    taskId: draft.taskId,
    userId: actorId,
    type: config.eventType,
    previousStatus,
    newStatus: nextStatus,
    metadata: {
      note,
      previousDate: draft.nextFollowUpAt,
      nextDate,
      previousAssigneeId: draft.followUpAssigneeId,
      nextAssigneeId: assigneeId,
    },
  });
  await batch.commit();
}

export async function recordReminderDraftCreated({ db, schoolId, actorId, draft, tone }) {
  if (!draft?.id || !draft?.taskId || !actorId || !['gentle', 'direct'].includes(tone)) {
    throw new Error('Invalid reminder draft');
  }
  const batch = writeBatch(db);
  const eventRef = eventRefFor(db, schoolId);
  batch.update(doc(db, 'schools', schoolId, 'communicationDrafts', draft.id), {
    lastEventId: eventRef.id,
    updatedAt: serverTimestamp(),
  });
  communicationEvent(batch, eventRef, {
    schoolId,
    draftId: draft.id,
    taskId: draft.taskId,
    userId: actorId,
    type: 'reminder_draft_created',
    previousStatus: draft.communicationStatus,
    newStatus: draft.communicationStatus,
    metadata: { reminderTone: tone },
  });
  await batch.commit();
}

export async function markCommunicationReminderNotified({ db, schoolId, actorId, draft }) {
  const reminderDate = dateValue(draft?.nextFollowUpAt);
  if (!draft?.id || !draft?.taskId || !actorId || !reminderDate) throw new Error('Invalid reminder');
  const batch = writeBatch(db);
  const eventRef = eventRefFor(db, schoolId);
  batch.update(doc(db, 'schools', schoolId, 'communicationDrafts', draft.id), {
    reminderNotifiedFor: reminderDate,
    lastEventId: eventRef.id,
    updatedAt: serverTimestamp(),
  });
  communicationEvent(batch, eventRef, {
    schoolId,
    draftId: draft.id,
    taskId: draft.taskId,
    userId: actorId,
    type: 'follow_up_reminder_due',
    previousStatus: draft.communicationStatus,
    newStatus: draft.communicationStatus,
    metadata: { nextDate: reminderDate },
  });
  await batch.commit();
}
