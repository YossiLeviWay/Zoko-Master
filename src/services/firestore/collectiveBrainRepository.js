import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
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

function publicShareDocument(db, shareId) {
  return doc(db, 'collectiveBrainPublicShares', shareId);
}

function publicParticipantsCollection(db, shareId) {
  return collection(publicShareDocument(db, shareId), 'participants');
}

function randomSecret(bytes = 24) {
  const values = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, value => value.toString(16).padStart(2, '0')).join('');
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

export async function configureCollectiveBrainPublicAccess({
  db, schoolId, boardId, actor, enabled, participants = [],
}) {
  requireActor(actor);
  const boardRef = boardDocument(db, schoolId, boardId);
  const boardSnapshot = await getDoc(boardRef);
  if (!boardSnapshot.exists()) throw new Error('BOARD_NOT_FOUND');
  const board = boardSnapshot.data();
  const existingShareId = board.publicShareId || '';
  const shareId = existingShareId || randomSecret();
  const shareRef = publicShareDocument(db, shareId);
  const batch = writeBatch(db);

  batch.update(boardRef, {
    visibility: enabled ? 'public' : 'private',
    publicShareId: shareId,
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
  });
  batch.set(shareRef, {
    enabled: Boolean(enabled),
    schoolId,
    boardId,
    createdBy: board.createdBy || actor.uid,
    createdAt: board.createdAt || serverTimestamp(),
    updatedBy: actor.uid,
    updatedAt: serverTimestamp(),
    schemaVersion: 1,
  }, { merge: true });

  if (!enabled) {
    await batch.commit();
    return { enabled: false, shareId, participants: [] };
  }

  const existingSnapshot = existingShareId
    ? await getDocs(publicParticipantsCollection(db, shareId))
    : { docs: [] };
  const existingByUser = new Map(existingSnapshot.docs.map(item => [item.data().authorId, { id: item.id, ...item.data() }]));
  const safeParticipants = participants
    .filter(person => person?.id && person?.fullName)
    .slice(0, 200);
  const activeIds = new Set(safeParticipants.map(person => person.id));

  existingSnapshot.docs.forEach(item => {
    if (item.data().active !== false && !activeIds.has(item.data().authorId)) {
      batch.update(item.ref, { active: false, updatedBy: actor.uid, updatedAt: serverTimestamp() });
    }
  });
  const links = safeParticipants.map(person => {
    const existing = existingByUser.get(person.id);
    const participantId = existing?.id || randomSecret();
    batch.set(doc(publicParticipantsCollection(db, shareId), participantId), {
      schoolId,
      boardId,
      shareId,
      authorId: person.id,
      authorName: cleanCollectiveBrainText(person.fullName, 120),
      active: true,
      claimedBy: existing?.claimedBy || '',
      claimedAt: existing?.claimedAt || null,
      createdBy: existing?.createdBy || actor.uid,
      createdAt: existing?.createdAt || serverTimestamp(),
      updatedBy: actor.uid,
      updatedAt: serverTimestamp(),
      schemaVersion: 1,
    }, { merge: true });
    return { userId: person.id, authorName: person.fullName, token: participantId };
  });
  await batch.commit();
  return { enabled: true, shareId, participants: links };
}

export async function loadPublicCollectiveBrainBoard({ db, shareId, participantId = '' }) {
  const shareSnapshot = await getDoc(publicShareDocument(db, shareId));
  if (!shareSnapshot.exists() || shareSnapshot.data().enabled !== true) throw new Error('BOARD_NOT_PUBLIC');
  const share = shareSnapshot.data();
  const boardRef = boardDocument(db, share.schoolId, share.boardId);
  const [boardSnapshot, responsesSnapshot, participantsSnapshot] = await Promise.all([
    getDoc(boardRef),
    getDocs(query(responsesCollection(db, share.schoolId, share.boardId), where('status', '==', 'active'))),
    getDocs(query(publicParticipantsCollection(db, shareId), where('active', '==', true))),
  ]);
  if (!boardSnapshot.exists()) throw new Error('BOARD_NOT_PUBLIC');
  const board = normalizeCollectiveBrainBoard({ id: boardSnapshot.id, ...boardSnapshot.data() });
  if (board.visibility !== 'public' || board.publicShareId !== shareId || board.status === 'deleted') throw new Error('BOARD_NOT_PUBLIC');
  const participants = participantsSnapshot.docs
    .map(item => ({ id: item.id, authorId: item.data().authorId, authorName: item.data().authorName }))
    .sort((a, b) => a.authorName.localeCompare(b.authorName, 'he'));
  return {
    board,
    responses: sortCollectiveBrainResponses(responsesSnapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
    participants,
    participant: participants.find(item => item.id === participantId) || null,
  };
}

export function subscribePublicCollectiveBrainBoard({
  db, schoolId, boardId, shareId, onBoard, onResponses, onError,
}) {
  if (!schoolId || !boardId || !shareId) return () => undefined;
  const unsubscribeShare = onSnapshot(publicShareDocument(db, shareId), snapshot => {
    if (!snapshot.exists() || snapshot.data().enabled !== true) onError?.(new Error('BOARD_NOT_PUBLIC'));
  }, onError);
  const unsubscribeBoard = onSnapshot(boardDocument(db, schoolId, boardId), snapshot => {
    if (!snapshot.exists()) return onError?.(new Error('BOARD_NOT_PUBLIC'));
    const board = normalizeCollectiveBrainBoard({ id: snapshot.id, ...snapshot.data() });
    if (board.visibility !== 'public' || board.publicShareId !== shareId || board.status === 'deleted') {
      return onError?.(new Error('BOARD_NOT_PUBLIC'));
    }
    onBoard?.(board);
  }, onError);
  const unsubscribeResponses = onSnapshot(
    query(responsesCollection(db, schoolId, boardId), where('status', '==', 'active')),
    snapshot => onResponses?.(sortCollectiveBrainResponses(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))),
    onError,
  );
  return () => {
    unsubscribeShare();
    unsubscribeBoard();
    unsubscribeResponses();
  };
}

