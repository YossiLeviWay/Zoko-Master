import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebaseAdmin.js';
import { failedPrecondition, permissionDenied } from './errors.js';

export async function assertNotLastGlobalAdmin(targetUid) {
  const targetAuth = await adminAuth.getUser(targetUid);
  if (targetAuth.customClaims?.global_admin !== true) return;
  const snapshot = await adminDb.collection('users').where('role', '==', 'global_admin').limit(2).get();
  if (snapshot.size <= 1) throw failedPrecondition();
}

export async function setGlobalAdminClaim(uid, enabled) {
  const userRecord = await adminAuth.getUser(uid);
  const claims = { ...(userRecord.customClaims || {}) };
  if (enabled) claims.global_admin = true;
  else delete claims.global_admin;
  await adminAuth.setCustomUserClaims(uid, claims);
}

export async function createUserProfile(input) {
  const authUser = await adminAuth.createUser({
    email: input.email,
    displayName: input.fullName,
    emailVerified: false,
    disabled: false,
  });

  try {
    await adminDb.collection('users').doc(authUser.uid).create({
      uid: authUser.uid,
      email: input.email,
      fullName: input.fullName,
      phone: input.phone,
      jobTitle: input.jobTitle,
      role: input.role,
      schoolId: input.schoolId,
      schoolIds: [input.schoolId],
      pendingSchools: [],
      permissions: {},
      customRoleIds: [],
      teamIds: [],
      avatar: '',
      avatarStyle: input.avatarStyle,
      accountStatus: 'active',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    await adminAuth.deleteUser(authUser.uid).catch(() => undefined);
    throw error;
  }

  return authUser.uid;
}

export function ensurePrincipalCanGrantRole(actor, nextRole) {
  if (actor.globalAdmin) return;
  if (!['viewer', 'editor'].includes(nextRole)) throw permissionDenied();
}
