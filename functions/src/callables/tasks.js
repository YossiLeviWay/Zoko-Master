import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, publicError, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { requireRoleAction, resolveActorRoleAuthority } from '../services/roleAuthorization.js';
import {
  mandatoryTaskSchema,
  taskCollaboratorInvitationSchema,
  taskInvitationResponseSchema,
} from '../validation/schemas.js';

function stableId(...parts) {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 40);
}

function belongsToSchool(data, schoolId) {
  return data?.schoolId === schoolId || (Array.isArray(data?.schoolIds) && data.schoolIds.includes(schoolId));
}

async function requireSchoolAccess(actor, schoolId) {
  if (actor.platformAdmin || actor.globalAdmin || actor.schoolIds.has(schoolId)) return;
  const membership = await adminDb.doc(`schools/${schoolId}/memberships/${actor.uid}`).get();
  if (!membership.exists || membership.data().status !== 'active') throw permissionDenied();
}

async function activeRecipients(schoolId, recipientIds) {
  const snapshots = await adminDb.getAll(...recipientIds.map(uid => adminDb.collection('users').doc(uid)));
  if (snapshots.some(item => !item.exists || item.data().accountStatus === 'disabled' || !belongsToSchool(item.data(), schoolId))) {
    throw permissionDenied();
  }
  return snapshots;
}

