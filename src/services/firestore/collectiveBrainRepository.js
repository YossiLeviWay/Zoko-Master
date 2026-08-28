import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { schoolCollection } from './paths.js';
import {
  cleanCollectiveBrainText,
  COLLECTIVE_BRAIN_LIMITS,
  normalizeCollectiveBrainBoard,
  sortCollectiveBrainBoards,
  sortCollectiveBrainResponses,
} from '../../utils/collectiveBrain.js';

function boardsCollection(db, schoolId) {
  return schoolCollection(db, schoolId, 'collectiveBrainBoards', 'nested');
}

function boardDocument(db, schoolId, boardId) {
  return doc(boardsCollection(db, schoolId), boardId);
}

function responsesCollection(db, schoolId, boardId) {
  return collection(boardDocument(db, schoolId, boardId), 'responses');
}

function requireActor(actor) {
  if (!actor?.uid) throw new Error('AUTH_REQUIRED');
}

function requireText(value, maxLength, errorCode) {
  const clean = cleanCollectiveBrainText(value, maxLength);
  if (!clean) throw new Error(errorCode);
  return clean;
}

function safeIds(values, limit = 200) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)))]
    .slice(0, limit);
}

function boardSettings(input = {}) {
  const audienceMode = input.audienceMode === 'restricted' ? 'restricted' : 'school';
  return {
    schemaVersion: 2,
    audienceMode,
    audienceUserIds: audienceMode === 'restricted' ? safeIds(input.audienceUserIds) : [],
    audienceTeamIds: audienceMode === 'restricted' ? safeIds(input.audienceTeamIds, 50) : [],
    visibility: input.visibility === 'public' ? 'public' : 'private',
    publicShareId: typeof input.publicShareId === 'string' ? input.publicShareId.slice(0, 128) : '',
    maxResponsesPerUser: Math.min(20, Math.max(1, Number.parseInt(input.maxResponsesPerUser, 10) || 1)),
    responseSlots: Array.from(
      { length: Math.min(20, Math.max(1, Number.parseInt(input.maxResponsesPerUser, 10) || 1)) },
      (_, index) => String(index + 1),
    ),
    linkedTaskIds: safeIds(input.linkedTaskIds, 50),
  };
}

function mergeLiveQueries(entries, normalize, sort, onData, onError) {
  const snapshots = new Map();
  const emit = () => {
    const merged = new Map();
    snapshots.forEach(items => items.forEach(item => merged.set(item.id, item)));
    onData(sort([...merged.values()]));
  };
  const unsubscribers = entries.map((entry, index) => onSnapshot(entry, snapshot => {
    snapshots.set(index, snapshot.docs.map(item => normalize({ id: item.id, ...item.data() })));
    emit();
  }, onError));
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}

export function subscribeCollectiveBrainBoards({ db, schoolId, uid = '', canManage = false, onData, onError }) {
  if (!schoolId) return () => undefined;
  const source = boardsCollection(db, schoolId);
  const entries = canManage ? [source] : ['open', 'closed', 'archived'].flatMap(status => [
    query(source, where('status', '==', status), where('audienceMode', '==', 'school')),
    ...(uid ? [query(source, where('status', '==', status), where('audienceUserIds', 'array-contains', uid))] : []),
  ]);
  return mergeLiveQueries(entries, normalizeCollectiveBrainBoard, sortCollectiveBrainBoards, onData, onError);
}

export function subscribeCollectiveBrainResponses({ db, schoolId, boardId, canManage = false, onData, onError }) {
  if (!schoolId || !boardId) return () => undefined;
  const source = responsesCollection(db, schoolId, boardId);
  const entries = canManage ? [source] : [query(source, where('status', '==', 'active'))];
  return mergeLiveQueries(entries, item => item, sortCollectiveBrainResponses, onData, onError);
}

export function subscribeCollectiveBrainResponseCount({ db, schoolId, boardId, onData, onError }) {
  if (!schoolId || !boardId) return () => undefined;
  return onSnapshot(
    query(responsesCollection(db, schoolId, boardId), where('status', '==', 'active')),
    snapshot => onData(snapshot.size),
    onError,
  );
}

