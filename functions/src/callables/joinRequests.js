import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { joinRequestSchema, reviewJoinRequestSchema } from '../validation/schemas.js';
import { isInstitutionManagerFor, requireActor } from '../services/authorization.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, publicError, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { requireRoleAction, resolveActorRoleAuthority } from '../services/roleAuthorization.js';
import { createInvitationRecord, normalizeEmail } from '../services/invitations.js';
import { EMAIL_PROVIDER_API_KEY } from '../services/email.js';
import { writeAuditLog } from '../services/audit.js';

const JOIN_OPTIONS = { ...CALLABLE_OPTIONS, secrets: [EMAIL_PROVIDER_API_KEY] };
const GENERIC_RESPONSE = Object.freeze({ ok: true, message: 'הבקשה התקבלה ותועבר לבדיקת מנהל המוסד.' });

async function safely(handler, request) {
  try {
    return await handler(request);
  } catch (error) {
    logger.error('Join request operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

function opaqueKey(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 40);
}

export async function submitJoinRequestHandler(request) {
  const input = joinRequestSchema.parse(request.data);
  const normalizedEmail = normalizeEmail(input.email);
  const ip = String(request.rawRequest?.ip || request.rawRequest?.headers?.['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  await Promise.all([
    enforceRateLimit({ uid: `ip_${opaqueKey(ip)}`, action: 'joinRequest', limit: 8, windowSeconds: 3600 }),
    enforceRateLimit({ uid: `email_${opaqueKey(normalizedEmail)}`, action: `join_${input.schoolId}`, limit: 3, windowSeconds: 86400 }),
  ]);

  const directory = await adminDb.collection('schoolPublicDirectory').doc(input.schoolId).get();
  if (!directory.exists || directory.data().status !== 'active') {
    throw publicError('not-found', 'school-not-found', 'המוסד אינו זמין לקבלת בקשות.');
  }
  const requestId = opaqueKey(`${input.schoolId}\u0000${normalizedEmail}`);
  const ref = adminDb.doc(`schools/${input.schoolId}/joinRequests/${requestId}`);
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists && ['pending', 'invited', 'approved'].includes(snapshot.data().status)) return;
    transaction.set(ref, {
      schoolId: input.schoolId,
      fullName: input.fullName,
      normalizedEmail,
      message: input.message,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      reviewedAt: null,
      reviewedBy: '',
      rejectionReason: '',
    });
  });
  return GENERIC_RESPONSE;
}

async function reviewAuthority(actor, schoolId) {
  const authority = await resolveActorRoleAuthority(actor, schoolId);
  if (!isInstitutionManagerFor(actor, schoolId) && !actor.platformAdmin && !actor.globalAdmin) {
    requireRoleAction(authority, 'staff.reviewJoinRequests');
  }
  return authority;
}

export async function reviewJoinRequestHandler(request) {
  const actor = await requireActor(request);
  const input = reviewJoinRequestSchema.parse(request.data);
  const authority = await reviewAuthority(actor, input.schoolId);
  const ref = adminDb.doc(`schools/${input.schoolId}/joinRequests/${input.requestId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data().status !== 'pending') {
    throw publicError('failed-precondition', 'join-request-not-pending', 'הבקשה כבר טופלה.');
  }
  const item = snapshot.data();
  if (input.action === 'invite') {
    if (!input.role) throw publicError('invalid-argument', 'role-required', 'יש לבחור תפקיד.');
    const requested = Object.entries(input.permissions).filter(([, enabled]) => enabled).map(([key]) => key);
    if (!authority.unrestricted && requested.some(key => !authority.permissions.has(key) || !authority.delegable.has(key))) {
      throw permissionDenied();
    }
    const result = await createInvitationRecord({
      actor,
      schoolId: input.schoolId,
      fullName: item.fullName,
      email: item.normalizedEmail,
      role: input.role,
      customRoleIds: input.customRoleIds,
      teamIds: input.teamIds,
      classIds: input.classIds,
      permissions: input.permissions,
      sourceJoinRequestId: input.requestId,
    });
    await ref.update({ status: 'invited', reviewedAt: FieldValue.serverTimestamp(), reviewedBy: actor.uid, invitationId: result.invitationId, updatedAt: FieldValue.serverTimestamp() });
  } else {
    await ref.update({ status: 'rejected', reviewedAt: FieldValue.serverTimestamp(), reviewedBy: actor.uid, rejectionReason: input.rejectionReason, updatedAt: FieldValue.serverTimestamp() });
  }
  await writeAuditLog({ actorUid: actor.uid, action: `join_request.${input.action}`, schoolId: input.schoolId, metadata: { requestId: input.requestId } });
  return { ok: true };
}

export const submitJoinRequest = onCall(JOIN_OPTIONS, request => safely(submitJoinRequestHandler, request));
export const reviewJoinRequest = onCall(JOIN_OPTIONS, request => safely(reviewJoinRequestHandler, request));
