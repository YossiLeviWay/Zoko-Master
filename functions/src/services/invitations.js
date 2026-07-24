import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebaseAdmin.js';
import { publicError } from './errors.js';
import { sendInvitationEmail } from './email.js';
import { writeAuditLog } from './audit.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function sameToken(expectedHex, token) {
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(String(expectedHex || ''), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function findAuthUserByEmail(email) {
  try {
    return await adminAuth.getUserByEmail(normalizeEmail(email));
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return null;
    throw error;
  }
}

function userHasSchool(data, schoolId) {
  return data?.schoolId === schoolId || (Array.isArray(data?.schoolIds) && data.schoolIds.includes(schoolId));
}

export async function createInvitationRecord({
  actor,
  schoolId,
  fullName,
  email,
  role = 'viewer',
  customRoleIds = [],
  teamIds = [],
  classIds = [],
  permissions = {},
  message = '',
  sourceJoinRequestId = '',
  throwOnDeliveryFailure = true,
}) {
  const normalizedEmail = normalizeEmail(email);
  const schoolRef = adminDb.collection('schools').doc(schoolId);
  const schoolSnapshot = await schoolRef.get();
  if (!schoolSnapshot.exists) throw publicError('not-found', 'school-not-found', 'המוסד לא נמצא.');
  const school = schoolSnapshot.data();
  if (school.status === 'disabled') throw publicError('failed-precondition', 'school-disabled', 'המוסד אינו פעיל.');

  const authUser = await findAuthUserByEmail(normalizedEmail);
  if (authUser) {
    const profile = await adminDb.collection('users').doc(authUser.uid).get();
    if (profile.exists && userHasSchool(profile.data(), schoolId)) {
      throw publicError('already-exists', 'email-already-member', 'המשתמש כבר חבר במוסד.');
    }
  }

  const invitations = schoolRef.collection('invitations');
  const duplicate = await invitations
    .where('normalizedEmail', '==', normalizedEmail)
    .where('status', '==', 'pending')
    .limit(1)
    .get();
  if (!duplicate.empty) {
    throw publicError('already-exists', 'invitation-already-exists', 'כבר קיימת הזמנה פעילה לכתובת זו.');
  }

  const invitationRef = invitations.doc();
  const secretRef = adminDb.collection('_invitationSecrets').doc(invitationRef.id);
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Timestamp.fromMillis(Date.now() + INVITATION_TTL_MS);
  const batch = adminDb.batch();
  batch.create(invitationRef, {
    schoolId,
    fullName: String(fullName).trim(),
    normalizedEmail,
    role,
    customRoleIds,
    teamIds,
    classIds,
    permissions,
    message: String(message || '').trim(),
    sourceJoinRequestId,
    status: 'pending',
    emailDeliveryStatus: 'queued',
    expiresAt,
    inviterId: actor.uid,
    createdBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.create(secretRef, {
    invitationId: invitationRef.id,
    schoolId,
    tokenHash: hashToken(token),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });
  await batch.commit();

  let delivery = 'failed';
  try {
    const result = await sendInvitationEmail({
      email: normalizedEmail,
      fullName,
      schoolName: school.name,
      invitationId: invitationRef.id,
      token,
      expiresAt,
    });
    delivery = result.delivery;
    await invitationRef.update({ emailDeliveryStatus: delivery, updatedAt: FieldValue.serverTimestamp() });
  } catch (error) {
    await invitationRef.update({ emailDeliveryStatus: 'failed', updatedAt: FieldValue.serverTimestamp() });
    if (throwOnDeliveryFailure) throw error;
  }

  await writeAuditLog({
    actorUid: actor.uid,
    action: 'staff.invitation.create',
    schoolId,
    metadata: { invitationId: invitationRef.id, role, delivery },
  });
  return { invitationId: invitationRef.id, delivery };
}

export async function rotateInvitationToken({ actor, schoolId, invitationId }) {
  const invitationRef = adminDb.doc(`schools/${schoolId}/invitations/${invitationId}`);
  const invitationSnapshot = await invitationRef.get();
  if (!invitationSnapshot.exists || !['pending', 'expired'].includes(invitationSnapshot.data().status)) {
    throw publicError('failed-precondition', 'invitation-not-pending', 'ההזמנה אינה ממתינה.');
  }
  const invitation = invitationSnapshot.data();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Timestamp.fromMillis(Date.now() + INVITATION_TTL_MS);
  const secretRef = adminDb.collection('_invitationSecrets').doc(invitationId);
  const batch = adminDb.batch();
  batch.set(secretRef, { invitationId, schoolId, tokenHash: hashToken(token), expiresAt, updatedAt: FieldValue.serverTimestamp() });
  batch.update(invitationRef, { status: 'pending', expiresAt, emailDeliveryStatus: 'queued', updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  try {
    const school = (await adminDb.collection('schools').doc(schoolId).get()).data();
    const result = await sendInvitationEmail({ email: invitation.normalizedEmail, fullName: invitation.fullName, schoolName: school.name, invitationId, token, expiresAt });
    await invitationRef.update({ emailDeliveryStatus: result.delivery, updatedAt: FieldValue.serverTimestamp() });
  } catch (error) {
    await invitationRef.update({ emailDeliveryStatus: 'failed', updatedAt: FieldValue.serverTimestamp() });
    throw error;
  }
  await writeAuditLog({ actorUid: actor.uid, action: 'staff.invitation.resend', schoolId, metadata: { invitationId } });
  return { ok: true };
}

export async function acceptInvitationToken({ invitationId, token, password, fullName }) {
  const secretRef = adminDb.collection('_invitationSecrets').doc(invitationId);
  const secretSnapshot = await secretRef.get();
  if (!secretSnapshot.exists || !sameToken(secretSnapshot.data().tokenHash, token)) {
    throw publicError('permission-denied', 'invitation-invalid', 'ההזמנה אינה תקינה או שפג תוקפה.');
  }
  const secret = secretSnapshot.data();
  const invitationRef = adminDb.doc(`schools/${secret.schoolId}/invitations/${invitationId}`);
  const invitationSnapshot = await invitationRef.get();
  if (!invitationSnapshot.exists || invitationSnapshot.data().status !== 'pending') {
    throw publicError('failed-precondition', 'invitation-already-used', 'ההזמנה כבר טופלה.');
  }
  const invitation = invitationSnapshot.data();
  if (invitation.expiresAt.toMillis() <= Date.now() || secret.expiresAt.toMillis() <= Date.now()) {
    await invitationRef.update({ status: 'expired', updatedAt: FieldValue.serverTimestamp() });
    throw publicError('deadline-exceeded', 'invitation-expired', 'תוקף ההזמנה פג.');
  }
  const schoolSnapshot = await adminDb.collection('schools').doc(secret.schoolId).get();
  if (!schoolSnapshot.exists || schoolSnapshot.data().status === 'disabled') {
    throw publicError('failed-precondition', 'school-not-found', 'המוסד אינו זמין.');
  }

  let authUser = await findAuthUserByEmail(invitation.normalizedEmail);
  let createdAuthUser = false;
  if (!authUser) {
    authUser = await adminAuth.createUser({
      email: invitation.normalizedEmail,
      password,
      displayName: String(fullName || invitation.fullName).trim(),
      emailVerified: false,
      disabled: false,
    });
    createdAuthUser = true;
  }

  const userRef = adminDb.collection('users').doc(authUser.uid);
  const membershipRef = adminDb.doc(`schools/${secret.schoolId}/memberships/${authUser.uid}`);
  const schoolRef = adminDb.collection('schools').doc(secret.schoolId);
  try {
    await adminDb.runTransaction(async transaction => {
      const [freshInvitation, freshSecret, userSnapshot] = await Promise.all([
        transaction.get(invitationRef), transaction.get(secretRef), transaction.get(userRef),
      ]);
      if (!freshInvitation.exists || freshInvitation.data().status !== 'pending' || !freshSecret.exists) {
        throw publicError('failed-precondition', 'invitation-already-used', 'ההזמנה כבר טופלה.');
      }
      const current = userSnapshot.data() || {};
      const role = invitation.role === 'institution_manager' ? 'institution_manager' : current.role || invitation.role || 'viewer';
      transaction.set(userRef, {
        uid: authUser.uid,
        email: invitation.normalizedEmail,
        fullName: String(fullName || invitation.fullName).trim(),
        role,
        schoolId: current.schoolId || secret.schoolId,
        schoolIds: [...new Set([...(current.schoolIds || []), secret.schoolId])],
        pendingSchools: (current.pendingSchools || []).filter(id => id !== secret.schoolId),
        customRoleIds: [...new Set([...(current.customRoleIds || []), ...(invitation.customRoleIds || [])])],
        teamIds: [...new Set([...(current.teamIds || []), ...(invitation.teamIds || [])])],
        permissions: { ...(current.permissions || {}), ...(invitation.permissions || {}) },
        rolesBySchool: { ...(current.rolesBySchool || {}), [secret.schoolId]: invitation.role },
        accountStatus: 'active',
        updatedAt: FieldValue.serverTimestamp(),
        ...(userSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true });
      transaction.set(membershipRef, {
        schoolId: secret.schoolId,
        userId: authUser.uid,
        role: invitation.role,
        customRoleIds: invitation.customRoleIds || [],
        teamIds: invitation.teamIds || [],
        classIds: invitation.classIds || [],
        status: 'active',
        joinedAt: FieldValue.serverTimestamp(),
        invitedBy: invitation.inviterId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(invitationRef, {
        status: 'accepted',
        acceptedBy: authUser.uid,
        acceptedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (invitation.role === 'institution_manager') {
        transaction.update(schoolRef, {
          primaryManagerId: authUser.uid,
          managerIds: FieldValue.arrayUnion(authUser.uid),
          pendingManagerInvitationId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      transaction.delete(secretRef);
    });
  } catch (error) {
    if (createdAuthUser) await adminAuth.deleteUser(authUser.uid).catch(() => undefined);
    throw error;
  }
  await writeAuditLog({ actorUid: authUser.uid, action: 'staff.invitation.accept', targetUid: authUser.uid, schoolId: secret.schoolId, metadata: { invitationId } });
  return { ok: true, email: invitation.normalizedEmail, schoolId: secret.schoolId, existingAccount: !createdAuthUser };
}
