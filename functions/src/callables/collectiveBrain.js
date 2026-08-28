import { createHash, randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { CALLABLE_OPTIONS } from '../config.js';
import { requireActor } from '../services/authorization.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { failedPrecondition, permissionDenied, publicError, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { requireRoleAction, resolveActorRoleAuthority } from '../services/roleAuthorization.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const configureSchema = z.object({ schoolId: id, boardId: id, enabled: z.boolean() }).strict();
const publicReadSchema = z.object({ shareId: id, participantToken: z.string().max(128).optional().default('') }).strict();
const publicSubmitSchema = z.object({ shareId: id, participantToken: z.string().min(20).max(128), body: z.string().trim().min(1).max(2000) }).strict();

function secret(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

function tokenFingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

async function requireBrainManager(request, schoolId) {
  const actor = await requireActor(request);
  const authority = await resolveActorRoleAuthority(actor, schoolId);
  requireRoleAction(authority, 'collectiveBrain.manage');
  return actor;
}

async function schoolStaff(schoolId, allowedIds) {
  const ids = new Set(allowedIds || []);
  if (ids.size === 0) {
    const membershipSnapshot = await adminDb.collection(`schools/${schoolId}/memberships`).where('status', '==', 'active').limit(200).get();
    membershipSnapshot.docs.forEach(item => ids.add(item.id));
    const [legacy, modern] = await Promise.all([
      adminDb.collection('users').where('schoolId', '==', schoolId).limit(200).get(),
      adminDb.collection('users').where('schoolIds', 'array-contains', schoolId).limit(200).get(),
    ]);
    [...legacy.docs, ...modern.docs].forEach(item => ids.add(item.id));
  }
  const limited = [...ids].slice(0, 200);
  if (!limited.length) return [];
  const users = await adminDb.getAll(...limited.map(userId => adminDb.doc(`users/${userId}`)));
  return users.filter(snapshot => {
    if (!snapshot.exists || snapshot.data().accountStatus === 'disabled') return false;
    const data = snapshot.data();
    return data.schoolId === schoolId || (Array.isArray(data.schoolIds) && data.schoolIds.includes(schoolId));
  }).map(snapshot => ({
    id: snapshot.id,
    name: String(snapshot.data().fullName || 'איש צוות').trim().slice(0, 120),
  }));
}

async function participantForToken(boardRef, token) {
  if (!token) return null;
  const match = await boardRef.collection('publicAccessTokens').where('token', '==', token).limit(1).get();
  if (match.empty) return null;
  const snapshot = match.docs[0];
  return { ref: snapshot.ref, id: snapshot.id, ...snapshot.data() };
}

export async function configureCollectiveBrainPublicAccessHandler(request) {
  const input = configureSchema.parse(request.data);
  const actor = await requireBrainManager(request, input.schoolId);
  const boardRef = adminDb.doc(`schools/${input.schoolId}/collectiveBrainBoards/${input.boardId}`);
  const boardSnapshot = await boardRef.get();
  if (!boardSnapshot.exists || boardSnapshot.data().status === 'deleted') throw failedPrecondition();
  const board = boardSnapshot.data();
  const normalizedSettings = {
    schemaVersion: 2,
    audienceMode: board.audienceMode === 'restricted' ? 'restricted' : 'school',
    audienceUserIds: Array.isArray(board.audienceUserIds) ? board.audienceUserIds : [],
    audienceTeamIds: Array.isArray(board.audienceTeamIds) ? board.audienceTeamIds : [],
    maxResponsesPerUser: Math.min(20, Math.max(1, board.maxResponsesPerUser || 1)),
    responseSlots: Array.from({ length: Math.min(20, Math.max(1, board.maxResponsesPerUser || 1)) }, (_, index) => String(index + 1)),
    linkedTaskIds: Array.isArray(board.linkedTaskIds) ? board.linkedTaskIds : [],
  };

  if (!input.enabled) {
    const shareId = board.publicShareId || '';
    const batch = adminDb.batch();
    batch.update(boardRef, { ...normalizedSettings, visibility: 'private', publicShareId: '', updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
    if (shareId) batch.set(adminDb.doc(`collectiveBrainPublicShares/${shareId}`), { enabled: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
    return { enabled: false, shareId: '', participants: [] };
  }

  const shareId = board.publicShareId || secret();
  const staff = await schoolStaff(input.schoolId, board.audienceMode === 'restricted' ? board.audienceUserIds : []);
  const existing = await boardRef.collection('publicAccessTokens').get();
  const tokens = new Map(existing.docs.map(item => [item.id, item.data()]));
  const batch = adminDb.batch();
  existing.docs.filter(item => !staff.some(member => member.id === item.id)).forEach(item => {
    batch.set(item.ref, { active: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  const participants = staff.map(member => {
    const token = tokens.get(member.id)?.token || secret();
    batch.set(boardRef.collection('publicAccessTokens').doc(member.id), {
      schoolId: input.schoolId,
      boardId: input.boardId,
      userId: member.id,
      authorName: member.name,
      token,
      responseCount: tokens.get(member.id)?.responseCount || 0,
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { userId: member.id, authorName: member.name, token };
  });
  batch.update(boardRef, { ...normalizedSettings, visibility: 'public', publicShareId: shareId, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
  batch.set(adminDb.doc(`collectiveBrainPublicShares/${shareId}`), {
    enabled: true, schoolId: input.schoolId, boardId: input.boardId,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { enabled: true, shareId, participants };
}

export async function getPublicCollectiveBrainBoardHandler(request) {
  const input = publicReadSchema.parse(request.data);
  await enforceRateLimit({ uid: `public_${input.shareId}`, action: 'brain.read', limit: 1200, windowSeconds: 60 });
  const share = await adminDb.doc(`collectiveBrainPublicShares/${input.shareId}`).get();
  if (!share.exists || share.data().enabled !== true) throw publicError('not-found', 'board-not-public', 'הקישור אינו פעיל עוד.');
  const { schoolId, boardId } = share.data();
  const boardRef = adminDb.doc(`schools/${schoolId}/collectiveBrainBoards/${boardId}`);
  const boardSnapshot = await boardRef.get();
  if (!boardSnapshot.exists || boardSnapshot.data().visibility !== 'public' || boardSnapshot.data().publicShareId !== input.shareId || boardSnapshot.data().status === 'deleted') {
    throw publicError('not-found', 'board-not-public', 'הקישור אינו פעיל עוד.');
  }
  const board = boardSnapshot.data();
  const [responses, participant] = await Promise.all([
    boardRef.collection('responses').where('status', '==', 'active').get(),
    participantForToken(boardRef, input.participantToken),
  ]);
  return {
    board: {
      id: boardId, question: board.question, description: board.description || '', status: board.status,
      maxResponsesPerUser: board.maxResponsesPerUser || 1,
    },
    responses: responses.docs.map(item => {
      const data = item.data();
      return { id: item.id, authorName: data.authorName, body: data.body, createdAt: data.createdAt?.toMillis?.() || null, editedAt: data.editedAt?.toMillis?.() || null };
    }).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    participant: participant && (
      board.audienceMode !== 'restricted' || (board.audienceUserIds || []).includes(participant.userId)
    ) ? { authorName: participant.authorName, responseCount: participant.responseCount || 0 } : null,
  };
}

export async function submitPublicCollectiveBrainResponseHandler(request) {
  const input = publicSubmitSchema.parse(request.data);
  const share = await adminDb.doc(`collectiveBrainPublicShares/${input.shareId}`).get();
  if (!share.exists || share.data().enabled !== true) throw publicError('not-found', 'board-not-public', 'הקישור אינו פעיל עוד.');
  const { schoolId, boardId } = share.data();
  const boardRef = adminDb.doc(`schools/${schoolId}/collectiveBrainBoards/${boardId}`);
  const participant = await participantForToken(boardRef, input.participantToken);
  if (!participant || participant.active !== true) throw permissionDenied();
  await enforceRateLimit({ uid: tokenFingerprint(input.participantToken), action: 'brain.submit', limit: 10, windowSeconds: 3600 });

  await adminDb.runTransaction(async transaction => {
    const [boardSnapshot, tokenSnapshot] = await Promise.all([transaction.get(boardRef), transaction.get(participant.ref)]);
    const board = boardSnapshot.data();
    const token = tokenSnapshot.data();
    if (!boardSnapshot.exists || board.visibility !== 'public' || board.publicShareId !== input.shareId || board.status !== 'open' || token.active !== true
      || (board.audienceMode === 'restricted' && !(board.audienceUserIds || []).includes(token.userId))) throw failedPrecondition();
    const nextIndex = (token.responseCount || 0) + 1;
    if (nextIndex > (board.maxResponsesPerUser || 1)) throw publicError('failed-precondition', 'response-limit', 'הגעת למכסת התגובות בלוח.');
    const responseRef = boardRef.collection('responses').doc(`${token.userId}_public_${nextIndex}`);
    transaction.create(responseRef, {
      schoolId, boardId, authorId: token.userId, authorName: token.authorName,
      responseIndex: nextIndex, submissionSource: 'public_link', body: input.body,
      responseSlot: String(nextIndex),
      status: 'active', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      editedAt: null, moderatedBy: '', moderatedAt: null, deletedBy: '', deletedAt: null,
    });
    transaction.update(participant.ref, { responseCount: nextIndex, lastResponseAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
}

async function runSafely(handler, request) {
  try { return await handler(request); }
  catch (error) {
    logger.error('Collective brain operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

export const configureCollectiveBrainPublicAccess = onCall(CALLABLE_OPTIONS, request => runSafely(configureCollectiveBrainPublicAccessHandler, request));
export const getPublicCollectiveBrainBoard = onCall(CALLABLE_OPTIONS, request => runSafely(getPublicCollectiveBrainBoardHandler, request));
export const submitPublicCollectiveBrainResponse = onCall(CALLABLE_OPTIONS, request => runSafely(submitPublicCollectiveBrainResponseHandler, request));