export async function submitPublicCollectiveBrainResponse({
  db, shareId, participantId, body,
}) {
  const shareRef = publicShareDocument(db, shareId);
  const participantRef = doc(publicParticipantsCollection(db, shareId), participantId);
  return runTransaction(db, async transaction => {
    const [shareSnapshot, participantSnapshot] = await Promise.all([
      transaction.get(shareRef), transaction.get(participantRef),
    ]);
    if (!shareSnapshot.exists() || shareSnapshot.data().enabled !== true || !participantSnapshot.exists()) throw new Error('BOARD_NOT_PUBLIC');
    const share = shareSnapshot.data();
    const participant = participantSnapshot.data();
    const boardRef = boardDocument(db, share.schoolId, share.boardId);
    const boardSnapshot = await transaction.get(boardRef);
    const board = boardSnapshot.data();
    if (!boardSnapshot.exists() || board.status !== 'open' || board.visibility !== 'public'
      || board.publicShareId !== shareId || participant.active !== true) {
      throw new Error('PUBLIC_RESPONSE_DENIED');
    }
    let selectedSlot = 0;
    for (let slot = 1; slot <= (board.maxResponsesPerUser || 1); slot += 1) {
      const candidate = doc(responsesCollection(db, share.schoolId, share.boardId), `${participant.authorId}_${slot}`);
      // Transactions require all reads before writes; the first vacant deterministic slot wins.
      const candidateSnapshot = await transaction.get(candidate);
      if (!candidateSnapshot.exists() && selectedSlot === 0) selectedSlot = slot;
    }
    if (!selectedSlot) throw new Error('RESPONSE_LIMIT');
    const responseRef = doc(responsesCollection(db, share.schoolId, share.boardId), `${participant.authorId}_${selectedSlot}`);
    transaction.set(responseRef, {
      schoolId: share.schoolId,
      boardId: share.boardId,
      authorId: participant.authorId,
      authorName: participant.authorName,
      responseSlot: String(selectedSlot),
      submissionSource: 'public_link',
      publicShareId: shareId,
      publicParticipantId: participantId,
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
  });
}

async function deleteReferencesInChunks(db, references, chunkSize = 400) {
  for (let index = 0; index < references.length; index += chunkSize) {
    const batch = writeBatch(db);
    references.slice(index, index + chunkSize).forEach(reference => batch.delete(reference));
    await batch.commit();
  }
}

export async function permanentlyDeleteCollectiveBrainBoard({ db, schoolId, boardId, actor }) {
  requireActor(actor);
  const boardRef = boardDocument(db, schoolId, boardId);
  const boardSnapshot = await getDoc(boardRef);
  if (!boardSnapshot.exists()) return;
  const board = boardSnapshot.data();
  if (board.status !== 'deleted') throw new Error('BOARD_MUST_BE_IN_TRASH');

  const [responsesSnapshot, legacyTokensSnapshot] = await Promise.all([
    getDocs(responsesCollection(db, schoolId, boardId)),
    getDocs(collection(boardRef, 'publicAccessTokens')),
  ]);
  await deleteReferencesInChunks(db, [
    ...responsesSnapshot.docs.map(item => item.ref),
    ...legacyTokensSnapshot.docs.map(item => item.ref),
  ]);

  if (board.publicShareId) {
    const shareRef = publicShareDocument(db, board.publicShareId);
    const participantsSnapshot = await getDocs(publicParticipantsCollection(db, board.publicShareId));
    await deleteReferencesInChunks(db, participantsSnapshot.docs.map(item => item.ref));
    await deleteReferencesInChunks(db, [shareRef]);
  }
  await deleteReferencesInChunks(db, [boardRef]);
}