export async function createCollectiveBrainBoard({ db, schoolId, actor, question, description = '', ...settings }) {
  requireActor(actor);
  const cleanQuestion = requireText(question, COLLECTIVE_BRAIN_LIMITS.question, 'QUESTION_REQUIRED');
  const reference = await addDoc(boardsCollection(db, schoolId), {
    schoolId,
    question: cleanQuestion,
    description: cleanCollectiveBrainText(description, COLLECTIVE_BRAIN_LIMITS.description),
    ...boardSettings(settings),
    status: 'open',
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
    archivedBy: '',
    archivedAt: null,
    deletedBy: '',
    deletedAt: null,
  });
  return reference.id;
}

export function updateCollectiveBrainBoard({ db, schoolId, boardId, actor, question, description = '', ...settings }) {
  requireActor(actor);
  return updateDoc(boardDocument(db, schoolId, boardId), {
    question: requireText(question, COLLECTIVE_BRAIN_LIMITS.question, 'QUESTION_REQUIRED'),
    description: cleanCollectiveBrainText(description, COLLECTIVE_BRAIN_LIMITS.description),
    ...boardSettings(settings),
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
}

export function updateCollectiveBrainBoardSettings({ db, schoolId, boardId, actor, ...settings }) {
  requireActor(actor);
  return updateDoc(boardDocument(db, schoolId, boardId), {
    ...boardSettings(settings),
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
}

export function setCollectiveBrainBoardStatus({ db, schoolId, boardId, actor, status }) {
  requireActor(actor);
  if (!['open', 'closed', 'archived', 'deleted'].includes(status)) throw new Error('INVALID_BOARD_STATUS');
  const archived = status === 'archived';
  const deleted = status === 'deleted';
  return updateDoc(boardDocument(db, schoolId, boardId), {
    status,
    archivedBy: archived ? actor.uid : '',
    archivedAt: archived ? serverTimestamp() : null,
    deletedBy: deleted ? actor.uid : '',
    deletedAt: deleted ? serverTimestamp() : null,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
}

export function createCollectiveBrainResponse({ db, schoolId, boardId, actor, authorName, body, responseIndex = 1 }) {
  requireActor(actor);
  const safeIndex = Math.max(1, Math.min(20, Number.parseInt(responseIndex, 10) || 1));
  return setDoc(doc(responsesCollection(db, schoolId, boardId), `${actor.uid}_${safeIndex}`), {
    schoolId,
    boardId,
    authorId: actor.uid,
    authorName: requireText(authorName, 120, 'AUTHOR_NAME_REQUIRED'),
    responseSlot: String(safeIndex),
    body: requireText(body, COLLECTIVE_BRAIN_LIMITS.response, 'RESPONSE_REQUIRED'),
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    editedAt: null,
    moderatedBy: '',
    moderatedAt: null,
    deletedBy: '',
    deletedAt: null,
  });
}

export function updateOwnCollectiveBrainResponse({ db, schoolId, boardId, responseId, actor, body }) {
  requireActor(actor);
  return updateDoc(doc(responsesCollection(db, schoolId, boardId), responseId || actor.uid), {
    body: requireText(body, COLLECTIVE_BRAIN_LIMITS.response, 'RESPONSE_REQUIRED'),
    updatedAt: serverTimestamp(),
    editedAt: serverTimestamp(),
  });
}

export function moderateCollectiveBrainResponse({ db, schoolId, boardId, responseId, actor, body }) {
  requireActor(actor);
  return updateDoc(doc(responsesCollection(db, schoolId, boardId), responseId), {
    body: requireText(body, COLLECTIVE_BRAIN_LIMITS.response, 'RESPONSE_REQUIRED'),
    updatedAt: serverTimestamp(),
    editedAt: serverTimestamp(),
    moderatedBy: actor.uid,
    moderatedAt: serverTimestamp(),
  });
}

export function deleteCollectiveBrainResponse({ db, schoolId, boardId, responseId, actor }) {
  requireActor(actor);
  return updateDoc(doc(responsesCollection(db, schoolId, boardId), responseId), {
    status: 'deleted',
    deletedBy: actor.uid,
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function restoreCollectiveBrainResponse({ db, schoolId, boardId, responseId, actor }) {
  requireActor(actor);
  return updateDoc(doc(responsesCollection(db, schoolId, boardId), responseId), {
    status: 'active',
    deletedBy: '',
    deletedAt: null,
    updatedAt: serverTimestamp(),
    moderatedBy: actor.uid,
    moderatedAt: serverTimestamp(),
  });
}
