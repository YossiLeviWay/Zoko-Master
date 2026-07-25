import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import {
  forumAccessRequestSchema,
  forumAccessReviewSchema,
  forumContentActionSchema,
  forumFolderSchema,
  forumMembershipRevokeSchema,
  forumPostSchema,
  forumThreadSchema,
} from '../validation/schemas.js';
import { requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { failedPrecondition, permissionDenied, publicError, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { requirePlatformAdmin, requireRecentMfa } from '../services/platformSecurity.js';

const ROOT = 'platformForum/root';
const DELEGABLE = new Set([
  'forum.createThread', 'forum.reply', 'forum.editOwnPost', 'forum.deleteOwnPost',
  'forum.uploadAttachment', 'forum.createFolder', 'forum.editFolder', 'forum.pinThread',
  'forum.lockThread', 'forum.moderate',
]);
const ALL = new Set(['forum.access', 'forum.read', ...DELEGABLE, 'forum.managePermissions', 'forum.approveDelegates', 'forum.viewAuditLog']);
const MANAGER_DEFAULTS = new Set([
  'forum.access', 'forum.read', 'forum.createThread', 'forum.reply',
  'forum.editOwnPost', 'forum.deleteOwnPost', 'forum.uploadAttachment',
  'forum.createFolder', 'forum.editFolder',
]);

function activeManagerSchoolIds(actor) {
  return [...actor.schoolIds].filter(schoolId => (
    ['principal', 'institution_manager'].includes(actor.data.rolesBySchool?.[schoolId] || actor.data.role)
  ));
}

async function forumAuthority(actor) {
  if (actor.platformAdmin) return { permissions: ALL, schoolIds: new Set(), platformAdmin: true };
  const managerSchools = activeManagerSchoolIds(actor);
  const snapshot = await adminDb.doc(`platformForumMemberships/${actor.uid}`).get();
  const membership = snapshot.exists ? snapshot.data() : null;
  const activeMembership = membership?.status === 'active'
    && (!membership.expiresAt || membership.expiresAt.toMillis() > Date.now());
  const permissions = new Set();
  if (managerSchools.length) {
    MANAGER_DEFAULTS.forEach(permission => permissions.add(permission));
  }
  if (activeMembership) (membership.permissions || []).forEach(permission => permissions.add(permission));
  return { permissions, schoolIds: new Set(activeMembership ? [membership.schoolId] : managerSchools), platformAdmin: false, membership };
}

function requireForumPermission(authority, permission) {
  if (!authority.permissions.has('forum.access') || !authority.permissions.has(permission)) throw permissionDenied();
}

async function publicIdentity(actor) {
  const schoolId = actor.data.activeSchoolId || actor.data.schoolId || [...actor.schoolIds][0] || '';
  const school = schoolId ? await adminDb.doc(`schoolPublicDirectory/${schoolId}`).get() : null;
  return {
    userId: actor.uid,
    fullName: actor.data.fullName || actor.data.displayName || 'משתמש',
    publicRole: actor.platformAdmin ? 'מנהל הפלטפורמה' : ['principal', 'institution_manager'].includes(actor.data.rolesBySchool?.[schoolId] || actor.data.role) ? 'מנהל מוסד' : (actor.data.forumPublicRole || 'איש צוות'),
    schoolId,
    schoolName: school?.data()?.name || '',
    avatarUrl: actor.data.publicAvatarEnabled === true ? (actor.data.photoURL || '') : '',
  };
}

async function assertAttachments(actor, attachmentIds) {
  if (!attachmentIds.length) return;
  const refs = attachmentIds.map(id => adminDb.doc(`${ROOT}/attachments/${id}`));
  const snapshots = await adminDb.getAll(...refs);
  if (snapshots.some(snapshot => !snapshot.exists || snapshot.data().uploadedBy !== actor.uid || snapshot.data().status !== 'uploaded')) {
    throw permissionDenied();
  }
}

export async function requestForumAccessHandler(request) {
  const actor = await requireActor(request);
  const input = forumAccessRequestSchema.parse(request.data);
  if (!activeManagerSchoolIds(actor).includes(input.schoolId)) throw permissionDenied();
  if (input.requestedPermissions.some(permission => !DELEGABLE.has(permission))) throw permissionDenied();
  const [target, school] = await adminDb.getAll(adminDb.doc(`users/${input.userId}`), adminDb.doc(`schools/${input.schoolId}`));
  if (!target.exists || !school.exists || target.data().accountStatus !== 'active'
    || !(target.data().schoolIds || [target.data().schoolId]).includes(input.schoolId)) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'forum.access.request', limit: 20, windowSeconds: 3600 });
  const ref = adminDb.collection('platformForumAccessRequests').doc();
  await ref.create({
    schoolId: input.schoolId,
    institutionId: input.schoolId,
    userId: input.userId,
    requestedPermissions: input.requestedPermissions,
    reason: input.reason,
    expiresAt: input.expiresAt ? Timestamp.fromDate(new Date(input.expiresAt)) : null,
    status: 'pending_admin_approval',
    requestedBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAuditLog({ actorUid: actor.uid, actorRole: actor.data.role || '', action: 'forum.access.request', targetType: 'forumAccessRequest', targetId: ref.id, schoolId: input.schoolId, reason: input.reason, after: { permissionCount: input.requestedPermissions.length, status: 'pending_admin_approval' }, collectionName: 'platformAuditLogs' });
  return { requestId: ref.id, status: 'pending_admin_approval' };
}

export async function reviewForumAccessHandler(request) {
  const actor = await requireActor(request);
  requirePlatformAdmin(actor);
  requireRecentMfa(request);
  const input = forumAccessReviewSchema.parse(request.data);
  if (input.approvedPermissions.some(permission => !DELEGABLE.has(permission))) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'forum.access.review', limit: 30, windowSeconds: 300 });
  const requestRef = adminDb.doc(`platformForumAccessRequests/${input.requestId}`);
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists || !['pending_admin_approval', 'clarification_requested'].includes(snapshot.data().status)) throw failedPrecondition();
    const accessRequest = snapshot.data();
    if (input.approvedPermissions.some(permission => !accessRequest.requestedPermissions.includes(permission))) throw permissionDenied();
    const nextStatus = input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'clarification_requested';
    transaction.update(requestRef, { status: nextStatus, approvedPermissions: input.action === 'approve' ? input.approvedPermissions : [], reviewedBy: actor.uid, reviewReason: input.reason, reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    if (input.action === 'approve') {
      transaction.set(adminDb.doc(`platformForumMemberships/${accessRequest.userId}`), {
        userId: accessRequest.userId,
        schoolId: accessRequest.schoolId,
        institutionId: accessRequest.schoolId,
        status: 'active',
        permissions: ['forum.access', 'forum.read', ...input.approvedPermissions],
        approvedRequestId: input.requestId,
        expiresAt: input.expiresAt ? Timestamp.fromDate(new Date(input.expiresAt)) : accessRequest.expiresAt || null,
        approvedBy: actor.uid,
        approvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    if (input.action !== 'clarification') {
      [accessRequest.userId, accessRequest.requestedBy].forEach(userId => {
        transaction.create(adminDb.collection('notifications').doc(), {
          userId,
          schoolId: accessRequest.schoolId,
          title: input.action === 'approve' ? 'בקשת הגישה לפורום אושרה' : 'בקשת הגישה לפורום נדחתה',
          body: input.reason,
          type: 'system',
          link: '/forum',
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      });
    }
  });
  await writeAuditLog({ actorUid: actor.uid, actorRole: 'platform_admin', action: `forum.access.${input.action}`, targetType: 'forumAccessRequest', targetId: input.requestId, reason: input.reason, requestId: input.requestId, after: { permissionCount: input.approvedPermissions.length, action: input.action }, collectionName: 'platformAuditLogs' });
  return { requestId: input.requestId, status: input.action };
}

export async function revokeForumMembershipHandler(request) {
  const actor = await requireActor(request);
  const input = forumMembershipRevokeSchema.parse(request.data);
  const ref = adminDb.doc(`platformForumMemberships/${input.membershipId}`);
  const membership = await ref.get();
  if (!membership.exists) throw failedPrecondition();
  if (actor.platformAdmin) requireRecentMfa(request);
  else if (!activeManagerSchoolIds(actor).includes(membership.data().schoolId)) throw permissionDenied();
  await ref.update({ status: 'revoked', permissions: [], revokedBy: actor.uid, revokeReason: input.reason, revokedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  await writeAuditLog({ actorUid: actor.uid, actorRole: actor.platformAdmin ? 'platform_admin' : actor.data.role || '', action: 'forum.access.revoke', targetType: 'forumMembership', targetId: ref.id, schoolId: membership.data().schoolId, reason: input.reason, before: { status: membership.data().status }, after: { status: 'revoked' }, collectionName: 'platformAuditLogs' });
  return { ok: true };
}

export async function upsertForumFolderHandler(request) {
  const actor = await requireActor(request);
  const input = forumFolderSchema.parse(request.data);
  const authority = await forumAuthority(actor);
  requireForumPermission(authority, input.folderId ? 'forum.editFolder' : 'forum.createFolder');
  const ref = input.folderId ? adminDb.doc(`${ROOT}/folders/${input.folderId}`) : adminDb.collection(`${ROOT}/folders`).doc();
  if (input.folderId && !(await ref.get()).exists) throw failedPrecondition();
  await ref.set({ name: input.name, description: input.description, status: 'active', updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(), ...(input.folderId ? {} : { createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() }) }, { merge: Boolean(input.folderId) });
  await writeAuditLog({ actorUid: actor.uid, actorRole: actor.platformAdmin ? 'platform_admin' : actor.data.role || '', action: input.folderId ? 'forum.folder.update' : 'forum.folder.create', targetType: 'forumFolder', targetId: ref.id, collectionName: 'platformAuditLogs' });
  return { folderId: ref.id };
}

export async function createForumThreadHandler(request) {
  const actor = await requireActor(request);
  const input = forumThreadSchema.parse(request.data);
  const authority = await forumAuthority(actor);
  requireForumPermission(authority, 'forum.createThread');
  await assertAttachments(actor, input.attachmentIds);
  if (!(await adminDb.doc(`${ROOT}/folders/${input.folderId}`).get()).exists) throw failedPrecondition();
  await enforceRateLimit({ uid: actor.uid, action: 'forum.thread.create', limit: 10, windowSeconds: 3600 });
  const identity = await publicIdentity(actor);
  const ref = adminDb.collection(`${ROOT}/threads`).doc();
  await ref.create({ folderId: input.folderId, title: input.title, body: input.body, attachmentIds: input.attachmentIds, authorId: actor.uid, author: identity, status: 'active', pinned: false, locked: false, replyCount: 0, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  await writeAuditLog({ actorUid: actor.uid, actorRole: identity.publicRole, action: 'forum.thread.create', targetType: 'forumThread', targetId: ref.id, schoolId: identity.schoolId || null, collectionName: 'platformAuditLogs' });
  return { threadId: ref.id };
}

export async function createForumPostHandler(request) {
  const actor = await requireActor(request);
  const input = forumPostSchema.parse(request.data);
  const authority = await forumAuthority(actor);
  requireForumPermission(authority, 'forum.reply');
  await assertAttachments(actor, input.attachmentIds);
  const threadRef = adminDb.doc(`${ROOT}/threads/${input.threadId}`);
  const thread = await threadRef.get();
  if (!thread.exists || thread.data().status !== 'active' || thread.data().locked === true) throw failedPrecondition();
  await enforceRateLimit({ uid: actor.uid, action: 'forum.post.create', limit: 30, windowSeconds: 300 });
  const identity = await publicIdentity(actor);
  const postRef = threadRef.collection('posts').doc();
  const batch = adminDb.batch();
  batch.create(postRef, { threadId: input.threadId, body: input.body, attachmentIds: input.attachmentIds, authorId: actor.uid, author: identity, status: 'active', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  batch.update(threadRef, { replyCount: FieldValue.increment(1), lastReplyAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  (thread.data().followers || []).filter(userId => userId !== actor.uid).slice(0, 100).forEach(userId => {
    batch.create(adminDb.collection('notifications').doc(), {
      userId,
      schoolId: identity.schoolId || '',
      title: 'תגובה חדשה בדיון במעקב',
      body: thread.data().title || '',
      type: 'system',
      link: '/forum',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
  return { postId: postRef.id };
}

export async function forumContentActionHandler(request) {
  const actor = await requireActor(request);
  const input = forumContentActionSchema.parse(request.data);
  const authority = await forumAuthority(actor);
  requireForumPermission(authority, 'forum.read');
  const threadRef = adminDb.doc(`${ROOT}/threads/${input.threadId}`);
  const targetRef = input.targetType === 'post' ? threadRef.collection('posts').doc(input.postId) : threadRef;
  const target = await targetRef.get();
  if (!target.exists) throw failedPrecondition();
  const own = target.data().authorId === actor.uid;
  const moderate = authority.permissions.has('forum.moderate');
  if (input.action === 'edit') {
    if (!(own && authority.permissions.has('forum.editOwnPost')) && !moderate) throw permissionDenied();
    if (!input.body) throw failedPrecondition();
    await targetRef.update({ body: input.body, editedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  } else if (input.action === 'delete') {
    if (!(own && authority.permissions.has('forum.deleteOwnPost')) && !moderate) throw permissionDenied();
    await targetRef.update({ status: 'deleted', body: '', attachmentIds: [], deletedBy: actor.uid, deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  } else if (input.action === 'pin') {
    requireForumPermission(authority, 'forum.pinThread');
    if (input.targetType !== 'thread') throw failedPrecondition();
    await threadRef.update({ pinned: !target.data().pinned, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
  } else if (input.action === 'lock') {
    requireForumPermission(authority, 'forum.lockThread');
    if (input.targetType !== 'thread') throw failedPrecondition();
    await threadRef.update({ locked: !target.data().locked, updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
  } else if (input.action === 'follow') {
    if (input.targetType !== 'thread') throw failedPrecondition();
    const followers = target.data().followers || [];
    await threadRef.update({
      followers: followers.includes(actor.uid) ? FieldValue.arrayRemove(actor.uid) : FieldValue.arrayUnion(actor.uid),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    const reportRef = adminDb.collection(`${ROOT}/reports`).doc();
    await reportRef.create({ targetType: input.targetType, threadId: input.threadId, postId: input.postId || '', reason: input.reason || '', reportedBy: actor.uid, status: 'open', createdAt: FieldValue.serverTimestamp() });
  }
  await writeAuditLog({ actorUid: actor.uid, actorRole: actor.platformAdmin ? 'platform_admin' : actor.data.role || '', action: `forum.content.${input.action}`, targetType: input.targetType, targetId: targetRef.id, reason: input.reason || '', collectionName: 'platformAuditLogs' });
  return { ok: true };
}

async function runSafely(handler, request) {
  try { return await handler(request); }
  catch (error) {
    logger.error('Forum operation failed.', { code: error?.code || 'unknown' });
    const safeError = toPublicError(error);
    if (safeError.code === 'internal') throw publicError('internal', 'forum-service-error');
    throw safeError;
  }
}

export const requestForumAccess = onCall(CALLABLE_OPTIONS, request => runSafely(requestForumAccessHandler, request));
export const reviewForumAccess = onCall(CALLABLE_OPTIONS, request => runSafely(reviewForumAccessHandler, request));
export const revokeForumMembership = onCall(CALLABLE_OPTIONS, request => runSafely(revokeForumMembershipHandler, request));
export const upsertForumFolder = onCall(CALLABLE_OPTIONS, request => runSafely(upsertForumFolderHandler, request));
export const createForumThread = onCall(CALLABLE_OPTIONS, request => runSafely(createForumThreadHandler, request));
export const createForumPost = onCall(CALLABLE_OPTIONS, request => runSafely(createForumPostHandler, request));
export const forumContentAction = onCall(CALLABLE_OPTIONS, request => runSafely(forumContentActionHandler, request));
