import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { supportTicketSchema, supportTicketUpdateSchema } from '../validation/schemas.js';
import { requireActor } from '../services/authorization.js';
import { writeAuditLog } from '../services/audit.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { requirePlatformAdmin } from '../services/platformSecurity.js';
import { resolveActorRoleAuthority } from '../services/roleAuthorization.js';

async function canCreateTicket(actor, schoolId) {
  if (!actor.schoolIds.has(schoolId)) return false;
  if (['principal', 'institution_manager'].includes(actor.data.rolesBySchool?.[schoolId] || actor.data.role)) return true;
  const authority = await resolveActorRoleAuthority(actor, schoolId);
  return authority.permissions.has('support.create');
}

async function assertSupportAttachments(actor, attachmentIds) {
  if (!attachmentIds.length) return;
  const refs = attachmentIds.map(id => adminDb.doc(`supportAttachments/${id}`));
  const snapshots = await adminDb.getAll(...refs);
  if (snapshots.some(snapshot => !snapshot.exists || snapshot.data().uploadedBy !== actor.uid || snapshot.data().status !== 'uploaded')) throw permissionDenied();
}

export async function createSupportTicketHandler(request) {
  const actor = await requireActor(request);
  const input = supportTicketSchema.parse(request.data);
  if (!await canCreateTicket(actor, input.schoolId)) throw permissionDenied();
  await assertSupportAttachments(actor, input.attachmentIds);
  await enforceRateLimit({ uid: actor.uid, action: 'support.ticket.create', limit: 10, windowSeconds: 3600 });
  const ref = adminDb.collection('supportTickets').doc();
  await ref.create({
    schoolId: input.schoolId,
    institutionId: input.schoolId,
    title: input.title,
    description: input.description,
    issueType: input.issueType,
    urgency: input.urgency,
    attachmentIds: input.attachmentIds,
    technicalContext: input.technicalContext,
    status: 'open',
    createdBy: actor.uid,
    participantIds: [actor.uid],
    assignedPlatformAdminId: '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAuditLog({ actorUid: actor.uid, actorRole: actor.data.role || '', action: 'support.ticket.create', targetType: 'supportTicket', targetId: ref.id, schoolId: input.schoolId, after: { issueType: input.issueType, urgency: input.urgency, status: 'open' }, collectionName: 'platformAuditLogs' });
  return { ticketId: ref.id };
}

export async function updateSupportTicketHandler(request) {
  const actor = await requireActor(request);
  requirePlatformAdmin(actor);
  const input = supportTicketUpdateSchema.parse(request.data);
  await enforceRateLimit({ uid: actor.uid, action: 'support.ticket.update', limit: 30, windowSeconds: 300 });
  const ref = adminDb.doc(`supportTickets/${input.ticketId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw permissionDenied();
  const update = {
    status: input.status,
    assignedPlatformAdminId: actor.uid,
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
    ...(input.response ? { lastResponse: input.response, lastResponseAt: FieldValue.serverTimestamp() } : {}),
  };
  await ref.update(update);
  await ref.collection('responses').add({ body: input.response, status: input.status, authorId: actor.uid, authorRole: 'platform_admin', createdAt: FieldValue.serverTimestamp() });
  await writeAuditLog({ actorUid: actor.uid, actorRole: 'platform_admin', action: 'support.ticket.update', targetType: 'supportTicket', targetId: input.ticketId, schoolId: snapshot.data().schoolId, reason: input.reason, before: { status: snapshot.data().status }, after: { status: input.status }, collectionName: 'platformAuditLogs' });
  return { ok: true };
}

async function runSafely(handler, request) {
  try { return await handler(request); }
  catch (error) {
    logger.error('Support operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

export const createSupportTicket = onCall(CALLABLE_OPTIONS, request => runSafely(createSupportTicketHandler, request));
export const updateSupportTicket = onCall(CALLABLE_OPTIONS, request => runSafely(updateSupportTicketHandler, request));
