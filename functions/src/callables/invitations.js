import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import {
  acceptInvitationSchema,
  invitationActionSchema,
  staffInvitationSchema,
} from '../validation/schemas.js';
import {
  assertReferencesBelongToSchool,
  isInstitutionManagerFor,
  requireActor,
} from '../services/authorization.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { permissionDenied, toPublicError } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import {
  assertRoleCanBeGranted,
  getRole,
  requireRoleAction,
  resolveActorRoleAuthority,
} from '../services/roleAuthorization.js';
import {
  acceptInvitationToken,
  createInvitationRecord,
  rotateInvitationToken,
} from '../services/invitations.js';
import { EMAIL_PROVIDER_API_KEY } from '../services/email.js';
import { writeAuditLog } from '../services/audit.js';

const INVITATION_OPTIONS = { ...CALLABLE_OPTIONS, secrets: [EMAIL_PROVIDER_API_KEY] };

async function safely(handler, request) {
  try {
    return await handler(request);
  } catch (error) {
    logger.error('Invitation operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

async function invitationAuthority(actor, schoolId) {
  const authority = await resolveActorRoleAuthority(actor, schoolId);
  if (!isInstitutionManagerFor(actor, schoolId) && !actor.platformAdmin && !actor.globalAdmin) {
    requireRoleAction(authority, 'staff.invite');
  }
  return authority;
}

async function validateInvitationGrant(authority, input) {
  const requested = Object.entries(input.permissions).filter(([, enabled]) => enabled).map(([key]) => key);
  if (!authority.unrestricted && requested.some(key => !authority.permissions.has(key) || !authority.delegable.has(key))) {
    throw permissionDenied();
  }
  for (const roleId of input.customRoleIds) {
    const role = await getRole(roleId, input.schoolId);
    assertRoleCanBeGranted(authority, role.data);
  }
  await assertReferencesBelongToSchool(input.schoolId, 'teams', input.teamIds);
  await assertReferencesBelongToSchool(input.schoolId, 'classes', input.classIds);
}

export async function createStaffInvitationHandler(request) {
  const actor = await requireActor(request);
  const input = staffInvitationSchema.parse(request.data);
  const authority = await invitationAuthority(actor, input.schoolId);
  await validateInvitationGrant(authority, input);
  await enforceRateLimit({ uid: actor.uid, action: 'createStaffInvitation', limit: 10, windowSeconds: 300 });
  return createInvitationRecord({ actor, ...input });
}

export async function invitationActionHandler(request) {
  const actor = await requireActor(request);
  const input = invitationActionSchema.parse(request.data);
  await invitationAuthority(actor, input.schoolId);
  await enforceRateLimit({ uid: actor.uid, action: `invitation_${input.action}`, limit: 15, windowSeconds: 300 });
  if (input.action === 'resend') return rotateInvitationToken({ actor, ...input });

  const invitationRef = adminDb.doc(`schools/${input.schoolId}/invitations/${input.invitationId}`);
  const invitation = await invitationRef.get();
  if (!invitation.exists || !['pending', 'expired'].includes(invitation.data().status)) return { ok: true };
  const batch = adminDb.batch();
  batch.update(invitationRef, { status: 'revoked', revokedBy: actor.uid, reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  batch.delete(adminDb.collection('_invitationSecrets').doc(input.invitationId));
  await batch.commit();
  await writeAuditLog({ actorUid: actor.uid, action: 'staff.invitation.revoke', schoolId: input.schoolId, metadata: { invitationId: input.invitationId } });
  return { ok: true };
}

export async function acceptInvitationHandler(request) {
  const input = acceptInvitationSchema.parse(request.data);
  await enforceRateLimit({ uid: `invite_${input.invitationId}`, action: 'acceptInvitation', limit: 8, windowSeconds: 900 });
  return acceptInvitationToken(input);
}

export const createStaffInvitation = onCall(INVITATION_OPTIONS, request => safely(createStaffInvitationHandler, request));
export const manageStaffInvitation = onCall(INVITATION_OPTIONS, request => safely(invitationActionHandler, request));
export const acceptStaffInvitation = onCall(INVITATION_OPTIONS, request => safely(acceptInvitationHandler, request));
