import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { CALLABLE_OPTIONS } from '../config.js';
import { activeSchoolSchema, publicPasswordResetSchema } from '../validation/schemas.js';
import { requireActor } from '../services/authorization.js';
import { adminAuth, adminDb } from '../services/firebaseAdmin.js';
import { toPublicError, permissionDenied } from '../services/errors.js';
import { enforceRateLimit } from '../services/rateLimit.js';
import { APP_BASE_URL, EMAIL_PROVIDER_API_KEY, sendPasswordResetLinkEmail } from '../services/email.js';
import { findAuthUserByEmail, normalizeEmail } from '../services/invitations.js';
import { writeAuditLog } from '../services/audit.js';

const AUTH_EMAIL_OPTIONS = { ...CALLABLE_OPTIONS, secrets: [EMAIL_PROVIDER_API_KEY] };

async function safely(handler, request) {
  try {
    return await handler(request);
  } catch (error) {
    logger.error('Authentication support operation failed.', { code: error?.code || 'unknown' });
    throw toPublicError(error);
  }
}

function hasLegacyMembership(data, schoolId) {
  return data?.schoolId === schoolId || (Array.isArray(data?.schoolIds) && data.schoolIds.includes(schoolId));
}

export async function setActiveSchoolHandler(request) {
  const actor = await requireActor(request);
  const input = activeSchoolSchema.parse(request.data);
  const [school, membership] = await Promise.all([
    adminDb.collection('schools').doc(input.schoolId).get(),
    adminDb.doc(`schools/${input.schoolId}/memberships/${actor.uid}`).get(),
  ]);
  if (!school.exists || school.data().status === 'disabled') throw permissionDenied();
  const activeMembership = membership.exists && membership.data().status === 'active';
  if (!actor.platformAdmin && !actor.globalAdmin && !activeMembership && !hasLegacyMembership(actor.data, input.schoolId)) {
    throw permissionDenied();
  }
  await adminDb.collection('users').doc(actor.uid).update({
    activeSchoolId: input.schoolId,
    activeSchoolChangedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, schoolId: input.schoolId };
}

export async function requestPublicPasswordResetHandler(request) {
  const input = publicPasswordResetSchema.parse(request.data);
  const normalizedEmail = normalizeEmail(input.email);
  const rateKey = createHash('sha256').update(`${input.schoolId}\u0000${normalizedEmail}`).digest('hex').slice(0, 40);
  await enforceRateLimit({ uid: `reset_${rateKey}`, action: 'publicPasswordReset', limit: 4, windowSeconds: 3600 });
  try {
    const [directory, authUser] = await Promise.all([
      adminDb.collection('schoolPublicDirectory').doc(input.schoolId).get(),
      findAuthUserByEmail(normalizedEmail),
    ]);
    if (!directory.exists || directory.data().status !== 'active' || !authUser) return { ok: true };
    const [profile, membership] = await Promise.all([
      adminDb.collection('users').doc(authUser.uid).get(),
      adminDb.doc(`schools/${input.schoolId}/memberships/${authUser.uid}`).get(),
    ]);
    if (!profile.exists || (!hasLegacyMembership(profile.data(), input.schoolId) && !(membership.exists && membership.data().status === 'active'))) return { ok: true };
    const resetLink = await adminAuth.generatePasswordResetLink(normalizedEmail, {
      url: `${APP_BASE_URL.value().replace(/\/$/, '')}/#/login`,
    });
    await sendPasswordResetLinkEmail({ email: normalizedEmail, fullName: profile.data().fullName, resetLink });
    await writeAuditLog({ actorUid: authUser.uid, action: 'auth.password_reset.request', targetUid: authUser.uid, schoolId: input.schoolId });
  } catch {
    // Always return the same response so callers cannot enumerate accounts or memberships.
  }
  return { ok: true };
}

export const setActiveSchool = onCall(CALLABLE_OPTIONS, request => safely(setActiveSchoolHandler, request));
export const requestPublicPasswordReset = onCall(AUTH_EMAIL_OPTIONS, request => safely(requestPublicPasswordResetHandler, request));