function notification(batch, { userId, schoolId, title, body, link }) {
  batch.create(adminDb.collection('notifications').doc(), {
    userId, schoolId, title, body, link, type: 'task', read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function inviteTaskCollaboratorsHandler(request) {
  const actor = await requireActor(request);
  const input = taskCollaboratorInvitationSchema.parse(request.data);
  await requireSchoolAccess(actor, input.schoolId);
  if (input.recipientIds.includes(actor.uid)) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'taskInvite', limit: 30, windowSeconds: 300 });
  const taskRef = adminDb.doc(`users/${actor.uid}/personalTasks/${input.personalTaskId}`);
  const task = await taskRef.get();
  if (!task.exists || task.data().ownerId !== actor.uid || task.data().schoolId !== input.schoolId) throw permissionDenied();
  const recipients = await activeRecipients(input.schoolId, input.recipientIds);
  const batch = adminDb.batch();
  recipients.forEach(recipient => {
    const invitationId = stableId(actor.uid, input.personalTaskId, recipient.id);
    const ref = adminDb.doc(`schools/${input.schoolId}/taskInvitations/${invitationId}`);
    batch.set(ref, {
      schoolId: input.schoolId,
      sourceOwnerId: actor.uid,
      sourceTaskId: input.personalTaskId,
      recipientId: recipient.id,
      inviterId: actor.uid,
      inviterName: actor.data.fullName || '',
      title: task.data().title,
      description: task.data().description || '',
      dueDate: task.data().dueDate || '',
      priority: task.data().priority || 'medium',
      message: input.message,
      status: 'pending',
      response: '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    notification(batch, { userId: recipient.id, schoolId: input.schoolId, title: 'הזמנה לשיתוף במשימה', body: task.data().title, link: '/tasks?view=invitations' });
  });
  await batch.commit();
  await writeAuditLog({ actorUid: actor.uid, action: 'task.invitation.create', schoolId: input.schoolId, metadata: { recipientCount: recipients.length } });
  return { ok: true, createdCount: recipients.length };
}

export async function respondTaskInvitationHandler(request) {
  const actor = await requireActor(request);
  const input = taskInvitationResponseSchema.parse(request.data);
  await requireSchoolAccess(actor, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: 'taskInvitationResponse', limit: 30, windowSeconds: 300 });
  const invitationRef = adminDb.doc(`schools/${input.schoolId}/taskInvitations/${input.invitationId}`);
  const invitationSnapshot = await invitationRef.get();
  if (!invitationSnapshot.exists || invitationSnapshot.data().status !== 'pending') {
    throw publicError('failed-precondition', 'task-invitation-not-pending', 'ההזמנה כבר טופלה.');
  }
  const invitation = invitationSnapshot.data();
  if (input.action === 'cancel') {
    if (invitation.inviterId !== actor.uid) throw permissionDenied();
    await invitationRef.update({ status: 'cancelled', response: input.response, updatedAt: FieldValue.serverTimestamp() });
  } else {
    if (invitation.recipientId !== actor.uid) throw permissionDenied();
    const sourceRef = adminDb.doc(`users/${invitation.sourceOwnerId}/personalTasks/${invitation.sourceTaskId}`);
    const sourceSnapshot = await sourceRef.get();
    if (!sourceSnapshot.exists) throw publicError('not-found', 'task-not-found', 'המשימה אינה זמינה עוד.');
    const sharedTaskId = `shared_${stableId(invitation.sourceOwnerId, invitation.sourceTaskId)}`;
    const sharedRef = adminDb.doc(`schools/${input.schoolId}/tasks/${sharedTaskId}`);
    const batch = adminDb.batch();
    if (input.action === 'accept') {
      const source = sourceSnapshot.data();
      batch.set(sharedRef, {
        title: source.title,
        description: source.description || '',
        dueDate: source.dueDate || '',
        priority: source.priority || 'medium',
        status: source.status || 'todo',
        schoolId: input.schoolId,
        scope: 'shared',
        assigneeType: 'participants',
        createdBy: invitation.sourceOwnerId,
        createdByName: invitation.inviterName,
        sourcePersonalTaskId: invitation.sourceTaskId,
        participantIds: FieldValue.arrayUnion(invitation.sourceOwnerId, actor.uid),
        mandatory: false,
        createdAt: source.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(sharedRef.collection('participants').doc(actor.uid), { userId: actor.uid, role: 'collaborator', status: 'active', joinedAt: FieldValue.serverTimestamp() });
      batch.set(sharedRef.collection('participants').doc(invitation.sourceOwnerId), { userId: invitation.sourceOwnerId, role: 'owner', status: 'active', joinedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    batch.update(invitationRef, { status: input.action === 'accept' ? 'accepted' : 'declined', response: input.response, respondedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), ...(input.action === 'accept' ? { sharedTaskId } : {}) });
    notification(batch, { userId: invitation.sourceOwnerId, schoolId: input.schoolId, title: input.action === 'accept' ? 'הזמנת המשימה התקבלה' : 'הזמנת המשימה נדחתה', body: invitation.title, link: '/tasks?view=created' });
    await batch.commit();
  }
  await writeAuditLog({ actorUid: actor.uid, action: `task.invitation.${input.action}`, schoolId: input.schoolId, metadata: { invitationId: input.invitationId } });
  return { ok: true };
}

export async function createMandatoryTaskHandler(request) {
  const actor = await requireActor(request);
  const input = mandatoryTaskSchema.parse(request.data);
  await requireSchoolAccess(actor, input.schoolId);
  const authority = await resolveActorRoleAuthority(actor, input.schoolId);
  requireRoleAction(authority, 'tasks.assignMandatory');
  if (input.recipientIds.includes(actor.uid)) throw permissionDenied();
  await enforceRateLimit({ uid: actor.uid, action: 'mandatoryTask', limit: 20, windowSeconds: 300 });
  const recipients = await activeRecipients(input.schoolId, input.recipientIds);
  const taskRef = adminDb.collection(`schools/${input.schoolId}/tasks`).doc();
  const batch = adminDb.batch();
  batch.create(taskRef, {
    schoolId: input.schoolId,
    title: input.title,
    description: input.description,
    dueDate: input.dueDate,
    priority: input.priority,
    status: 'todo',
    scope: 'assigned',
    assigneeType: 'individual',
    assigneeIds: input.recipientIds,
    mandatory: true,
    assignedBy: actor.uid,
    assignedByName: actor.data.fullName || '',
    assignmentAuthority: 'tasks.assignMandatory',
    createdBy: actor.uid,
    createdByName: actor.data.fullName || '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  recipients.forEach(recipient => {
    batch.set(taskRef.collection('participants').doc(recipient.id), { userId: recipient.id, role: 'assignee', status: 'active', acknowledgedAt: null, joinedAt: FieldValue.serverTimestamp() });
    notification(batch, { userId: recipient.id, schoolId: input.schoolId, title: 'משימה מחייבת חדשה', body: input.title, link: `/tasks?task=${taskRef.id}` });
  });
  await batch.commit();
  await writeAuditLog({ actorUid: actor.uid, action: 'task.mandatory.create', schoolId: input.schoolId, metadata: { taskId: taskRef.id, recipientCount: recipients.length } });
  return { ok: true, taskId: taskRef.id };
}

async function safely(handler, request) {
  try {
    return await handler(request);
  } catch (error) {
    logger.error('Task collaboration operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

export const inviteTaskCollaborators = onCall(CALLABLE_OPTIONS, request => safely(inviteTaskCollaboratorsHandler, request));
export const respondTaskInvitation = onCall(CALLABLE_OPTIONS, request => safely(respondTaskInvitationHandler, request));
export const createMandatoryTask = onCall(CALLABLE_OPTIONS, request => safely(createMandatoryTaskHandler, request));
